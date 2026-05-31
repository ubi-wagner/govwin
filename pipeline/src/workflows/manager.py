"""
================================================================================
WorkflowManager — Persistent Workflow Orchestration with Crash Recovery
================================================================================

WHO:    Central orchestrator for all workflow execution across both the RFP
        Pipeline (admin workflows) and CMS (email/content automation workflows).
        Called by the main pipeline loop and CMS event listener.

WHAT:   Replaces the fire-and-forget workflow processor with a fully persistent,
        crash-recoverable workflow execution engine. Every workflow instance is
        tracked in the process_instances table from creation through completion.

WHY:    Without persistence:
        - If the process crashes mid-workflow, all in-flight work is lost
        - Admins have no visibility into what's running or what failed
        - Failed workflows can't be retried from the last successful step
        - No audit trail for compliance reporting
        - HITL_WAIT steps can't actually pause and resume

HOW:    1. Event arrives → create process_instance row (status=pending)
        2. Claim instance (status=running, heartbeat starts)
        3. Execute steps sequentially, persisting each result
        4. On step completion → update step_results + step_status JSONB
        5. On step failure → mark instance failed, store error, emit event
        6. On HITL_WAIT → mark instance paused, store resume trigger
        7. On completion → mark instance completed, emit event
        8. Cron heartbeat: mark stuck instances (no heartbeat > 5min) as failed
        9. Recovery: create new instance from failed one, skip completed steps
        10. Admin actions: cancel, retry, force-complete

CRASH RECOVERY:
        If the process dies mid-execution:
        1. Cron detects missing heartbeat after 5 minutes
        2. Marks instance as 'failed' with reason='heartbeat_timeout'
        3. Admin or auto-recovery creates new instance with recovered_from=old.id
        4. New instance reads step_status from old instance
        5. Skips all steps marked 'completed', resumes from first non-completed step
        6. Emits system:workflow.recovered event

CRON HEARTBEAT (every 30 seconds):
        UPDATE process_instances SET last_heartbeat_at = now()
        WHERE id = $current_instance AND status = 'running'

STUCK DETECTION (every 60 seconds):
        SELECT * FROM process_instances
        WHERE status = 'running'
        AND last_heartbeat_at < now() - interval '5 minutes'
        → Mark as failed, emit system:workflow.stuck_detected event

ADMIN ACTIONS:
        - Cancel: status → cancelled, emit event
        - Retry: create new instance from failed, skip completed steps
        - Force-complete: status → completed (for stuck HITL_WAIT)

EVENT EMISSIONS:
        - system:workflow.instance_created (single)
        - system:workflow.instance_started (single)
        - system:workflow.step_started (single)
        - system:workflow.step_completed (single)
        - system:workflow.step_failed (single)
        - system:workflow.instance_completed (single)
        - system:workflow.instance_failed (single)
        - system:workflow.instance_cancelled (single)
        - system:workflow.instance_recovered (single)
        - system:workflow.stuck_detected (single)

CHANGE LOG:
    PR #xxx (2026-05-22) — Initial implementation: full persistent workflow
                           manager with crash recovery, heartbeat, admin actions
================================================================================
"""
from __future__ import annotations

import asyncio
import importlib
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg

from events import emit_event
from workflows.base import StepType, Workflow

logger = logging.getLogger("pipeline.workflows.manager")


class WorkflowManager:
    """Persistent workflow orchestration with crash recovery."""

    def __init__(self, source: str = "pipeline"):
        """Initialize manager.

        Args:
            source: 'pipeline' for RFP admin workflows, 'cms' for CMS workflows
        """
        self.source = source
        self._running_instances: dict[str, str] = {}  # instance_id → workflow_name
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._stuck_detection_task: asyncio.Task[None] | None = None

    async def start(self, conn: asyncpg.Connection, pool: asyncpg.Pool | None = None) -> None:
        """Start the manager's background tasks.

        Args:
            conn: primary connection for orphan recovery
            pool: connection pool for background tasks (heartbeat, stuck detection).
                  If None, background tasks use the same connection (not recommended
                  for production — asyncpg connections are not concurrency-safe).
        """
        self._pool = pool
        self._cancelled_instances: set[str] = set()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(conn, pool))
        self._stuck_detection_task = asyncio.create_task(self._stuck_detection_loop(conn, pool))
        await self._recover_orphaned_instances(conn)

    async def stop(self) -> None:
        """Gracefully stop background tasks."""
        for task in [self._heartbeat_task, self._stuck_detection_task]:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    async def create_instance(
        self,
        conn: asyncpg.Connection,
        workflow_name: str,
        trigger_event_id: Optional[str],
        payload: dict[str, Any],
        tenant_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        actor_email: Optional[str] = None,
    ) -> str:
        """Create a new workflow instance (status=pending).

        Returns the instance ID.
        """
        instance_id = str(uuid.uuid4())

        # Calculate deadline from workflow definition (default 1 hour)
        deadline = datetime.now(timezone.utc) + timedelta(hours=1)

        result = await conn.fetchrow(
            """
            INSERT INTO process_instances
                (id, workflow_name, trigger_event_id, status, payload,
                 tenant_id, actor_id, actor_email, source, deadline)
            VALUES ($1, $2, $3, 'pending', $4::jsonb, $5, $6, $7, $8, $9)
            ON CONFLICT (workflow_name, trigger_event_id) DO NOTHING
            RETURNING id
            """,
            uuid.UUID(instance_id),
            workflow_name,
            uuid.UUID(trigger_event_id) if trigger_event_id else None,
            json.dumps(payload),
            uuid.UUID(tenant_id) if tenant_id else None,
            self._safe_uuid(actor_id),
            actor_email,
            self.source,
            deadline,
        )

        if result is None:
            # Duplicate — fetch the existing instance ID
            existing = await conn.fetchval(
                """
                SELECT id::text FROM process_instances
                WHERE workflow_name = $1 AND trigger_event_id = $2
                """,
                workflow_name,
                uuid.UUID(trigger_event_id) if trigger_event_id else None,
            )
            logger.warning(
                "[create_instance] Duplicate for workflow=%s trigger=%s — returning existing %s",
                workflow_name, trigger_event_id, existing,
            )
            return existing or instance_id

        # Record transition
        await self._record_transition(
            conn, instance_id, None, "pending", actor="system", reason="created"
        )

        # Emit event
        await self._emit_event(
            conn,
            "system",
            "workflow.instance_created",
            tenant_id,
            {
                "instance_id": instance_id,
                "workflow_name": workflow_name,
                "trigger_event_id": trigger_event_id,
            },
        )

        return instance_id

    async def execute_instance(
        self,
        conn: asyncpg.Connection,
        instance_id: str,
        workflow_cls: type[Workflow],
        trigger_payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a workflow instance step by step with persistence.

        This is the main execution loop. It:
        1. Claims the instance (pending → running)
        2. Iterates through workflow steps
        3. Skips already-completed steps (for recovery)
        4. Persists each step result
        5. Handles HITL_WAIT by pausing
        6. Marks complete or failed at the end
        """
        workflow_name = workflow_cls.__name__

        # Claim instance with row lock to prevent double-claim
        # CTE captures previous status before the UPDATE overwrites it
        result = await conn.fetchrow(
            """
            WITH old AS (
                SELECT id, status AS prev_status FROM process_instances
                WHERE id = $1 AND status IN ('pending', 'retrying')
                FOR UPDATE SKIP LOCKED
            )
            UPDATE process_instances pi
            SET status = 'running', started_at = COALESCE(pi.started_at, now()),
                last_heartbeat_at = now()
            FROM old
            WHERE pi.id = old.id
            RETURNING old.prev_status
            """,
            uuid.UUID(instance_id),
        )

        if not result:
            return {"status": "error", "reason": "Instance not claimable"}

        prev_status = result["prev_status"]
        await self._record_transition(
            conn, instance_id, prev_status, "running", actor="system", reason="execution_started"
        )
        self._running_instances[instance_id] = workflow_name

        await self._emit_event(
            conn,
            "system",
            "workflow.instance_started",
            None,
            {
                "instance_id": instance_id,
                "workflow_name": workflow_name,
            },
        )

        # Load prior step results (for recovery)
        row = await conn.fetchrow(
            "SELECT step_results, step_status FROM process_instances WHERE id = $1",
            uuid.UUID(instance_id),
        )
        step_results: dict[str, Any] = {}
        step_status: dict[str, str] = {}
        if row:
            raw_results = row["step_results"]
            raw_status = row["step_status"]
            if isinstance(raw_results, str):
                step_results = json.loads(raw_results) if raw_results else {}
            elif isinstance(raw_results, dict):
                step_results = raw_results
            if isinstance(raw_status, str):
                step_status = json.loads(raw_status) if raw_status else {}
            elif isinstance(raw_status, dict):
                step_status = raw_status

        # Execute steps
        steps = workflow_cls.step_execution_order()
        final_status = "completed"
        step_name = None  # track for error reporting

        try:
          for i, step in enumerate(steps):
            step_name = step.name

            # Check for cancellation between steps
            if instance_id in getattr(self, '_cancelled_instances', set()):
                self._cancelled_instances.discard(instance_id)
                final_status = "cancelled"
                break
            cancel_check = await conn.fetchval(
                "SELECT status FROM process_instances WHERE id = $1",
                uuid.UUID(instance_id),
            )
            if cancel_check == "cancelled":
                final_status = "cancelled"
                break

            # Skip already-completed steps (crash recovery)
            if step_status.get(step_name) == "completed":
                logger.info("[%s] Skipping completed step: %s", instance_id, step_name)
                continue

            # Update current step
            await conn.execute(
                """
                UPDATE process_instances
                SET current_step = $2, current_step_index = $3, last_heartbeat_at = now()
                WHERE id = $1
                """,
                uuid.UUID(instance_id),
                step_name,
                i,
            )

            # Check step dependencies
            if step.depends_on:
                dep_status = step_status.get(step.depends_on)
                if dep_status == "failed":
                    logger.warning(
                        "[%s] Dependency %s failed for %s, skipping",
                        instance_id,
                        step.depends_on,
                        step_name,
                    )
                    step_status[step_name] = "skipped"
                    await self._persist_step_status(conn, instance_id, step_results, step_status)
                    continue
                if dep_status == "skipped":
                    logger.warning(
                        "[%s] Dependency %s skipped for %s, skipping",
                        instance_id,
                        step.depends_on,
                        step_name,
                    )
                    step_status[step_name] = "skipped"
                    await self._persist_step_status(conn, instance_id, step_results, step_status)
                    continue

            # Mark step as running
            step_status[step_name] = "running"
            await self._persist_step_status(conn, instance_id, step_results, step_status)

            # Emit step started
            await self._emit_event(
                conn,
                "system",
                "workflow.step_started",
                None,
                {
                    "instance_id": instance_id,
                    "workflow_name": workflow_name,
                    "step_name": step_name,
                    "step_index": i,
                },
            )

            # Handle TODO + HITL_WAIT steps — both park the instance. TODO also
            # writes a row to the unified `tasks` ledger so it shows up in the
            # assignee's queue and gets nudged. (Tasks epic keystone.)
            if step.step_type in (StepType.TODO, StepType.HITL_WAIT):
                step_status[step_name] = "waiting"
                await self._persist_step_status(conn, instance_id, step_results, step_status)
                # Derive the park deadline from the binding's DECLARED timeout, not
                # the create-time 1h default. A 72h HITL review must get a 72h
                # deadline or the paused-deadline sweep force-fails it ~1h in.
                # (EVENT_CONTRACT_V3 §3.1 / §6; CLAUDE_CLIFFNOTES Mistake 17.)
                wait_minutes = (
                    step.timeout_minutes
                    if step.timeout_minutes and step.timeout_minutes > 0
                    else 1440
                )
                wait_deadline = datetime.now(timezone.utc) + timedelta(minutes=wait_minutes)
                await conn.execute(
                    """
                    UPDATE process_instances
                    SET status = 'paused', current_step = $2, deadline = $3
                    WHERE id = $1
                    """,
                    uuid.UUID(instance_id),
                    step_name,
                    wait_deadline,
                )
                reason = (
                    f"todo:{step_name}"
                    if step.step_type == StepType.TODO
                    else f"hitl_wait:{step_name}"
                )
                await self._record_transition(
                    conn, instance_id, "running", "paused",
                    actor="system", reason=reason,
                )
                if step.step_type == StepType.TODO:
                    await self._create_task(
                        conn, step, instance_id, trigger_payload, step_results,
                    )
                self._running_instances.pop(instance_id, None)
                return {
                    "status": "paused",
                    "waiting_for": step_name,
                    "instance_id": instance_id,
                }

            # Execute step with retry
            step_start = time.monotonic()
            max_retries = step.retry_count
            timeout_seconds = step.timeout_minutes * 60

            step_result: Optional[dict[str, Any]] = None
            step_error: Optional[str] = None

            for attempt in range(max_retries + 1):
                try:
                    step_result = await asyncio.wait_for(
                        self._execute_step(
                            conn, step, trigger_payload, step_results
                        ),
                        timeout=timeout_seconds,
                    )
                    break  # Success
                except asyncio.TimeoutError:
                    step_error = (
                        f"Timeout after {step.timeout_minutes}m (attempt {attempt + 1})"
                    )
                    if attempt < max_retries:
                        delay = step.retry_delay_seconds * (2**attempt)
                        await asyncio.sleep(delay)
                except Exception as e:
                    step_error = f"{type(e).__name__}: {str(e)[:500]}"
                    if attempt < max_retries:
                        delay = step.retry_delay_seconds * (2**attempt)
                        await asyncio.sleep(delay)

            duration_ms = int((time.monotonic() - step_start) * 1000)

            if step_result is not None:
                # Step succeeded
                step_results[step_name] = step_result
                step_status[step_name] = "completed"
                await self._persist_step_status(conn, instance_id, step_results, step_status)

                await self._emit_event(
                    conn,
                    "system",
                    "workflow.step_completed",
                    None,
                    {
                        "instance_id": instance_id,
                        "workflow_name": workflow_name,
                        "step_name": step_name,
                        "duration_ms": duration_ms,
                    },
                )
            else:
                # Step failed after all retries
                step_status[step_name] = "failed"
                await self._persist_step_status(conn, instance_id, step_results, step_status)

                # Update instance with error info
                await conn.execute(
                    """
                    UPDATE process_instances
                    SET last_error = $2, last_error_step = $3
                    WHERE id = $1
                    """,
                    uuid.UUID(instance_id),
                    step_error,
                    step_name,
                )

                await self._emit_event(
                    conn,
                    "system",
                    "workflow.step_failed",
                    None,
                    {
                        "instance_id": instance_id,
                        "workflow_name": workflow_name,
                        "step_name": step_name,
                        "error": step_error,
                        "duration_ms": duration_ms,
                    },
                )

                # Step failure is fatal — stop the workflow
                final_status = "failed"
                break

            # Heartbeat after each step
            await conn.execute(
                """
                UPDATE process_instances SET last_heartbeat_at = now() WHERE id = $1
                """,
                uuid.UUID(instance_id),
            )

        except Exception as loop_exc:
            logger.error("[%s] Infrastructure error in step loop: %s", instance_id, loop_exc)
            final_status = "failed"
            try:
                await conn.execute(
                    """
                    UPDATE process_instances
                    SET last_error = $2, last_error_step = $3
                    WHERE id = $1
                    """,
                    uuid.UUID(instance_id),
                    f"Infrastructure: {str(loop_exc)[:500]}",
                    step_name,
                )
            except Exception:
                pass

        # Mark instance complete/failed
        await conn.execute(
            """
            UPDATE process_instances
            SET status = $2, completed_at = now(), current_step = NULL
            WHERE id = $1
            """,
            uuid.UUID(instance_id),
            final_status,
        )

        await self._record_transition(
            conn,
            instance_id,
            "running",
            final_status,
            actor="system",
            reason="execution_finished",
        )

        event_type = f"workflow.instance_{final_status}"
        await self._emit_event(
            conn,
            "system",
            event_type,
            None,
            {
                "instance_id": instance_id,
                "workflow_name": workflow_name,
                "steps_completed": sum(1 for s in step_status.values() if s == "completed"),
                "steps_failed": sum(1 for s in step_status.values() if s == "failed"),
            },
        )

        self._running_instances.pop(instance_id, None)
        return {
            "status": final_status,
            "instance_id": instance_id,
            "step_results": step_results,
        }

    async def retry_instance(
        self, conn: asyncpg.Connection, instance_id: str, actor_email: str
    ) -> str:
        """Create a new instance that recovers from a failed one.

        Skips all previously completed steps, resumes from the failed step.
        Returns the new instance ID.
        """
        # Fetch the failed instance
        row = await conn.fetchrow(
            """
            SELECT workflow_name, trigger_event_id, payload, tenant_id,
                   actor_id, actor_email, step_results, step_status, retry_count
            FROM process_instances WHERE id = $1 AND status IN ('failed', 'cancelled')
            """,
            uuid.UUID(instance_id),
        )

        if not row:
            raise ValueError(f"Instance {instance_id} not found or not retryable")

        # Parse JSONB fields
        prior_results = row["step_results"]
        if isinstance(prior_results, str):
            prior_results = json.loads(prior_results) if prior_results else {}
        elif prior_results is None:
            prior_results = {}

        prior_status = row["step_status"]
        if isinstance(prior_status, str):
            prior_status = json.loads(prior_status) if prior_status else {}
        elif prior_status is None:
            prior_status = {}

        # Create recovery instance
        new_id = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO process_instances
                (id, workflow_name, trigger_event_id, status, payload,
                 tenant_id, actor_id, actor_email, source,
                 step_results, step_status, retry_count, recovered_from,
                 deadline)
            VALUES ($1, $2, $3, 'retrying', $4::jsonb, $5, $6, $7, $8,
                    $9::jsonb, $10::jsonb, $11, $12,
                    now() + interval '1 hour')
            """,
            uuid.UUID(new_id),
            row["workflow_name"],
            None,  # trigger_event_id NULL for retries — lineage tracked via recovered_from
            row["payload"] if isinstance(row["payload"], str) else json.dumps(row["payload"] or {}),
            row["tenant_id"],
            row["actor_id"],
            row["actor_email"],
            self.source,
            json.dumps(prior_results, default=str),
            json.dumps(prior_status),
            (row["retry_count"] or 0) + 1,
            uuid.UUID(instance_id),
        )

        await self._record_transition(
            conn,
            new_id,
            None,
            "retrying",
            actor=f"admin:{actor_email}",
            reason=f"retry_from:{instance_id}",
        )

        await self._emit_event(
            conn,
            "system",
            "workflow.instance_recovered",
            None,
            {
                "instance_id": new_id,
                "recovered_from": instance_id,
                "workflow_name": row["workflow_name"],
                "actor": actor_email,
            },
        )

        return new_id

    async def cancel_instance(
        self, conn: asyncpg.Connection, instance_id: str, actor_email: str
    ) -> bool:
        """Cancel a running or paused workflow instance."""
        result = await conn.execute(
            """
            UPDATE process_instances
            SET status = 'cancelled', completed_at = now()
            WHERE id = $1 AND status IN ('running', 'paused', 'pending', 'retrying')
            """,
            uuid.UUID(instance_id),
        )

        if "UPDATE 0" in result:
            return False

        # Signal in-memory cancellation for in-flight workflows
        if hasattr(self, '_cancelled_instances'):
            self._cancelled_instances.add(instance_id)

        await self._record_transition(
            conn,
            instance_id,
            None,
            "cancelled",
            actor=f"admin:{actor_email}",
            reason="manual_cancellation",
        )

        await self._emit_event(
            conn,
            "system",
            "workflow.instance_cancelled",
            None,
            {
                "instance_id": instance_id,
                "actor": actor_email,
            },
        )

        self._running_instances.pop(instance_id, None)
        return True

    async def _create_task(
        self,
        conn: asyncpg.Connection,
        step: Any,
        instance_id: str,
        trigger_payload: dict[str, Any],
        step_results: dict[str, Any],
    ) -> Optional[str]:
        """Write a row to the `tasks` ledger for a TODO step.

        Every task_* field is resolved per-instance via the SAME resolve_input
        paths as input_map (payload.X / "literal"), so the static template stays
        generic and the payload carries the specifics — the assignee, the entity
        UUID to act on, the nudge cadence, the due date. The instance is already
        being parked by the caller; this just makes the gate visible + nudgeable.
        """
        from workflows.processor import resolve_input

        event_dict = {"payload": trigger_payload}

        def r(path: Optional[str]) -> Any:
            if not path:
                return None
            return resolve_input(path, event_dict, step_results)

        # tenant scope from the instance
        tenant_id = await conn.fetchval(
            "SELECT tenant_id FROM process_instances WHERE id = $1",
            uuid.UUID(instance_id),
        )

        task_type = r(step.task_type) or step.task_type or "task"
        title = r(step.task_title) or step.task_title or task_type
        assignee_role = r(step.assignee_role) or step.assignee_role
        assignee_user = r(step.assignee_user)
        entity_type = r(step.entity_type) or step.entity_type
        entity_ref = r(step.entity_ref)

        # Due date: explicit due_in_minutes overrides the step timeout.
        due_minutes = r(step.due_in_minutes)
        try:
            due_minutes = int(due_minutes) if due_minutes is not None else step.timeout_minutes
        except (TypeError, ValueError):
            due_minutes = step.timeout_minutes
        due_at = datetime.now(timezone.utc) + timedelta(minutes=due_minutes or 1440)

        nudge_days = r(step.nudge_days)
        if not isinstance(nudge_days, list):
            nudge_days = []

        params = {
            k: v for k, v in {
                "task_type_raw": step.task_type,
                "entity_ref": step.entity_ref,
            }.items() if v
        }

        task_id = str(uuid.uuid4())
        try:
            await conn.execute(
                """
                INSERT INTO tasks
                    (id, tenant_id, assignee_role, assignee_user_id, task_type,
                     title, entity_type, entity_id, process_instance_id, step_name,
                     status, due_at, nudge_schedule, params)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12::jsonb, $13::jsonb)
                """,
                uuid.UUID(task_id),
                tenant_id,
                assignee_role,
                self._safe_uuid(assignee_user),
                task_type,
                str(title)[:500],
                entity_type,
                self._safe_uuid(entity_ref),
                uuid.UUID(instance_id),
                step.name,
                due_at,
                json.dumps(nudge_days),
                json.dumps(params, default=str),
            )
        except Exception as e:
            # A task-write failure must NOT crash the park — the instance is
            # already paused; log and continue (the gate still exists, just
            # unsurfaced). Better degraded than a lost workflow.
            logger.error("[_create_task] failed for instance %s step %s: %s",
                         instance_id, step.name, e)
            return None

        await self._emit_event(
            conn, "system", "task.created",
            str(tenant_id) if tenant_id else None,
            {
                "task_id": task_id,
                "instance_id": instance_id,
                "step_name": step.name,
                "task_type": task_type,
                "assignee_role": assignee_role,
            },
        )
        logger.info("[_create_task] %s (%s) for instance %s step %s",
                    task_id, task_type, instance_id, step.name)
        return task_id

    async def complete_task(
        self,
        conn: asyncpg.Connection,
        task_id: str,
        result: Optional[dict[str, Any]] = None,
        actor: str = "system",
        actor_id: Optional[str] = None,
    ) -> bool:
        """Mark a task completed and resume its parked process instance.

        The human's decision (`result`) is recorded on the task AND passed to
        resume_instance, which merges it into the parked TODO step's result so
        downstream steps can read it (e.g. step.<todo>.result.approved). Returns
        False if the task is missing or already closed.
        """
        row = await conn.fetchrow(
            """
            SELECT process_instance_id, step_name, status
            FROM tasks WHERE id = $1
            """,
            uuid.UUID(task_id),
        )
        if not row or row["status"] not in ("open", "in_progress"):
            return False

        await conn.execute(
            """
            UPDATE tasks
            SET status = 'completed', result = $2::jsonb,
                completed_by = $3, completed_at = now(), updated_at = now()
            WHERE id = $1
            """,
            uuid.UUID(task_id),
            json.dumps(result or {}, default=str),
            self._safe_uuid(actor_id),
        )

        instance_id = row["process_instance_id"]
        if instance_id is not None:
            await self.resume_instance(
                conn, str(instance_id),
                resume_data={"task_id": task_id, **(result or {})},
                actor=actor, reason="task_completed",
            )
        return True

    async def _sweep_task_nudges(self, conn: asyncpg.Connection) -> int:
        """Fire any due nudges for open tasks (idempotent).

        For each open task with a due date and a nudge_schedule like [1,3,5]
        (days-before-due), emit system:task.nudge once per threshold as it is
        crossed, recording it in nudges_sent so it never double-fires. The
        landing-page nudge surface reads tasks directly; this event is the push
        signal (email/in-app) layered on top. Best-effort.
        """
        fired = 0
        try:
            rows = await conn.fetch(
                """
                SELECT id, tenant_id, assignee_role, title, due_at,
                       nudge_schedule, nudges_sent
                FROM tasks
                WHERE status IN ('open', 'in_progress') AND due_at IS NOT NULL
                  AND nudge_schedule <> '[]'::jsonb
                """
            )
        except Exception as e:
            logger.error("[_sweep_task_nudges] query failed: %s", e)
            return 0

        now = datetime.now(timezone.utc)
        for t in rows:
            schedule = t["nudge_schedule"]
            sent = t["nudges_sent"]
            if isinstance(schedule, str):
                schedule = json.loads(schedule or "[]")
            if isinstance(sent, str):
                sent = json.loads(sent or "[]")
            sent_set = set(sent or [])
            due_at = t["due_at"]
            for days_before in (schedule or []):
                if days_before in sent_set:
                    continue
                threshold = due_at - timedelta(days=float(days_before))
                if now >= threshold:
                    tenant_str = str(t["tenant_id"]) if t["tenant_id"] else None
                    try:
                        await self._emit_event(
                            conn, "system", "task.nudge", tenant_str,
                            {
                                "task_id": str(t["id"]),
                                "title": t["title"],
                                "assignee_role": t["assignee_role"],
                                "days_before_due": days_before,
                                "due_at": due_at.isoformat(),
                            },
                        )
                        sent_set.add(days_before)
                        await conn.execute(
                            "UPDATE tasks SET nudges_sent = $2::jsonb, updated_at = now() WHERE id = $1",
                            t["id"], json.dumps(sorted(sent_set, reverse=True)),
                        )
                        fired += 1
                    except Exception as e:
                        logger.error("[_sweep_task_nudges] nudge failed for %s: %s", t["id"], e)
        return fired

    async def resume_instance(
        self,
        conn: asyncpg.Connection,
        instance_id: str,
        resume_data: Optional[dict[str, Any]] = None,
        actor: str = "system",
        reason: str = "hitl_resumed",
    ) -> bool:
        """Resume a paused (HITL_WAIT) instance.

        Marks the HITL_WAIT step as completed (with resume_data as result) and
        sets status to 'retrying' so execute_instance picks it up and continues
        from the next step. `actor`/`reason` are recorded on the transition and
        emitted for audit: the event-driven path uses the defaults
        ('system'/'hitl_resumed'); a human force-advance (rfp_admin now,
        tenant_admin later) passes the operator's identity and 'hitl_forced'.
        The frontend force-advance lib (lib/process/force-advance.ts) mirrors
        this exact state transition — keep the two in sync.
        """
        row = await conn.fetchrow(
            "SELECT current_step, step_results, step_status FROM process_instances WHERE id = $1 AND status = 'paused'",
            uuid.UUID(instance_id),
        )
        if not row:
            return False

        # Mark the HITL step as completed with resume_data
        step_status = json.loads(row["step_status"]) if isinstance(row["step_status"], str) else (row["step_status"] or {})
        step_results = json.loads(row["step_results"]) if isinstance(row["step_results"], str) else (row["step_results"] or {})
        current_step = row["current_step"]
        if current_step:
            step_status[current_step] = "completed"
            step_results[current_step] = resume_data or {"resumed": True}

        result = await conn.execute(
            """
            UPDATE process_instances
            SET status = 'retrying', last_heartbeat_at = now(),
                step_status = $2::jsonb, step_results = $3::jsonb
            WHERE id = $1 AND status = 'paused'
            """,
            uuid.UUID(instance_id),
            json.dumps(step_status),
            json.dumps(step_results, default=str),
        )

        if "UPDATE 0" in result:
            return False

        await self._record_transition(
            conn, instance_id, "paused", "retrying", actor=actor, reason=reason,
        )
        # Observable audit of who resumed — distinguishes a human force-advance
        # (forced=True) from the event-driven resume (forced=False).
        await self._emit_event(
            conn, "system", "workflow.resumed", None,
            {
                "instance_id": instance_id,
                "actor": actor,
                "reason": reason,
                "forced": reason != "hitl_resumed",
            },
        )
        return True

    async def match_waiting_instances(
        self, conn: asyncpg.Connection, event: dict[str, Any]
    ) -> list[str]:
        """Resume paused instances whose current HITL step is waiting for this event.

        This is the missing link that made HITL a dead end: instances could pause
        but nothing matched an incoming event against the parking step's `wait_for`
        trigger to wake them. For each paused instance of this source, resolve its
        workflow class, find the current step, and if that step's `wait_for` matches
        the event, resume it (paused -> retrying) so poll_retrying_instances re-drives
        it from the next step. (EVENT_CONTRACT_V3 §6; CLAUDE_CLIFFNOTES Mistake 18.)

        Returns the list of resumed instance IDs.
        """
        from workflows.base import EventTrigger  # local import: avoid cycle at module load

        resumed: list[str] = []
        rows = await conn.fetch(
            """
            SELECT id, workflow_name, current_step FROM process_instances
            WHERE status = 'paused' AND source = $1
            """,
            self.source,
        )
        for row in rows:
            wf_cls = self._resolve_workflow_class(row["workflow_name"])
            if wf_cls is None:
                continue
            step = next(
                (s for s in wf_cls.steps if s.name == row["current_step"]), None
            )
            wait_for: Optional[EventTrigger] = getattr(step, "wait_for", None)
            if wait_for is None:
                continue
            if wait_for.matches(event):
                if await self.resume_instance(
                    conn, str(row["id"]), resume_data={"resumed_by_event": event.get("id")}
                ):
                    resumed.append(str(row["id"]))
        return resumed

    @staticmethod
    def _resolve_workflow_class(workflow_name: str):
        """Look up a registered Workflow subclass by its class name."""
        from workflows.base import _registry

        for candidates in _registry.values():
            for c in candidates:
                if c.__name__ == workflow_name:
                    return c
        return None

    async def poll_retrying_instances(self, conn: asyncpg.Connection) -> list[str]:
        """Find instances that need re-execution (retrying status).

        Called by the processor main loop to pick up resumed HITL instances
        and retry instances created by the admin.
        """
        rows = await conn.fetch(
            """
            SELECT id, workflow_name FROM process_instances
            WHERE status = 'retrying' AND source = $1
            ORDER BY updated_at ASC LIMIT 5
            """,
            self.source,
        )
        return [str(r["id"]) for r in rows]

    # --- Internal helpers ---

    @staticmethod
    def _safe_uuid(value: str | None) -> uuid.UUID | None:
        """Convert string to UUID, returning None if invalid."""
        if not value:
            return None
        try:
            return uuid.UUID(value)
        except (ValueError, AttributeError):
            return None

    async def _execute_step(
        self,
        conn: asyncpg.Connection,
        step: Any,
        trigger_payload: dict[str, Any],
        prior_results: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a single workflow step. Delegates to the step's action."""
        from workflows.processor import resolve_inputs, _execute_step as processor_execute_step

        # Build a fake event dict so resolve_inputs works with existing logic
        event_dict: dict[str, Any] = {"payload": trigger_payload}
        inputs = resolve_inputs(step.input_map, event_dict, prior_results)

        return await processor_execute_step(conn, step, inputs, trigger_event=event_dict)

    async def _run_on_timeout(
        self,
        conn: asyncpg.Connection,
        workflow_name: str,
        current_step: Optional[str],
        payload: dict[str, Any],
        tenant_str: Optional[str],
        instance_id: str,
    ) -> Optional[str]:
        """Run a parked step's declared on_timeout escalation, if any.

        This is what makes on_timeout a live binding instead of a dead field
        (EVENT_CONTRACT_V3 §6 gap 6). When a HITL wait crosses its deadline, the
        parked step may name an on_timeout step (e.g. re-notify the admin); we
        resolve and execute it, then emit workflow.escalation_ran. Best-effort:
        any failure is logged and swallowed so the sweep still fails the instance
        cleanly. Semantics: escalate once, then the caller marks the instance
        terminally failed (a re-notify-and-repark loop is intentionally V2).

        Returns the on_timeout step name if it ran, else None.
        """
        wf_cls = self._resolve_workflow_class(workflow_name)
        if wf_cls is None or not current_step:
            return None
        parked = next((s for s in wf_cls.steps if s.name == current_step), None)
        target_name = getattr(parked, "on_timeout", None) if parked else None
        if not target_name:
            return None
        target = next((s for s in wf_cls.steps if s.name == target_name), None)
        if target is None:
            # validate() should prevent this; guard anyway.
            logger.warning(
                "[on_timeout] %s.%s names missing step '%s'",
                workflow_name, current_step, target_name,
            )
            return None
        try:
            await self._execute_step(conn, target, payload or {}, {})
            await self._emit_event(
                conn, "system", "workflow.escalation_ran", tenant_str,
                {
                    "instance_id": instance_id,
                    "workflow_name": workflow_name,
                    "timed_out_step": current_step,
                    "on_timeout_step": target.name,
                },
            )
            logger.info(
                "[on_timeout] ran %s.%s for instance %s",
                workflow_name, target.name, instance_id,
            )
            return target.name
        except Exception as e:
            logger.error(
                "[on_timeout] escalation step %s failed for instance %s: %s",
                target_name, instance_id, e,
            )
            return None

    async def _heartbeat_loop(
        self, conn: asyncpg.Connection, pool: asyncpg.Pool | None = None
    ) -> None:
        """Send heartbeats for all running instances every 30 seconds.

        Uses a dedicated pool connection if available to avoid sharing
        the main connection (asyncpg is not concurrency-safe).
        """
        while True:
            try:
                await asyncio.sleep(30)
                if self._running_instances:
                    ids = [uuid.UUID(iid) for iid in self._running_instances]
                    if pool:
                        async with pool.acquire() as hb_conn:
                            await hb_conn.execute(
                                """
                                UPDATE process_instances SET last_heartbeat_at = now()
                                WHERE id = ANY($1) AND status = 'running'
                                """,
                                ids,
                            )
                    else:
                        await conn.execute(
                            """
                            UPDATE process_instances SET last_heartbeat_at = now()
                            WHERE id = ANY($1) AND status = 'running'
                            """,
                            ids,
                        )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("[heartbeat] Error: %s", e)

    async def _stuck_detection_loop(
        self, conn: asyncpg.Connection, pool: asyncpg.Pool | None = None
    ) -> None:
        """Detect and mark stuck + paused-timeout instances every 60 seconds."""
        while True:
            try:
                await asyncio.sleep(60)

                # Fire any due task nudges (1/3/5-day reminders, etc.). Shares the
                # 60s cadence with stuck-detection; idempotent via nudges_sent.
                if pool:
                    async with pool.acquire() as nudge_conn:
                        await self._sweep_task_nudges(nudge_conn)
                else:
                    await self._sweep_task_nudges(conn)

                # Check for stale heartbeats on running instances
                if pool:
                    async with pool.acquire() as sd_conn:
                        stuck = await sd_conn.fetch(
                            """
                            SELECT id, workflow_name, current_step, tenant_id
                            FROM process_instances
                            WHERE status = 'running'
                              AND last_heartbeat_at < now() - interval '5 minutes'
                            """
                        )
                else:
                    stuck = await conn.fetch(
                        """
                        SELECT id, workflow_name, current_step, tenant_id
                        FROM process_instances
                        WHERE status = 'running'
                          AND last_heartbeat_at < now() - interval '5 minutes'
                        """
                    )

                # Use pool connection for writes if available
                async def _do_stuck_writes(w_conn, stuck_row):
                    stuck_id = str(stuck_row["id"])
                    logger.warning(
                        "[stuck_detection] Instance %s (%s) has no heartbeat",
                        stuck_id,
                        stuck_row["workflow_name"],
                    )
                    await w_conn.execute(
                        """
                        UPDATE process_instances
                        SET status = 'failed', last_error = 'heartbeat_timeout',
                            completed_at = now()
                        WHERE id = $1
                        """,
                        stuck_row["id"],
                    )
                    await self._record_transition(
                        w_conn, stuck_id, "running", "failed",
                        actor="cron", reason="heartbeat_timeout",
                    )
                    tenant_str = (
                        str(stuck_row["tenant_id"]) if stuck_row["tenant_id"] else None
                    )
                    await self._emit_event(
                        w_conn, "system", "workflow.stuck_detected", tenant_str,
                        {
                            "instance_id": stuck_id,
                            "workflow_name": stuck_row["workflow_name"],
                            "current_step": stuck_row["current_step"],
                        },
                    )
                    self._running_instances.pop(stuck_id, None)

                for stuck_row in stuck:
                    if pool:
                        async with pool.acquire() as w_conn:
                            await _do_stuck_writes(w_conn, stuck_row)
                    else:
                        await _do_stuck_writes(conn, stuck_row)

                # Check for stale pending instances (created > 1 hour ago, never picked up)
                if pool:
                    async with pool.acquire() as sp_conn:
                        stale_pending = await sp_conn.fetch(
                            """SELECT id, workflow_name FROM process_instances
                               WHERE status = 'pending' AND created_at < now() - interval '1 hour'
                               FOR UPDATE SKIP LOCKED"""
                        )
                else:
                    stale_pending = await conn.fetch(
                        """SELECT id, workflow_name FROM process_instances
                           WHERE status = 'pending' AND created_at < now() - interval '1 hour'
                           FOR UPDATE SKIP LOCKED"""
                    )

                for sp_row in stale_pending:
                    sp_id = str(sp_row["id"])
                    logger.warning(
                        "[stuck_detection] Stale pending instance %s (%s) — created > 1 hour ago",
                        sp_id, sp_row["workflow_name"],
                    )
                    if pool:
                        async with pool.acquire() as sp_w_conn:
                            await sp_w_conn.execute(
                                """
                                UPDATE process_instances
                                SET status = 'failed', last_error = 'pending_ttl_expired',
                                    completed_at = now()
                                WHERE id = $1 AND status = 'pending'
                                """,
                                sp_row["id"],
                            )
                            await self._record_transition(
                                sp_w_conn, sp_id, "pending", "failed",
                                actor="cron", reason="pending_ttl_expired",
                            )
                    else:
                        await conn.execute(
                            """
                            UPDATE process_instances
                            SET status = 'failed', last_error = 'pending_ttl_expired',
                                completed_at = now()
                            WHERE id = $1 AND status = 'pending'
                            """,
                            sp_row["id"],
                        )
                        await self._record_transition(
                            conn, sp_id, "pending", "failed",
                            actor="cron", reason="pending_ttl_expired",
                        )

                # Also check for paused instances past their deadline
                if pool:
                    async with pool.acquire() as pt_conn:
                        paused_timeout = await pt_conn.fetch(
                            """
                            SELECT id, workflow_name, current_step, tenant_id, payload
                            FROM process_instances
                            WHERE status = 'paused' AND deadline IS NOT NULL
                              AND deadline < now()
                            """
                        )
                else:
                    paused_timeout = await conn.fetch(
                        """
                        SELECT id, workflow_name, current_step, tenant_id, payload
                        FROM process_instances
                        WHERE status = 'paused' AND deadline IS NOT NULL
                          AND deadline < now()
                        """
                    )

                for pt_row in paused_timeout:
                    pt_id = str(pt_row["id"])
                    # A park-and-wait that crosses its (binding-derived) wait_deadline
                    # is an ESCALATION, not a silent kill. Run the parked step's
                    # on_timeout (e.g. re-notify the admin) before recording the
                    # timeout and failing the instance, and emit an observable
                    # workflow.wait_timed_out event with a step pointer.
                    # (EVENT_CONTRACT_V3 §6 gaps 1+6; CLAUDE_CLIFFNOTES Mistake 17.)
                    logger.warning(
                        "[stuck_detection] Paused instance %s (%s) past wait_deadline at step %s",
                        pt_id, pt_row["workflow_name"], pt_row["current_step"],
                    )
                    tenant_str = (
                        str(pt_row["tenant_id"]) if pt_row["tenant_id"] else None
                    )
                    pt_payload = pt_row.get("payload")
                    if isinstance(pt_payload, str):
                        try:
                            pt_payload = json.loads(pt_payload)
                        except (json.JSONDecodeError, TypeError):
                            pt_payload = {}
                    # INC-6: run on_timeout escalation (best-effort) before failing.
                    if pool:
                        async with pool.acquire() as esc_conn:
                            await self._run_on_timeout(
                                esc_conn, pt_row["workflow_name"],
                                pt_row["current_step"], pt_payload or {},
                                tenant_str, pt_id,
                            )
                    else:
                        await self._run_on_timeout(
                            conn, pt_row["workflow_name"], pt_row["current_step"],
                            pt_payload or {}, tenant_str, pt_id,
                        )
                    if pool:
                        async with pool.acquire() as u_conn:
                            await u_conn.execute(
                                """
                                UPDATE process_instances
                                SET status = 'failed',
                                    last_error = 'wait_deadline_exceeded',
                                    last_error_step = $2, completed_at = now()
                                WHERE id = $1
                                """,
                                pt_row["id"], pt_row["current_step"],
                            )
                            await self._record_transition(
                                u_conn, pt_id, "paused", "failed",
                                actor="cron", reason="wait_deadline_exceeded",
                            )
                            await self._emit_event(
                                u_conn, "system", "workflow.wait_timed_out", tenant_str,
                                {
                                    "instance_id": pt_id,
                                    "workflow_name": pt_row["workflow_name"],
                                    "current_step": pt_row["current_step"],
                                },
                            )
                    else:
                        await conn.execute(
                            """
                            UPDATE process_instances
                            SET status = 'failed',
                                last_error = 'wait_deadline_exceeded',
                                last_error_step = $2, completed_at = now()
                            WHERE id = $1
                            """,
                            pt_row["id"], pt_row["current_step"],
                        )
                        await self._record_transition(
                            conn, pt_id, "paused", "failed",
                            actor="cron", reason="wait_deadline_exceeded",
                        )
                        await self._emit_event(
                            conn, "system", "workflow.wait_timed_out", tenant_str,
                            {
                                "instance_id": pt_id,
                                "workflow_name": pt_row["workflow_name"],
                                "current_step": pt_row["current_step"],
                            },
                        )

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("[stuck_detection] Error: %s", e)

    async def _recover_orphaned_instances(self, conn: asyncpg.Connection) -> None:
        """On startup, find instances that were running when we crashed."""
        orphans = await conn.fetch(
            """
            SELECT id, workflow_name FROM process_instances
            WHERE status = 'running' AND source = $1
              AND last_heartbeat_at < now() - interval '5 minutes'
            """,
            self.source,
        )

        for orphan_row in orphans:
            orphan_id = str(orphan_row["id"])
            logger.warning(
                "[recovery] Orphaned instance %s (%s)",
                orphan_id,
                orphan_row["workflow_name"],
            )
            await conn.execute(
                """
                UPDATE process_instances
                SET status = 'failed', last_error = 'process_crash_recovery',
                    completed_at = now()
                WHERE id = $1
                """,
                orphan_row["id"],
            )
            await self._record_transition(
                conn,
                orphan_id,
                "running",
                "failed",
                actor="system",
                reason="startup_crash_recovery",
            )

    async def _persist_step_status(
        self,
        conn: asyncpg.Connection,
        instance_id: str,
        step_results: dict[str, Any],
        step_status: dict[str, str],
    ) -> None:
        """Persist current step results and status to DB."""
        await conn.execute(
            """
            UPDATE process_instances
            SET step_results = $2::jsonb, step_status = $3::jsonb,
                last_heartbeat_at = now()
            WHERE id = $1
            """,
            uuid.UUID(instance_id),
            json.dumps(step_results, default=str),
            json.dumps(step_status),
        )

    async def _record_transition(
        self,
        conn: asyncpg.Connection,
        instance_id: str,
        from_status: Optional[str],
        to_status: str,
        actor: str = "system",
        reason: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        """Record a state transition in the audit table."""
        try:
            await conn.execute(
                """
                INSERT INTO process_instance_transitions
                    (id, instance_id, from_status, to_status, actor, reason, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
                """,
                uuid.uuid4(),
                uuid.UUID(instance_id),
                from_status,
                to_status,
                actor,
                reason,
                json.dumps(metadata or {}),
            )
        except Exception as e:
            logger.error("[transition_audit] Failed to record: %s", e)

    async def _emit_event(
        self,
        conn: asyncpg.Connection,
        namespace: str,
        event_type: str,
        tenant_id: Optional[str],
        payload: dict[str, Any],
    ) -> None:
        """Emit a system event via the pipeline's emit_event helper."""
        try:
            await emit_event(
                conn,
                namespace=namespace,
                type=event_type,
                phase="single",
                actor_type="system",
                actor_id="workflow_manager",
                tenant_id=tenant_id,
                payload=payload,
            )
        except Exception as e:
            logger.error("[emit_event] Failed: %s", e)

    # --- Query helpers for admin UI ---

    async def get_active_instances(
        self, conn: asyncpg.Connection, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get currently running/paused instances for admin dashboard."""
        rows = await conn.fetch(
            """
            SELECT id, workflow_name, status, current_step, current_step_index,
                   started_at, last_heartbeat_at, tenant_id, source,
                   step_status, retry_count, last_error
            FROM process_instances
            WHERE status IN ('running', 'paused', 'pending', 'retrying')
              AND source = $1
            ORDER BY started_at DESC
            LIMIT $2
            """,
            self.source,
            limit,
        )
        return [dict(r) for r in rows]

    async def get_recent_instances(
        self, conn: asyncpg.Connection, hours: int = 24, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Get recently completed/failed instances for admin dashboard."""
        rows = await conn.fetch(
            """
            SELECT id, workflow_name, status, current_step,
                   started_at, completed_at, tenant_id, source,
                   step_status, retry_count, last_error, last_error_step,
                   recovered_from
            FROM process_instances
            WHERE source = $1
              AND created_at > now() - ($2 || ' hours')::interval
            ORDER BY created_at DESC
            LIMIT $3
            """,
            self.source,
            str(hours),
            limit,
        )
        return [dict(r) for r in rows]

    async def get_instance_detail(
        self, conn: asyncpg.Connection, instance_id: str
    ) -> Optional[dict[str, Any]]:
        """Get full detail of a specific instance including transitions."""
        row = await conn.fetchrow(
            """
            SELECT * FROM process_instances WHERE id = $1
            """,
            uuid.UUID(instance_id),
        )

        if not row:
            return None

        transitions = await conn.fetch(
            """
            SELECT * FROM process_instance_transitions
            WHERE instance_id = $1
            ORDER BY created_at ASC
            """,
            uuid.UUID(instance_id),
        )

        return {
            "instance": dict(row),
            "transitions": [dict(t) for t in transitions],
        }
