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
import os
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

    def __init__(self, source: str = "pipeline", fabric: Any = None):
        """Initialize manager.

        Args:
            source: 'pipeline' for RFP admin workflows, 'cms' for CMS workflows
            fabric: the AgentFabric for AI_INVOKE steps. WITHOUT this the managed
                execution path drops fabric and every AI_INVOKE step silently skips
                in production (the fire-and-forget fallback had it; the managed path
                did not). Threaded into _execute_step so AI steps actually run.
        """
        self.source = source
        self._fabric = fabric
        self._running_instances: dict[str, str] = {}  # instance_id → workflow_name
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._stuck_detection_task: asyncio.Task[None] | None = None
        self._last_anchor_sweep: datetime | None = None  # J2 date-anchor gate

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
    ) -> Optional[str]:
        """Create a new workflow instance (status=pending).

        Returns the instance ID, or None if the template is inactive in the
        process_templates catalog (the launch is refused, not an error).
        """
        # Launch gate: a template marked inactive in the process_templates catalog
        # cannot be launched (in-flight instances are unaffected). The .py file is
        # the definition; the catalog row is the on/off switch + audit. Fail OPEN —
        # a missing row/table or any query error treats the template as active, so
        # the activation layer can never strand a live launch.
        if not await self._template_is_active(conn, workflow_name):
            logger.info(
                "[create_instance] template %s inactive — refusing launch (trigger=%s)",
                workflow_name, trigger_event_id,
            )
            await self._emit_event(
                conn, "system", "workflow.skipped_inactive", tenant_id,
                {"workflow_name": workflow_name, "trigger_event_id": trigger_event_id},
            )
            return None

        instance_id = str(uuid.uuid4())

        # Calculate deadline from workflow definition (default 1 hour)
        deadline = datetime.now(timezone.utc) + timedelta(hours=1)

        # R3: link the instance to the opportunity spine (additive). The overlay
        # may carry opportunityId + scope so the control tower can chain/roll up
        # reaction runs by the immutable opportunity_id. Both nullable — every
        # existing bespoke On* workflow omits them and is unchanged. scope is
        # validated against the mig-088 CHECK so a bad overlay value degrades to
        # null instead of failing the INSERT.
        opportunity_id = self._safe_uuid(payload.get("opportunityId"))
        scope = payload.get("scope")
        if scope not in ("opp", "spotlight", "project", "contract"):
            scope = None

        result = await conn.fetchrow(
            """
            INSERT INTO process_instances
                (id, workflow_name, trigger_event_id, status, payload,
                 tenant_id, actor_id, actor_email, source, deadline,
                 opportunity_id, scope)
            VALUES ($1, $2, $3, 'pending', $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
            -- The dedup index (mig 043) is PARTIAL (WHERE trigger_event_id IS NOT
            -- NULL); Postgres cannot infer a partial unique index for ON CONFLICT
            -- unless the predicate is restated here. Without it this INSERT throws
            -- "no unique or exclusion constraint matching the ON CONFLICT
            -- specification" on EVERY launch (verified, PG16). A null trigger
            -- can't conflict anyway, so the predicate is exactly right.
            ON CONFLICT (workflow_name, trigger_event_id)
                WHERE trigger_event_id IS NOT NULL DO NOTHING
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
            opportunity_id,
            scope,
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

    async def _template_is_active(
        self, conn: asyncpg.Connection, workflow_name: str
    ) -> bool:
        """Return False only if the catalog explicitly marks this template inactive.

        Fail-open: a missing row, the process_templates table not yet existing
        (054 unapplied), or any query error returns True — the activation layer
        must never strand the launch path.
        """
        try:
            row = await conn.fetchrow(
                "SELECT active FROM process_templates WHERE workflow_name = $1",
                workflow_name,
            )
        except Exception:
            return True
        if row is None:
            return True
        return bool(row["active"])

    async def sync_template_catalog(self, conn: asyncpg.Connection) -> int:
        """Reflect the live workflow registry into process_templates (boot-sync).

        Code is the source of truth: upsert one catalog row per registered template
        so the activation/audit layer lists exactly what the running build defines.
        New templates land active; known templates get description / trigger_key /
        last_seen_at refreshed, but their admin-owned active, inactive_date,
        inactivated_by and memo columns are left UNTOUCHED. Best effort — if the
        table is absent (054 unapplied) it is skipped; per-row errors are logged
        and do not abort the sync.
        """
        from workflows.base import all_registered_workflows

        try:
            exists = await conn.fetchval(
                "SELECT to_regclass('public.process_templates') IS NOT NULL"
            )
        except Exception:
            exists = False
        if not exists:
            logger.info(
                "[sync_template_catalog] process_templates absent — skipping (054 unapplied?)"
            )
            return 0

        synced = 0
        for cls in all_registered_workflows():
            trig = getattr(cls, "trigger", None)
            trigger_key = (
                f"{trig.namespace}:{trig.type}:{trig.phase}" if trig else None
            )
            try:
                await conn.execute(
                    """
                    INSERT INTO process_templates
                        (workflow_name, description, trigger_key, source, last_seen_at)
                    VALUES ($1, $2, $3, $4, now())
                    ON CONFLICT (workflow_name) DO UPDATE
                        SET description = EXCLUDED.description,
                            trigger_key = EXCLUDED.trigger_key,
                            last_seen_at = now()
                    """,
                    cls.__name__,
                    getattr(cls, "description", "") or "",
                    trigger_key,
                    self.source,
                )
                synced += 1
            except Exception as e:
                logger.error(
                    "[sync_template_catalog] upsert failed for %s: %s", cls.__name__, e
                )
        if synced:
            logger.info(
                "[sync_template_catalog] synced %d template(s) for source=%s",
                synced, self.source,
            )
        return synced

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
                #
                # R3 (additive): a generic overlay-driven gate (ProjectCollaboration)
                # can EXTEND its park ceiling per-launch via payload.parkMinutes — a
                # weeks-long customer-build gate must not be capped at the static class
                # default. The TASK due_at/nudges (dueMinutes/nudgeDays) drive the human
                # cadence; parkMinutes is only the instance abandon backstop. Existing
                # workflows omit parkMinutes → unchanged (falls back to step timeout).
                overlay_park = None
                if isinstance(trigger_payload, dict):
                    try:
                        _pm = trigger_payload.get("parkMinutes")
                        overlay_park = int(_pm) if _pm is not None else None
                    except (TypeError, ValueError):
                        overlay_park = None
                if overlay_park and overlay_park > 0:
                    wait_minutes = overlay_park
                elif step.timeout_minutes and step.timeout_minutes > 0:
                    wait_minutes = step.timeout_minutes
                else:
                    wait_minutes = 1440
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

                # HIGH-3 (launch-readiness): continue-on-INDEPENDENT-failure, do NOT
                # fail-fast. A failed step no longer halts the whole instance. The
                # depends_on guard above already cascades a failure to DEPENDENT steps
                # (a failed/skipped dependency skips the dependent, which in turn skips
                # ITS dependents), while INDEPENDENT downstream steps still run. This
                # aligns the managed engine with the fire-and-forget path
                # (processor._run_workflow) and every workflow docstring ("continue to
                # the next independent step; still notify the curator on shred failure").
                # The instance is still marked `failed`, so the audit trail and the admin
                # retry affordance (retry_instance skips completed, resumes from failed)
                # are preserved. (Was: `break` → skipped independent steps like the
                # curator alert — the workflow HIGH-2/HIGH-3 launch-readiness finding.)
                final_status = "failed"
                # NO break — fall through to run independent downstream steps.

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

        def r_or_none(field: Optional[str]) -> Any:
            """Resolve a task field, but never fall back to a raw dynamic path.

            A generic overlay-driven template declares fields as "payload.X" paths.
            If the overlay omits the key, resolve_input returns None — and the old
            `r(x) or x` idiom would then use the LITERAL string "payload.X" as the
            value, writing a corrupt task (task_type="payload.taskType", a task
            assigned to a phantom role "payload.assigneeRole" no one queries). So an
            unresolved payload./step. path degrades to None (caller defaults safely);
            a quoted/bare literal (every existing bespoke template) is unchanged.
            """
            val = r(field)
            if val is not None:
                return val
            if isinstance(field, str) and (field.startswith("payload.") or field.startswith("step.")):
                return None
            return field

        # tenant scope from the instance
        tenant_id = await conn.fetchval(
            "SELECT tenant_id FROM process_instances WHERE id = $1",
            uuid.UUID(instance_id),
        )

        task_type = r_or_none(step.task_type) or "task"
        title = r_or_none(step.task_title) or task_type
        assignee_role = r_or_none(step.assignee_role)
        assignee_user = r(step.assignee_user)
        entity_type = r_or_none(step.entity_type)
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
            # Advancing the process also closes the SIBLING ToDos (e.g. Bob's
            # copy), attributed to the completer (Eric). skip_task_id protects
            # this row's own result/completed_by from being overwritten.
            await self.resume_instance(
                conn, str(instance_id),
                resume_data={"task_id": task_id, **(result or {})},
                actor=actor, reason="task_completed",
                completed_by=actor_id, skip_task_id=task_id,
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
                SELECT id, tenant_id, assignee_role, assignee_user_id, title, due_at,
                       nudge_schedule, nudges_sent, entity_type, entity_id
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
                        # nudge_index (1-based) + is_final drive the email escalation:
                        # the LAST threshold in the schedule CC-escalates to a manager.
                        nudge_index = len(sent_set)
                        is_final = len(sent_set) >= len(set(schedule or []))
                        await conn.execute(
                            "UPDATE tasks SET nudges_sent = $2::jsonb, updated_at = now() WHERE id = $1",
                            t["id"], json.dumps(sorted(sent_set, reverse=True)),
                        )
                        fired += 1
                        # Layered EMAIL push (W-N/O), best-effort: a failure here must
                        # never undo the in-app nudge or its nudges_sent mark above.
                        try:
                            await self._emit_task_nudge_email(conn, t, nudge_index, is_final)
                        except Exception as ee:
                            logger.error("[_sweep_task_nudges] email emit failed for %s: %s", t["id"], ee)
                    except Exception as e:
                        logger.error("[_sweep_task_nudges] nudge failed for %s: %s", t["id"], e)
        return fired

    async def _emit_task_nudge_email(
        self, conn: asyncpg.Connection, t: Any, nudge_index: int, is_final: bool
    ) -> None:
        """Emit the EMAIL push for a nudge (W-N/O) via system:notification.requested
        — the CMS event_listener renders the template + delivers it.

        Only USER-assigned tasks email (a role-bucket task has no single recipient;
        its in-app nudge suffices). The email carries a login link to the in-between
        landing page (/go?task=...) that routes the user to the task after login.
        On the FINAL nudge we ALSO emit a SEPARATE escalation email to the tenant's
        manager (tenant_admin) — cleaner than a CC and needs no listener change.
        """
        assignee_user_id = t["assignee_user_id"]
        if not assignee_user_id:
            return  # role-bucket task → in-app nudge only

        base = (os.getenv("PORTAL_BASE_URL") or os.getenv("NEXTAUTH_URL") or "").rstrip("/")
        if not base:
            # A relative link is a dead CTA in an email client. Skip the email (the
            # in-app nudge already fired) and log loudly so ops sets the env var,
            # rather than shipping 100% broken-link nudges.
            logger.warning(
                "[_sweep_task_nudges] PORTAL_BASE_URL/NEXTAUTH_URL unset — skipping nudge EMAIL "
                "for task %s (in-app nudge still delivered)", t["id"],
            )
            return
        login_url = f"{base}/go?task={t['id']}"
        tenant_str = str(t["tenant_id"]) if t["tenant_id"] else None
        ctx = {
            "channel": "email",
            "template": "task_nudge",
            "user_id": str(assignee_user_id),
            "title": t["title"],
            "due_at": t["due_at"].isoformat(),
            "login_url": login_url,
            "nudge_index": nudge_index,
            "is_final": is_final,
            "task_id": str(t["id"]),
        }
        await self._emit_event(conn, "system", "notification.requested", tenant_str, ctx)

        if is_final and t["tenant_id"]:
            # The FINAL nudge escalates to the task's manager(s). For a portal task these
            # are the portal's DELEGATED managers (guardrail_config); otherwise it's the
            # tenant's oldest admin (see _final_notice_user_ids).
            for uid in await self._final_notice_user_ids(conn, t):
                await self._emit_event(
                    conn, "system", "notification.requested", tenant_str,
                    {
                        "channel": "email",
                        "template": "task_nudge_manager",
                        "user_id": str(uid),
                        "title": t["title"],
                        "due_at": t["due_at"].isoformat(),
                        "login_url": login_url,
                        "task_id": str(t["id"]),
                    },
                )

    async def _final_notice_user_ids(self, conn: asyncpg.Connection, t: Any) -> list:
        """Recipients of a task's FINAL (escalation) nudge.

        The tenant's admin is the DEFAULT recipient on EVERY task — the customer always
        sees the escalation. A PORTAL task ALSO notifies its DELEGATED managers: the
        guardrail_config collaborators with role='manager', resolved by email to active
        users (which may include one of our experts in another tenant, so resolve globally
        by email). Delegates are added ON TOP of the admin, deduped; a portal may have none.
        """
        ids: list = []

        # Default on all: the tenant's (primary) admin always gets the final notice.
        try:
            admin = await conn.fetchrow(
                """
                SELECT id FROM users
                WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active = true
                ORDER BY created_at ASC LIMIT 1
                """,
                t["tenant_id"],
            )
            if admin:
                ids.append(admin["id"])
        except Exception as e:
            logger.error("[_final_notice] admin default lookup failed: %s", e)

        # A portal task ALSO notifies its delegated managers (added or not).
        if t.get("entity_type") == "portal" and t.get("entity_id"):
            cfg = None
            try:
                prow = await conn.fetchrow(
                    "SELECT guardrail_config FROM proposal_portals WHERE id = $1", t["entity_id"]
                )
                cfg = prow["guardrail_config"] if prow else None
            except Exception as e:
                logger.error("[_final_notice] portal lookup failed for %s: %s", t.get("entity_id"), e)
            if isinstance(cfg, str):
                try:
                    cfg = json.loads(cfg or "{}")
                except Exception:
                    cfg = None
            emails = [
                c.get("email")
                for c in ((cfg or {}).get("collaborators") or [])
                if isinstance(c, dict) and c.get("role") == "manager" and c.get("email")
            ]
            if emails:
                try:
                    urows = await conn.fetch(
                        "SELECT id FROM users WHERE lower(email) = ANY($1::text[]) AND is_active = true",
                        [e.lower() for e in emails],
                    )
                    ids.extend(u["id"] for u in urows)
                except Exception as e:
                    logger.error("[_final_notice] manager email resolve failed: %s", e)

        # Dedup, preserving order (admin first).
        seen: set = set()
        out: list = []
        for i in ids:
            if i not in seen:
                seen.add(i)
                out.append(i)

        # RFP-Pipeline shadow backstop (AUTOMATION_POLICY_DESIGN decision ①): if the
        # tenant has NO active admin/manager to receive the final notice, route it to us
        # — the oldest active rfp_admin/master_admin — so an escalation never lands on
        # nobody. The floor is admin-always + managers + THIS platform backstop.
        if not out:
            try:
                backstop = await conn.fetchrow(
                    """
                    SELECT id FROM users
                    WHERE role IN ('rfp_admin', 'master_admin') AND is_active = true
                    ORDER BY created_at ASC LIMIT 1
                    """
                )
                if backstop:
                    out.append(backstop["id"])
            except Exception as e:
                logger.error("[_final_notice] RFP-Pipeline backstop lookup failed: %s", e)

        return out

    async def _sweep_date_anchored_tasks(self, conn: asyncpg.Connection) -> int:
        """Materialize date-ANCHORED tasks from a proposal's deadline (J2).

        The nudge sweep reacts to a task's due_at; THIS generates the task in the
        first place from a calendar anchor — the opportunity close_date (the RFP
        deadline). For each active proposal with a future deadline that has no
        'final_due' task yet, create one due at close_date, escalating [7,3,1] days
        out, assigned to the tenant's manager (so the W-N/O email nudges them).
        Idempotent via NOT EXISTS (one final_due per proposal, ever — it is not
        regenerated after submission). Gated to ~hourly by the caller.

        This is a date-anchored GENERATOR (a sweep), deliberately not a generic
        engine ScheduleTrigger — the value is the dated tasks, and the sweep fits
        the existing loop without a cron-matching layer in the processor.
        """
        created = 0
        try:
            rows = await conn.fetch(
                """
                SELECT p.id, p.tenant_id, p.title, o.close_date,
                       (SELECT u.id FROM users u
                          WHERE u.tenant_id = p.tenant_id AND u.role = 'tenant_admin'
                            AND u.is_active = true
                          ORDER BY u.created_at ASC LIMIT 1) AS manager_id
                FROM proposals p
                JOIN opportunities o ON o.id = p.opportunity_id
                WHERE p.stage NOT IN ('submitted', 'archived')
                  AND o.close_date IS NOT NULL
                  AND o.close_date > now()
                  AND NOT EXISTS (
                      SELECT 1 FROM tasks t
                      WHERE t.entity_type = 'proposal' AND t.entity_id = p.id
                        AND t.task_type = 'final_due'
                  )
                LIMIT 500
                """
            )
        except Exception as e:
            logger.error("[_sweep_date_anchored_tasks] query failed: %s", e)
            return 0

        for r in rows:
            try:
                task_id = str(uuid.uuid4())
                await conn.execute(
                    """
                    INSERT INTO tasks (
                        id, tenant_id, assignee_role, assignee_user_id, task_type, title,
                        entity_type, entity_id, status, due_at, nudge_schedule, params
                    ) VALUES (
                        $1, $2, $3, $4, 'final_due', $5, 'proposal', $6, 'open', $7,
                        '[7,3,1]'::jsonb, $8::jsonb
                    )
                    """,
                    uuid.UUID(task_id),
                    r["tenant_id"],
                    None if r["manager_id"] else "tenant_admin",
                    r["manager_id"],
                    f"Final submission due: {r['title']}"[:500],
                    r["id"],
                    r["close_date"],
                    json.dumps({"anchor": "final_due", "generated": True}),
                )
                await self._emit_event(
                    conn, "system", "task.created",
                    str(r["tenant_id"]) if r["tenant_id"] else None,
                    {
                        "task_id": task_id,
                        "task_type": "final_due",
                        "entity_type": "proposal",
                        "entity_id": str(r["id"]),
                        "anchor": "final_due",
                        "due_at": r["close_date"].isoformat(),
                    },
                )
                created += 1
            except Exception as e:
                logger.error("[_sweep_date_anchored_tasks] insert failed for proposal %s: %s", r["id"], e)
        if created:
            logger.info("[_sweep_date_anchored_tasks] generated %d final_due task(s)", created)

        # W-P: expire HUMAN tasks long past their deadline (the +30d past-due anchor)
        # so the queue self-cleans and nudges stop. Only process_instance_id IS NULL
        # (human/anchor) tasks — a workflow-parked task must be reaped by the INSTANCE
        # deadline sweep (resume path), not orphaned by expiring its task here.
        try:
            tag = await conn.execute(
                """
                UPDATE tasks SET status = 'expired', updated_at = now()
                WHERE status IN ('open', 'in_progress')
                  AND process_instance_id IS NULL
                  AND due_at IS NOT NULL
                  AND due_at < now() - interval '30 days'
                """
            )
            n_expired = int(tag.split()[-1]) if tag and tag.startswith("UPDATE") else 0
            if n_expired:
                logger.info("[_sweep_date_anchored_tasks] expired %d past-due human task(s)", n_expired)
        except Exception as e:
            logger.error("[_sweep_date_anchored_tasks] expiry pass failed: %s", e)

        return created

    async def resume_instance(
        self,
        conn: asyncpg.Connection,
        instance_id: str,
        resume_data: Optional[dict[str, Any]] = None,
        actor: str = "system",
        reason: str = "hitl_resumed",
        completed_by: Optional[str] = None,
        skip_task_id: Optional[str] = None,
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
        # Reconcile sibling ToDos as part of advancing the process. A TODO gate
        # can be assigned to several people (e.g. Eric AND Bob both have it). When
        # one of them satisfies it — or an event / force-advance does — the OTHERS'
        # copies are marked COMPLETED and attributed to whoever advanced it, not
        # cancelled: the work WAS done, just by someone else. completed_by stamps
        # the actor onto every sibling; skip_task_id is the row already closed by
        # complete_task (so we don't overwrite its own completed_by).
        try:
            await conn.execute(
                """
                UPDATE tasks
                SET status = 'completed',
                    completed_by = COALESCE($2, completed_by),
                    completed_at = now(), updated_at = now()
                WHERE process_instance_id = $1
                  AND status IN ('open', 'in_progress')
                  AND ($3::uuid IS NULL OR id <> $3::uuid)
                """,
                uuid.UUID(instance_id),
                self._safe_uuid(completed_by),
                self._safe_uuid(skip_task_id),
            )
        except Exception as e:
            logger.error("[resume_instance] task reconcile failed for %s: %s",
                         instance_id, e)
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
        event_payload = event.get("payload") or {}
        rows = await conn.fetch(
            """
            SELECT id, workflow_name, current_step, payload FROM process_instances
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
            if not wait_for.matches(event):
                continue
            # ENTITY CORRELATION: wait_for matches on namespace/type/phase/condition
            # only, so without this a single 'proposal.advanced'/'user.logged_in'/
            # 'source_diff.reviewed' would resume EVERY paused gate of that kind —
            # across proposals, users, even tenants. Resume only when the event is
            # about the SAME entity as the parked instance.
            inst_payload = row.get("payload")
            if isinstance(inst_payload, str):
                try:
                    inst_payload = json.loads(inst_payload)
                except (json.JSONDecodeError, TypeError):
                    inst_payload = {}
            if not self._event_correlates(event_payload, inst_payload or {}):
                continue
            if await self.resume_instance(
                conn, str(row["id"]), resume_data={"resumed_by_event": event.get("id")}
            ):
                resumed.append(str(row["id"]))
        return resumed

    # Entity keys that disambiguate WHICH parked instance an event belongs to.
    # tenantId (MED-6) is the tenant-scope guard: without it a future tenant-scoped
    # `wait_for` that shares no other entity key with the resuming event would fall
    # through to the "no shared key ⇒ True" branch and resume a DIFFERENT tenant's
    # parked instance. Including it only ever TIGHTENS matching (never loosens).
    _CORRELATION_KEYS = (
        "proposalId", "userId", "sourceId", "opportunityId", "sectionId", "contentId",
        "tenantId",
    )

    @classmethod
    def _event_correlates(cls, event_payload: dict[str, Any], instance_payload: dict[str, Any]) -> bool:
        """True if the event is about the same entity as the parked instance.

        Require equality on every correlation key present in BOTH payloads. If the
        two share no correlation key, fall back to True (a workflow that genuinely
        waits on a non-entity event) — so this only ever TIGHTENS, never loosens.
        """
        shared = [
            k for k in cls._CORRELATION_KEYS
            if event_payload.get(k) is not None and instance_payload.get(k) is not None
        ]
        if not shared:
            return True
        return all(event_payload.get(k) == instance_payload.get(k) for k in shared)

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

        # Thread fabric so AI_INVOKE steps actually call Claude on the managed path
        # (when fabric + ANTHROPIC_API_KEY are configured); else it skips as before.
        return await processor_execute_step(
            conn, step, inputs, trigger_event=event_dict, fabric=self._fabric
        )

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

                # Generate date-ANCHORED tasks from proposal deadlines (J2), at most
                # ~hourly (it scans proposals, not the hot per-minute path; idempotent
                # via NOT EXISTS so the cadence only bounds the scan cost).
                _now = datetime.now(timezone.utc)
                if self._last_anchor_sweep is None or (_now - self._last_anchor_sweep) > timedelta(hours=1):
                    self._last_anchor_sweep = _now
                    try:
                        if pool:
                            async with pool.acquire() as anchor_conn:
                                await self._sweep_date_anchored_tasks(anchor_conn)
                        else:
                            await self._sweep_date_anchored_tasks(conn)
                    except Exception as anchor_err:
                        logger.error("[anchor_sweep] failed: %s", anchor_err)

                # Check for stale heartbeats on running instances
                if pool:
                    async with pool.acquire() as sd_conn:
                        stuck = await sd_conn.fetch(
                            """
                            SELECT id, workflow_name, current_step, tenant_id
                            FROM process_instances
                            WHERE status = 'running' AND source = $1
                              AND last_heartbeat_at < now() - interval '5 minutes'
                            """,
                            self.source,
                        )
                else:
                    stuck = await conn.fetch(
                        """
                        SELECT id, workflow_name, current_step, tenant_id
                        FROM process_instances
                        WHERE status = 'running' AND source = $1
                          AND last_heartbeat_at < now() - interval '5 minutes'
                        """,
                        self.source,
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
                               WHERE status = 'pending' AND source = $1 AND created_at < now() - interval '1 hour'
                               FOR UPDATE SKIP LOCKED""",
                            self.source,
                        )
                else:
                    stale_pending = await conn.fetch(
                        """SELECT id, workflow_name FROM process_instances
                           WHERE status = 'pending' AND source = $1 AND created_at < now() - interval '1 hour'
                           FOR UPDATE SKIP LOCKED""",
                        self.source,
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
                            WHERE status = 'paused' AND source = $1 AND deadline IS NOT NULL
                              AND deadline < now()
                            """,
                            self.source,
                        )
                else:
                    paused_timeout = await conn.fetch(
                        """
                        SELECT id, workflow_name, current_step, tenant_id, payload
                        FROM process_instances
                        WHERE status = 'paused' AND source = $1 AND deadline IS NOT NULL
                          AND deadline < now()
                        """,
                        self.source,
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
                    # COMPARE-AND-SWAP on status='paused': if a human completed the
                    # task in the SELECT→UPDATE window (resume flipped it to
                    # 'retrying'), this UPDATE affects 0 rows and we DON'T clobber the
                    # resume or destroy the completed work. Only on a real fail do we
                    # expire the sibling task (it can never resume a failed instance —
                    # the W-P orphan), record the transition, and emit.
                    if pool:
                        async with pool.acquire() as u_conn:
                            _tag = await u_conn.execute(
                                """
                                UPDATE process_instances
                                SET status = 'failed',
                                    last_error = 'wait_deadline_exceeded',
                                    last_error_step = $2, completed_at = now()
                                WHERE id = $1 AND status = 'paused'
                                """,
                                pt_row["id"], pt_row["current_step"],
                            )
                            if _tag.endswith(" 1"):
                                await u_conn.execute(
                                    "UPDATE tasks SET status='expired', updated_at=now() "
                                    "WHERE process_instance_id=$1 AND status IN ('open','in_progress')",
                                    pt_row["id"],
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
                        _tag = await conn.execute(
                            """
                            UPDATE process_instances
                            SET status = 'failed',
                                last_error = 'wait_deadline_exceeded',
                                last_error_step = $2, completed_at = now()
                            WHERE id = $1 AND status = 'paused'
                            """,
                            pt_row["id"], pt_row["current_step"],
                        )
                        if _tag.endswith(" 1"):
                            await conn.execute(
                                "UPDATE tasks SET status='expired', updated_at=now() "
                                "WHERE process_instance_id=$1 AND status IN ('open','in_progress')",
                                pt_row["id"],
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
