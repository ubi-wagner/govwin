"""#149 (cross-board audit) — agent-fabric observability lifecycle.

Every agent invocation must be reconstructable from the DB: the fabric emits a
tool:agent.invoked start→end pair AND writes an agent_task_log row carrying the outcome
lifecycle (status + started_at + completed_at + guardrail_decision, mig 120). Two holes
the audit found are closed here: the unknown-archetype path is no longer a silent return,
and agent_task_log now records the terminal status + guardrail verdict, not just `error`.
"""
from __future__ import annotations

import inspect
import os
import uuid

import asyncpg
import pytest

from agents.fabric import AgentFabric

DATABASE_URL = os.getenv("DATABASE_URL")


def test_unknown_archetype_is_not_a_silent_return():
    """An unknown archetype must emit a start→end pair + log a row before returning."""
    src = inspect.getsource(AgentFabric.invoke_agent)
    # Scope to the missing-archetype guard block: from `if not archetype` to its return.
    start = src.index("if not archetype")
    guard = src[start: src.index("return {\"status\": \"error\", \"reason\": reason}", start)]
    assert "_emit_event" in guard, "unknown-archetype path must emit a tool:agent.invoked event"
    assert "_log_task" in guard, "unknown-archetype path must write an agent_task_log row"


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_log_task_records_lifecycle_columns():
    """_log_task populates status/started_at/completed_at/guardrail_decision (mig 120)."""
    conn = await asyncpg.connect(DATABASE_URL)
    fab = AgentFabric.__new__(AgentFabric)  # bypass __init__ for the helper
    role = f"probe_{uuid.uuid4().hex[:8]}"
    try:
        await fab._log_task(conn, tenant_id=None, agent_role=role, task_type="ok",
                            duration_ms=1500, error=None, guardrail_decision="apply")
        await fab._log_task(conn, tenant_id=None, agent_role=role, task_type="bad",
                            duration_ms=0, error="boom")
        rows = {r["task_type"]: r for r in await conn.fetch(
            "SELECT task_type, status, guardrail_decision, started_at, completed_at "
            "FROM agent_task_log WHERE agent_role=$1", role)}
        assert rows["ok"]["status"] == "completed"
        assert rows["ok"]["guardrail_decision"] == "apply"
        assert rows["ok"]["started_at"] <= rows["ok"]["completed_at"]
        # error → failed status derived, no guardrail
        assert rows["bad"]["status"] == "failed"
        assert rows["bad"]["guardrail_decision"] is None
    finally:
        await conn.execute("DELETE FROM agent_task_log WHERE agent_role=$1", role)
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_agent_task_log_has_lifecycle_columns():
    """mig 120 columns present (the durable lifecycle record)."""
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        cols = {r["column_name"] for r in await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_name='agent_task_log'")}
        for c in ("status", "started_at", "completed_at", "guardrail_decision"):
            assert c in cols, f"agent_task_log missing lifecycle column {c}"
    finally:
        await conn.close()
