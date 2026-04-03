"""
Email automation engine API routes.

CRUD for accounts, templates, campaigns, sends.
AI-powered template drafting and reply interpretation.
Engagement tracking and thread management.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from ..models.database import get_pool
from ..models.events import emit_event


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='email', **kwargs))
from ..models.email_schemas import (
    AccountCreate, AccountUpdate, AccountOut,
    TemplateCreate, TemplateUpdate, TemplateDraftRequest, TemplateOut,
    CampaignCreate, CampaignUpdate, CampaignAction, CampaignOut,
    SendCreate, SendOut,
    EngagementOut, ThreadOut,
)

logger = logging.getLogger('cms.email')
router = APIRouter()


# ── Accounts ────────────────────────────────────────────────────

@router.get('/accounts')
async def list_accounts(active_only: bool = Query(False)):
    pool = get_pool()
    try:
        if active_only:
            rows = await pool.fetch(
                'SELECT * FROM email_accounts WHERE is_active = TRUE ORDER BY created_at DESC'
            )
        else:
            rows = await pool.fetch('SELECT * FROM email_accounts ORDER BY created_at DESC')
        return {'data': [dict(r) for r in rows]}
    except Exception as e:
        logger.error(f'[GET /accounts] Error: {e}')
        raise HTTPException(500, 'Failed to fetch accounts')


@router.get('/accounts/{account_id}')
async def get_account(account_id: str):
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM email_accounts WHERE id = $1', uuid.UUID(account_id))
        if not row:
            raise HTTPException(404, 'Account not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /accounts/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to fetch account')


@router.post('/accounts', status_code=201)
async def create_account(body: AccountCreate):
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            '''INSERT INTO email_accounts (email_address, display_name, account_type,
                   credentials_type, delegate_subject, daily_send_limit, sweep_enabled)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *''',
            body.email_address, body.display_name, body.account_type,
            body.credentials_type, body.delegate_subject, body.daily_send_limit,
            body.sweep_enabled,
        )
        return {'data': dict(row)}
    except Exception as e:
        if '23505' in str(e):
            raise HTTPException(409, 'Account with this email already exists')
        logger.error(f'[POST /accounts] Error: {e}')
        raise HTTPException(500, 'Failed to create account')


@router.patch('/accounts/{account_id}')
async def update_account(account_id: str, body: AccountUpdate):
    pool = get_pool()
    try:
        updates = []
        params = []
        idx = 1
        for field, value in body.model_dump(exclude_none=True).items():
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
            f"UPDATE email_accounts SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )
        if not row:
            raise HTTPException(404, 'Account not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /accounts/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update account')


# ── Templates ───────────────────────────────────────────────────

@router.get('/templates')
async def list_templates(
    category: str | None = Query(None),
    active_only: bool = Query(False),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if category:
            conditions.append(f'category = ${idx}')
            params.append(category)
            idx += 1
        if active_only:
            conditions.append('is_active = TRUE')

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM email_templates {where} ORDER BY updated_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /templates] Error: {e}')
        raise HTTPException(500, 'Failed to fetch templates')


@router.get('/templates/{template_id}')
async def get_template(template_id: str):
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM email_templates WHERE id = $1', uuid.UUID(template_id))
        if not row:
            raise HTTPException(404, 'Template not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /templates/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to fetch template')


@router.post('/templates', status_code=201)
async def create_template(body: TemplateCreate):
    pool = get_pool()
    try:
        import json
        row = await pool.fetchrow(
            '''INSERT INTO email_templates (name, slug, description, category,
                   subject_template, body_html, body_text, variables, tags)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
               RETURNING *''',
            body.name, body.slug, body.description, body.category,
            body.subject_template, body.body_html, body.body_text,
            json.dumps(body.variables), body.tags,
        )
        return {'data': dict(row)}
    except Exception as e:
        if '23505' in str(e):
            raise HTTPException(409, 'Template with this slug already exists')
        logger.error(f'[POST /templates] Error: {e}')
        raise HTTPException(500, 'Failed to create template')


@router.patch('/templates/{template_id}')
async def update_template(template_id: str, body: TemplateUpdate):
    pool = get_pool()
    try:
        import json
        updates = []
        params = []
        idx = 1

        for field, value in body.model_dump(exclude_none=True).items():
            if field == 'variables':
                updates.append(f'variables = ${idx}::jsonb')
                params.append(json.dumps(value))
            elif field == 'tags':
                updates.append(f'tags = ${idx}')
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
        updates.append(f'version = version + 1')

        params.append(uuid.UUID(template_id))
        row = await pool.fetchrow(
            f"UPDATE email_templates SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )
        if not row:
            raise HTTPException(404, 'Template not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /templates/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update template')


@router.post('/templates/draft', status_code=201)
async def draft_template_ai(body: TemplateDraftRequest):
    """Use Claude to draft a new email template from a prompt."""
    pool = get_pool()
    try:
        from ..workers.template_drafter import draft_template
        import json
        import re

        result = await draft_template(
            prompt=body.prompt,
            category=body.category,
            tone=body.tone,
            variables=body.variables or None,
            model=body.model,
            temperature=body.temperature,
        )

        name = body.name or result.get('name', 'Untitled Template')
        base_slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:80]
        slug = f'{base_slug}-{uuid.uuid4().hex[:6]}'

        row = await pool.fetchrow(
            '''INSERT INTO email_templates (name, slug, description, category,
                   subject_template, body_html, body_text,
                   ai_drafted, ai_prompt, ai_model, ai_drafted_at,
                   variables, tags)
               VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, NOW(), $10::jsonb, $11)
               RETURNING *''',
            name, slug,
            result.get('description', ''),
            body.category,
            result.get('subject_template', ''),
            result.get('body_html', ''),
            result.get('body_text', ''),
            body.prompt, body.model,
            json.dumps(result.get('variables', [])),
            [],
        )

        _fire_event(
            'email.template.drafted',
            entity_id=str(row['id']),
            diff_summary=f'AI drafted template: "{name}"',
            payload={'template_id': str(row['id']), 'name': name, 'model': body.model},
        )

        return {'data': dict(row)}

    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f'[POST /templates/draft] Error: {e}')
        raise HTTPException(500, 'Failed to draft template')


# ── Campaigns ───────────────────────────────────────────────────

CAMPAIGN_TRANSITIONS = {
    'activate': {'from': ['draft', 'paused'], 'to': 'active'},
    'pause': {'from': ['active', 'scheduled'], 'to': 'paused'},
    'resume': {'from': ['paused'], 'to': 'active'},
    'cancel': {'from': ['draft', 'scheduled', 'active', 'paused'], 'to': 'cancelled'},
    'complete': {'from': ['active'], 'to': 'completed'},
}


@router.get('/campaigns')
async def list_campaigns(
    status: str | None = Query(None),
    campaign_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1
        if campaign_type:
            conditions.append(f'campaign_type = ${idx}')
            params.append(campaign_type)
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM email_campaigns {where} ORDER BY updated_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /campaigns] Error: {e}')
        raise HTTPException(500, 'Failed to fetch campaigns')


@router.get('/campaigns/{campaign_id}')
async def get_campaign(campaign_id: str):
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM email_campaigns WHERE id = $1', uuid.UUID(campaign_id))
        if not row:
            raise HTTPException(404, 'Campaign not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /campaigns/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to fetch campaign')


@router.post('/campaigns', status_code=201)
async def create_campaign(body: CampaignCreate):
    pool = get_pool()
    try:
        import json
        row = await pool.fetchrow(
            '''INSERT INTO email_campaigns (name, description, campaign_type,
                   template_id, account_id, audience_type, audience_filter,
                   scheduled_at, cron_expression, timezone,
                   trigger_event, trigger_delay_hours, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
               RETURNING *''',
            body.name, body.description, body.campaign_type,
            uuid.UUID(body.template_id) if body.template_id else None,
            uuid.UUID(body.account_id) if body.account_id else None,
            body.audience_type, json.dumps(body.audience_filter),
            body.scheduled_at, body.cron_expression, body.timezone,
            body.trigger_event, body.trigger_delay_hours, body.created_by,
        )
        return {'data': dict(row)}
    except Exception as e:
        logger.error(f'[POST /campaigns] Error: {e}')
        raise HTTPException(500, 'Failed to create campaign')


@router.patch('/campaigns/{campaign_id}')
async def update_campaign(campaign_id: str, body: CampaignUpdate):
    pool = get_pool()
    try:
        import json
        updates = []
        params = []
        idx = 1

        for field, value in body.model_dump(exclude_none=True).items():
            if field == 'audience_filter':
                updates.append(f'audience_filter = ${idx}::jsonb')
                params.append(json.dumps(value))
            elif field in ('template_id', 'account_id'):
                updates.append(f'{field} = ${idx}')
                params.append(uuid.UUID(value) if value else None)
            else:
                updates.append(f'{field} = ${idx}')
                params.append(value)
            idx += 1

        if not updates:
            raise HTTPException(400, 'No fields to update')

        updates.append(f'updated_at = ${idx}')
        params.append(datetime.now(timezone.utc))
        idx += 1

        params.append(uuid.UUID(campaign_id))
        row = await pool.fetchrow(
            f"UPDATE email_campaigns SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )
        if not row:
            raise HTTPException(404, 'Campaign not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /campaigns/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update campaign')


@router.post('/campaigns/{campaign_id}/action')
async def campaign_action(campaign_id: str, body: CampaignAction):
    """Transition a campaign's status (activate, pause, resume, cancel, complete)."""
    pool = get_pool()
    try:
        transition = CAMPAIGN_TRANSITIONS.get(body.action)
        if not transition:
            raise HTTPException(400, f'Invalid action: {body.action}')

        row = await pool.fetchrow(
            'SELECT id, status, name FROM email_campaigns WHERE id = $1',
            uuid.UUID(campaign_id),
        )
        if not row:
            raise HTTPException(404, 'Campaign not found')

        if row['status'] not in transition['from']:
            raise HTTPException(
                409,
                f"Cannot {body.action} campaign in '{row['status']}' status"
            )

        now = datetime.now(timezone.utc)
        extra_sets = ''
        if body.action == 'activate':
            extra_sets = f', started_at = COALESCE(started_at, $4)'
        elif body.action in ('complete', 'cancel'):
            extra_sets = f', completed_at = $4'

        if extra_sets:
            updated = await pool.fetchrow(
                f"UPDATE email_campaigns SET status = $1, updated_at = $2{extra_sets} WHERE id = $3 RETURNING *",
                transition['to'], now, uuid.UUID(campaign_id), now,
            )
        else:
            updated = await pool.fetchrow(
                'UPDATE email_campaigns SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *',
                transition['to'], now, uuid.UUID(campaign_id),
            )

        _fire_event(
            f'email.campaign.{body.action}',
            entity_id=campaign_id,
            diff_summary=f'Campaign "{row["name"]}" {body.action} → {transition["to"]}',
            payload={'campaign_id': campaign_id, 'name': row['name'], 'new_status': transition['to']},
        )

        return {'data': dict(updated)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /campaigns/{{id}}/action] Error: {e}')
        raise HTTPException(500, 'Failed to update campaign')


@router.get('/campaigns/{campaign_id}/stats')
async def campaign_stats(campaign_id: str):
    """Get detailed stats for a campaign."""
    pool = get_pool()
    try:
        campaign = await pool.fetchrow(
            '''SELECT id, name, total_sent, total_delivered, total_opened,
                      total_clicked, total_replied, total_bounced, total_unsubscribed
               FROM email_campaigns WHERE id = $1''',
            uuid.UUID(campaign_id),
        )
        if not campaign:
            raise HTTPException(404, 'Campaign not found')

        # Recent engagement breakdown
        engagement = await pool.fetch(
            '''SELECT engagement_type, COUNT(*) as count
               FROM email_engagement WHERE campaign_id = $1
               GROUP BY engagement_type''',
            uuid.UUID(campaign_id),
        )

        return {
            'data': {
                **dict(campaign),
                'engagement_breakdown': {r['engagement_type']: r['count'] for r in engagement},
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /campaigns/{{id}}/stats] Error: {e}')
        raise HTTPException(500, 'Failed to fetch campaign stats')


# ── Sends ───────────────────────────────────────────────────────

@router.post('/sends', status_code=201)
async def create_send(body: SendCreate):
    """Create a send record and enqueue it for delivery."""
    pool = get_pool()
    try:
        import json

        # Resolve subject and body from template if provided
        subject = body.subject or ''
        body_html = body.body_html or ''
        body_text = body.body_text or ''

        if body.template_id and not (body.subject and body.body_html):
            template = await pool.fetchrow(
                'SELECT subject_template, body_html, body_text FROM email_templates WHERE id = $1 AND is_active = TRUE',
                uuid.UUID(body.template_id),
            )
            if not template:
                raise HTTPException(404, 'Template not found or inactive')

            # Render template variables
            subject = subject or template['subject_template']
            body_html = body_html or template['body_html']
            body_text = body_text or template['body_text']

            for var_name, var_value in body.template_variables.items():
                placeholder = '{{' + var_name + '}}'
                subject = subject.replace(placeholder, str(var_value))
                body_html = body_html.replace(placeholder, str(var_value))
                body_text = body_text.replace(placeholder, str(var_value))

        if not subject:
            raise HTTPException(400, 'Subject is required (provide directly or via template)')

        # Create send record
        send_row = await pool.fetchrow(
            '''INSERT INTO email_sends (campaign_id, template_id, account_id,
                   recipient_email, recipient_name, tenant_id, user_id,
                   subject, body_html, body_text, template_variables, in_reply_to)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
               RETURNING *''',
            uuid.UUID(body.campaign_id) if body.campaign_id else None,
            uuid.UUID(body.template_id) if body.template_id else None,
            uuid.UUID(body.account_id) if body.account_id else None,
            body.recipient_email, body.recipient_name,
            body.tenant_id, body.user_id,
            subject, body_html, body_text,
            json.dumps(body.template_variables),
            body.in_reply_to,
        )

        # Enqueue for delivery
        await pool.execute(
            '''INSERT INTO email_queue (send_id, priority)
               VALUES ($1, $2)''',
            send_row['id'], body.priority,
        )

        logger.info(f'Send queued: {send_row["id"]} to {body.recipient_email}')
        return {'data': dict(send_row)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /sends] Error: {e}')
        raise HTTPException(500, 'Failed to create send')


@router.get('/sends')
async def list_sends(
    campaign_id: str | None = Query(None),
    recipient_email: str | None = Query(None),
    tenant_id: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if campaign_id:
            conditions.append(f'campaign_id = ${idx}')
            params.append(uuid.UUID(campaign_id))
            idx += 1
        if recipient_email:
            conditions.append(f'recipient_email = ${idx}')
            params.append(recipient_email)
            idx += 1
        if tenant_id:
            conditions.append(f'tenant_id = ${idx}')
            params.append(tenant_id)
            idx += 1
        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM email_sends {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /sends] Error: {e}')
        raise HTTPException(500, 'Failed to fetch sends')


@router.get('/sends/{send_id}')
async def get_send(send_id: str):
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM email_sends WHERE id = $1', uuid.UUID(send_id))
        if not row:
            raise HTTPException(404, 'Send not found')
        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /sends/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to fetch send')


# ── Engagement ──────────────────────────────────────────────────

@router.get('/engagement')
async def list_engagement(
    campaign_id: str | None = Query(None),
    tenant_id: str | None = Query(None),
    engagement_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if campaign_id:
            conditions.append(f'campaign_id = ${idx}')
            params.append(uuid.UUID(campaign_id))
            idx += 1
        if tenant_id:
            conditions.append(f'tenant_id = ${idx}')
            params.append(tenant_id)
            idx += 1
        if engagement_type:
            conditions.append(f'engagement_type = ${idx}')
            params.append(engagement_type)
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM email_engagement {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /engagement] Error: {e}')
        raise HTTPException(500, 'Failed to fetch engagement')


# ── Threads ─────────────────────────────────────────────────────

@router.get('/threads')
async def list_threads(
    status: str | None = Query(None),
    recipient_email: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    pool = get_pool()
    try:
        conditions = []
        params = []
        idx = 1

        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1
        if recipient_email:
            conditions.append(f'recipient_email = ${idx}')
            params.append(recipient_email)
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ''
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM email_threads {where} ORDER BY updated_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /threads] Error: {e}')
        raise HTTPException(500, 'Failed to fetch threads')


@router.get('/threads/{thread_id}')
async def get_thread(thread_id: str):
    pool = get_pool()
    try:
        row = await pool.fetchrow('SELECT * FROM email_threads WHERE id = $1', uuid.UUID(thread_id))
        if not row:
            raise HTTPException(404, 'Thread not found')

        # Get all sends in this thread
        sends = await pool.fetch(
            'SELECT * FROM email_sends WHERE gmail_thread_id = $1 ORDER BY created_at',
            row['gmail_thread_id'],
        )

        return {
            'data': {
                **dict(row),
                'messages': [dict(s) for s in sends],
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /threads/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to fetch thread')
