"""Web Source Scout cron wiring (ingest.dispatcher.tick_schedules + mig 172 schedule row).

Proves the missing hop: a due `scout_source` schedule enqueues a `kind='scout_source'` all-due
scout job (so scout_all_due runs on the shared cron, not just the manual "Scout Now" button), and a
second due tick does NOT duplicate it while one is in flight. DB-integration — conftest auto-skips
this module without a reachable Postgres (it imports asyncpg).
"""
import os
import sys

import asyncpg  # noqa: F401 — presence makes conftest skip this module without a DB
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from ingest.dispatcher import tick_schedules  # noqa: E402

DATABASE_URL = os.environ.get("DATABASE_URL", "")

_CLEAN = "DELETE FROM pipeline_jobs WHERE kind='scout_source' AND status='pending' AND (metadata->>'triggered_by')='cron'"


@pytest.mark.asyncio
async def test_scout_schedule_enqueues_and_dedups():
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # The mig-172 schedule row must exist.
        assert await conn.fetchval("SELECT 1 FROM pipeline_schedules WHERE source='scout_source'") == 1

        # Make it due + clear any in-flight cron scout job.
        await conn.execute(_CLEAN)
        await conn.execute("UPDATE pipeline_schedules SET next_run_at = now() - interval '1 hour' WHERE source='scout_source'")

        await tick_schedules(conn)

        row = await conn.fetchrow(
            "SELECT source, kind, status, metadata FROM pipeline_jobs "
            "WHERE kind='scout_source' AND status='pending' ORDER BY created_at DESC LIMIT 1"
        )
        assert row is not None, "a due scout_source schedule did not enqueue a scout job"
        assert row["source"] == "scout_source" and row["kind"] == "scout_source"

        # Dedup: force it due again — while one scout job is still pending, a second tick must NOT
        # enqueue a duplicate (the in-flight guard).
        await conn.execute("UPDATE pipeline_schedules SET next_run_at = now() - interval '1 hour' WHERE source='scout_source'")
        await tick_schedules(conn)
        pending = await conn.fetchval("SELECT count(*) FROM pipeline_jobs WHERE kind='scout_source' AND status='pending' AND (metadata->>'triggered_by')='cron'")
        assert pending == 1, f"expected exactly 1 pending cron scout job (dedup), got {pending}"
    finally:
        await conn.execute(_CLEAN)
        await conn.close()
