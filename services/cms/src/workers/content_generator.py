"""
AI Content Generation Worker.

Polls for pending generation requests and processes them using Claude.
Runs as a background task within the CMS service.

Usage:
  Imported and started from main.py on startup if ANTHROPIC_API_KEY is set.
"""
import os
import json
import time
import asyncio
import logging

from ..models.database import get_pool
from ..models.events import emit_event

logger = logging.getLogger('cms.generator')

POLL_INTERVAL = int(os.getenv('GENERATION_POLL_INTERVAL', '30'))  # seconds


async def process_generation(gen_id: str, prompt: str, category: str,
                              model: str, temperature: float,
                              system_prompt: str | None) -> None:
    """Process a single generation request using Claude API."""
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

        default_system = (
            'You are a content writer for the SBIR Engine. Write clear, actionable content '
            'for small businesses pursuing federal R&D funding. Use short sentences. Be specific. '
            'No fluff. Focus on SBIR/STTR, proposal writing, and federal procurement strategy.'
        )

        messages = [
            {
                'role': 'user',
                'content': (
                    f'Write a {category.replace("_", " ")} article.\n\n'
                    f'Topic/instructions: {prompt}\n\n'
                    'Respond with a JSON object containing:\n'
                    '- "title": string (compelling, SEO-friendly)\n'
                    '- "excerpt": string (1-2 sentences, hooks the reader)\n'
                    '- "body": string (full article in markdown format, 400-800 words)\n'
                    '- "tags": array of strings (3-6 relevant tags)\n'
                    '- "meta_title": string (for SEO, under 60 chars)\n'
                    '- "meta_description": string (for SEO, under 160 chars)\n\n'
                    'Return ONLY valid JSON, no markdown fences.'
                ),
            }
        ]

        response = await client.messages.create(
            model=model,
            max_tokens=4096,
            temperature=temperature,
            system=system_prompt or default_system,
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
            payload={'model': model, 'tokens': tokens, 'duration_ms': duration_ms},
        )

        logger.info(f'Generation {gen_id} completed: "{result.get("title")}" ({duration_ms}ms)')

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
                )
            else:
                await asyncio.sleep(POLL_INTERVAL)

        except Exception as e:
            logger.error(f'[generation_loop] Error: {e}')
            await asyncio.sleep(POLL_INTERVAL)
