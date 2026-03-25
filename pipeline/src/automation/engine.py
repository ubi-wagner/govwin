"""
Automation Engine — Evaluates rules against events and dispatches actions.

Flow:
  1. Load enabled rules from automation_rules table (cached, refreshed periodically)
  2. For each incoming event, find rules whose trigger_bus + trigger_events match
  3. Evaluate conditions against the event row + parsed metadata
  4. Execute the action if all conditions pass
  5. Log the result to automation_log
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from .actions import execute_action

log = logging.getLogger("automation.engine")

# Cache rules for 60 seconds to avoid hitting DB on every event
_rules_cache: list[dict] = []
_rules_cache_at: float = 0
CACHE_TTL_SECONDS = 60


def _resolve_template(template: str, context: dict) -> str:
    """
    Resolve a template string like "User {actor.email} logged in"
    against a nested context dict.

    Supports dotted paths: {payload.total_score}, {actor.email}, etc.
    Missing keys resolve to '?'.
    """
    def replacer(match: re.Match) -> str:
        path = match.group(1)
        value = _resolve_path(context, path)
        return str(value) if value is not None else "?"

    return re.sub(r"\{([^}]+)\}", replacer, template)


def _resolve_path(obj: Any, path: str) -> Any:
    """Walk a dotted path like 'payload.total_score' into a nested dict."""
    parts = path.split(".")
    current = obj
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
        if current is None:
            return None
    return current


def _check_conditions(conditions: dict, context: dict, conn, rule: dict, event: dict) -> tuple[bool, str]:
    """
    Evaluate all conditions against the event context.

    Returns (passed: bool, skip_reason: str).

    Condition types:
      - Simple equality: {"actor.type": "user"} → context.actor.type == "user"
      - $gte/$lte/$gt/$lt: {"payload.total_score": {"$gte": 75}}
      - $contains_any: {"payload.fields_changed": {"$contains_any": ["primary_naics", ...]}}
      - $first_occurrence: checked via automation_log dedup
      - $entity_key: used with $first_occurrence to define what "first" means
    """
    if not conditions:
        return True, ""

    for key, expected in conditions.items():
        # Special operators
        if key == "$first_occurrence":
            # Handled async in evaluate_rule — skip here
            continue
        if key == "$entity_key":
            # Companion to $first_occurrence — skip here
            continue

        actual = _resolve_path(context, key)

        if isinstance(expected, dict):
            # Comparison operators
            if "$gte" in expected:
                if actual is None or float(actual) < float(expected["$gte"]):
                    return False, f"{key} ({actual}) < {expected['$gte']}"
            if "$lte" in expected:
                if actual is None or float(actual) > float(expected["$lte"]):
                    return False, f"{key} ({actual}) > {expected['$lte']}"
            if "$gt" in expected:
                if actual is None or float(actual) <= float(expected["$gt"]):
                    return False, f"{key} ({actual}) <= {expected['$gt']}"
            if "$lt" in expected:
                if actual is None or float(actual) >= float(expected["$lt"]):
                    return False, f"{key} ({actual}) >= {expected['$lt']}"
            if "$contains_any" in expected:
                if not isinstance(actual, (list, tuple)):
                    return False, f"{key} is not a list"
                if not any(item in actual for item in expected["$contains_any"]):
                    return False, f"{key} contains none of {expected['$contains_any']}"
            if "$eq" in expected:
                if actual != expected["$eq"]:
                    return False, f"{key} ({actual}) != {expected['$eq']}"
            if "$ne" in expected:
                if actual == expected["$ne"]:
                    return False, f"{key} ({actual}) == {expected['$ne']}"
        else:
            # Simple equality
            if actual != expected:
                return False, f"{key}: expected {expected}, got {actual}"

    return True, ""


async def load_rules(conn) -> list[dict]:
    """Load enabled automation rules from DB, with caching."""
    global _rules_cache, _rules_cache_at

    now = datetime.now(timezone.utc).timestamp()
    if _rules_cache and (now - _rules_cache_at) < CACHE_TTL_SECONDS:
        return _rules_cache

    try:
        rows = await conn.fetch(
            """
            SELECT id, name, description, trigger_bus, trigger_events,
                   conditions, action_type, action_config,
                   priority, cooldown_seconds, max_fires_per_hour
            FROM automation_rules
            WHERE enabled = TRUE
            ORDER BY priority ASC
            """
        )
        _rules_cache = [dict(r) for r in rows]
        _rules_cache_at = now
        return _rules_cache
    except Exception as e:
        log.error(f"[automation.engine] Failed to load rules: {e}")
        return _rules_cache  # Return stale cache on error


def invalidate_cache():
    """Force reload of rules on next evaluation."""
    global _rules_cache_at
    _rules_cache_at = 0


async def evaluate_event(conn, event: dict, bus: str) -> list[dict]:
    """
    Evaluate all matching rules against an event.

    Args:
        conn: asyncpg connection
        event: the dequeued event row (dict)
        bus: 'opportunity_events', 'customer_events', or 'content_events'

    Returns: list of action results
    """
    rules = await load_rules(conn)
    event_type = event.get("event_type", "")
    results = []

    # Parse metadata into a context dict for condition evaluation
    metadata = event.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            metadata = {}
    elif metadata is None:
        metadata = {}

    context = {
        "event_type": event_type,
        "bus": bus,
        "actor": metadata.get("actor", {}),
        "trigger": metadata.get("trigger", {}),
        "refs": metadata.get("refs", {}),
        "payload": metadata.get("payload", {}),
        # Top-level event fields
        "event": {
            "id": str(event.get("id", "")),
            "tenant_id": str(event.get("tenant_id", "")),
            "user_id": str(event.get("user_id", "")),
            "opportunity_id": str(event.get("opportunity_id", "")),
            "entity_type": event.get("entity_type"),
            "entity_id": str(event.get("entity_id", "")),
            "description": event.get("description", ""),
            "correlation_id": str(event.get("correlation_id", "")),
        },
        # Convenience aliases
        "trigger_event_type": event_type,
    }

    for rule in rules:
        # Skip rules that don't match this bus
        if rule["trigger_bus"] != bus:
            continue

        # Skip rules that don't match this event type
        trigger_events = rule.get("trigger_events") or []
        if event_type not in trigger_events:
            continue

        # Check conditions
        conditions = rule.get("conditions") or {}
        passed, skip_reason = _check_conditions(conditions, context, conn, rule, event)

        # Handle $first_occurrence
        if passed and conditions.get("$first_occurrence"):
            entity_key_path = conditions.get("$entity_key", "actor.id")
            entity_value = _resolve_path(context, entity_key_path)
            if entity_value:
                try:
                    existing = await conn.fetchval(
                        """
                        SELECT id FROM automation_log
                        WHERE rule_id = $1 AND fired = TRUE
                          AND action_result->>'entity_key' = $2
                        LIMIT 1
                        """,
                        rule["id"],
                        str(entity_value),
                    )
                    if existing:
                        passed = False
                        skip_reason = f"already_fired_for_{entity_key_path}={entity_value}"
                except Exception as e:
                    log.warning(f"[automation.engine] $first_occurrence check failed: {e}")

        # Handle cooldown
        if passed and rule.get("cooldown_seconds", 0) > 0:
            try:
                last_fire = await conn.fetchval(
                    """
                    SELECT created_at FROM automation_log
                    WHERE rule_id = $1 AND fired = TRUE
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    rule["id"],
                )
                if last_fire:
                    elapsed = (datetime.now(timezone.utc) - last_fire).total_seconds()
                    if elapsed < rule["cooldown_seconds"]:
                        passed = False
                        skip_reason = f"cooldown ({elapsed:.0f}s < {rule['cooldown_seconds']}s)"
            except Exception as e:
                log.warning(f"[automation.engine] Cooldown check failed: {e}")

        # Handle rate limiting
        if passed and rule.get("max_fires_per_hour", 0) > 0:
            try:
                count = await conn.fetchval(
                    """
                    SELECT COUNT(*) FROM automation_log
                    WHERE rule_id = $1 AND fired = TRUE
                      AND created_at > NOW() - INTERVAL '1 hour'
                    """,
                    rule["id"],
                )
                if count >= rule["max_fires_per_hour"]:
                    passed = False
                    skip_reason = f"rate_limited ({count} fires in last hour, max {rule['max_fires_per_hour']})"
            except Exception as e:
                log.warning(f"[automation.engine] Rate limit check failed: {e}")

        # Execute or log skip
        action_result = None
        if passed:
            try:
                action_result = await execute_action(
                    conn=conn,
                    rule=rule,
                    event=event,
                    context=context,
                    resolve_template=_resolve_template,
                )
                # Tag entity_key for $first_occurrence tracking
                if action_result and conditions.get("$first_occurrence"):
                    entity_key_path = conditions.get("$entity_key", "actor.id")
                    entity_value = _resolve_path(context, entity_key_path)
                    action_result["entity_key"] = str(entity_value) if entity_value else None

                log.info(
                    f"[automation] FIRED rule '{rule['name']}' "
                    f"on {event_type} → {rule['action_type']}"
                )
            except Exception as e:
                log.error(f"[automation] Action failed for rule '{rule['name']}': {e}")
                action_result = {"error": str(e)}
        else:
            log.debug(
                f"[automation] SKIP rule '{rule['name']}' on {event_type}: {skip_reason}"
            )

        # Log to automation_log
        try:
            await conn.execute(
                """
                INSERT INTO automation_log
                    (rule_id, rule_name, trigger_event_id, trigger_event_type,
                     trigger_bus, fired, skip_reason, action_type,
                     action_result, event_metadata, correlation_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
                """,
                rule["id"],
                rule["name"],
                event.get("id"),
                event_type,
                bus,
                passed,
                skip_reason if not passed else None,
                rule["action_type"] if passed else None,
                json.dumps(action_result, default=str) if action_result else None,
                json.dumps(metadata, default=str),
                event.get("correlation_id"),
            )
        except Exception as e:
            log.error(f"[automation] Failed to log rule evaluation: {e}")

        if passed:
            results.append({
                "rule": rule["name"],
                "action": rule["action_type"],
                "result": action_result,
            })

    return results
