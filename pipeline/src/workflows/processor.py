"""
================================================================================
Module: Workflow Processor (processor.py)
================================================================================

WHO:    The core execution engine for all event-driven workflows.

WHAT:   Polls system_events for new events, matches them against registered
        workflow triggers, and drives step-by-step execution. Handles input
        resolution (dot-notation against event payloads and prior step
        results), step dispatch by type (ACTION, AI_INVOKE, NOTIFY,
        HITL_WAIT, CONDITION, API_CALL), and comprehensive event emission
        at every lifecycle stage.

WHY:    Centralizes workflow execution so individual workflow definitions
        remain purely declarative. The processor uniformly handles error
        recovery, event emission, retry logic, timeout enforcement, and
        step dependency resolution.

HOW:    Runs as a concurrent asyncio task alongside the ingester consumer
        loop. Polls system_events every N seconds (default 10), skipping
        namespace='system' to avoid self-triggering. For each matching
        event, executes all workflow steps in topological order. Each step
        dispatches to a type-specific executor. Results are collected in
        step_results for downstream input resolution.

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step
    - Dependency failure: Dependent steps still run but receive None inputs
      from the failed step (graceful degradation)
    - Workflow failure: Emit system:workflow.failed event with full context
    - DB connection loss: Retry reconnection, log error
    - Poll loop errors: Catch, log, continue polling (never crash)

FAULT TOLERANCE:
    - Duplicate detection: Tracks processed event IDs in-memory set to
      prevent double-processing within a single processor lifetime
    - Stuck workflow detection: Logs warning for workflows exceeding their
      total timeout budget
    - Idempotent event emission: All emitted events include trigger_event_id
      for downstream dedup
    - Graceful shutdown: Respects shutdown_event, closes DB connection

EVENT EMISSIONS:
    - system:workflow.started — when a workflow begins processing
    - system:workflow.step_completed — after each step succeeds (or skips)
    - system:workflow.step_failed — after each step fails
    - system:workflow.completed — when all steps finish
    - system:workflow.failed — when the entire workflow throws

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: polling, step execution,
                           input resolution, basic event emissions
    PR #xxx (2026-05-22) — Hardened: workflow.started event, duplicate
                           detection, stuck workflow logging, duration_ms
                           tracking, comprehensive headers, step-level
                           retry with exponential backoff, timeout
                           enforcement via asyncio.wait_for
    PR #xxx (2026-05-22) — WorkflowManager integration: persistent workflow
                           execution with crash recovery. Falls back to
                           fire-and-forget if process_instances table missing.
================================================================================
"""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
import time
import uuid
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


# ─── Duplicate tracking ──────────────────────────────────────────────

# In-memory set of trigger event IDs already processed in this
# processor lifetime. Prevents double-processing if the high-water
# mark query returns an event that was already handled (e.g., due to
# timestamp collisions at millisecond granularity).
_processed_event_ids: set[str] = set()

# Cap the size of the dedup set to prevent unbounded memory growth.
# When exceeded, we clear the oldest half (approximated by clearing all).
_MAX_DEDUP_SET_SIZE = 50_000


def _track_processed(event_id: str) -> bool:
    """Record an event ID as processed. Returns True if it was already seen."""
    global _processed_event_ids
    if event_id in _processed_event_ids:
        return True
    if len(_processed_event_ids) >= _MAX_DEDUP_SET_SIZE:
        log.info(
            "dedup set reached %d entries, clearing to prevent memory growth",
            _MAX_DEDUP_SET_SIZE,
        )
        _processed_event_ids = set()
    _processed_event_ids.add(event_id)
    return False


# ─── Input resolution ──────────────────────────────────────────────


def resolve_input(path: str, event: dict, step_results: dict) -> Any:
    """Resolve a dot-notation path against the trigger event and prior step results.

    Supported prefixes:
      - payload.<key>         -> event['payload'][key]
      - result.<key>          -> event['payload'][key] (end events store result in payload)
      - step.<name>.result.<key> -> step_results[name]['result'][key]
      - "<literal>"           -> the literal string (quotes stripped)
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
    trigger_event: dict[str, Any] | None = None,
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

    # Include the trigger event ID so the CMS can cross-reference for dedup
    if trigger_event and trigger_event.get("id"):
        notification_payload["trigger_event_id"] = str(trigger_event["id"])

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
    trigger_event: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Dispatch a single workflow step by its type."""
    if step.step_type == StepType.ACTION:
        return await _execute_action(conn, step.action, inputs)

    if step.step_type == StepType.AI_INVOKE:
        return await _execute_ai_invoke(conn, step.action, inputs)

    if step.step_type == StepType.NOTIFY:
        return await _execute_notify(conn, step.action, inputs, trigger_event=trigger_event)

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


async def _execute_step_with_retry(
    conn: asyncpg.Connection,
    step: Any,
    inputs: dict[str, Any],
    trigger_event: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute a step with retry logic and timeout enforcement.

    Retries use exponential backoff based on step.retry_delay_seconds.
    Timeout is enforced via asyncio.wait_for using step.timeout_minutes.
    """
    last_exc: Optional[Exception] = None
    max_attempts = 1 + max(step.retry_count, 0)

    for attempt in range(max_attempts):
        try:
            # Enforce timeout
            timeout_seconds = step.timeout_minutes * 60
            result = await asyncio.wait_for(
                _execute_step(conn, step, inputs, trigger_event=trigger_event),
                timeout=timeout_seconds,
            )
            return result
        except asyncio.TimeoutError:
            last_exc = TimeoutError(
                f"Step '{step.name}' timed out after {step.timeout_minutes}m "
                f"(attempt {attempt + 1}/{max_attempts})"
            )
            log.error(
                "step '%s' timed out after %dm (attempt %d/%d)",
                step.name,
                step.timeout_minutes,
                attempt + 1,
                max_attempts,
            )
        except Exception as exc:
            last_exc = exc
            log.error(
                "step '%s' failed (attempt %d/%d): %s",
                step.name,
                attempt + 1,
                max_attempts,
                exc,
            )

        # If there are more attempts, wait with exponential backoff
        if attempt < max_attempts - 1:
            delay = step.retry_delay_seconds * (2 ** attempt)
            log.info(
                "retrying step '%s' in %ds (attempt %d/%d)",
                step.name,
                delay,
                attempt + 2,
                max_attempts,
            )
            await asyncio.sleep(delay)

    # All attempts exhausted
    raise last_exc  # type: ignore[misc]


async def _run_workflow(
    conn: asyncpg.Connection,
    workflow_cls: type[Workflow],
    event: dict[str, Any],
) -> None:
    """Execute all steps of a matched workflow in dependency order."""
    workflow_name = workflow_cls.__name__
    trigger_event_id = event.get("id")
    tenant_id = event.get("tenant_id")
    workflow_start_time = time.monotonic()

    log.info(
        "starting workflow %s for event %s:%s:%s (id=%s)",
        workflow_name,
        event.get("namespace"),
        event.get("type"),
        event.get("phase"),
        trigger_event_id,
    )

    # Emit workflow.started event
    try:
        await emit_event(
            conn,
            namespace="system",
            type="workflow.started",
            payload={
                "workflow": workflow_name,
                "triggerEventId": trigger_event_id,
                "tenant_id": tenant_id,
            },
            tenant_id=tenant_id,
        )
    except Exception as exc:
        log.error("failed to emit workflow.started event: %s", exc)

    steps = workflow_cls.step_execution_order()
    step_results: dict[str, dict[str, Any]] = {}

    for step in steps:
        step_start_time = time.monotonic()

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

            # If dependency failed, log but continue (inputs will be None)
            if "error" in dep_result:
                log.warning(
                    "step '%s' depends on failed step '%s' — inputs may be None",
                    step.name,
                    step.depends_on,
                )

        inputs = resolve_inputs(step.input_map, event, step_results)

        try:
            result = await _execute_step_with_retry(
                conn, step, inputs, trigger_event=event
            )
            step_results[step.name] = result
            step_duration_ms = int((time.monotonic() - step_start_time) * 1000)

            try:
                await emit_event(
                    conn,
                    namespace="system",
                    type="workflow.step_completed",
                    payload={
                        "workflow": workflow_name,
                        "step": step.name,
                        "stepType": step.step_type.value,
                        "skipped": result.get("skipped", False),
                        "triggerEventId": trigger_event_id,
                        "tenant_id": tenant_id,
                        "duration_ms": step_duration_ms,
                    },
                    tenant_id=tenant_id,
                )
            except Exception as emit_exc:
                log.error("failed to emit step_completed event: %s", emit_exc)

            log.info(
                "step '%s' completed (type=%s, skipped=%s, duration=%dms)",
                step.name,
                step.step_type.value,
                result.get("skipped", False),
                step_duration_ms,
            )

        except Exception as exc:
            step_duration_ms = int((time.monotonic() - step_start_time) * 1000)
            log.error(
                "step '%s' in workflow %s failed: %s",
                step.name,
                workflow_name,
                exc,
            )
            step_results[step.name] = {"error": str(exc)}

            try:
                await emit_event(
                    conn,
                    namespace="system",
                    type="workflow.step_failed",
                    payload={
                        "workflow": workflow_name,
                        "step": step.name,
                        "stepType": step.step_type.value,
                        "error": str(exc)[:500],
                        "triggerEventId": trigger_event_id,
                        "tenant_id": tenant_id,
                        "duration_ms": step_duration_ms,
                    },
                    tenant_id=tenant_id,
                )
            except Exception as emit_exc:
                log.error("failed to emit step_failed event: %s", emit_exc)

            # Continue to next step -- don't abort the entire workflow
            # (steps that depend on this one will still run but get None inputs)

    workflow_duration_ms = int((time.monotonic() - workflow_start_time) * 1000)

    steps_failed = sum(1 for r in step_results.values() if "error" in r)
    steps_skipped = sum(1 for r in step_results.values() if r.get("skipped"))

    try:
        await emit_event(
            conn,
            namespace="system",
            type="workflow.completed",
            payload={
                "workflow": workflow_name,
                "triggerEventId": trigger_event_id,
                "tenant_id": tenant_id,
                "stepsExecuted": len(steps),
                "stepsSkipped": steps_skipped,
                "stepsFailed": steps_failed,
                "duration_ms": workflow_duration_ms,
            },
            tenant_id=tenant_id,
        )
    except Exception as emit_exc:
        log.error("failed to emit workflow.completed event: %s", emit_exc)

    log.info(
        "workflow %s completed (steps=%d, skipped=%d, failed=%d, duration=%dms)",
        workflow_name,
        len(steps),
        steps_skipped,
        steps_failed,
        workflow_duration_ms,
    )

    # Warn if workflow took longer than expected
    total_timeout_minutes = sum(s.timeout_minutes for s in steps)
    if workflow_duration_ms > total_timeout_minutes * 60 * 1000:
        log.warning(
            "STUCK WORKFLOW: %s took %dms, exceeding total step timeout budget of %dm",
            workflow_name,
            workflow_duration_ms,
            total_timeout_minutes,
        )


# ─── WorkflowManager integration ─────────────────────────────────


async def _check_manager_available(conn: asyncpg.Connection) -> bool:
    """Check if the process_instances table exists (migration 043 applied)."""
    try:
        row = await conn.fetchrow(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'process_instances'
            ) AS table_exists
            """
        )
        return bool(row and row["table_exists"])
    except Exception:
        return False


async def _run_workflow_managed(
    conn: asyncpg.Connection,
    manager: Any,
    workflow_cls: type[Workflow],
    event_dict: dict[str, Any],
) -> None:
    """Execute a workflow through the persistent WorkflowManager.

    Creates a process_instance, then drives execution step-by-step
    with crash recovery and audit trail.
    """
    workflow_name = workflow_cls.__name__
    trigger_event_id = event_dict.get("id")
    tenant_id = event_dict.get("tenant_id")
    payload = event_dict.get("payload", {})

    # Create persistent instance
    instance_id = await manager.create_instance(
        conn,
        workflow_name=workflow_name,
        trigger_event_id=trigger_event_id,
        payload=payload,
        tenant_id=tenant_id,
        actor_id=event_dict.get("actor_id"),
        actor_email=None,
    )

    log.info(
        "created process instance %s for workflow %s (event=%s)",
        instance_id,
        workflow_name,
        trigger_event_id,
    )

    # Execute the instance
    result = await manager.execute_instance(
        conn, instance_id, workflow_cls, payload
    )

    log.info(
        "workflow instance %s finished with status=%s",
        instance_id,
        result.get("status"),
    )


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

    If the process_instances table exists (migration 043), uses the
    persistent WorkflowManager for crash recovery and audit trail.
    Otherwise falls back to fire-and-forget execution.
    """
    conn: Optional[asyncpg.Connection] = None
    manager: Optional[Any] = None
    pool: Optional[Any] = None
    try:
        conn = await asyncpg.connect(database_url)
        log.info("workflow processor started")

        # Discover and register all workflow definitions
        count = discover_workflows()
        log.info("discovered %d workflow(s)", count)

        # Check if persistent workflow management is available
        use_manager = await _check_manager_available(conn)
        if use_manager:
            from workflows.manager import WorkflowManager
            pool = await asyncpg.create_pool(database_url, min_size=2, max_size=4)
            manager = WorkflowManager(source="pipeline")
            await manager.start(conn, pool=pool)
            log.info("WorkflowManager enabled — persistent execution with crash recovery")
        else:
            log.info("process_instances table not found — using fire-and-forget execution")

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
                        "error": event_row.get("error") or event_row.get("error_json") or None,
                    }

                    # Duplicate detection — skip if already processed
                    event_id = event_dict["id"]
                    if _track_processed(event_id):
                        log.info(
                            "skipping duplicate event %s (already processed)",
                            event_id,
                        )
                        last_processed_at = event_row["created_at"]
                        continue

                    workflow_cls = get_workflow_for_event(event_dict)
                    if workflow_cls:
                        try:
                            if manager:
                                await _run_workflow_managed(
                                    conn, manager, workflow_cls, event_dict
                                )
                            else:
                                await _run_workflow(conn, workflow_cls, event_dict)
                        except Exception as exc:
                            log.error(
                                "workflow execution failed for event %s: %s",
                                event_dict["id"],
                                exc,
                            )
                            try:
                                await emit_event(
                                    conn,
                                    namespace="system",
                                    type="workflow.failed",
                                    payload={
                                        "workflow": workflow_cls.__name__,
                                        "triggerEventId": event_dict["id"],
                                        "tenant_id": event_dict.get("tenant_id"),
                                        "error": str(exc)[:500],
                                    },
                                    tenant_id=event_dict.get("tenant_id"),
                                )
                            except Exception as emit_exc:
                                log.error(
                                    "failed to emit workflow.failed event: %s",
                                    emit_exc,
                                )

                    # Advance the high-water mark
                    last_processed_at = event_row["created_at"]

                # Poll for retrying instances (HITL resume + admin retry)
                if manager:
                    try:
                        retrying_ids = await manager.poll_retrying_instances(conn)
                        for rid in retrying_ids:
                            # Look up the workflow class from the instance
                            inst_row = await conn.fetchrow(
                                "SELECT workflow_name, payload FROM process_instances WHERE id = $1",
                                uuid.UUID(rid),
                            )
                            if inst_row:
                                wf_cls = get_workflow_for_event({
                                    "namespace": "",
                                    "type": "",
                                    "phase": "",
                                    "payload": json.loads(inst_row["payload"]) if isinstance(inst_row["payload"], str) else (inst_row["payload"] or {}),
                                })
                                # If we can't find the class by event, look it up by name
                                if not wf_cls:
                                    from workflows.base import _registry
                                    for candidates in _registry.values():
                                        for c in candidates:
                                            if c.__name__ == inst_row["workflow_name"]:
                                                wf_cls = c
                                                break
                                        if wf_cls:
                                            break
                                if wf_cls:
                                    await manager.execute_instance(
                                        conn, rid, wf_cls,
                                        json.loads(inst_row["payload"]) if isinstance(inst_row["payload"], str) else (inst_row["payload"] or {}),
                                    )
                                else:
                                    log.warning(
                                        "Cannot resolve workflow for retrying instance %s (name=%s)",
                                        rid, inst_row["workflow_name"],
                                    )
                                    await conn.execute(
                                        "UPDATE process_instances SET status = 'failed', last_error = 'workflow_class_not_found', completed_at = now() WHERE id = $1",
                                        uuid.UUID(rid),
                                    )
                    except Exception as e:
                        log.error("poll_retrying_instances failed: %s", e)

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
                # Normal -- poll interval elapsed, loop again
                pass

    except Exception as exc:
        log.error("workflow processor fatal: %s", exc)
    finally:
        if manager:
            await manager.stop()
        if pool:
            await pool.close()
        if conn:
            await conn.close()
        log.info("workflow processor stopped")
