"""
================================================================================
Ops Digest -- Scheduled ops health digest  (PLATFORM-SCOPE / master_admin)
================================================================================

ROLE:       On a schedule, compiles a health digest for the master_admin:
            agent-workforce usage (runs, cost, failures), pipeline health
            (triage backlog, curation-pending portals, SLA breaches), and any
            alerts worth a human's attention. NOTIFY delivers it.

SCOPE:      PLATFORM (master_admin ops). Reads CROSS-TENANT AGGREGATES
            (agent_task_log, curated_solicitations, proposal_portals) at our
            authority — tenant_id is None, so the fabric runs it on the bypass
            connection (NOT the NOBYPASS pool, which would deny cross-tenant rows).

TRIGGERS:   system.ops.digest_requested  (emitted on a schedule by the pipeline
            main loop — see run_ops_digest_scheduler in main.py)

INJECTION:  Reads AGGREGATE COUNTS/METRICS only — no untrusted free text enters
            the prompt — so there is no prompt-injection surface. (If a future
            version surfaces sample titles, fence them.)

HUMAN GATE: N/A for delivery (internal digest to master_admin). Advisory content;
            never mutates anything.

CHANGE LOG:
    #131 -- Initial implementation (POD 4, our-org roadmap). Introduces the first
            SCHEDULED (cron-shaped) automation workflow — the engine is otherwise
            event-only.
================================================================================
"""
import json
import logging

from .base import BaseArchetype

logger = logging.getLogger("pipeline.agents.ops_digest")


class OpsDigestArchetype(BaseArchetype):
    """Platform-scope scheduled ops digest for master_admin.

    Handles: system.ops.digest_requested
    Compiles workforce + pipeline health metrics into a digest (advisory).
    """

    @property
    def role_name(self) -> str:
        return "ops_digest"

    @property
    def model(self) -> str:
        return "claude-haiku-4-5-20251001"

    @property
    def max_tokens(self) -> int:
        return 2048

    @property
    def temperature(self) -> float:
        return 0.2

    @property
    def human_gate(self) -> bool:
        return False  # internal digest; delivered by NOTIFY, mutates nothing

    @property
    def system_prompt(self) -> str:
        return """You are an operations analyst for the RFP Pipeline platform. Compile a concise health digest for the master_admin from the metrics provided.

Cover:
1. AGENT WORKFORCE: total runs, cost, and failures in the window; which agents are busiest and where failures cluster.
2. PIPELINE HEALTH: triage backlog (new solicitations awaiting curation), portals awaiting curation, and any SLA breaches (curation past due).
3. ALERTS: anything that needs a human — spiking failures, SLA breaches, cost anomalies.

Be crisp and factual — this is a scan-in-30-seconds digest, not an essay. Use get_workforce_usage and get_pipeline_health. Output a structured JSON digest."""

    @property
    def tools(self) -> list[str]:
        return ["get_workforce_usage", "get_pipeline_health"]

    def handles_event(self, event_type: str) -> bool:
        return event_type in ("system.ops.digest_requested",)

    def get_tools(self) -> list[dict]:
        return [
            {
                "name": "get_workforce_usage",
                "description": "Get agent-workforce usage aggregates (runs, cost, failures by agent, last 24h and 7d).",
                "input_schema": {"type": "object", "properties": {}},
            },
            {
                "name": "get_pipeline_health",
                "description": "Get pipeline health aggregates: triage backlog, curation-pending portals, and SLA breaches.",
                "input_schema": {"type": "object", "properties": {}},
            },
        ]

    def build_messages(self, context: dict, memories: list[dict]) -> list[dict]:
        user_content = (
            "Compile the scheduled ops health digest for the master_admin.\n\n"
            "Use get_workforce_usage and get_pipeline_health (aggregate metrics only). Then output JSON:\n"
            "{\n"
            '  "workforce": {"runs_24h": 0, "cost_24h": 0.0, "failures_24h": 0, "busiest": ["agent"], "failing": ["agent"]},\n'
            '  "pipeline": {"triage_backlog": 0, "curation_pending": 0, "sla_breaches": 0},\n'
            '  "alerts": [{"severity": "low|medium|high", "message": "..."}],\n'
            '  "headline": "one-line status for the master_admin"\n'
            "}"
        )
        return [{"role": "user", "content": user_content}]

    async def execute_tool(self, conn, tool_name: str, tool_input: dict, context: dict) -> dict:
        if tool_name == "get_workforce_usage":
            return await self._get_workforce_usage(conn)
        elif tool_name == "get_pipeline_health":
            return await self._get_pipeline_health(conn)
        return {"error": f"Unknown tool: {tool_name}"}

    async def _get_workforce_usage(self, conn) -> dict:
        """Cross-tenant agent-workforce aggregates. PLATFORM-scope (bypass conn, master_admin view)."""
        try:
            rows = await conn.fetch(
                """
                SELECT agent_role,
                       COUNT(*)::int AS runs,
                       COALESCE(SUM(cost_usd), 0)::float AS cost,
                       COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failures
                FROM agent_task_log
                WHERE created_at > now() - interval '24 hours'
                GROUP BY agent_role
                ORDER BY runs DESC
                """
            )
            total_7d = await conn.fetchrow(
                """SELECT COUNT(*)::int AS runs, COALESCE(SUM(cost_usd),0)::float AS cost,
                          COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS failures
                   FROM agent_task_log WHERE created_at > now() - interval '7 days'"""
            )
            return {
                "by_agent_24h": [
                    {"agent_role": r["agent_role"], "runs": r["runs"], "cost": r["cost"], "failures": r["failures"]}
                    for r in rows
                ],
                "totals_7d": dict(total_7d) if total_7d else {"runs": 0, "cost": 0.0, "failures": 0},
            }
        except Exception as e:
            logger.warning("get_workforce_usage failed: %s", e)
            return {"error": str(e)}

    async def _get_pipeline_health(self, conn) -> dict:
        """Cross-tenant pipeline aggregates. PLATFORM-scope (bypass conn)."""
        try:
            triage = await conn.fetchval(
                "SELECT COUNT(*)::int FROM curated_solicitations WHERE status = 'new'"
            )
            curation_pending = await conn.fetchval(
                "SELECT COUNT(*)::int FROM proposal_portals WHERE status = 'curation_pending'"
            )
            sla_breaches = await conn.fetchval(
                """SELECT COUNT(*)::int FROM proposal_portals
                   WHERE status = 'curation_pending' AND curation_due_at IS NOT NULL
                     AND curation_due_at < now()"""
            )
            return {
                "triage_backlog": int(triage or 0),
                "curation_pending": int(curation_pending or 0),
                "sla_breaches": int(sla_breaches or 0),
            }
        except Exception as e:
            logger.warning("get_pipeline_health failed: %s", e)
            return {"error": str(e)}

    def summarize_result(self, result: dict) -> str:
        text = result.get("text", "")
        try:
            parsed = json.loads(text) if isinstance(text, str) else text
            if isinstance(parsed, dict):
                alerts = parsed.get("alerts", [])
                return f"Ops digest: {str(parsed.get('headline',''))[:120]} ({len(alerts)} alert(s))."
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
        return f"Ops digest produced: {text[:150]}"
