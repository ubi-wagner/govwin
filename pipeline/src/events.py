"""
Standardized event emitters for the Python pipeline.

Every event gets a consistent metadata payload:
  actor    — who/what triggered it (pipeline worker)
  trigger  — upstream event that caused this (for correlation chains)
  refs     — entity references
  payload  — event-specific data for downstream triggers

All functions log on failure but never raise.
"""

import json
import logging
from typing import Optional

log = logging.getLogger("events")


def build_metadata(
    *,
    actor: dict,
    trigger: Optional[dict] = None,
    refs: Optional[dict] = None,
    payload: Optional[dict] = None,
) -> str:
    """Build standardized metadata JSON string."""
    meta: dict = {"actor": actor}
    if trigger:
        meta["trigger"] = trigger
    if refs:
        meta["refs"] = refs
    if payload:
        meta["payload"] = payload
    return json.dumps(meta, default=str)


def pipeline_actor(worker_id: str) -> dict:
    """Build an actor dict for pipeline workers."""
    return {"type": "pipeline", "id": worker_id}


def system_actor(name: str = "system") -> dict:
    """Build an actor dict for system actions."""
    return {"type": "system", "id": name}


def trigger_ref(event_id: str, event_type: str) -> dict:
    """Build a trigger reference for event chaining."""
    return {"eventId": str(event_id), "eventType": event_type}


async def emit_opportunity_event(
    conn,
    *,
    opportunity_id: str,
    event_type: str,
    source: str,
    actor: dict,
    field_changed: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    snapshot_hash: Optional[str] = None,
    correlation_id: Optional[str] = None,
    trigger: Optional[dict] = None,
    refs: Optional[dict] = None,
    payload: Optional[dict] = None,
) -> Optional[str]:
    """Emit an opportunity_events row with standardized metadata."""
    try:
        meta = build_metadata(
            actor=actor, trigger=trigger, refs=refs, payload=payload
        )
        row = await conn.fetchrow(
            """
            INSERT INTO opportunity_events
                (opportunity_id, event_type, source, field_changed,
                 old_value, new_value, snapshot_hash, correlation_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
            RETURNING id
            """,
            opportunity_id,
            event_type,
            source,
            field_changed,
            old_value,
            new_value,
            snapshot_hash,
            correlation_id,
            meta,
        )
        return str(row["id"]) if row else None
    except Exception as e:
        log.error(f"[emit_opportunity_event] {event_type} failed: {e}")
        return None


async def emit_customer_event(
    conn,
    *,
    tenant_id: str,
    event_type: str,
    actor: dict,
    user_id: Optional[str] = None,
    opportunity_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    description: str = "",
    correlation_id: Optional[str] = None,
    trigger: Optional[dict] = None,
    refs: Optional[dict] = None,
    payload: Optional[dict] = None,
) -> Optional[str]:
    """Emit a customer_events row with standardized metadata."""
    try:
        meta = build_metadata(
            actor=actor, trigger=trigger, refs=refs, payload=payload
        )
        row = await conn.fetchrow(
            """
            INSERT INTO customer_events
                (tenant_id, user_id, event_type, opportunity_id,
                 entity_type, entity_id, description, correlation_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
            RETURNING id
            """,
            tenant_id,
            user_id,
            event_type,
            opportunity_id,
            entity_type,
            entity_id,
            description,
            correlation_id,
            meta,
        )
        return str(row["id"]) if row else None
    except Exception as e:
        log.error(f"[emit_customer_event] {event_type} failed: {e}")
        return None
