"""Failure-flagging invariants (launch-critical): a failed py-function execution must NEVER be
silent — it is flagged in the AUDIT (process_instances + transitions + system_events) and in the
AUTOMATION QUEUES (process_instances for workflows, agent_task_queue for agent tasks). These drive
real failures through the managed engine + the fabric and assert every flag lands. DB-gated;
self-cleaning. (conftest auto-skips when no reachable Postgres.)
"""
from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from agents.archetypes.base import BaseArchetype
from agents.fabric import AgentFabric
from workflows.base import EventTrigger, Step, StepType, Workflow
from workflows.manager import WorkflowManager

DATABASE_URL = os.getenv("DATABASE_URL")
BOGUS = "workflows.actions.score_tenants.NO_SUCH_FUNCTION"
_NOTIFY = dict(step_type=StepType.NOTIFY, action="system.notify",
               input_map={"channel": '"email"', "template": '"x"', "tenant_ids": "[]"})


class _FailWF(Workflow):
    description = "one ACTION step that raises"
    trigger = EventTrigger(namespace="system", type="test.fail_flag", phase="single")
    steps = [Step(name="boom", step_type=StepType.ACTION, action=BOGUS, input_map={})]


class _IndepWF(Workflow):
    description = "a failing step + an INDEPENDENT step that succeeds"
    trigger = EventTrigger(namespace="system", type="test.indep_fail", phase="single")
    steps = [Step(name="boom", step_type=StepType.ACTION, action=BOGUS, input_map={}),
             Step(name="ok", **_NOTIFY)]


async def _drive(mgr, conn, wf):
    iid = await mgr.create_instance(conn, wf.__name__, None, {"probe": True})
    await mgr.execute_instance(conn, iid, wf, {"probe": True})
    row = await conn.fetchrow(
        "SELECT status, last_error, last_error_step, step_status FROM process_instances WHERE id=$1",
        uuid.UUID(iid))
    events = [e["type"] for e in await conn.fetch(
        "SELECT type FROM system_events WHERE payload->>'instance_id'=$1 AND type LIKE 'workflow.%'", iid)]
    return iid, row, events


async def _cleanup_instance(conn, iid):
    await conn.execute("DELETE FROM system_events WHERE payload->>'instance_id'=$1", iid)
    await conn.execute("DELETE FROM process_instance_transitions WHERE instance_id=$1", uuid.UUID(iid))
    await conn.execute("DELETE FROM process_instances WHERE id=$1", uuid.UUID(iid))


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_workflow_step_failure_is_flagged_in_audit():
    """A raising ACTION step → instance failed, last_error + last_error_step recorded, and both
    workflow.step_failed and workflow.instance_failed emitted (audit + what /admin/workflows reads)."""
    conn = await asyncpg.connect(DATABASE_URL)
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        mgr = WorkflowManager(source="pipeline", fabric=None)
        await mgr.start(conn, pool=pool)
        iid, row, events = await _drive(mgr, conn, _FailWF)
        assert row["status"] == "failed"
        assert row["last_error"], "last_error must capture the py error text"
        assert row["last_error_step"] == "boom", "last_error_step must name the failed step"
        assert "workflow.step_failed" in events
        assert "workflow.instance_failed" in events
        await _cleanup_instance(conn, iid)
    finally:
        await pool.close()
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_independent_failure_is_not_masked_by_a_success():
    """continue-on-independent-failure: the failed step is still flagged even though an independent
    step completes; the instance is `failed` (a later success must not hide an earlier failure)."""
    import json
    conn = await asyncpg.connect(DATABASE_URL)
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        mgr = WorkflowManager(source="pipeline", fabric=None)
        await mgr.start(conn, pool=pool)
        iid, row, _ = await _drive(mgr, conn, _IndepWF)
        ss = row["step_status"] if isinstance(row["step_status"], dict) else json.loads(row["step_status"] or "{}")
        assert row["status"] == "failed", "instance must be failed despite the independent success"
        assert ss.get("boom") == "failed"
        assert ss.get("ok") == "completed", "the independent step must still have run"
        await _cleanup_instance(conn, iid)
    finally:
        await pool.close()
        await conn.close()


class _RaisingArchetype(BaseArchetype):
    @property
    def role_name(self): return "_raise_probe"
    @property
    def system_prompt(self): return "x"
    @property
    def tools(self): return []
    def handles_event(self, event_type): return False
    def build_messages(self, context, memories): raise RuntimeError("deliberate archetype failure")


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_agent_task_queue_failure_is_flagged_with_reason():
    """An agent task that fails (unknown archetype) must land on agent_task_queue as status='failed'
    WITH the error text recorded — a `reason`-only return once left agent_task_queue.error NULL."""
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        lh = await conn.fetchval("SELECT id FROM tenants WHERE slug='lighthouse'")
        if lh is None:  # seed_dev_accounts not run — skip rather than fail
            pytest.skip("lighthouse tenant not seeded")
        fabric = AgentFabric()
        role = f"__unknown_{uuid.uuid4().hex[:8]}__"
        tid = uuid.uuid4()
        await conn.execute(
            "INSERT INTO agent_task_queue (id, tenant_id, agent_role, task_type, input, status, created_at) "
            "VALUES ($1,$2,$3,'test','{}'::jsonb,'pending',now())", tid, lh, role)
        # process_task_queue claims LIMIT 5/call — drain until our task is processed.
        for _ in range(20):
            await fabric.process_task_queue(conn)
            st = await conn.fetchval("SELECT status FROM agent_task_queue WHERE id=$1", tid)
            if st != "pending":
                break
        row = await conn.fetchrow("SELECT status, error FROM agent_task_queue WHERE id=$1", tid)
        log_errs = await conn.fetchval(
            "SELECT count(*) FROM agent_task_log WHERE agent_role=$1 AND status IN ('error','failed')", role)
        try:
            assert row["status"] == "failed", "a failed agent task must be flagged failed on the queue"
            assert row["error"], "the queue row must record WHY it failed (not just that it did)"
            assert log_errs >= 1, "an agent_task_log terminal error row must be written"
        finally:
            await conn.execute("DELETE FROM agent_task_results WHERE task_id=$1", tid)
            await conn.execute("DELETE FROM agent_task_queue WHERE id=$1", tid)
            await conn.execute("DELETE FROM agent_task_log WHERE agent_role=$1", role)
    finally:
        await conn.close()
