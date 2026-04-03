"""
Event emission for CMS service.

Events are recorded locally in cms_events, then optionally bridged
to the shared database's content_events table for automation triggers.
"""
import logging
from .database import get_pool, get_event_pool

logger = logging.getLogger('cms.events')


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
        import json
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

        # Bridge to shared database if configured
        event_pool = get_event_pool()
        if event_pool:
            try:
                await event_pool.execute(
                    """
                    INSERT INTO content_events (page_key, event_type, user_id, source, diff_summary, metadata)
                    VALUES ('content_pipeline', $1, $2, 'cms_service', $3, $4::jsonb)
                    """,
                    event_type,
                    user_id,
                    diff_summary,
                    json.dumps({
                        'actor': {'type': 'user', 'id': user_id or 'system'},
                        'payload': payload or {},
                        'cms_event_id': str(event_id),
                    }),
                )
                # Mark as bridged
                await pool.execute(
                    'UPDATE cms_events SET bridged = TRUE, bridged_at = NOW() WHERE id = $1',
                    event_id,
                )
            except Exception as bridge_err:
                logger.error(f'[emit_event] Bridge failed for {event_type}: {bridge_err}')
                # Don't fail — local event is recorded

        return str(event_id)
    except Exception as e:
        logger.error(f'[emit_event] {event_type} failed: {e}')
        return None
