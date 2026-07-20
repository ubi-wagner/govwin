"""Regression for the shared cron→event→workflow bridge (launch-readiness audit findings).

FIX-1 (HIGH): the workflow processor poll must PASS scheduled `system:*` events
(system:ops.digest_requested, social.schedule_requested) — the old `namespace != 'system'`
filter dropped them, so those workflows never fired — while still EXCLUDING the processor's
own `system:workflow.*` lifecycle emissions (no self-trigger).

FIX-2 (MEDIUM): the cron event-emit is a compare-and-swap CLAIM (advance next_run_at before
emit), so a crash mid-tick or a second replica can't double-emit."""
import os
import asyncio
import inspect

import asyncpg
import pytest

from ingest.dispatcher import tick_schedules

DATABASE_URL = os.getenv("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")

# The exact predicate the processor poll uses (kept in sync with processor.py).
POLL_PREDICATE = "NOT (namespace = 'system' AND type LIKE 'workflow.%')"


def test_processor_poll_predicate_is_narrowed_not_whole_system():
    from workflows import processor
    src = inspect.getsource(processor.run_workflow_processor)
    # The ACTIVE poll clause must be the narrowed form (excludes only workflow.* self-emissions),
    # not the old whole-system exclusion. (A `namespace != 'system'` string may remain in the
    # explanatory comment; assert on the active `AND NOT (...)` clause instead.)
    assert "AND NOT (namespace = 'system' AND type LIKE 'workflow.%')" in src
    assert "AND namespace != 'system'\n" not in src, "old whole-system exclusion must be gone from the query"


@pytest.mark.asyncio
async def test_poll_passes_scheduled_system_events_but_not_workflow_lifecycle():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "INSERT INTO system_events (id,namespace,type,phase,actor_type,actor_id,payload,created_at)"
            " VALUES (gen_random_uuid(),'system','ops.digest_requested','single','system','cron','{}'::jsonb, now())")
        await conn.execute(
            "INSERT INTO system_events (id,namespace,type,phase,actor_type,actor_id,payload,created_at)"
            " VALUES (gen_random_uuid(),'system','workflow.started','single','system','workflow_manager','{}'::jsonb, now())")
        rows = await conn.fetch(
            f"SELECT type FROM system_events WHERE created_at >= now()-interval '1 min' AND {POLL_PREDICATE}")
        types = {r["type"] for r in rows}
        assert "ops.digest_requested" in types      # scheduled workflow trigger — must be visible
        assert "workflow.started" not in types       # processor's own emission — must stay excluded
    finally:
        await conn.execute("DELETE FROM system_events WHERE type IN ('ops.digest_requested','workflow.started')"
                           " AND created_at >= now()-interval '5 min'")
        await conn.close()


@pytest.mark.asyncio
async def test_cron_emit_is_compare_and_swap_no_double_emit():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(
            "UPDATE pipeline_schedules SET next_run_at = now()-interval '1 min' WHERE source='system:ops.digest_requested'")
        before = await conn.fetchval(
            "SELECT count(*) FROM system_events WHERE type='ops.digest_requested' AND actor_id='cron'")
        await tick_schedules(conn)   # claims + emits
        await tick_schedules(conn)   # already advanced → no emit
        after = await conn.fetchval(
            "SELECT count(*) FROM system_events WHERE type='ops.digest_requested' AND actor_id='cron'")
        assert after - before == 1, f"expected exactly one emit across two ticks, got {after - before}"
    finally:
        await conn.execute("DELETE FROM system_events WHERE type='ops.digest_requested' AND actor_id='cron'"
                           " AND created_at >= now()-interval '5 min'")
        await conn.close()
