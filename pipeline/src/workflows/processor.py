"""
Workflow processor — polls system_events and executes matching workflows.

V1 keeps it simple:
  - No process_instances table — workflows execute inline
  - HITL_WAIT steps log and skip
  - Tracks last-processed event timestamp in memory
  - Step input_map resolution via dot-notation against trigger event payload

See docs/EVENT_CONTRACT.md §7 for the architecture this implements.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from events import emit_event
from workflows.base import (
    StepType,
    Workflow,
    discover_workflows,
    get_workflow_for_event,
)

log = logging.getLogger("pipeline.workflows.processor")


# ─── Input resolution ──────────────────────────────────────────────


def resolve_input(path: str, event: dict, step_results: dict) -> Any:
    """Resolve a dot-notation path against the trigger event and prior step results.

    Supported prefixes:
      - payload.<key>         → event['payload'][key]
      - result.<key>          → event['payload'][key] (end events store result in payload)
      - step.<name>.result.<key> → step_results[name]['result'][key]
      - "<literal>"           → the literal string (quotes stripped)
    """
    if not path:
        return None

    # Literal string values (e.g. '"email"')
    if path.startswith('"') and path.endswith('"'):
        return path.strip('"')

    parts = path.split(".")

    if parts[0] == "payload" and len(parts) >= 2:
        obj = event.get("payload", {})
        for part in parts[1:]:
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                return None
        return obj

    if parts[0] == "result" and len(parts) >= 2:
        obj = event.get("payload", {})
        for part in parts[1:]:
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                return None
        return obj

    if parts[0] == "step" and len(parts) >= 3:
        # step.<step_name>.result.<key>[.<nested>...]
        step_name = parts[1]
        step_data = step_results.get(step_name, {})
        obj = step_data.get("result", {})
        for part in parts[3:]:  # skip "step", step_name, "result"
            if isinstance(obj, dict):
                obj = obj.get(part)
            else:
                return None
        return obj

    return None


def resolve_inputs(
    input_map: dict[str, str], event: dict, step_results: dict
) -> dict[str, Any]:
    """Resolve all input_map entries for a step."""
    resolved = {}
    for key, path in input_map.items():
        resolved[key] = resolve_input(path, event, step_results)
    return resolved


# ─── Step executors ────────────────────────────────────────────────


async def _execute_action(
    conn: asyncpg.Connection,
    action: str,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Resolve a dotted function path and call it.

    For V1, the action string is a Python module path like
    'pipeline.shredder.shred'. We import the module and call the
    last component as a function, passing conn + inputs.
    """
    parts = action.rsplit(".", 1)
    if len(parts) != 2:
        raise ValueError(f"ACTION step action must be 'module.function', got: {action}")

    module_path, func_name = parts
    try:
        mod = importlib.import_module(module_path)
    except ImportError as exc:
        raise ImportError(f"Could not import module '{module_path}': {exc}") from exc

    func = getattr(mod, func_name, None)
    if func is None:
        raise AttributeError(f"Module '{module_path}' has no function '{func_name}'")

    result = func(conn, **inputs)
    if asyncio.iscoroutine(result) or asyncio.isfuture(result):
        result = await result
    return {"result": result}


async def _execute_ai_invoke(
    conn: asyncpg.Connection,
    action: str,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Invoke an AI tool action.

    For V1, we log the invocation. The actual AI tool call infrastructure
    (POST to frontend tool API or direct Anthropic SDK call) will be
    wired in V2. For now we attempt to resolve the action as a Python
    callable, same as ACTION, so any tool functions that exist locally
    can still be called.
    """
    log.info("AI_INVOKE: %s with inputs %s", action, list(inputs.keys()))
    try:
        return await _execute_action(conn, action, inputs)
    except (ImportError, AttributeError) as exc:
        log.warning(
            "AI_INVOKE action '%s' not resolvable locally (V1), skipping: %s",
            action,
            exc,
        )
        return {"result": None, "skipped": True, "reason": str(exc)}


async def _execute_notify(
    conn: asyncpg.Connection,
    action: str,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Execute a notification step by emitting a system event.

    Inserts a ``system:notification.requested`` event into system_events.
    The CRM event_listener polls for these events and delivers the email
    via Gmail API using the template and recipient specified in ``inputs``.

    The ``inputs`` dict is populated from the step's ``input_map`` and
    typically contains:
      - channel: "email" (only email supported in V1)
      - template: template name (e.g. "welcome_accepted")
      - tenant_id / user_id / to_role: recipient identifiers
      - additional context fields forwarded as template variables
    """
    channel = inputs.get("channel", "email")
    template = inputs.get("template", "unknown")

    log.info(
        "NOTIFY: action=%s channel=%s template=%s",
        action,
        channel,
        template,
    )

    # Build the notification payload for the CRM event_listener
    notification_payload = {
        "channel": channel,
        "template": template,
        **{k: v for k, v in inputs.items() if k not in ("channel",)},
    }

    # Emit a system event that the CRM event_listener will pick up
    try:
        await emit_event(
            conn,
            namespace="system",
            type="notification.requested",
            payload=notification_payload,
        )
        log.info(
            "NOTIFY: emitted notification.requested event (template=%s)",
            template,
        )
    except Exception as exc:
        log.error("NOTIFY: failed to emit notification event: %s", exc)
        return {
            "result": {
                "notified": False,
                "channel": channel,
                "template": template,
                "error": str(exc),
            }
        }

    return {
        "result": {
            "notified": True,
            "channel": channel,
            "template": template,
        }
    }


def _evaluate_condition(
    step_condition: Any,
    inputs: dict[str, Any],
) -> bool:
    """Evaluate a CONDITION step. Returns True if the step should proceed."""
    if callable(step_condition):
        return bool(step_condition(inputs))
    return True


# ─── Core processor ───────────────────────────────────────────────


async def _execute_step(
    conn: asyncpg.Connection,
    step: Any,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    """Dispatch a single workflow step by its type."""
    if step.step_type == StepType.ACTION:
        return await _execute_action(conn, step.action, inputs)

    if step.step_type == StepType.AI_INVOKE:
        return await _execute_ai_invoke(conn, step.action, inputs)

    if step.step_type == StepType.NOTIFY:
        return await _execute_notify(conn, step.action, inputs)

    if step.step_type == StepType.HITL_WAIT:
        log.info(
            "HITL_WAIT: step '%s' waiting for human action (skipping in V1)",
            step.name,
        )
        return {"result": None, "skipped": True, "reason": "hitl_wait_v1"}

    if step.step_type == StepType.CONDITION:
        passed = _evaluate_condition(step.condition, inputs)
        if not passed:
            log.info("CONDITION: step '%s' evaluated to false, skipping", step.name)
            return {"result": None, "skipped": True, "reason": "condition_false"}
        return {"result": {"condition_passed": True}}

    if step.step_type == StepType.API_CALL:
        log.info("API_CALL: step '%s' (not implemented in V1, skipping)", step.name)
        return {"result": None, "skipped": True, "reason": "api_call_v1"}

    log.warning("Unknown step type '%s' for step '%s'", step.step_type, step.name)
    return {"result": None, "skipped": True, "reason": "unknown_type"}


async def _run_workflow(
    conn: asyncpg.Connection,
    workflow_cls: type[Workflow],
    event: dict[str, Any],
) -> None:
    """Execute all steps of a matched workflow in dependency order."""
    workflow_name = workflow_cls.__name__
    log.info(
        "starting workflow %s for event %s:%s:%s (id=%s)",
        workflow_name,
        event.get("namespace"),
        event.get("type"),
        event.get("phase"),
        event.get("id"),
    )

    steps = workflow_cls.step_execution_order()
    step_results: dict[str, dict[str, Any]] = {}

    for step in steps:
        # If this step depends on a skipped HITL_WAIT step, skip it too
        if step.depends_on:
            dep_result = step_results.get(step.depends_on, {})
            if dep_result.get("skipped") and dep_result.get("reason") == "hitl_wait_v1":
                log.info(
                    "skipping step '%s' because dependency '%s' is a HITL_WAIT (V1)",
                    step.name,
                    step.depends_on,
                )
                step_results[step.name] = {
                    "result": None,
                    "skipped": True,
                    "reason": "dependency_hitl_wait",
                }
                continue

        inputs = resolve_inputs(step.input_map, event, step_results)

        try:
            result = await _execute_step(conn, step, inputs)
            step_results[step.name] = result

            await emit_event(
                conn,
                namespace="system",
                type="workflow.step_completed",
                payload={
                    "workflow": workflow_name,
                    "step": step.name,
                    "stepType": step.step_type.value,
                    "skipped": result.get("skipped", False),
                },
            )
            log.info(
                "step '%s' completed (type=%s, skipped=%s)",
                step.name,
                step.step_type.value,
                result.get("skipped", False),
            )

        except Exception as exc:
            log.error(
                "step '%s' in workflow %s failed: %s",
                step.name,
                workflow_name,
                exc,
            )
            step_results[step.name] = {"error": str(exc)}

            await emit_event(
                conn,
                namespace="system",
                type="workflow.step_failed",
                payload={
                    "workflow": workflow_name,
                    "step": step.name,
                    "stepType": step.step_type.value,
                    "error": str(exc)[:500],
                },
            )
            # Continue to next step — don't abort the entire workflow
            # (steps that depend on this one will still run but get None inputs)

    await emit_event(
        conn,
        namespace="system",
        type="workflow.completed",
        payload={
            "workflow": workflow_name,
            "triggerEventId": event.get("id"),
            "stepsExecuted": len(steps),
            "stepsSkipped": sum(
                1 for r in step_results.values() if r.get("skipped")
            ),
            "stepsFailed": sum(
                1 for r in step_results.values() if "error" in r
            ),
        },
    )
    log.info("workflow %s completed", workflow_name)


# ─── Main loop ─────────────────────────────────────────────────────


async def run_workflow_processor(
    *,
    database_url: str,
    shutdown_event: asyncio.Event,
    poll_interval: int = 10,
) -> None:
    """Poll system_events for new events and execute matching workflows.

    Runs until shutdown_event is set. Connects to the database
    independently (separate connection from the ingester consumer).
    """
    conn: Optional[asyncpg.Connection] = None
    try:
        conn = await asyncpg.connect(database_url)
        log.info("workflow processor started")

        # Discover and register all workflow definitions
        count = discover_workflows()
        log.info("discovered %d workflow(s)", count)

        # Seed last_processed_at to now so we only process new events
        row = await conn.fetchrow(
            "SELECT COALESCE(MAX(created_at), now()) AS ts FROM system_events"
        )
        last_processed_at: datetime = row["ts"] if row else datetime.now(timezone.utc)
        log.info("workflow processor seeded last_processed_at = %s", last_processed_at)

        while not shutdown_event.is_set():
            try:
                events = await conn.fetch(
                    """
                    SELECT id, namespace, type, phase, actor_type, actor_id,
                           tenant_id, parent_event_id, payload, created_at
                    FROM system_events
                    WHERE created_at > $1
                      AND namespace != 'system'
                    ORDER BY created_at ASC
                    LIMIT 100
                    """,
                    last_processed_at,
                )

                for event_row in events:
                    # asyncpg returns JSONB as a string unless a codec is registered
                    raw_payload = event_row["payload"]
                    if isinstance(raw_payload, str):
                        try:
                            payload = json.loads(raw_payload) if raw_payload else {}
                        except json.JSONDecodeError:
                            payload = {}
                    elif raw_payload is None:
                        payload = {}
                    else:
                        payload = raw_payload

                    event_dict: dict[str, Any] = {
                        "id": str(event_row["id"]),
                        "namespace": event_row["namespace"],
                        "type": event_row["type"],
                        "phase": event_row["phase"],
                        "actor_type": event_row["actor_type"],
                        "actor_id": event_row["actor_id"],
                        "tenant_id": str(event_row["tenant_id"])
                        if event_row["tenant_id"]
                        else None,
                        "parent_event_id": str(event_row["parent_event_id"])
                        if event_row["parent_event_id"]
                        else None,
                        "payload": payload,
                        "created_at": event_row["created_at"],
                    }

                    workflow_cls = get_workflow_for_event(event_dict)
                    if workflow_cls:
                        try:
                            await _run_workflow(conn, workflow_cls, event_dict)
                        except Exception as exc:
                            log.error(
                                "workflow execution failed for event %s: %s",
                                event_dict["id"],
                                exc,
                            )
                            await emit_event(
                                conn,
                                namespace="system",
                                type="workflow.failed",
                                payload={
                                    "workflow": workflow_cls.__name__,
                                    "triggerEventId": event_dict["id"],
                                    "error": str(exc)[:500],
                                },
                            )

                    # Advance the high-water mark
                    last_processed_at = event_row["created_at"]

            except asyncpg.PostgresConnectionError as exc:
                log.error("workflow processor lost DB connection: %s", exc)
                # Try to reconnect
                try:
                    conn = await asyncpg.connect(database_url)
                    log.info("workflow processor reconnected to DB")
                except Exception as reconn_exc:
                    log.error("workflow processor reconnect failed: %s", reconn_exc)

            except Exception as exc:
                log.error("workflow processor poll error: %s", exc)

            # Wait before next poll (respects shutdown)
            try:
                await asyncio.wait_for(
                    shutdown_event.wait(), timeout=poll_interval
                )
                # If we get here, shutdown was signaled
                break
            except asyncio.TimeoutError:
                # Normal — poll interval elapsed, loop again
                pass

    except Exception as exc:
        log.error("workflow processor fatal: %s", exc)
    finally:
        if conn:
            await conn.close()
        log.info("workflow processor stopped")
