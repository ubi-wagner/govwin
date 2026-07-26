"""
Event emission for CMS service.

Events are recorded locally in cms_events, then optionally bridged
to the shared database's system_events table for automation triggers.
"""
import json
import logging
import uuid
from .database import get_pool, get_event_pool

logger = logging.getLogger('cms.events')


async def emit_system_event(
    *,
    event_type: str,
    namespace: str = 'system',
    phase: str = 'single',
    actor_type: str | None = None,
    actor_id: str | None = None,
    user_id: str | None = None,
    parent_event_id: str | None = None,
    payload: dict | None = None,
    ensure_correlation_id: bool = False,
    pool=None,
) -> str:
    """
    Insert one row into the shared system_events table (best-effort).

    The single choke point for every CMS → shared-bus emission: centralizes the INSERT,
    the actor resolution, correlationId seeding, and error handling so no call site can
    drift (this is the dedup that keeps the actor_type logic in exactly one place).

    Actor resolution: pass actor_type/actor_id explicitly for a fixed actor (e.g. a
    worker or the event_listener), OR pass user_id to derive ('user', user_id) when a
    user is present, else ('system', 'cms_service').

    Returns the new event id, or '' if no shared pool is configured / on error.
    """
    if pool is None:
        pool = get_event_pool()
    if not pool:
        return ""
    if actor_type is None:
        actor_type = 'user' if user_id else 'system'
    if actor_id is None:
        actor_id = user_id or 'cms_service'
    body = dict(payload or {})
    if ensure_correlation_id and 'correlationId' not in body:
        body['correlationId'] = str(uuid.uuid4())
    event_id = str(uuid.uuid4())
    try:
        await pool.execute(
            """
            INSERT INTO system_events
                (id, namespace, type, phase, actor_type, actor_id, parent_event_id, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
            """,
            uuid.UUID(event_id), namespace, event_type, phase, actor_type, actor_id,
            uuid.UUID(parent_event_id) if parent_event_id else None,
            json.dumps(body),
        )
        return event_id
    except Exception as e:
        logger.error('[emit_system_event] %s failed: %s', event_type, e)
        return ""


async def emit_event(
    event_type: str,
    entity_type: str = 'post',
    entity_id: str | None = None,
    user_id: str | None = None,
    diff_summary: str | None = None,
    payload: dict | None = None,
) -> str | None:
    """
    Record an event locally and bridge to shared DB if configured.

    Returns the local event ID, or None on failure.
    """
    pool = get_pool()
    try:
        # Write to local cms_events table
        event_id = await pool.fetchval(
            """
            INSERT INTO cms_events (event_type, entity_type, entity_id, user_id, source, diff_summary, payload)
            VALUES ($1, $2, $3::uuid, $4, 'cms_service', $5, $6::jsonb)
            RETURNING id
            """,
            event_type,
            entity_type,
            entity_id,
            user_id,
            diff_summary,
            json.dumps(payload or {}),
        )

        # Bridge to shared database if configured — via the one shared emit helper.
        event_pool = get_event_pool()
        if event_pool:
            bridged_id = await emit_system_event(
                event_type=event_type,
                # namespace 'system' + phase 'single' are the defaults; actor is derived
                # from user_id ('user'/user_id, else 'system'/'cms_service').
                user_id=user_id,
                payload={
                    'entity_type': entity_type,
                    'entity_id': entity_id,
                    'diff_summary': diff_summary,
                    'cms_event_id': str(event_id),
                    **(payload or {}),
                },
                pool=event_pool,
            )
            if bridged_id:
                # Mark as bridged (a '' return means the bridge INSERT was skipped/failed —
                # emit_system_event already logged it; the local event stays unbridged).
                await pool.execute(
                    'UPDATE cms_events SET bridged = TRUE, bridged_at = NOW() WHERE id = $1',
                    event_id,
                )

        return str(event_id)
    except Exception as e:
        logger.error(f'[emit_event] {event_type} failed: {e}')
        return None
