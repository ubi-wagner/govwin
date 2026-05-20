"""
AI Content Generation Worker.

Polls for pending generation requests and processes them using Claude.
Supports multiple source types: prompt, url, email, screenshot, repackage.

Usage:
  Imported and started from main.py on startup if ANTHROPIC_API_KEY is set.
"""
import os
import json
import time
import asyncio
import base64
import logging
import re

from ..models.database import get_pool
from ..models.events import emit_event

logger = logging.getLogger('cms.generator')

POLL_INTERVAL = int(os.getenv('GENERATION_POLL_INTERVAL', '30'))  # seconds

DEFAULT_SYSTEM_PROMPT = (
    'You are a content writer for the SBIR Engine. Write clear, actionable content '
    'for small businesses pursuing federal R&D funding. Use short sentences. Be specific. '
    'No fluff. Focus on SBIR/STTR, proposal writing, and federal procurement strategy.'
)

JSON_OUTPUT_INSTRUCTIONS = (
    'Respond with a JSON object containing:\n'
    '- "title": string (compelling, SEO-friendly)\n'
    '- "excerpt": string (1-2 sentences, hooks the reader)\n'
    '- "body": string (full article in markdown format, 400-800 words)\n'
    '- "tags": array of strings (3-6 relevant tags)\n'
    '- "meta_title": string (for SEO, under 60 chars)\n'
    '- "meta_description": string (for SEO, under 160 chars)\n\n'
    'Return ONLY valid JSON, no markdown fences.'
)


async def _fetch_url_content(url: str) -> dict:
    """Fetch and extract text content from a URL."""
    import httpx

    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        resp = await client.get(url, headers={'User-Agent': 'RFPPipeline/1.0'})
        resp.raise_for_status()
        html = resp.text
    # Extract title
    title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.I)
    title = title_match.group(1).strip() if title_match else ''

    # Extract meta description
    desc_match = re.search(
        r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)', html, re.I
    )
    description = desc_match.group(1).strip() if desc_match else ''

    # Strip HTML tags for body text
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.S)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    # Truncate to reasonable length for Claude context
    text = text[:8000]

    return {'title': title, 'description': description, 'text': text, 'url': url}


async def _build_vision_messages(prompt, category, attachment_ids, pool):
    """Build Claude message with image attachments for vision generation."""
    content_blocks = []

    for media_id in (attachment_ids or []):
        try:
            media_row = await pool.fetchrow(
                'SELECT storage_path, content_type FROM cms_media WHERE id = $1::uuid',
                media_id,
            )
        except Exception as e:
            logger.error(f'[vision] Error fetching media {media_id}: {e}')
            continue

        if media_row and media_row['storage_path']:
            storage_root = os.getenv('CMS_STORAGE_ROOT', '/data/cms')
            full_path = os.path.join(storage_root, media_row['storage_path'])
            try:
                with open(full_path, 'rb') as f:
                    image_data = base64.standard_b64encode(f.read()).decode('ascii')
                content_blocks.append({
                    'type': 'image',
                    'source': {
                        'type': 'base64',
                        'media_type': media_row['content_type'],
                        'data': image_data,
                    }
                })
            except FileNotFoundError:
                logger.error(f'[vision] File not found: {full_path}')
            except Exception as e:
                logger.error(f'[vision] Error reading file {full_path}: {e}')

    content_blocks.append({
        'type': 'text',
        'text': (
            f'Based on the screenshot(s) above and these instructions:\n\n'
            f'{prompt}\n\n'
            f'Write a {category.replace("_", " ")} article.\n\n'
            f'{JSON_OUTPUT_INSTRUCTIONS}'
        ),
    })

    return [{'role': 'user', 'content': content_blocks}]


def _build_prompt_messages(prompt: str, category: str) -> list[dict]:
    """Build standard prompt-based messages (existing behavior)."""
    return [
        {
            'role': 'user',
            'content': (
                f'Write a {category.replace("_", " ")} article.\n\n'
                f'Topic/instructions: {prompt}\n\n'
                f'{JSON_OUTPUT_INSTRUCTIONS}'
            ),
        }
    ]


def _build_url_messages(prompt: str, category: str, url_content: dict) -> list[dict]:
    """Build messages for URL-driven generation."""
    source_text = url_content.get('text', '')
    source_title = url_content.get('title', '')
    source_desc = url_content.get('description', '')
    url = url_content.get('url', '')

    enhanced_prompt = (
        f'Based on this source material from {url}:\n\n'
        f'Title: {source_title}\n'
        f'Description: {source_desc}\n\n'
        f'{source_text[:6000]}\n\n'
        f'Original instructions: {prompt}\n\n'
        f'Generate a {category.replace("_", " ")} article based on this source material.\n\n'
        f'{JSON_OUTPUT_INSTRUCTIONS}'
    )
    return [{'role': 'user', 'content': enhanced_prompt}]


def _build_email_messages(prompt: str, category: str, source_content: str) -> list[dict]:
    """Build messages for email-driven generation."""
    enhanced_prompt = (
        f'Based on this email communication:\n\n'
        f'{source_content[:6000]}\n\n'
        f'Generate {category.replace("_", " ")} content that addresses or responds to '
        f'this communication.\n\n'
        f'Additional instructions: {prompt}\n\n'
        f'{JSON_OUTPUT_INSTRUCTIONS}'
    )
    return [{'role': 'user', 'content': enhanced_prompt}]


def _build_repackage_messages(prompt: str, category: str, source_content: str) -> list[dict]:
    """Build messages for repackaging existing content."""
    enhanced_prompt = (
        f'Repackage the following content for our SBIR/government contracting audience:\n\n'
        f'{source_content[:6000]}\n\n'
        f'Instructions: {prompt}\n\n'
        f'Generate a fresh {category.replace("_", " ")} article that presents this information '
        f'in a new way, tailored for small businesses pursuing federal R&D funding.\n\n'
        f'{JSON_OUTPUT_INSTRUCTIONS}'
    )
    return [{'role': 'user', 'content': enhanced_prompt}]


async def process_generation(gen_id: str, prompt: str, category: str,
                              model: str, temperature: float,
                              system_prompt: str | None,
                              source_type: str = 'prompt',
                              source_url: str | None = None,
                              source_content: str | None = None,
                              source_email_id: str | None = None,
                              attachments: list[str] | None = None) -> None:
    """Process a single generation request using Claude API.

    Supports multiple source types:
      - prompt: standard text prompt (original behavior)
      - url: fetch URL content, build enhanced prompt
      - email: use email thread content as source material
      - screenshot: use Claude vision with attached images
      - repackage: rewrite existing content for our audience
    """
    pool = get_pool()
    start_ms = time.monotonic()

    try:
        # Mark as generating
        await pool.execute(
            "UPDATE cms_generations SET status = 'generating' WHERE id = $1::uuid",
            gen_id,
        )

        # Import anthropic lazily (only when actually generating)
        import anthropic
        client = anthropic.AsyncAnthropic()

        system = system_prompt or DEFAULT_SYSTEM_PROMPT

        # Build messages based on source_type
        messages = None

        if source_type == 'url' and source_url:
            try:
                url_content = await _fetch_url_content(source_url)
                messages = _build_url_messages(prompt, category, url_content)
            except Exception as url_err:
                logger.error(f'[gen {gen_id}] URL fetch failed for {source_url}: {url_err}')
                # Fall back to prompt-only generation
                messages = _build_prompt_messages(
                    f'{prompt}\n\n(Note: attempted to fetch {source_url} but it failed)',
                    category,
                )

        elif source_type == 'email':
            email_content = source_content or ''
            if not email_content and source_email_id:
                # Fetch email content from email_sends
                try:
                    send_row = await pool.fetchrow(
                        'SELECT subject, body_text, body_html, recipient_email FROM email_sends WHERE id = $1::uuid',
                        source_email_id,
                    )
                    if send_row:
                        email_content = (
                            f"From: {send_row.get('recipient_email', 'unknown')}\n"
                            f"Subject: {send_row.get('subject', '')}\n\n"
                            f"{send_row.get('body_text') or send_row.get('body_html', '')}"
                        )
                except Exception as email_err:
                    logger.error(f'[gen {gen_id}] Email fetch failed for {source_email_id}: {email_err}')

            if email_content:
                messages = _build_email_messages(prompt, category, email_content)
            else:
                messages = _build_prompt_messages(prompt, category)

        elif source_type == 'screenshot' and attachments:
            messages = await _build_vision_messages(prompt, category, attachments, pool)

        elif source_type == 'repackage' and source_content:
            messages = _build_repackage_messages(prompt, category, source_content)

        else:
            # Default: standard prompt-based generation
            messages = _build_prompt_messages(prompt, category)

        response = await client.messages.create(
            model=model,
            max_tokens=4096,
            temperature=temperature,
            system=system,
            messages=messages,
        )

        # Parse response
        content_text = response.content[0].text if response.content else ''
        # Try to extract JSON from response (handle markdown fences)
        json_text = content_text.strip()
        if json_text.startswith('```'):
            json_text = json_text.split('\n', 1)[1] if '\n' in json_text else json_text[3:]
            if json_text.endswith('```'):
                json_text = json_text[:-3]
            json_text = json_text.strip()

        result = json.loads(json_text)
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        tokens = (response.usage.input_tokens + response.usage.output_tokens) if response.usage else None

        await pool.execute(
            """
            UPDATE cms_generations SET
                status = 'completed',
                generated_title = $2,
                generated_excerpt = $3,
                generated_body = $4,
                generated_tags = $5,
                generated_meta = $6::jsonb,
                tokens_used = $7,
                duration_ms = $8,
                completed_at = NOW()
            WHERE id = $1::uuid
            """,
            gen_id,
            result.get('title', 'Untitled'),
            result.get('excerpt'),
            result.get('body', ''),
            result.get('tags', []),
            json.dumps({'meta_title': result.get('meta_title'), 'meta_description': result.get('meta_description')}),
            tokens,
            duration_ms,
        )

        await emit_event(
            'content_pipeline.generation.completed',
            entity_type='generation',
            entity_id=str(gen_id),
            diff_summary=f'Generation completed: "{result.get("title", "Untitled")}" ({duration_ms}ms, {tokens} tokens)',
            payload={'model': model, 'tokens': tokens, 'duration_ms': duration_ms, 'source_type': source_type},
        )

        logger.info(f'Generation {gen_id} completed: "{result.get("title")}" ({duration_ms}ms, source={source_type})')

    except json.JSONDecodeError as e:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        error_msg = f'Failed to parse AI response as JSON: {str(e)[:200]}'
        await pool.execute(
            "UPDATE cms_generations SET status = 'failed', error_message = $2, duration_ms = $3 WHERE id = $1::uuid",
            gen_id, error_msg, duration_ms,
        )
        await emit_event('content_pipeline.generation.failed', entity_type='generation',
            entity_id=str(gen_id), diff_summary=error_msg)
        logger.error(f'Generation {gen_id} failed: {error_msg}')

    except Exception as e:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        error_msg = f'{type(e).__name__}: {str(e)[:300]}'
        await pool.execute(
            "UPDATE cms_generations SET status = 'failed', error_message = $2, duration_ms = $3 WHERE id = $1::uuid",
            gen_id, error_msg, duration_ms,
        )
        await emit_event('content_pipeline.generation.failed', entity_type='generation',
            entity_id=str(gen_id), diff_summary=f'Generation failed: {error_msg}')
        logger.error(f'Generation {gen_id} failed: {error_msg}')


async def generation_loop() -> None:
    """Poll for pending generations and process them."""
    logger.info(f'Content generation worker started (poll interval: {POLL_INTERVAL}s)')

    while True:
        try:
            pool = get_pool()
            # Dequeue one pending generation at a time (FIFO)
            row = await pool.fetchrow(
                """
                UPDATE cms_generations SET status = 'generating'
                WHERE id = (
                    SELECT id FROM cms_generations
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING *
                """
            )

            if row:
                logger.info(f'Processing generation {row["id"]}: {row["prompt"][:80]}...')
                await process_generation(
                    str(row['id']),
                    row['prompt'],
                    row['category'],
                    row['model'],
                    float(row['temperature']),
                    row.get('system_prompt'),
                    source_type=row.get('source_type', 'prompt') or 'prompt',
                    source_url=row.get('source_url'),
                    source_content=row.get('source_content'),
                    source_email_id=str(row['source_email_id']) if row.get('source_email_id') else None,
                    attachments=row.get('attachments') or [],
                )
            else:
                await asyncio.sleep(POLL_INTERVAL)

        except Exception as e:
            logger.error(f'[generation_loop] Error: {e}')
            await asyncio.sleep(POLL_INTERVAL)
