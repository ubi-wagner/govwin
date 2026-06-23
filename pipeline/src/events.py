"""
Event emission for the pipeline service.

All events go to the master `system_events` table — the same table
the frontend writes to. The legacy tables (opportunity_events,
customer_events, content_events) are deprecated.

See docs/EVENT_CONTRACT.md for the binding specification.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Optional

log = logging.getLogger("pipeline.events")


async def emit_event(
    conn,
    *,
    namespace: str,
    type: str,
    phase: str = "single",
    actor_type: str = "pipeline",
    actor_id: str = "worker",
    actor_email: Optional[str] = None,
    tenant_id: Optional[str] = None,
    parent_event_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> str:
    """Write one event to system_events. Returns the event id."""
    event_payload = payload or {}
    if "correlationId" not in event_payload:
        event_payload["correlationId"] = str(uuid.uuid4())

    try:
        row = await conn.fetchrow(
            """
            INSERT INTO system_events (
                namespace, type, phase, actor_type, actor_id, actor_email,
                tenant_id, parent_event_id, payload
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
            """,
            namespace,
            type,
            phase,
            actor_type,
            actor_id,
            actor_email,
            uuid.UUID(tenant_id) if tenant_id else None,
            uuid.UUID(parent_event_id) if parent_event_id else None,
            json.dumps(event_payload),
        )
        return str(row["id"]) if row else ""
    except Exception as e:
        log.error("emit_event failed: %s (ns=%s type=%s)", e, namespace, type)
        return ""


async def emit_start(
    conn,
    *,
    namespace: str,
    type: str,
    actor_type: str = "pipeline",
    actor_id: str = "worker",
    tenant_id: Optional[str] = None,
    payload: Optional[dict[str, Any]] = None,
) -> str:
    """Emit a start-phase event. Returns event id for pairing with emit_end."""
    return await emit_event(
        conn,
        namespace=namespace,
        type=type,
        phase="start",
        actor_type=actor_type,
        actor_id=actor_id,
        tenant_id=tenant_id,
        payload=payload,
    )


async def emit_end(
    conn,
    start_event_id: str,
    *,
    result: Optional[dict[str, Any]] = None,
    error: Optional[dict[str, Any]] = None,
) -> None:
    """Emit an end-phase event linked to a start event."""
    if not start_event_id:
        return

    try:
        start_row = await conn.fetchrow(
            "SELECT namespace, type, actor_type, actor_id, tenant_id FROM system_events WHERE id = $1",
            uuid.UUID(start_event_id) if not isinstance(start_event_id, uuid.UUID) else start_event_id,
        )
        if not start_row:
            log.warning("emit_end: start event %s not found", start_event_id)
            return

        payload: dict[str, Any] = {}
        if result:
            payload.update(result)
        if error:
            payload["error"] = error

        await emit_event(
            conn,
            namespace=start_row["namespace"],
            type=start_row["type"],
            phase="end",
            actor_type=start_row["actor_type"],
            actor_id=start_row["actor_id"],
            tenant_id=str(start_row["tenant_id"]) if start_row["tenant_id"] else None,
            parent_event_id=str(start_event_id),
            payload=payload,
        )
    except Exception as e:
        log.error("emit_end failed for start=%s: %s", start_event_id, e)
