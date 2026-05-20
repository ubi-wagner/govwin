"""
Social media management API routes.

CRUD for social accounts and posts. These tables live in the CMS Postgres
database (migrated from Main Postgres in CMS migration 006).
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..models.database import get_pool
from ..models.events import emit_event

logger = logging.getLogger('cms.social')
router = APIRouter()


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='social', **kwargs))


def _get_cms_pool():
    """Get the CMS DB pool, raising 503 if unavailable."""
    try:
        return get_pool()
    except RuntimeError:
        raise HTTPException(503, 'CMS database not connected')


# ── Pydantic Models ────────────────────────────────────────────────

class SocialAccountCreate(BaseModel):
    platform: str  # linkedin, twitter, facebook, instagram
    account_name: str
    platform_account_id: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    token_expires_at: datetime | None = None
    tenant_id: str | None = None  # NULL = platform-owned account
    metadata: dict = {}


class SocialAccountUpdate(BaseModel):
    account_name: str | None = None
    platform_account_id: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    token_expires_at: datetime | None = None
    status: str | None = None
    metadata: dict | None = None


class SocialPostCreate(BaseModel):
    content_id: str | None = None  # FK to cms_content (nullable for standalone)
    social_account_id: str
    platform: str
    post_text: str
    media_urls: list[str] = []
    link_url: str | None = None
    scheduled_at: datetime | None = None
    status: str = 'draft'  # draft or scheduled
    created_by: str | None = None


class SocialPostUpdate(BaseModel):
    post_text: str | None = None
    media_urls: list[str] | None = None
    link_url: str | None = None
    scheduled_at: datetime | None = None
    status: str | None = None


# ── Accounts ───────────────────────────────────────────────────────

@router.get('/accounts')
async def list_accounts(
    platform: str | None = Query(None),
    status: str | None = Query(None),
    tenant_id: str | None = Query(None),
):
    """List connected social accounts with optional filters."""
    pool = _get_cms_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if platform:
            conditions.append(f'platform = ${idx}')
            params.append(platform)
            idx += 1
        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1
        if tenant_id:
            conditions.append(f'tenant_id = ${idx}')
            params.append(uuid.UUID(tenant_id))
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''

        rows = await pool.fetch(
            f'SELECT * FROM social_accounts {where} ORDER BY created_at DESC',
            *params,
        )
        # Strip sensitive fields from response
        data = []
        for r in rows:
            item = dict(r)
            item.pop('access_token', None)
            item.pop('refresh_token', None)
            data.append(item)

        return {'data': data, 'count': len(data)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /accounts] Error: {e}')
        raise HTTPException(500, 'Failed to fetch social accounts')


@router.post('/accounts', status_code=201)
async def create_account(body: SocialAccountCreate):
    """Register a new social media account."""
    pool = _get_cms_pool()
    try:
        valid_platforms = ('linkedin', 'twitter', 'facebook', 'instagram')
        if body.platform not in valid_platforms:
            raise HTTPException(400, f'Invalid platform. Must be one of: {", ".join(valid_platforms)}')

        row = await pool.fetchrow(
            '''INSERT INTO social_accounts
                   (platform, account_name, platform_account_id,
                    access_token, refresh_token, token_expires_at,
                    tenant_id, metadata)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
               RETURNING *''',
            body.platform, body.account_name, body.platform_account_id,
            body.access_token, body.refresh_token, body.token_expires_at,
            uuid.UUID(body.tenant_id) if body.tenant_id else None,
            json.dumps(body.metadata),
        )

        result = dict(row)
        result.pop('access_token', None)
        result.pop('refresh_token', None)

        _fire_event(
            'social.account.created',
            entity_id=str(row['id']),
            diff_summary=f'Social account registered: {body.platform}/{body.account_name}',
            payload={'platform': body.platform, 'account_name': body.account_name},
        )

        return {'data': result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /accounts] Error: {e}')
        raise HTTPException(500, 'Failed to create social account')


@router.patch('/accounts/{account_id}')
async def update_account(account_id: str, body: SocialAccountUpdate):
    """Update a social account (token refresh, status change, etc.)."""
    pool = _get_cms_pool()
    try:
        updates = []
        params = []
        idx = 1

        for field, value in body.model_dump(exclude_none=True).items():
            if field == 'metadata':
                updates.append(f'metadata = ${idx}::jsonb')
                params.append(json.dumps(value))
            elif field == 'token_expires_at':
                updates.append(f'token_expires_at = ${idx}')
                params.append(value)
            else:
                updates.append(f'{field} = ${idx}')
                params.append(value)
            idx += 1

        if not updates:
            raise HTTPException(400, 'No fields to update')

        updates.append(f'updated_at = ${idx}')
        params.append(datetime.now(timezone.utc))
        idx += 1

        params.append(uuid.UUID(account_id))
        row = await pool.fetchrow(
            f"UPDATE social_accounts SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )
        if not row:
            raise HTTPException(404, 'Social account not found')

        result = dict(row)
        result.pop('access_token', None)
        result.pop('refresh_token', None)

        return {'data': result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /accounts/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update social account')


# ── Posts ──────────────────────────────────────────────────────────

@router.get('/posts')
async def list_posts(
    status: str | None = Query(None),
    platform: str | None = Query(None),
    social_account_id: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    """List social posts with filters."""
    pool = _get_cms_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1
        if platform:
            conditions.append(f'platform = ${idx}')
            params.append(platform)
            idx += 1
        if social_account_id:
            conditions.append(f'social_account_id = ${idx}')
            params.append(uuid.UUID(social_account_id))
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM social_posts {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /posts] Error: {e}')
        raise HTTPException(500, 'Failed to fetch social posts')


@router.post('/posts', status_code=201)
async def create_post(body: SocialPostCreate):
    """Create or schedule a social media post."""
    pool = _get_cms_pool()
    try:
        # Validate the account exists
        account = await pool.fetchrow(
            'SELECT id, platform, status FROM social_accounts WHERE id = $1',
            uuid.UUID(body.social_account_id),
        )
        if not account:
            raise HTTPException(404, 'Social account not found')
        if account['status'] != 'active':
            raise HTTPException(400, f'Social account is {account["status"]}, not active')

        # Validate platform matches
        if body.platform != account['platform']:
            raise HTTPException(400, f'Platform mismatch: post says {body.platform}, account is {account["platform"]}')

        valid_statuses = ('draft', 'scheduled')
        if body.status not in valid_statuses:
            raise HTTPException(400, f'Initial status must be one of: {", ".join(valid_statuses)}')

        if body.status == 'scheduled' and not body.scheduled_at:
            raise HTTPException(400, 'scheduled_at is required when status is scheduled')

        row = await pool.fetchrow(
            '''INSERT INTO social_posts
                   (content_id, social_account_id, platform, post_text,
                    media_urls, link_url, scheduled_at, status, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING *''',
            uuid.UUID(body.content_id) if body.content_id else None,
            uuid.UUID(body.social_account_id),
            body.platform, body.post_text,
            body.media_urls, body.link_url,
            body.scheduled_at, body.status,
            uuid.UUID(body.created_by) if body.created_by else None,
        )

        _fire_event(
            'social.post.created',
            entity_id=str(row['id']),
            diff_summary=f'Social post created ({body.platform}): {body.post_text[:60]}',
            payload={
                'post_id': str(row['id']),
                'platform': body.platform,
                'status': body.status,
                'account_id': body.social_account_id,
            },
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /posts] Error: {e}')
        raise HTTPException(500, 'Failed to create social post')


@router.post('/posts/{post_id}/publish')
async def publish_post(post_id: str):
    """Publish a post now (override schedule). Sets scheduled_at to now and status to scheduled."""
    pool = _get_cms_pool()
    try:
        now = datetime.now(timezone.utc)

        post = await pool.fetchrow(
            'SELECT id, status FROM social_posts WHERE id = $1',
            uuid.UUID(post_id),
        )
        if not post:
            raise HTTPException(404, 'Social post not found')
        if post['status'] in ('posted', 'posting'):
            raise HTTPException(409, f'Post is already {post["status"]}')

        row = await pool.fetchrow(
            '''UPDATE social_posts
               SET status = 'scheduled', scheduled_at = $1, updated_at = $1
               WHERE id = $2
               RETURNING *''',
            now, uuid.UUID(post_id),
        )

        _fire_event(
            'social.post.publish_requested',
            entity_id=post_id,
            diff_summary=f'Social post publish requested (immediate)',
            payload={'post_id': post_id},
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /posts/{{id}}/publish] Error: {e}')
        raise HTTPException(500, 'Failed to publish social post')


@router.patch('/posts/{post_id}')
async def update_post(post_id: str, body: SocialPostUpdate):
    """Update post text, schedule, or status."""
    pool = _get_cms_pool()
    try:
        post = await pool.fetchrow(
            'SELECT id, status FROM social_posts WHERE id = $1',
            uuid.UUID(post_id),
        )
        if not post:
            raise HTTPException(404, 'Social post not found')
        if post['status'] in ('posted', 'posting'):
            raise HTTPException(409, f'Cannot modify post in {post["status"]} status')

        updates = []
        params = []
        idx = 1

        for field, value in body.model_dump(exclude_none=True).items():
            if field == 'media_urls':
                updates.append(f'media_urls = ${idx}')
                params.append(value)
            else:
                updates.append(f'{field} = ${idx}')
                params.append(value)
            idx += 1

        if not updates:
            raise HTTPException(400, 'No fields to update')

        updates.append(f'updated_at = ${idx}')
        params.append(datetime.now(timezone.utc))
        idx += 1

        params.append(uuid.UUID(post_id))
        row = await pool.fetchrow(
            f"UPDATE social_posts SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /posts/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update social post')
