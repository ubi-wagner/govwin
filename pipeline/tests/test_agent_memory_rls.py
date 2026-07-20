"""P1-1 (launch-readiness): agent-memory RLS reconcile (mig 119).

semantic_memories / procedural_memories / agent_task_log had RLS ENABLED but NOT FORCED with
0 policies — a NOBYPASSRLS role (rfp_agent) would read ZERO rows (deny-all). Mig 119 adds the
tenant_isolation policy + FORCE to match episodic_memories (mig 116). Durable schema-level
assertion (no seed needed); the row-level isolation was drive-proven under SET ROLE rfp_agent
(own=1, cross-tenant/unset=0, platform-NULL rows hidden from tenants but insertable)."""
import os

import asyncpg
import pytest

DATABASE_URL = os.getenv("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")

RECONCILED = ["semantic_memories", "procedural_memories", "agent_task_log"]


@pytest.mark.asyncio
async def test_agent_memory_tables_are_forced_with_tenant_policy():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        for t in RECONCILED + ["episodic_memories"]:  # episodic is the reference (mig 116)
            row = await conn.fetchrow(
                """SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                          (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
                   FROM pg_class c WHERE c.relname = $1 AND c.relkind = 'r'""",
                t,
            )
            assert row is not None, f"{t} missing"
            assert row["rls"] and row["forced"], f"{t} must be RLS-enabled + FORCED"
            assert row["policies"] >= 1, f"{t} must have a tenant_isolation policy (had {row['policies']})"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_agent_task_log_policy_allows_null_tenant_writes():
    """Platform-agent rows (tenant_id IS NULL) must remain writable — the WITH CHECK permits NULL."""
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        qual = await conn.fetchval(
            "SELECT with_check FROM pg_policies WHERE tablename='agent_task_log' AND policyname='tenant_isolation'")
        assert qual is not None and "IS NULL" in qual, \
            "agent_task_log WITH CHECK must allow tenant_id IS NULL (platform-agent logging)"
    finally:
        await conn.close()
