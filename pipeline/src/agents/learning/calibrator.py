"""
================================================================================
Calibrator — Recalibrates Agent Performance Metrics and Confidence Scores
================================================================================

WHO:    Scheduled monthly job. Runs once per month for each active tenant.

WHAT:   Fetches agent_task_log for the last 90 days grouped by agent_role.
        Calculates per-role metrics (acceptance rate, edit percentage, cost,
        task count). Updates the agent_performance table. Adjusts confidence
        thresholds and suggests model changes based on acceptance rates.

WHY:    Agents need periodic recalibration to ensure their confidence scores
        reflect actual performance. High-performing agents can use cheaper
        models (cost savings), while low-performing agents may need quality
        upgrades or memory reviews.

HOW:    Aggregates agent_task_log metrics per role over 90 days. Updates
        agent_performance records. Flags roles with acceptance_rate < 50%
        for memory review. Suggests model changes: consistently high-quality
        roles -> Haiku, consistently low-quality -> Opus.

SCHEDULE: Monthly (once per month per active tenant)

INPUTS: agent_task_log (last 90 days), semantic_memories (confidence scores)

OUTPUTS: agent_performance (updated), calibration suggestions

DEPENDENCIES:
    - agent_task_log table (001_baseline.sql)
    - agent_performance table (001_baseline.sql)
    - semantic_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:agent.calibrated (single)

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

from pipeline.src.events import emit_event

logger = logging.getLogger("pipeline.agents.calibrator")


class Calibrator:
    """Recalibrates agent performance metrics and confidence scores."""

    async def calibrate_for_tenant(self, conn, tenant_id: str) -> dict:
        """Recalibrate agent settings based on performance data.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant

        Returns:
            Calibration result dict with per-role metrics and suggestions.
        """
        try:
            # 1. Fetch agent_task_log for last 90 days grouped by agent_role
            role_metrics = await conn.fetch(
                """
                SELECT
                    agent_role,
                    COUNT(*) AS total_tasks,
                    AVG(CASE WHEN human_accepted = true THEN 1.0
                         WHEN human_accepted = false THEN 0.0
                         ELSE NULL END) AS acceptance_rate,
                    AVG(human_edit_pct) AS avg_edit_pct,
                    AVG(cost_usd) AS avg_cost,
                    SUM(cost_usd) AS total_cost,
                    AVG(duration_ms) AS avg_duration_ms,
                    COUNT(CASE WHEN human_accepted IS NOT NULL THEN 1 END) AS reviewed_tasks
                FROM agent_task_log
                WHERE tenant_id = $1
                  AND created_at > now() - interval '90 days'
                GROUP BY agent_role
                ORDER BY total_tasks DESC
                """,
                uuid.UUID(tenant_id),
            )

            if not role_metrics:
                logger.info("tenant=%s has no task logs in last 90 days", tenant_id)
                return {
                    "tenant_id": tenant_id,
                    "roles_calibrated": 0,
                    "suggestions": [],
                    "role_results": [],
                }

            # 2. Calculate per-role metrics and generate suggestions
            now = datetime.now(timezone.utc)
            period_start = now.date().replace(day=1)
            if now.month == 12:
                period_end = period_start.replace(year=now.year + 1, month=1)
            else:
                period_end = period_start.replace(month=now.month + 1)

            role_results = []
            suggestions = []
            memory_adjustments = 0

            for row in role_metrics:
                agent_role = row["agent_role"]
                total_tasks = row["total_tasks"]
                acceptance_rate = float(row["acceptance_rate"]) if row["acceptance_rate"] is not None else 0.0
                avg_edit_pct = float(row["avg_edit_pct"]) if row["avg_edit_pct"] is not None else 0.0
                avg_cost = float(row["avg_cost"]) if row["avg_cost"] is not None else 0.0
                total_cost = float(row["total_cost"]) if row["total_cost"] is not None else 0.0
                avg_duration = float(row["avg_duration_ms"]) if row["avg_duration_ms"] is not None else 0.0
                reviewed_tasks = row["reviewed_tasks"]

                role_result = {
                    "agent_role": agent_role,
                    "total_tasks": total_tasks,
                    "reviewed_tasks": reviewed_tasks,
                    "acceptance_rate": round(acceptance_rate * 100, 1),
                    "avg_edit_pct": round(avg_edit_pct * 100, 1),
                    "avg_cost": round(avg_cost, 4),
                    "total_cost": round(total_cost, 2),
                    "avg_duration_ms": round(avg_duration, 0),
                }

                # 3. Update agent_performance table
                try:
                    await conn.execute(
                        """
                        INSERT INTO agent_performance
                            (id, tenant_id, agent_role, period_start, period_end,
                             tasks_completed, acceptance_rate, avg_edit_pct,
                             avg_cost_usd, avg_duration_ms, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (tenant_id, agent_role, period_start, period_end)
                        DO UPDATE SET
                            tasks_completed = EXCLUDED.tasks_completed,
                            acceptance_rate = EXCLUDED.acceptance_rate,
                            avg_edit_pct = EXCLUDED.avg_edit_pct,
                            avg_cost_usd = EXCLUDED.avg_cost_usd,
                            avg_duration_ms = EXCLUDED.avg_duration_ms
                        """,
                        uuid.UUID(str(uuid.uuid4())),
                        uuid.UUID(tenant_id),
                        agent_role,
                        period_start,
                        period_end,
                        total_tasks,
                        acceptance_rate,
                        avg_edit_pct,
                        avg_cost,
                        avg_duration,
                        now,
                    )
                except Exception as e:
                    logger.error(
                        "failed to upsert agent_performance for role=%s: %s",
                        agent_role, e,
                    )

                # 4. Adjust confidence thresholds based on acceptance rate
                if reviewed_tasks >= 5:  # Need minimum sample size
                    if acceptance_rate > 0.70:
                        # High performer: boost memory confidence weights
                        try:
                            updated = await conn.execute(
                                """
                                UPDATE semantic_memories
                                SET confidence = LEAST(1.0, confidence + 0.05),
                                    updated_at = $1
                                WHERE tenant_id = $2
                                  AND agent_role = $3
                                  AND is_active = true
                                  AND confidence < 0.9
                                """,
                                now,
                                uuid.UUID(tenant_id),
                                agent_role,
                            )
                            memory_adjustments += 1
                            role_result["confidence_action"] = "boosted"
                        except Exception as e:
                            logger.error("failed to boost confidence for role=%s: %s", agent_role, e)

                    elif acceptance_rate < 0.50:
                        # Low performer: flag for memory review, reduce confidence
                        try:
                            await conn.execute(
                                """
                                UPDATE semantic_memories
                                SET confidence = GREATEST(0.1, confidence - 0.1),
                                    updated_at = $1
                                WHERE tenant_id = $2
                                  AND agent_role = $3
                                  AND is_active = true
                                  AND confidence > 0.3
                                  AND evidence_count < 5
                                """,
                                now,
                                uuid.UUID(tenant_id),
                                agent_role,
                            )
                            memory_adjustments += 1
                            role_result["confidence_action"] = "reduced"
                        except Exception as e:
                            logger.error("failed to reduce confidence for role=%s: %s", agent_role, e)

                        suggestions.append({
                            "type": "memory_review",
                            "agent_role": agent_role,
                            "reason": (
                                f"Acceptance rate is {acceptance_rate*100:.0f}% "
                                f"(below 50% threshold). Review semantic memories "
                                f"for stale or contradictory preferences."
                            ),
                            "severity": "warning",
                        })

                # 5. Suggest model changes based on quality
                if total_tasks >= 10:
                    if acceptance_rate > 0.80 and avg_edit_pct < 0.15:
                        suggestions.append({
                            "type": "model_downgrade",
                            "agent_role": agent_role,
                            "reason": (
                                f"Consistently high quality ({acceptance_rate*100:.0f}% acceptance, "
                                f"{avg_edit_pct*100:.0f}% avg edit). Consider Haiku for cost savings."
                            ),
                            "current_cost": round(total_cost, 2),
                            "severity": "info",
                        })
                    elif acceptance_rate < 0.40:
                        suggestions.append({
                            "type": "model_upgrade",
                            "agent_role": agent_role,
                            "reason": (
                                f"Consistently low quality ({acceptance_rate*100:.0f}% acceptance). "
                                f"Consider Opus for quality improvement."
                            ),
                            "severity": "warning",
                        })

                role_results.append(role_result)

            # 6. Emit event
            await emit_event(
                conn,
                namespace="system",
                type="agent.calibrated",
                tenant_id=tenant_id,
                payload={
                    "tenantId": tenant_id,
                    "rolesCalibrated": len(role_results),
                    "suggestions": len(suggestions),
                    "memoryAdjustments": memory_adjustments,
                    "topRole": role_results[0]["agent_role"] if role_results else None,
                },
            )

            logger.info(
                "calibrated tenant=%s: %d roles, %d suggestions, %d memory adjustments",
                tenant_id, len(role_results), len(suggestions), memory_adjustments,
            )

            return {
                "tenant_id": tenant_id,
                "roles_calibrated": len(role_results),
                "suggestions": suggestions,
                "role_results": role_results,
                "memory_adjustments": memory_adjustments,
            }

        except Exception as e:
            logger.error("failed to calibrate tenant=%s: %s", tenant_id, e)
            return {
                "tenant_id": tenant_id,
                "roles_calibrated": 0,
                "suggestions": [],
                "role_results": [],
                "error": str(e),
            }
