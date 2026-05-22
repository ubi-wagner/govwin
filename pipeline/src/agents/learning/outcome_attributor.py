"""
================================================================================
OutcomeAttributor — Attributes Proposal Outcomes to Agent Memories and Content
================================================================================

WHO:    Triggered on-event when `proposal.outcome.recorded` fires (a proposal
        is marked as won or lost).

WHAT:   Traces a win/loss outcome back to the agent task logs and library units
        that contributed to the proposal. Tags them with outcome data, creates
        episodic memories recording the outcome, and updates agent performance
        metrics.

WHY:    Outcome attribution closes the feedback loop. By knowing which memories
        and content contributed to wins vs losses, the system can prioritize
        high-performing content and calibrate agent confidence scores over time.

HOW:    Fetches all agent_task_log entries and proposal_sections for the given
        proposal. Updates agent_performance metrics and creates an episodic
        memory summarizing the outcome and agent contribution.

SCHEDULE: On-event (proposal.outcome.recorded)

INPUTS: proposal_id, outcome (won/lost), agent_task_log, proposal_sections

OUTPUTS: episodic_memories (outcome records), agent_performance (updated metrics)

DEPENDENCIES:
    - agent_task_log table (001_baseline.sql)
    - agent_performance table (001_baseline.sql)
    - episodic_memories table (001_baseline.sql)
    - proposals table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.outcome_attributed (single)

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation
================================================================================
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from events import emit_event

logger = logging.getLogger("pipeline.agents.outcome_attributor")


class OutcomeAttributor:
    """Attributes proposal outcomes to agent memories and library units."""

    # Zero vector placeholder (1536 dims for text-embedding-3-small compat)
    _ZERO_VECTOR = "[" + ",".join(["0.0"] * 1536) + "]"

    async def attribute_outcome(
        self,
        conn,
        tenant_id: str,
        proposal_id: str,
        outcome: str,
        details: dict,
    ) -> dict:
        """Trace a win/loss back to contributing memories and content.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            proposal_id: UUID of the proposal
            outcome: 'won' or 'lost'
            details: dict with optional keys like agency, program_type, score

        Returns:
            Attribution result dict with counts and summary.
        """
        try:
            # 1. Fetch all agent_task_log entries for this proposal
            task_logs = await conn.fetch(
                """
                SELECT id, agent_role, task_type, human_accepted, human_edit_pct,
                       cost_usd, duration_ms, created_at
                FROM agent_task_log
                WHERE proposal_id = $1
                  AND tenant_id = $2
                ORDER BY created_at ASC
                """,
                uuid.UUID(proposal_id),
                uuid.UUID(tenant_id),
            )

            # 2. Calculate aggregate metrics from task logs
            total_tasks = len(task_logs)
            accepted_count = sum(1 for t in task_logs if t["human_accepted"] is True)
            total_cost = sum(float(t["cost_usd"] or 0) for t in task_logs)
            avg_edit_pct = 0.0
            tasks_with_edits = [t for t in task_logs if t["human_edit_pct"] is not None]
            if tasks_with_edits:
                avg_edit_pct = sum(float(t["human_edit_pct"]) for t in tasks_with_edits) / len(tasks_with_edits)

            acceptance_rate = (accepted_count / total_tasks * 100) if total_tasks > 0 else 0.0

            # 3. Fetch proposal metadata
            proposal_row = await conn.fetchrow(
                """
                SELECT p.title, p.stage, o.agency, o.program_type
                FROM proposals p
                LEFT JOIN opportunities o ON o.id = p.opportunity_id
                WHERE p.id = $1 AND p.tenant_id = $2
                """,
                uuid.UUID(proposal_id),
                uuid.UUID(tenant_id),
            )

            agency = "unknown"
            program_type = "unknown"
            proposal_title = proposal_id[:8]
            if proposal_row:
                agency = proposal_row.get("agency") or details.get("agency", "unknown")
                program_type = proposal_row.get("program_type") or details.get("program_type", "unknown")
                proposal_title = proposal_row.get("title") or proposal_id[:8]

            # 4. Create episodic memory recording the outcome
            memory_content = (
                f"Proposal '{proposal_title}' for {agency} ({program_type}): {outcome}. "
                f"Used {total_tasks} agent tasks. "
                f"Agent acceptance rate: {acceptance_rate:.0f}%. "
                f"Avg edit percentage: {avg_edit_pct:.0f}%. "
                f"Total AI cost: ${total_cost:.2f}."
            )

            # Outcomes are high-importance memories (0.9)
            importance = 0.9
            memory_id = str(uuid.uuid4())

            await conn.execute(
                """
                INSERT INTO episodic_memories
                    (id, tenant_id, agent_role, embedding, content, memory_type,
                     importance, metadata, source, occurred_at, created_at)
                VALUES
                    ($1, $2, 'outcome_tracker', $3::vector, $4, 'outcome',
                     $5, $6::jsonb, 'outcome_attributor', $7, $7)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                self._ZERO_VECTOR,
                memory_content,
                importance,
                json.dumps({
                    "proposal_id": proposal_id,
                    "outcome": outcome,
                    "agency": agency,
                    "program_type": program_type,
                    "total_tasks": total_tasks,
                    "acceptance_rate": acceptance_rate,
                    "avg_edit_pct": avg_edit_pct,
                    "total_cost": total_cost,
                }),
                datetime.now(timezone.utc),
            )

            # 5. Create per-role episodic memories for agents that contributed
            role_tasks: dict[str, list] = {}
            for t in task_logs:
                role = t["agent_role"]
                if role not in role_tasks:
                    role_tasks[role] = []
                role_tasks[role].append(t)

            role_memory_ids = []
            for role, tasks in role_tasks.items():
                role_accepted = sum(1 for t in tasks if t["human_accepted"] is True)
                role_total = len(tasks)
                role_rate = (role_accepted / role_total * 100) if role_total > 0 else 0.0

                role_memory_content = (
                    f"Proposal {outcome}: {proposal_title} ({agency} {program_type}). "
                    f"My role ({role}): {role_total} tasks, {role_rate:.0f}% acceptance rate."
                )

                role_mem_id = str(uuid.uuid4())
                try:
                    await conn.execute(
                        """
                        INSERT INTO episodic_memories
                            (id, tenant_id, agent_role, embedding, content, memory_type,
                             importance, metadata, source, occurred_at, created_at)
                        VALUES
                            ($1, $2, $3, $4::vector, $5, 'outcome',
                             $6, $7::jsonb, 'outcome_attributor', $8, $8)
                        """,
                        uuid.UUID(role_mem_id),
                        uuid.UUID(tenant_id),
                        role,
                        self._ZERO_VECTOR,
                        role_memory_content,
                        0.85,
                        json.dumps({
                            "proposal_id": proposal_id,
                            "outcome": outcome,
                            "role_tasks": role_total,
                            "role_acceptance_rate": role_rate,
                        }),
                        datetime.now(timezone.utc),
                    )
                    role_memory_ids.append(role_mem_id)
                except Exception as e:
                    logger.error("failed to create role outcome memory for %s: %s", role, e)

            # 6. Update agent_performance table
            now = datetime.now(timezone.utc)
            period_start = now.date().replace(day=1)
            if now.month == 12:
                period_end = period_start.replace(year=now.year + 1, month=1)
            else:
                period_end = period_start.replace(month=now.month + 1)

            for role, tasks in role_tasks.items():
                role_accepted = sum(1 for t in tasks if t["human_accepted"] is True)
                role_total = len(tasks)
                role_rate = (role_accepted / role_total) if role_total > 0 else 0.0
                role_edit_pcts = [float(t["human_edit_pct"]) for t in tasks if t["human_edit_pct"] is not None]
                role_avg_edit = sum(role_edit_pcts) / len(role_edit_pcts) if role_edit_pcts else 0.0
                role_costs = [float(t["cost_usd"] or 0) for t in tasks]
                role_avg_cost = sum(role_costs) / len(role_costs) if role_costs else 0.0
                try:
                    # Upsert into agent_performance
                    await conn.execute(
                        """
                        INSERT INTO agent_performance
                            (id, tenant_id, agent_role, period_start, period_end,
                             tasks_completed, acceptance_rate, avg_edit_pct,
                             avg_cost_usd, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (tenant_id, agent_role, period_start)
                        DO UPDATE SET
                            tasks_completed = agent_performance.tasks_completed + EXCLUDED.tasks_completed,
                            acceptance_rate = EXCLUDED.acceptance_rate,
                            avg_edit_pct = EXCLUDED.avg_edit_pct,
                            avg_cost_usd = EXCLUDED.avg_cost_usd
                        """,
                        uuid.UUID(str(uuid.uuid4())),
                        uuid.UUID(tenant_id),
                        role,
                        period_start,
                        period_end,
                        role_total,
                        role_rate,
                        role_avg_edit,
                        role_avg_cost,
                        now,
                    )
                except Exception as e:
                    logger.error("failed to upsert agent_performance for %s: %s", role, e)

            # 7. Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.outcome_attributed",
                tenant_id=tenant_id,
                payload={
                    "proposalId": proposal_id,
                    "outcome": outcome,
                    "agency": agency,
                    "programType": program_type,
                    "totalTasks": total_tasks,
                    "acceptanceRate": acceptance_rate,
                    "rolesAttributed": list(role_tasks.keys()),
                    "memoryId": memory_id,
                },
            )

            logger.info(
                "attributed outcome=%s for proposal=%s tenant=%s: %d tasks, %d roles",
                outcome, proposal_id, tenant_id, total_tasks, len(role_tasks),
            )

            return {
                "proposal_id": proposal_id,
                "outcome": outcome,
                "total_tasks": total_tasks,
                "acceptance_rate": acceptance_rate,
                "avg_edit_pct": avg_edit_pct,
                "total_cost": total_cost,
                "roles_attributed": list(role_tasks.keys()),
                "memory_created": memory_id,
                "role_memories_created": role_memory_ids,
            }

        except Exception as e:
            logger.error(
                "failed to attribute outcome for proposal=%s tenant=%s: %s",
                proposal_id, tenant_id, e,
            )
            return {
                "proposal_id": proposal_id,
                "outcome": outcome,
                "total_tasks": 0,
                "acceptance_rate": 0.0,
                "avg_edit_pct": 0.0,
                "total_cost": 0.0,
                "roles_attributed": [],
                "memory_created": "",
                "role_memories_created": [],
                "error": str(e),
            }
