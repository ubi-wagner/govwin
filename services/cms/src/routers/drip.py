"""
Drip campaign management API routes.

CRUD for drip sequences and enrollment lifecycle management.
All tables (drip_sequences, drip_enrollments) live in CMS Postgres.
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

logger = logging.getLogger('cms.drip')
router = APIRouter()


def _fire_event(event_type: str, **kwargs):
    """Fire-and-forget event emission."""
    asyncio.create_task(emit_event(event_type, entity_type='drip', **kwargs))


# ── Pydantic Models ────────────────────────────────────────────────

class SequenceCreate(BaseModel):
    step_number: int
    template_id: str | None = None
    subject_override: str | None = None
    body_override: str | None = None
    delay_hours: int = 0
    delay_from: str = 'enrollment'  # enrollment or previous_step
    condition_filter: dict = {}


class SequenceUpdate(BaseModel):
    template_id: str | None = None
    subject_override: str | None = None
    body_override: str | None = None
    delay_hours: int | None = None
    delay_from: str | None = None
    condition_filter: dict | None = None


class EnrollRequest(BaseModel):
    tenant_id: str | None = None
    recipient_email: str
    recipient_name: str | None = None
    metadata: dict = {}


# ── Sequences ──────────────────────────────────────────────────────

@router.get('/campaigns/{campaign_id}/sequences')
async def list_sequences(campaign_id: str):
    """List all steps in a drip campaign's sequence."""
    pool = get_pool()
    try:
        # Verify campaign exists
        campaign = await pool.fetchrow(
            'SELECT id FROM email_campaigns WHERE id = $1',
            uuid.UUID(campaign_id),
        )
        if not campaign:
            raise HTTPException(404, 'Campaign not found')

        rows = await pool.fetch(
            'SELECT * FROM drip_sequences WHERE campaign_id = $1 ORDER BY step_number ASC',
            uuid.UUID(campaign_id),
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[GET /campaigns/{{id}}/sequences] Error: {e}')
        raise HTTPException(500, 'Failed to fetch drip sequences')


@router.post('/campaigns/{campaign_id}/sequences', status_code=201)
async def create_sequence(campaign_id: str, body: SequenceCreate):
    """Add a step to a drip campaign's sequence."""
    pool = get_pool()
    try:
        # Verify campaign exists
        campaign = await pool.fetchrow(
            'SELECT id FROM email_campaigns WHERE id = $1',
            uuid.UUID(campaign_id),
        )
        if not campaign:
            raise HTTPException(404, 'Campaign not found')

        # Validate delay_from
        valid_delay_from = ('enrollment', 'previous_step')
        if body.delay_from not in valid_delay_from:
            raise HTTPException(400, f'delay_from must be one of: {", ".join(valid_delay_from)}')

        row = await pool.fetchrow(
            '''INSERT INTO drip_sequences
                   (campaign_id, step_number, template_id, subject_override,
                    body_override, delay_hours, delay_from, condition_filter)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
               RETURNING *''',
            uuid.UUID(campaign_id), body.step_number,
            uuid.UUID(body.template_id) if body.template_id else None,
            body.subject_override, body.body_override,
            body.delay_hours, body.delay_from,
            json.dumps(body.condition_filter),
        )

        _fire_event(
            'drip.sequence.created',
            entity_id=str(row['id']),
            diff_summary=f'Drip step {body.step_number} added to campaign {campaign_id}',
            payload={
                'campaign_id': campaign_id,
                'step_number': body.step_number,
                'delay_hours': body.delay_hours,
            },
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        if '23505' in str(e):
            raise HTTPException(409, f'Step {body.step_number} already exists for this campaign')
        logger.error(f'[POST /campaigns/{{id}}/sequences] Error: {e}')
        raise HTTPException(500, 'Failed to create drip sequence step')


@router.patch('/sequences/{sequence_id}')
async def update_sequence(sequence_id: str, body: SequenceUpdate):
    """Update a drip sequence step."""
    pool = get_pool()
    try:
        updates = []
        params = []
        idx = 1

        for field, value in body.model_dump(exclude_none=True).items():
            if field == 'condition_filter':
                updates.append(f'condition_filter = ${idx}::jsonb')
                params.append(json.dumps(value))
            elif field == 'template_id':
                updates.append(f'template_id = ${idx}')
                params.append(uuid.UUID(value) if value else None)
            else:
                updates.append(f'{field} = ${idx}')
                params.append(value)
            idx += 1

        if not updates:
            raise HTTPException(400, 'No fields to update')

        params.append(uuid.UUID(sequence_id))
        row = await pool.fetchrow(
            f"UPDATE drip_sequences SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
            *params,
        )
        if not row:
            raise HTTPException(404, 'Sequence step not found')

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[PATCH /sequences/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to update drip sequence step')


@router.delete('/sequences/{sequence_id}')
async def delete_sequence(sequence_id: str):
    """Remove a drip sequence step."""
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            'DELETE FROM drip_sequences WHERE id = $1 RETURNING id, campaign_id, step_number',
            uuid.UUID(sequence_id),
        )
        if not row:
            raise HTTPException(404, 'Sequence step not found')

        _fire_event(
            'drip.sequence.deleted',
            entity_id=str(row['id']),
            diff_summary=f'Drip step {row["step_number"]} removed from campaign {row["campaign_id"]}',
            payload={
                'campaign_id': str(row['campaign_id']),
                'step_number': row['step_number'],
            },
        )

        return {'data': {'deleted': True, 'id': str(row['id'])}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[DELETE /sequences/{{id}}] Error: {e}')
        raise HTTPException(500, 'Failed to delete drip sequence step')


# ── Enrollments ────────────────────────────────────────────────────

@router.get('/campaigns/{campaign_id}/enrollments')
async def list_enrollments(
    campaign_id: str,
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
):
    """List enrollments for a drip campaign."""
    pool = get_pool()
    try:
        conditions = ['campaign_id = $1']
        params = [uuid.UUID(campaign_id)]
        idx = 2

        if status:
            conditions.append(f'status = ${idx}')
            params.append(status)
            idx += 1

        where = f"WHERE {' AND '.join(conditions)}"
        params.extend([limit, offset])

        rows = await pool.fetch(
            f'SELECT * FROM drip_enrollments {where} ORDER BY enrolled_at DESC LIMIT ${idx} OFFSET ${idx + 1}',
            *params,
        )
        return {'data': [dict(r) for r in rows], 'count': len(rows)}
    except Exception as e:
        logger.error(f'[GET /campaigns/{{id}}/enrollments] Error: {e}')
        raise HTTPException(500, 'Failed to fetch drip enrollments')


@router.post('/campaigns/{campaign_id}/enroll', status_code=201)
async def enroll_recipient(campaign_id: str, body: EnrollRequest):
    """Enroll a recipient in a drip campaign."""
    pool = get_pool()
    try:
        # Verify campaign exists
        campaign = await pool.fetchrow(
            'SELECT id, status FROM email_campaigns WHERE id = $1',
            uuid.UUID(campaign_id),
        )
        if not campaign:
            raise HTTPException(404, 'Campaign not found')

        # Check for existing active enrollment
        existing = await pool.fetchrow(
            '''SELECT id FROM drip_enrollments
               WHERE campaign_id = $1 AND recipient_email = $2 AND status = 'active'
               LIMIT 1''',
            uuid.UUID(campaign_id), body.recipient_email,
        )
        if existing:
            raise HTTPException(409, 'Recipient already enrolled in this campaign')

        # Compute next_send_at from the first step's delay
        first_step = await pool.fetchrow(
            '''SELECT delay_hours FROM drip_sequences
               WHERE campaign_id = $1 ORDER BY step_number ASC LIMIT 1''',
            uuid.UUID(campaign_id),
        )

        now = datetime.now(timezone.utc)
        if first_step:
            delay_hours = first_step['delay_hours'] or 0
            next_send_at = now + timedelta(hours=delay_hours)
        else:
            # No steps defined yet — set to now, engine will complete immediately
            next_send_at = now

        row = await pool.fetchrow(
            '''INSERT INTO drip_enrollments
                   (campaign_id, tenant_id, recipient_email, recipient_name,
                    next_send_at, metadata)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb)
               RETURNING *''',
            uuid.UUID(campaign_id),
            body.tenant_id,
            body.recipient_email, body.recipient_name,
            next_send_at, json.dumps(body.metadata),
        )

        _fire_event(
            'drip.enrollment.created',
            entity_id=str(row['id']),
            diff_summary=f'Enrolled {body.recipient_email} in drip campaign {campaign_id}',
            payload={
                'enrollment_id': str(row['id']),
                'campaign_id': campaign_id,
                'recipient': body.recipient_email,
            },
        )

        return {'data': dict(row)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /campaigns/{{id}}/enroll] Error: {e}')
        raise HTTPException(500, 'Failed to enroll recipient')


@router.post('/enrollments/{enrollment_id}/pause')
async def pause_enrollment(enrollment_id: str):
    """Pause an active enrollment."""
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            'SELECT id, status FROM drip_enrollments WHERE id = $1',
            uuid.UUID(enrollment_id),
        )
        if not row:
            raise HTTPException(404, 'Enrollment not found')
        if row['status'] != 'active':
            raise HTTPException(409, f'Cannot pause enrollment in {row["status"]} status')

        updated = await pool.fetchrow(
            '''UPDATE drip_enrollments
               SET status = 'paused', updated_at = $1
               WHERE id = $2
               RETURNING *''',
            datetime.now(timezone.utc), uuid.UUID(enrollment_id),
        )

        _fire_event(
            'drip.enrollment.paused',
            entity_id=enrollment_id,
            diff_summary=f'Drip enrollment paused',
            payload={'enrollment_id': enrollment_id},
        )

        return {'data': dict(updated)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /enrollments/{{id}}/pause] Error: {e}')
        raise HTTPException(500, 'Failed to pause enrollment')


@router.post('/enrollments/{enrollment_id}/resume')
async def resume_enrollment(enrollment_id: str):
    """Resume a paused enrollment."""
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            'SELECT id, status, next_send_at FROM drip_enrollments WHERE id = $1',
            uuid.UUID(enrollment_id),
        )
        if not row:
            raise HTTPException(404, 'Enrollment not found')
        if row['status'] != 'paused':
            raise HTTPException(409, f'Cannot resume enrollment in {row["status"]} status')

        now = datetime.now(timezone.utc)
        # If next_send_at was in the past, reset to now
        next_send = row['next_send_at']
        if not next_send or next_send < now:
            next_send = now

        updated = await pool.fetchrow(
            '''UPDATE drip_enrollments
               SET status = 'active', next_send_at = $1, updated_at = $2
               WHERE id = $3
               RETURNING *''',
            next_send, now, uuid.UUID(enrollment_id),
        )

        _fire_event(
            'drip.enrollment.resumed',
            entity_id=enrollment_id,
            diff_summary=f'Drip enrollment resumed',
            payload={'enrollment_id': enrollment_id},
        )

        return {'data': dict(updated)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /enrollments/{{id}}/resume] Error: {e}')
        raise HTTPException(500, 'Failed to resume enrollment')


@router.post('/enrollments/{enrollment_id}/cancel')
async def cancel_enrollment(enrollment_id: str):
    """Cancel an enrollment (cannot be undone)."""
    pool = get_pool()
    try:
        row = await pool.fetchrow(
            'SELECT id, status FROM drip_enrollments WHERE id = $1',
            uuid.UUID(enrollment_id),
        )
        if not row:
            raise HTTPException(404, 'Enrollment not found')
        if row['status'] in ('completed', 'cancelled'):
            raise HTTPException(409, f'Enrollment is already {row["status"]}')

        updated = await pool.fetchrow(
            '''UPDATE drip_enrollments
               SET status = 'cancelled', next_send_at = NULL, updated_at = $1
               WHERE id = $2
               RETURNING *''',
            datetime.now(timezone.utc), uuid.UUID(enrollment_id),
        )

        _fire_event(
            'drip.enrollment.cancelled',
            entity_id=enrollment_id,
            diff_summary=f'Drip enrollment cancelled',
            payload={'enrollment_id': enrollment_id},
        )

        return {'data': dict(updated)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f'[POST /enrollments/{{id}}/cancel] Error: {e}')
        raise HTTPException(500, 'Failed to cancel enrollment')
