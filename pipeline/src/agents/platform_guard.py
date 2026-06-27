"""Platform AI spend guard (G1).

Caps + logs *platform* (non-tenant) Claude calls — the shredder per-ingest,
discovery, CMS content generation — against
``platform_agent_config.platform_monthly_cap``.

Tenant-scoped agent calls are guarded inside the fabric runtime
(``_check_budget`` / ``_log_task``); this is the parallel guard for spend that
runs with ``tenant_id IS NULL`` so the platform monthly cap accounts for it too.
Both checks fail CLOSED: if the cap cannot be verified, the call is denied.
"""
from __future__ import annotations

import logging
import uuid

logger = logging.getLogger(__name__)


async def platform_ai_allowed(conn) -> bool:
    """Return True iff platform AI is enabled and month-to-date total spend
    (all tenants + platform/system) is under ``platform_monthly_cap``.

    NULL cap means "no platform cap" (off) → allowed. A missing config row is
    treated as unconfigured → allowed (matches fabric's default-on behaviour).
    Fails CLOSED on error.
    """
    try:
        cfg = await conn.fetchrow(
            "SELECT ai_enabled, platform_monthly_cap "
            "FROM platform_agent_config WHERE id = TRUE"
        )
        if cfg is None:
            return True
        if not cfg["ai_enabled"]:
            logger.info("[platform_guard] AI disabled platform-wide")
            return False
        cap = cfg["platform_monthly_cap"]
        if cap is None:
            return True
        row = await conn.fetchrow(
            """
            SELECT COALESCE(SUM(cost_usd), 0) AS total_cost
            FROM agent_task_log
            WHERE created_at >= date_trunc('month', now())
            """
        )
        total = float(row["total_cost"]) if row else 0.0
        if total >= float(cap):
            logger.error(
                "[platform_guard] platform monthly cap reached: $%.4f of $%.2f",
                total, float(cap),
            )
            return False
        return True
    except Exception as exc:  # fail closed
        logger.error("[platform_guard] cap check failed, denying call: %s", exc)
        return False


async def log_platform_call(
    conn,
    *,
    agent_role: str,
    task_type: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cost_usd: float = 0.0,
    duration_ms: int = 0,
    error: str | None = None,
) -> None:
    """Insert a platform (``tenant_id`` NULL) row into agent_task_log so the
    platform monthly cap and admin usage views see this spend. Best-effort."""
    try:
        await conn.execute(
            """
            INSERT INTO agent_task_log
                (id, tenant_id, agent_role, task_type,
                 input_tokens, output_tokens, tool_calls_count,
                 duration_ms, cost_usd, memories_written, error, created_at)
            VALUES ($1, NULL, $2, $3, $4, $5, 0, $6, $7, 0, $8, now())
            """,
            uuid.uuid4(),
            agent_role,
            task_type,
            int(input_tokens or 0),
            int(output_tokens or 0),
            int(duration_ms or 0),
            float(cost_usd or 0.0),
            error,
        )
    except Exception as exc:  # best-effort — never break the calling pipeline
        logger.error("[platform_guard] log_platform_call failed: %s", exc)
