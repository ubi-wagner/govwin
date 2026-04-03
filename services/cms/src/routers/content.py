"""
Content pipeline API routes.

Full CRUD + workflow for content posts, AI generations, and review queue.
All operations record events for the automation system.
"""
import logging
import uuid
import re

from fastapi import APIRouter, HTTPException, Query
from ..models.database import get_pool
from ..models.events import emit_event
from ..models.schemas import (
    PostCreate, PostUpdate, PostOut, WorkflowAction,
    GenerationRequest, GenerationOut, GenerationAction,
    ReviewOut,
)

logger = logging.getLogger('cms.content')
router = APIRouter()

# Valid status transitions
TRANSITIONS = {
    'submit_review': {'from': ['draft'], 'to': 'in_review'},
    'approve': {'from': ['in_review'], 'to': 'approved'},
    'reject': {'from': ['in_review'], 'to': 'rejected'},
    'publish': {'from': ['approved'], 'to': 'published'},
    'unpublish': {'from': ['published'], 'to': 'draft'},
    'archive': {'from': ['draft', 'rejected', 'published', 'approved', 'reverted'], 'to': 'archived'},
    'revert': {'from': ['draft', 'in_review', 'approved', 'rejected'], 'to': 'reverted'},
}


def _slug(title: str) -> str:
    """Generate URL-safe slug with random suffix."""
    base = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:80]
    suffix = uuid.uuid4().hex[:6]
    return f'{base}-{suffix}'


# ── Posts CRUD ───────────────────────────────────────────────────

@router.get('/posts')
async def list_posts(
    status: str | None = Query(None),
    category: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    """List content posts with optional filters."""
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1
        if category:
            conditions.append(f'category = ${idx}')
            params.append(category)
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM cms_posts {where} ORDER BY updated_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /posts] Error: {e}')
        raise HTTPException(500, 'Failed to fetch posts')


@router.get('/posts/{post_id}')
async def get_post(post_id: str):
    """Get a single post by ID."""
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM cms_posts WHERE id = $1', uuid.UUID(post_id))
        if not row:
            raise HTTPException(404, 'Post not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /posts/{post_id}] Error: {e}')
        raise HTTPException(500, 'Failed to fetch post')


@router.post('/posts', status_code=201)
async def create_post(body: PostCreate):
    """Create a new draft post."""
    pool = get_pool()
    try:
        slug = _slug(body.title)
        row = await pool.fetchrow(
            """
            INSERT INTO cms_posts (slug, title, body, body_format, excerpt, category, tags,
                meta_title, meta_description, author_id, author_name, author_email,
                featured_image_id, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::uuid, 'draft')
            RETURNING *
            """,
            slug, body.title, body.body, body.body_format, body.excerpt,
            body.category, body.tags, body.meta_title, body.meta_description,
            body.author_id, body.author_name, body.author_email,
            body.featured_image_id,
        )

        await emit_event(
            'content_pipeline.post.created',
            entity_id=str(row['id']),
            user_id=body.author_id,
            diff_summary=f'Draft post created: "{body.title}"',
            payload={'slug': slug, 'category': body.category},
        )

        return {'data': dict(row)}
    except Exception as e:
        logger.error(f'[POST /posts] Error: {e}')
        raise HTTPException(500, 'Failed to create post')


@router.patch('/posts/{post_id}')
async def update_post(post_id: str, body: PostUpdate):
    """Update a draft post's content fields. Increments version."""
    pool = get_pool()
    try:
        post = await pool.fetchrow('SELECT * FROM cms_posts WHERE id = $1', uuid.UUID(post_id))
        if not post:
            raise HTTPException(404, 'Post not found')

        # Build dynamic update — only set fields that were provided
        updates = {}
        if body.title is not None: updates['title'] = body.title
        if body.body is not None: updates['body'] = body.body
        if body.body_format is not None: updates['body_format'] = body.body_format
        if body.excerpt is not None: updates['excerpt'] = body.excerpt
        if body.category is not None: updates['category'] = body.category
        if body.tags is not None: updates['tags'] = body.tags
        if body.meta_title is not None: updates['meta_title'] = body.meta_title
        if body.meta_description is not None: updates['meta_description'] = body.meta_description
        if body.canonical_url is not None: updates['canonical_url'] = body.canonical_url
        if body.og_image_url is not None: updates['og_image_url'] = body.og_image_url
        if body.featured_image_id is not None: updates['featured_image_id'] = body.featured_image_id

        if not updates:
            return {'data': dict(post)}

        # Save previous version for revert
        set_parts = ['previous_body = body', 'previous_title = title', 'version = version + 1', 'updated_at = NOW()']
        params = [uuid.UUID(post_id)]
        idx = 2

        for col, val in updates.items():
            if col == 'featured_image_id' and val:
                set_parts.append(f'{col} = ${idx}::uuid')
            else:
                set_parts.append(f'{col} = ${idx}')
            params.append(val)
            idx += 1

        row = await pool.fetchrow(
            f"UPDATE cms_posts SET {', '.join(set_parts)} WHERE id = $1 RETURNING *",
            *params,
        )

        await emit_event(
            'content_pipeline.post.updated',
            entity_id=post_id,
            user_id=post['author_id'],
            diff_summary=f'Post updated: "{row["title"]}" (v{row["version"]})',
            payload={'version': row['version'], 'fields_changed': list(updates.keys())},
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /posts/{post_id}] Error: {e}')
        raise HTTPException(500, 'Failed to update post')


# ── Workflow Actions ─────────────────────────────────────────────

@router.post('/posts/{post_id}/action')
async def post_action(post_id: str, body: WorkflowAction):
    """Execute a workflow action on a post (submit, approve, reject, publish, etc.)."""
    pool = get_pool()
    action = body.action

    if action not in TRANSITIONS:
        raise HTTPException(400, f'Invalid action: {action}')

    try:
        transition = TRANSITIONS[action]

        async with pool.acquire() as conn:
            async with conn.transaction():
                post = await conn.fetchrow('SELECT * FROM cms_posts WHERE id = $1 FOR UPDATE', uuid.UUID(post_id))
                if not post:
                    raise HTTPException(404, 'Post not found')

                if post['status'] not in transition['from']:
                    raise HTTPException(
                        400,
                        f'Cannot {action}: post status is "{post["status"]}", must be one of: {", ".join(transition["from"])}',
                    )

                # Reject requires notes
                if action == 'reject' and not body.notes:
                    raise HTTPException(400, 'Notes are required when rejecting')

                # Revert requires previous version
                if action == 'revert' and not post['previous_body'] and not post['previous_title']:
                    raise HTTPException(400, 'No previous version to revert to')

                # Build the update query based on action
                if action == 'revert':
                    row = await conn.fetchrow(
                        """
                        UPDATE cms_posts SET
                            title = COALESCE(previous_title, title),
                            body = COALESCE(previous_body, body),
                            previous_title = NULL, previous_body = NULL,
                            status = $2, version = version + 1, updated_at = NOW()
                        WHERE id = $1 RETURNING *
                        """,
                        uuid.UUID(post_id), transition['to'],
                    )
                elif action == 'publish':
                    row = await conn.fetchrow(
                        'UPDATE cms_posts SET status = $2, published_at = NOW(), published_by = $3, updated_at = NOW() WHERE id = $1 RETURNING *',
                        uuid.UUID(post_id), transition['to'], body.user_id,
                    )
                elif action == 'unpublish':
                    row = await conn.fetchrow(
                        'UPDATE cms_posts SET status = $2, unpublished_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
                        uuid.UUID(post_id), transition['to'],
                    )
                elif action in ('approve', 'reject'):
                    row = await conn.fetchrow(
                        'UPDATE cms_posts SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4, updated_at = NOW() WHERE id = $1 RETURNING *',
                        uuid.UUID(post_id), transition['to'], body.user_id, body.notes,
                    )
                else:
                    row = await conn.fetchrow(
                        'UPDATE cms_posts SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
                        uuid.UUID(post_id), transition['to'],
                    )

                # Create immutable review record in same transaction
                await conn.execute(
                    """
                    INSERT INTO cms_reviews (post_id, action, reviewer_id, reviewer_email, notes, title_snapshot, body_snapshot, version_at_review)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """,
                    uuid.UUID(post_id), action, body.user_id, body.user_email,
                    body.notes, post['title'], post['body'], post['version'],
                )

        # Event emission outside transaction (fire-and-forget)
        await emit_event(
            f'content_pipeline.post.{action.replace("submit_review", "submitted_for_review")}',
            entity_id=post_id,
            user_id=body.user_id,
            diff_summary=f'Post {action.replace("_", " ")}: "{post["title"]}"',
            payload={'notes': body.notes, 'from_status': post['status'], 'to_status': transition['to']},
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /posts/{post_id}/action] {action} error: {e}')
        raise HTTPException(500, f'Failed to {action}')


# ── Reviews ──────────────────────────────────────────────────────

@router.get('/posts/{post_id}/reviews')
async def list_reviews(post_id: str):
    """Get review history for a post."""
    pool = get_pool()
    try:
        rows = await pool.fetch(
            'SELECT * FROM cms_reviews WHERE post_id = $1 ORDER BY created_at DESC',
            uuid.UUID(post_id),
        )
        return {'data': [dict(r) for r in rows]}
    except Exception as e:
        logger.error(f'[GET /posts/{post_id}/reviews] Error: {e}')
        raise HTTPException(500, 'Failed to fetch reviews')


# ── Generations ──────────────────────────────────────────────────

@router.get('/generations')
async def list_generations(status: str | None = Query(None), limit: int = Query(50, le=200)):
    """List AI content generations."""
    pool = get_pool()
    try:
        if status:
            rows = await pool.fetch(
                'SELECT * FROM cms_generations WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
                status, limit,
            )
        else:
            rows = await pool.fetch(
                'SELECT * FROM cms_generations ORDER BY created_at DESC LIMIT $1',
                limit,
            )
        return {'data': [dict(r) for r in rows]}
    except Exception as e:
        logger.error(f'[GET /generations] Error: {e}')
        raise HTTPException(500, 'Failed to fetch generations')


@router.post('/generations', status_code=201)
async def create_generation(body: GenerationRequest):
    """Create a new AI content generation request."""
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO cms_generations (prompt, category, model, temperature, system_prompt, status, requested_by)
            VALUES ($1, $2, $3, $4, $5, 'pending', $6)
            RETURNING *
            """,
            body.prompt, body.category, body.model, body.temperature, body.system_prompt, body.user_id,
        )

        await emit_event(
            'content_pipeline.generation.requested',
            entity_type='generation',
            entity_id=str(row['id']),
            user_id=body.user_id,
            diff_summary=f'AI generation requested: model={body.model}, category={body.category}',
        )

        return {'data': dict(row)}
    except Exception as e:
        logger.error(f'[POST /generations] Error: {e}')
        raise HTTPException(500, 'Failed to create generation request')


@router.post('/generations/{gen_id}/action')
async def generation_action(gen_id: str, body: GenerationAction):
    """Accept, reject, or retry a generation."""
    pool = get_pool()
    action = body.action

    try:
        gen = await pool.fetchrow('SELECT * FROM cms_generations WHERE id = $1', uuid.UUID(gen_id))
        if not gen:
            raise HTTPException(404, 'Generation not found')

        if action == 'accept':
            if gen['status'] != 'completed':
                raise HTTPException(400, f'Cannot accept generation with status "{gen["status"]}"')

            title = gen['generated_title'] or 'Untitled'
            slug = _slug(title)

            async with pool.acquire() as conn:
                async with conn.transaction():
                    post = await conn.fetchrow(
                        """
                        INSERT INTO cms_posts (slug, title, excerpt, body, category, tags,
                            generation_id, generated_by_model, generation_prompt, author_id, status)
                        VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10, 'draft')
                        RETURNING *
                        """,
                        slug, title, gen['generated_excerpt'], gen['generated_body'] or '',
                        gen['category'], gen['generated_tags'],
                        uuid.UUID(gen_id), gen['model'], gen['prompt'], body.user_id,
                    )
                    await conn.execute(
                        "UPDATE cms_generations SET status = 'accepted', post_id = $2 WHERE id = $1",
                        uuid.UUID(gen_id), post['id'],
                    )

            await emit_event('content_pipeline.generation.accepted', entity_type='generation',
                entity_id=gen_id, user_id=body.user_id,
                diff_summary=f'Generation accepted, draft created: "{title}"',
                payload={'post_id': str(post['id'])})

            return {'data': dict(post)}

        elif action == 'reject':
            if gen['status'] != 'completed':
                raise HTTPException(400, f'Cannot reject generation with status "{gen["status"]}"')

            row = await pool.fetchrow(
                "UPDATE cms_generations SET status = 'rejected', error_message = $2 WHERE id = $1 RETURNING *",
                uuid.UUID(gen_id), body.notes,
            )
            await emit_event('content_pipeline.generation.rejected', entity_type='generation',
                entity_id=gen_id, user_id=body.user_id,
                diff_summary=f'Generation rejected{": " + body.notes if body.notes else ""}')
            return {'data': dict(row)}

        elif action == 'retry':
            if gen['status'] != 'failed':
                raise HTTPException(400, f'Cannot retry generation with status "{gen["status"]}"')

            row = await pool.fetchrow(
                """
                INSERT INTO cms_generations (prompt, category, model, temperature, system_prompt, status, requested_by, retry_count)
                VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
                RETURNING *
                """,
                gen['prompt'], gen['category'], gen['model'], gen['temperature'],
                gen['system_prompt'], body.user_id, gen['retry_count'] + 1,
            )
            await emit_event('content_pipeline.generation.retry_requested', entity_type='generation',
                entity_id=str(row['id']), user_id=body.user_id,
                diff_summary=f'Generation retry requested (attempt {row["retry_count"] + 1})')
            return {'data': dict(row)}

        else:
            raise HTTPException(400, f'Invalid generation action: {action}')

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /generations/{gen_id}/action] {action} error: {e}')
        raise HTTPException(500, f'Failed to {action} generation')
