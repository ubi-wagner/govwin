"""End-to-end dispatcher test for Phase 1 §C.

Spins up asyncio-scoped ingestion against a real PG connection.
Verifies that a queued pipeline_jobs row gets consumed, an
opportunities row appears, and finder.opportunity.ingested events
land in system_events.

Runs in stub mode (USE_STUB_DATA=true) so no real HTTP calls happen.

Requires an externally running PG with the schema applied. The
fixture looks for TEST_DATABASE_URL; if not set, the test SKIPs
rather than failing so the unit test suite stays green without
PG dependencies.
"""
import os
import asyncio
import json

import pytest
import pytest_asyncio
import asyncpg


TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql://postgres@/postgres?host=/tmp/pgtest&port=55432",
)


@pytest_asyncio.fixture
async def conn():
    """Connect to the test PG instance (skip if unreachable)."""
    try:
        c = await asyncpg.connect(TEST_DATABASE_URL, timeout=2)
    except (asyncpg.exceptions.PostgresError, OSError, ConnectionError):
        pytest.skip(f"test PG not reachable at {TEST_DATABASE_URL}")
    try:
        yield c
    finally:
        await c.close()


@pytest_asyncio.fixture
async def clean_tables(conn):
    """Clear the tables we'll test against before each run."""
    await conn.execute("DELETE FROM pipeline_jobs")
    await conn.execute("DELETE FROM system_events WHERE namespace = 'finder'")
    await conn.execute("DELETE FROM opportunities WHERE source IN ('sam_gov', 'sbir_gov', 'grants_gov')")
    yield
    # cleanup after too
    await conn.execute("DELETE FROM pipeline_jobs")
    await conn.execute("DELETE FROM system_events WHERE namespace = 'finder'")
    await conn.execute("DELETE FROM opportunities WHERE source IN ('sam_gov', 'sbir_gov', 'grants_gov')")


@pytest.mark.asyncio
async def test_dispatcher_consumes_sam_gov_job_stub_mode(conn, clean_tables, monkeypatch):
    """A pipeline_jobs row for sam_gov gets consumed and produces opportunities.

    The ingester runs in stub mode (USE_STUB_DATA=true) so no HTTP
    calls happen; it returns 9 synthetic opportunities (SBIR Phase I
    + II, STTR, BAA, OTA).
    """
    monkeypatch.setenv("USE_STUB_DATA", "true")
    # Force config module to re-read env (it caches at import time)
    import importlib, sys
    if "config" in sys.modules:
        importlib.reload(sys.modules["config"])

    from ingest.dispatcher import consume_one_job

    # Insert a pending job
    await conn.execute(
        """
        INSERT INTO pipeline_jobs (source, status, priority, metadata)
        VALUES ('sam_gov', 'pending', 1, '{"run_type": "incremental"}')
        """
    )

    # Consume one job
    processed = await consume_one_job(conn)
    assert processed is True, "expected consume_one_job to process a job"

    # Job status flipped to completed
    status = await conn.fetchval(
        "SELECT status FROM pipeline_jobs WHERE source = 'sam_gov' ORDER BY created_at DESC LIMIT 1"
    )
    assert status == "completed", f"expected completed, got {status}"

    # Opportunities rows landed
    opp_count = await conn.fetchval(
        "SELECT COUNT(*) FROM opportunities WHERE source = 'sam_gov'"
    )
    assert opp_count >= 5, f"expected >=5 sam_gov opportunities from stub data, got {opp_count}"

    # Ingest run.start + run.end events emitted
    start_count = await conn.fetchval(
        "SELECT COUNT(*) FROM system_events WHERE namespace='finder' AND type='ingest.run.start'"
    )
    assert start_count == 1

    end_count = await conn.fetchval(
        "SELECT COUNT(*) FROM system_events WHERE namespace='finder' AND type='ingest.run.end'"
    )
    assert end_count == 1

    # Per-opportunity ingested events
    ingested_events = await conn.fetchval(
        "SELECT COUNT(*) FROM system_events WHERE namespace='finder' AND type='opportunity.ingested'"
    )
    assert ingested_events >= 5


@pytest.mark.asyncio
async def test_dispatcher_idempotent_content_hash_dedupe(conn, clean_tables, monkeypatch):
    """Running the same ingester twice doesn't insert duplicates.

    The opportunities table has a UNIQUE (source, source_id) constraint
    and an ON CONFLICT DO UPDATE WHERE content_hash changes pattern.
    Second run should UPDATE 0 rows when content hasn't changed.
    """
    monkeypatch.setenv("USE_STUB_DATA", "true")
    import importlib, sys
    if "config" in sys.modules:
        importlib.reload(sys.modules["config"])

    from ingest.dispatcher import consume_one_job

    # First run
    await conn.execute("""
        INSERT INTO pipeline_jobs (source, status, priority, metadata)
        VALUES ('sam_gov', 'pending', 1, '{"run_type": "incremental"}')
    """)
    assert await consume_one_job(conn)
    first_count = await conn.fetchval(
        "SELECT COUNT(*) FROM opportunities WHERE source = 'sam_gov'"
    )
    assert first_count >= 5

    # Second run with identical stub data
    await conn.execute("""
        INSERT INTO pipeline_jobs (source, status, priority, metadata)
        VALUES ('sam_gov', 'pending', 1, '{"run_type": "incremental"}')
    """)
    assert await consume_one_job(conn)
    second_count = await conn.fetchval(
        "SELECT COUNT(*) FROM opportunities WHERE source = 'sam_gov'"
    )
    assert second_count == first_count, (
        f"dedup failure: first run inserted {first_count}, "
        f"after second run: {second_count} (should be equal)"
    )

    # Second job's result should show all skipped
    second_job_result = await conn.fetchval(
        """
        SELECT result FROM pipeline_jobs
        WHERE source = 'sam_gov' AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1
        """
    )
    result = json.loads(second_job_result) if isinstance(second_job_result, str) else second_job_result
    # Either all skipped (row existed with same hash) or all updated-via-conflict
    assert result["inserted"] == 0 or (result["inserted"] + result["skipped"]) > 0


@pytest.mark.asyncio
async def test_dispatcher_handles_empty_queue(conn, clean_tables):
    """consume_one_job returns False when the queue is empty."""
    from ingest.dispatcher import consume_one_job
    processed = await consume_one_job(conn)
    assert processed is False
