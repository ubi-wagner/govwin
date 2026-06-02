"""
Page Block management API routes.

Visual editor CRUD + workflow for page_block content items in cms_content.
All operations use the shared database (Main DB) since cms_content lives there.
"""
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..models.database import get_event_pool
from ..routers.auth import verify_session_token

logger = logging.getLogger('cms.page_blocks')

router = APIRouter(prefix="/page-blocks", tags=["page-blocks"])

_CMS_SESSION_COOKIE = 'cms_login_session'


# ── Auth helper ──────────────────────────────────────────────────────────────

def _require_admin(request: Request) -> dict:
    """Verify session cookie or API key. Returns user claims. Raises 401/403."""
    # Try JWT session cookie first
    token = request.cookies.get(_CMS_SESSION_COOKIE, '')
    if token:
        claims = verify_session_token(token)
        if claims:
            if claims.get('role') not in ('master_admin', 'rfp_admin'):
                raise HTTPException(status_code=403, detail='Admin role required')
            return claims

    # Fallback: check API key header
    import hmac
    api_key = os.getenv('CMS_API_KEY', '')
    provided = request.headers.get('x-cms-api-key', '')
    if api_key and provided and hmac.compare_digest(provided, api_key):
        return {'sub': 'api-key-user', 'email': 'api@cms', 'role': 'master_admin', 'name': 'API'}

    raise HTTPException(status_code=401, detail='Not authenticated')


def _get_shared_pool():
    """Get the shared database pool. Raises 503 if not configured."""
    pool = get_event_pool()
    if not pool:
        raise HTTPException(
            status_code=503,
            detail='Shared database not configured (SHARED_DATABASE_URL)',
        )
    return pool


async def _emit_shared_event(pool, event_type: str, user_id: str, payload: dict) -> None:
    """Emit event to shared system_events table (best-effort)."""
    try:
        await pool.execute(
            """
            INSERT INTO system_events
                (namespace, type, phase, actor_type, actor_id, payload)
            VALUES ($1, $2, 'single', 'user', $3, $4::jsonb)
            """,
            'system',
            event_type,
            user_id,
            json.dumps(payload),
        )
    except Exception as e:
        logger.error('[page_blocks] event emit failed for %s: %s', event_type, e)


# ── Request models ───────────────────────────────────────────────────────────

class BlockUpdate(BaseModel):
    id: str
    title: str | None = None
    body: str | None = None
    excerpt: str | None = None
    metadata: dict | None = None
    displayOrder: int | None = None


class BatchUpdateRequest(BaseModel):
    updates: list[BlockUpdate]


class PageRequest(BaseModel):
    page: str


class RejectRequest(BaseModel):
    page: str
    notes: str | None = None


class ApproveRequest(BaseModel):
    page: str
    blockIds: list[str] | None = None


class ReorderRequest(BaseModel):
    blockIds: list[str]


class AddBlankRequest(BaseModel):
    page: str
    section: str


class AiGenerateRequest(BaseModel):
    page: str
    section: str
    instructions: str | None = None


class AiReviseRequest(BaseModel):
    title: str
    body: str
    excerpt: str = ''
    instructions: str = 'Make it more compelling and concise.'


class AiFromUrlRequest(BaseModel):
    url: str
    page: str
    section: str
    instructions: str | None = None


class RevalidateRequest(BaseModel):
    page: str


# ── AI Constants ─────────────────────────────────────────────────────────────

SECTION_PROMPTS = {
    'hero': 'Write a compelling hero section. Return JSON with: title (headline, 8-12 words), excerpt (subtitle, 1 sentence), body (supporting paragraph, 2-3 sentences), and metadata with cta_text, cta_href, cta_secondary_text, cta_secondary_href.',
    'stats': 'Write a statistics/metrics block. Return JSON with: title (section heading), body (context sentence), and metadata with value (the number/stat), label (what it measures), suffix (unit like "+" or "%").',
    'pricing': 'Write a pricing section block. Return JSON with: title (plan name), excerpt (tagline), body (plan description), and metadata with price, period (e.g. "/month"), features (array of feature strings).',
    'features': 'Write a feature highlight block. Return JSON with: title (feature name), body (feature description, 2-3 sentences), and metadata with icon (emoji or icon name), items (array of bullet points if applicable).',
    'cta': 'Write a call-to-action section. Return JSON with: title (CTA heading), body (supporting copy, 1-2 sentences), and metadata with cta_text (button label), cta_href (URL path like "/apply"), note (optional fine print).',
    'how-it-works': 'Write a process/how-it-works step. Return JSON with: title (step name), body (step description), and metadata with step_number, detail_points (array of detail strings).',
    'testimonials': 'Write a customer testimonial block. Return JSON with: title (customer name and title), body (the testimonial quote), excerpt (company name).',
    'faq': 'Write an FAQ item. Return JSON with: title (the question), body (the answer, 2-4 sentences).',
}

AI_SYSTEM_PROMPT = (
    'You are a content writer for RFP Pipeline (also called SBIR Engine / GovWin), '
    'a SaaS platform that helps small businesses discover, score, and build proposals '
    'for federal R&D opportunities (SBIR, STTR, BAA, OTA).\n\n'
    'Write clear, professional marketing copy. Be specific about value propositions. '
    'No fluff. Target audience: small defense/tech companies pursuing government contracts.\n\n'
    'ALWAYS return valid JSON only — no markdown fences, no explanation text.'
)


# ── Helper: serialize row ────────────────────────────────────────────────────

def _row_to_block(row) -> dict:
    """Convert an asyncpg Record to a block dict with camelCase keys."""
    d = dict(row)
    metadata = d.get('metadata')
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = {}
    elif metadata is None:
        metadata = {}

    return {
        'id': str(d['id']),
        'slug': d.get('slug', ''),
        'title': d.get('title', ''),
        'contentType': d.get('content_type', 'page_block'),
        'body': d.get('body', ''),
        'excerpt': d.get('excerpt'),
        'author': d.get('author'),
        'tags': d.get('tags', []),
        'published': d.get('published', False),
        'status': d.get('status', 'draft'),
        'publishedAt': d['published_at'].isoformat() if d.get('published_at') else None,
        'featuredImage': d.get('featured_image'),
        'externalUrl': d.get('external_url'),
        'displayOrder': d.get('display_order', 0),
        'metadata': metadata,
        'createdAt': d['created_at'].isoformat() if d.get('created_at') else None,
        'updatedAt': d['updated_at'].isoformat() if d.get('updated_at') else None,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/")
async def list_page_blocks(request: Request, page: str):
    """Return all blocks for a page, ordered by display_order."""
    _require_admin(request)
    pool = _get_shared_pool()

    try:
        rows = await pool.fetch(
            """
            SELECT * FROM cms_content
            WHERE content_type = 'page_block'
              AND $1 = ANY(tags)
              AND status IN ('published', 'draft', 'pending')
            ORDER BY display_order ASC
            """,
            page,
        )
        blocks = [_row_to_block(r) for r in rows]
        return {'data': {'blocks': blocks, 'page': page, 'count': len(blocks)}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[GET /page-blocks] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to fetch page blocks')


@router.patch("/")
async def update_page_blocks(request: Request, body: BatchUpdateRequest):
    """
    Batch update blocks. Snapshots current state into metadata._versions before updating.
    Sets status='draft' and tracks _draftedBy.
    """
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_email = claims.get('email', 'unknown')
    user_id = claims.get('sub', 'unknown')

    saved = 0
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for update in body.updates:
                    block_id = uuid.UUID(update.id)

                    # Fetch current state for version snapshot
                    current = await conn.fetchrow(
                        'SELECT * FROM cms_content WHERE id = $1',
                        block_id,
                    )
                    if not current:
                        continue

                    current_meta = current['metadata']
                    if isinstance(current_meta, str):
                        try:
                            current_meta = json.loads(current_meta)
                        except (json.JSONDecodeError, TypeError):
                            current_meta = {}
                    elif current_meta is None:
                        current_meta = {}

                    # Build version snapshot
                    versions = current_meta.get('_versions', [])
                    current_version = current_meta.get('_currentVersion', 0)
                    new_version = current_version + 1

                    snapshot = {
                        'version': current_version,
                        'savedAt': datetime.now(timezone.utc).isoformat(),
                        'savedBy': user_email,
                        'title': current['title'] or '',
                        'body': current['body'] or '',
                        'excerpt': current.get('excerpt'),
                        'featuredImage': current.get('featured_image'),
                        'displayOrder': current.get('display_order', 0),
                        'metadata': {
                            k: v for k, v in current_meta.items()
                            if k not in ('_versions', '_currentVersion')
                        },
                    }
                    # Keep last 20 versions
                    versions = [snapshot] + versions[:19]

                    # Merge new metadata
                    new_meta = dict(current_meta)
                    if update.metadata is not None:
                        # Overwrite editable keys, preserve version tracking
                        for k, v in update.metadata.items():
                            if k not in ('_versions', '_currentVersion'):
                                new_meta[k] = v

                    new_meta['_versions'] = versions
                    new_meta['_currentVersion'] = new_version
                    new_meta['_draftedBy'] = user_email

                    # Build SET clause
                    set_parts = [
                        "status = 'draft'",
                        "metadata = $2::jsonb",
                        "updated_at = NOW()",
                    ]
                    params: list = [block_id, json.dumps(new_meta)]
                    idx = 3

                    if update.title is not None:
                        set_parts.append(f"title = ${idx}")
                        params.append(update.title)
                        idx += 1
                    if update.body is not None:
                        set_parts.append(f"body = ${idx}")
                        params.append(update.body)
                        idx += 1
                    if update.excerpt is not None:
                        set_parts.append(f"excerpt = ${idx}")
                        params.append(update.excerpt)
                        idx += 1
                    if update.displayOrder is not None:
                        set_parts.append(f"display_order = ${idx}")
                        params.append(update.displayOrder)
                        idx += 1

                    await conn.execute(
                        f"UPDATE cms_content SET {', '.join(set_parts)} WHERE id = $1",
                        *params,
                    )
                    saved += 1

        # Emit events
        await _emit_shared_event(pool, 'content.page_blocks_updated', user_id, {
            'blockCount': saved,
            'draftedBy': user_email,
        })

        return {'data': {'saved': saved}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[PATCH /page-blocks] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to update blocks')


@router.post("/publish")
async def publish_page(request: Request, body: PageRequest):
    """Publish all drafts for a page."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    try:
        result = await pool.execute(
            """
            UPDATE cms_content
            SET status = 'published', published = true, published_at = NOW(), updated_at = NOW()
            WHERE content_type = 'page_block'
              AND $1 = ANY(tags)
              AND status IN ('draft', 'pending')
            """,
            body.page,
        )
        # asyncpg returns "UPDATE N"
        count = int(result.split()[-1]) if result else 0

        await _emit_shared_event(pool, 'content.page_blocks_published', user_id, {
            'page': body.page,
            'publishedCount': count,
        })

        return {'data': {'published': count, 'page': body.page}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/publish] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to publish blocks')


@router.post("/submit-review")
async def submit_for_review(request: Request, body: PageRequest):
    """Move drafts to pending status for review."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    try:
        result = await pool.execute(
            """
            UPDATE cms_content
            SET status = 'pending', updated_at = NOW()
            WHERE content_type = 'page_block'
              AND $1 = ANY(tags)
              AND status = 'draft'
            """,
            body.page,
        )
        count = int(result.split()[-1]) if result else 0

        await _emit_shared_event(pool, 'content.page_blocks_submitted', user_id, {
            'page': body.page,
            'submittedCount': count,
        })

        return {'data': {'submitted': count, 'page': body.page}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/submit-review] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to submit blocks for review')


@router.post("/approve")
async def approve_blocks(request: Request, body: ApproveRequest):
    """Approve pending blocks (publish them)."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    try:
        if body.blockIds:
            # Approve specific blocks
            block_uuids = [uuid.UUID(bid) for bid in body.blockIds]
            result = await pool.execute(
                """
                UPDATE cms_content
                SET status = 'published', published = true, published_at = NOW(), updated_at = NOW()
                WHERE content_type = 'page_block'
                  AND $1 = ANY(tags)
                  AND status = 'pending'
                  AND id = ANY($2::uuid[])
                """,
                body.page,
                block_uuids,
            )
        else:
            # Approve all pending for page
            result = await pool.execute(
                """
                UPDATE cms_content
                SET status = 'published', published = true, published_at = NOW(), updated_at = NOW()
                WHERE content_type = 'page_block'
                  AND $1 = ANY(tags)
                  AND status = 'pending'
                """,
                body.page,
            )
        count = int(result.split()[-1]) if result else 0

        await _emit_shared_event(pool, 'content.page_blocks_approved', user_id, {
            'page': body.page,
            'approvedCount': count,
        })

        return {'data': {'approved': count, 'page': body.page}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/approve] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to approve blocks')


@router.post("/reject")
async def reject_blocks(request: Request, body: RejectRequest):
    """Reject pending blocks back to draft."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    try:
        result = await pool.execute(
            """
            UPDATE cms_content
            SET status = 'draft', updated_at = NOW()
            WHERE content_type = 'page_block'
              AND $1 = ANY(tags)
              AND status = 'pending'
            """,
            body.page,
        )
        count = int(result.split()[-1]) if result else 0

        await _emit_shared_event(pool, 'content.page_blocks_rejected', user_id, {
            'page': body.page,
            'rejectedCount': count,
            'notes': body.notes,
        })

        return {'data': {'rejected': count, 'page': body.page, 'notes': body.notes}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/reject] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to reject blocks')


@router.post("/reorder")
async def reorder_blocks(request: Request, body: ReorderRequest):
    """Atomically reorder blocks by setting display_order 0, 1, 2, ..."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for i, block_id_str in enumerate(body.blockIds):
                    block_id = uuid.UUID(block_id_str)
                    await conn.execute(
                        "UPDATE cms_content SET display_order = $1, updated_at = NOW() WHERE id = $2",
                        i, block_id,
                    )

        await _emit_shared_event(pool, 'content.page_blocks_reordered', user_id, {
            'blockCount': len(body.blockIds),
        })

        return {'data': {'reordered': len(body.blockIds)}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/reorder] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to reorder blocks')


@router.post("/add-blank")
async def add_blank_block(request: Request, body: AddBlankRequest):
    """Create a blank block with page/section tags at the end of the section."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_email = claims.get('email', 'unknown')
    user_id = claims.get('sub', 'unknown')

    try:
        # Look up user UUID from email for created_by FK
        user_row = await pool.fetchrow("SELECT id FROM users WHERE email = $1", user_email)
        creator_id = user_row['id'] if user_row else None

        # Get current max display_order for the page
        max_order = await pool.fetchval(
            """
            SELECT COALESCE(MAX(display_order), -1) FROM cms_content
            WHERE content_type = 'page_block' AND $1 = ANY(tags)
            """,
            body.page,
        )
        new_order = (max_order or 0) + 1

        slug = f"page-block-{body.page}-{body.section}-{uuid.uuid4().hex[:8]}"
        tags = [body.page, body.section]

        row = await pool.fetchrow(
            """
            INSERT INTO cms_content
                (slug, title, content_type, body, excerpt, tags, display_order,
                 metadata, status, published, created_by)
            VALUES ($1, $2, 'page_block', '', NULL, $3, $4,
                    $5::jsonb, 'draft', false, $6)
            RETURNING *
            """,
            slug,
            f"New {body.section} block",
            tags,
            new_order,
            json.dumps({'_currentVersion': 0, '_versions': [], '_draftedBy': user_email}),
            creator_id,
        )

        await _emit_shared_event(pool, 'content.page_block_created', user_id, {
            'page': body.page,
            'section': body.section,
            'blockId': str(row['id']),
        })

        return {'data': _row_to_block(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/add-blank] Error: %s', e)
        raise HTTPException(status_code=500, detail='Failed to create blank block')


@router.delete("/{block_id}")
async def delete_block(request: Request, block_id: str):
    """Delete a page block."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    try:
        bid = uuid.UUID(block_id)
        result = await pool.execute(
            "DELETE FROM cms_content WHERE id = $1 AND content_type = 'page_block'",
            bid,
        )
        count = int(result.split()[-1]) if result else 0
        if count == 0:
            raise HTTPException(status_code=404, detail='Block not found')

        await _emit_shared_event(pool, 'content.page_block_deleted', user_id, {
            'blockId': block_id,
        })

        return {'data': {'deleted': True, 'id': block_id}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[DELETE /page-blocks/%s] Error: %s', block_id, e)
        raise HTTPException(status_code=500, detail='Failed to delete block')


# ── AI Endpoints ─────────────────────────────────────────────────────────────

async def _call_claude(system_prompt: str, user_prompt: str) -> dict:
    """Call Claude API and parse JSON response."""
    import anthropic
    client = anthropic.AsyncAnthropic()

    response = await client.messages.create(
        model='claude-sonnet-4-20250514',
        max_tokens=2000,
        system=system_prompt,
        messages=[{'role': 'user', 'content': user_prompt}],
    )

    text = ''.join(
        b.text for b in response.content if b.type == 'text'
    )
    cleaned = text.replace('```json\n', '').replace('```\n', '').replace('```', '').strip()
    return json.loads(cleaned)


@router.post("/ai/generate")
async def ai_generate(request: Request, body: AiGenerateRequest):
    """AI-generate content for a page section."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    section_type = body.section.replace('-', '_').split('_')[0] if '-' in body.section else body.section
    # Try exact match first, then stripped match
    section_prompt = SECTION_PROMPTS.get(
        body.section,
        SECTION_PROMPTS.get(
            section_type,
            'Write a marketing content block. Return JSON with: title, body, excerpt, and metadata (object with any relevant fields).',
        ),
    )

    user_prompt_parts = [
        f'Page: {body.page}',
        f'Section: {body.section}',
    ]
    if body.instructions:
        user_prompt_parts.append(f'Additional instructions: {body.instructions}')
    user_prompt_parts.append('')
    user_prompt_parts.append(section_prompt)
    user_prompt = '\n'.join(user_prompt_parts)

    try:
        await _emit_shared_event(pool, 'content.ai_generation_started', user_id, {
            'page': body.page,
            'section': body.section,
            'action': 'generate',
        })
    except Exception:
        pass

    try:
        result = await _call_claude(AI_SYSTEM_PROMPT, user_prompt)

        try:
            await _emit_shared_event(pool, 'content.ai_generation_completed', user_id, {
                'page': body.page,
                'section': body.section,
                'action': 'generate',
            })
        except Exception:
            pass

        return {
            'data': {
                'title': result.get('title', ''),
                'body': result.get('body', ''),
                'excerpt': result.get('excerpt', ''),
                'metadata': result.get('metadata', {}),
            }
        }
    except Exception as e:
        logger.error('[POST /page-blocks/ai/generate] Claude failed: %s', e)

        try:
            await _emit_shared_event(pool, 'content.ai_generation_failed', user_id, {
                'page': body.page,
                'section': body.section,
                'action': 'generate',
                'error': str(e),
            })
        except Exception:
            pass

        raise HTTPException(status_code=502, detail='AI generation failed')


@router.post("/ai/revise")
async def ai_revise(request: Request, body: AiReviseRequest):
    """AI-revise existing content."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    if not body.title and not body.body:
        raise HTTPException(status_code=422, detail='title or body required for revision')

    user_prompt_parts = [
        'Revise the following marketing content. Keep the same structure and intent but improve clarity, impact, and persuasion.',
        '',
        f'Instructions: {body.instructions}',
        '',
    ]
    if body.title:
        user_prompt_parts.append(f'Current title: "{body.title}"')
    if body.excerpt:
        user_prompt_parts.append(f'Current excerpt: "{body.excerpt}"')
    if body.body:
        user_prompt_parts.append(f'Current body:\n{body.body}')
    user_prompt_parts.append('')
    user_prompt_parts.append('Return JSON with: title, body, excerpt (all revised versions). Keep metadata unchanged.')
    user_prompt = '\n'.join(user_prompt_parts)

    try:
        await _emit_shared_event(pool, 'content.ai_revision_started', user_id, {
            'action': 'revise',
            'instructions': body.instructions,
        })
    except Exception:
        pass

    try:
        result = await _call_claude(AI_SYSTEM_PROMPT, user_prompt)

        await _emit_shared_event(pool, 'content.ai_revision_completed', user_id, {
            'action': 'revise',
        })

        return {
            'data': {
                'title': result.get('title', body.title),
                'body': result.get('body', body.body),
                'excerpt': result.get('excerpt', body.excerpt),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/ai/revise] Claude failed: %s', e)
        raise HTTPException(status_code=502, detail='AI revision failed')


@router.post("/ai/from-url")
async def ai_from_url(request: Request, body: AiFromUrlRequest):
    """Generate content from a URL source."""
    claims = _require_admin(request)
    pool = _get_shared_pool()
    user_id = claims.get('sub', 'unknown')

    if not body.url:
        raise HTTPException(status_code=422, detail='url is required')

    # Fetch URL content
    page_text = ''
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(body.url)
            html = resp.text
        page_text = re.sub(r'<script[^>]*>[\s\S]*?</script>', '', html, flags=re.IGNORECASE)
        page_text = re.sub(r'<style[^>]*>[\s\S]*?</style>', '', page_text, flags=re.IGNORECASE)
        page_text = re.sub(r'<[^>]+>', ' ', page_text)
        page_text = re.sub(r'\s+', ' ', page_text).strip()[:8000]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f'Failed to fetch URL: {e}')

    section_type = body.section.replace('-', '_').split('_')[0] if '-' in body.section else body.section
    section_prompt = SECTION_PROMPTS.get(
        body.section,
        SECTION_PROMPTS.get(
            section_type,
            'Write a marketing content block. Return JSON with: title, body, excerpt, and metadata.',
        ),
    )

    user_prompt_parts = [
        'Analyze the following web page content and create a marketing content block inspired by its messaging, but written for RFP Pipeline / SBIR Engine.',
    ]
    if body.instructions:
        user_prompt_parts.append(f'Additional instructions: {body.instructions}')
    user_prompt_parts.extend([
        '',
        f'Target page: {body.page}, section: {body.section}',
        section_prompt,
        '',
        f'Source page content:\n{page_text}',
    ])
    user_prompt = '\n'.join(user_prompt_parts)

    try:
        await _emit_shared_event(pool, 'content.ai_generation_started', user_id, {
            'page': body.page,
            'section': body.section,
            'action': 'from_url',
            'sourceUrl': body.url,
        })
    except Exception:
        pass

    try:
        result = await _call_claude(AI_SYSTEM_PROMPT, user_prompt)

        try:
            await _emit_shared_event(pool, 'content.ai_generation_completed', user_id, {
                'page': body.page,
                'section': body.section,
                'action': 'from_url',
                'sourceUrl': body.url,
            })
        except Exception:
            pass

        return {
            'data': {
                'title': result.get('title', ''),
                'body': result.get('body', ''),
                'excerpt': result.get('excerpt', ''),
                'metadata': result.get('metadata', {}),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error('[POST /page-blocks/ai/from-url] Claude failed: %s', e)
        raise HTTPException(status_code=502, detail='AI generation from URL failed')


@router.post("/revalidate")
async def revalidate(request: Request, body: RevalidateRequest):
    """Trigger ISR revalidation on the Next.js frontend."""
    _require_admin(request)

    frontend_url = os.getenv('FRONTEND_URL', '')
    if not frontend_url:
        return {'data': {'revalidated': False, 'reason': 'FRONTEND_URL not configured'}}

    page_paths = {
        'homepage': '/',
        'about': '/about',
        'features': '/features',
        'value': '/value',
        'pricing': '/pricing',
        'how-it-works': '/how-it-works',
        'engine': '/engine',
        'the-expert': '/the-expert',
        'security': '/infosec',
        'infosec': '/infosec',
        'apply': '/apply',
        'get-started': '/pricing',
        'resources': '/resources',
    }

    path = page_paths.get(body.page, f'/{body.page}')

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f'{frontend_url}/api/cms/revalidate',
                json={'path': path},
                headers={
                    'Content-Type': 'application/json',
                    'x-revalidate-secret': os.getenv('REVALIDATE_SECRET', ''),
                },
            )
        return {'data': {'revalidated': resp.status_code == 200, 'path': path}}
    except Exception as e:
        logger.error('[POST /page-blocks/revalidate] Error: %s', e)
        return {'data': {'revalidated': False, 'reason': str(e)}}
