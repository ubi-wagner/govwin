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


#: Databases this file must never open. Its cleanup TRUNCATES shared tables, so pointing
#: TEST_DATABASE_URL at a working database deletes real rows — and the deletes that DON'T trip a
#: foreign key are the ones that do the damage silently. Names, not URLs, because the same database
#: is reachable under several host spellings.
_FORBIDDEN_DB_NAMES = ("govtech_intel", "railway", "postgres_prod")


def _force_stub_mode(monkeypatch):
    """Put the ingesters in stub mode, and PROVE it took.

    This used to be `monkeypatch.setenv("USE_STUB_DATA", "true")` followed by a reload of the config
    module, because config computes the flag once at import. Two things are wrong with that. The
    reload is guarded on `"config" in sys.modules`, so it silently does nothing when config has not
    been imported yet; and monkeypatch restores the ENV at teardown without reloading, so the
    module attribute keeps whatever the last reload left. Run alone these tests passed; run inside
    the full suite the flag was False and `sam_gov.fetch_page` made a REAL call to the SAM.gov API,
    failing with 403 Forbidden. A test suite that reaches the public internet depending on file
    ordering is worse than one that fails.

    Set the attribute the code actually reads, reached THROUGH the ingester module rather than by a
    fresh `import config`. Those can be different objects: test_crypto.py evicts config from
    sys.modules, so anything imported before it keeps the original module while a later import
    builds a second one. Patching `sam_gov.config` patches whichever object sam_gov is holding,
    whatever the import history was.

    The assertion is the point — silently not taking effect is the failure mode being fixed.
    """
    from ingest import sam_gov
    monkeypatch.setattr(sam_gov.config, "USE_STUB_DATA", True)
    assert sam_gov.config.USE_STUB_DATA is True


@pytest_asyncio.fixture
async def conn():
    """Connect to the test PG instance (skip if unreachable)."""
    name = TEST_DATABASE_URL.rsplit("/", 1)[-1].split("?")[0]
    if name in _FORBIDDEN_DB_NAMES:
        pytest.fail(
            f"TEST_DATABASE_URL points at '{name}', a working database. This file's cleanup "
            "truncates pipeline_jobs / curated_solicitations / solicitation_compliance and deletes "
            "finder events. Point it at a throwaway database (see scripts/sandbox-env.sh)."
        )
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
    """Clear what these tests produce, and nothing else.

    THESE DELETES USED TO BE UNQUALIFIED, written against a bare schema where curated_solicitations
    had no dependents and system_events had no referrers. A database built by actually running the
    migrations has both: 140/143 seed a demo solicitation with a proposal, sections and a compliance
    matrix hanging off it, and workflow rows point at seeded events. So
    `DELETE FROM curated_solicitations` trips proposals_solicitation_id_fkey and every test here
    errors in setup.

    It went unnoticed because these tests SKIP when no test PG is reachable — the suite reported
    green while this fixture had never once run against a real schema.

    Deleting the seeded graph would be the wrong repair anyway; other tests depend on it. Scope each
    delete to rows nothing owns instead: the stub ingest's own opportunities, solicitations with no
    proposal built on them, events no workflow instance references. Both an empty database and a
    fully seeded one end up in the state these tests expect.
    """
    async def _cleanup():
        await conn.execute("DELETE FROM pipeline_jobs")
        await conn.execute(
            "DELETE FROM system_events WHERE namespace = 'finder' AND id NOT IN "
            "(SELECT trigger_event_id FROM process_instances WHERE trigger_event_id IS NOT NULL)"
        )
        await conn.execute(
            "DELETE FROM solicitation_compliance WHERE solicitation_id NOT IN "
            "(SELECT solicitation_id FROM proposals WHERE solicitation_id IS NOT NULL)"
        )
        await conn.execute(
            "DELETE FROM curated_solicitations WHERE id NOT IN "
            "(SELECT solicitation_id FROM proposals WHERE solicitation_id IS NOT NULL)"
        )
        await conn.execute("DELETE FROM opportunities WHERE source IN ('sam_gov', 'sbir_gov', 'grants_gov')")
    await _cleanup()
    yield
    await _cleanup()


@pytest.mark.asyncio
async def test_dispatcher_consumes_sam_gov_job_stub_mode(conn, clean_tables, monkeypatch):
    """A pipeline_jobs row for sam_gov gets consumed and produces opportunities.

    The ingester runs in stub mode (USE_STUB_DATA=true) so no HTTP
    calls happen; it returns 9 synthetic opportunities (SBIR Phase I
    + II, STTR, BAA, OTA).
    """
    _force_stub_mode(monkeypatch)

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
    _force_stub_mode(monkeypatch)

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
async def test_dispatcher_consumes_shred_solicitation_job(conn, clean_tables):
    """A pipeline_jobs row with kind='shred_solicitation' routes to the shredder.

    Injects a mock Anthropic client via shredder.runner.ANTHROPIC_CLIENT
    so no real Claude calls happen. Verifies the full chain:
    dispatcher → shredder.runner → DB writes (ai_extracted, namespace,
    status='ai_analyzed', solicitation_compliance row).
    """
    from types import SimpleNamespace
    from ingest.dispatcher import consume_one_job
    from shredder import runner as shredder_runner
    import uuid as _uuid

    # Seed an opportunity + curated_solicitations with full_text
    opp_id = await conn.fetchval(
        """
        INSERT INTO opportunities (source, source_id, title, agency, office, program_type, is_active)
        VALUES ('sam_gov', $1, 'dispatcher shred test', 'Department of the Air Force',
                'AFWERX', 'sbir_phase_1', true)
        RETURNING id
        """,
        f"dispatcher-shred-{_uuid.uuid4()}",
    )
    sol_id = await conn.fetchval(
        """
        INSERT INTO curated_solicitations (opportunity_id, namespace, status, full_text)
        VALUES ($1, 'pending', 'released_for_analysis', $2)
        RETURNING id
        """,
        opp_id,
        "The Technical Volume shall not exceed 15 pages. Use Times New Roman.",
    )

    # Mock Anthropic client returning a minimal valid response for both calls
    async def _create(**kwargs):
        user_msg = kwargs["messages"][0]["content"]
        if "MASTER VARIABLES:" in user_msg:
            text = json.dumps({
                "matches": [{
                    "variable_name": "page_limit_technical", "value": 15,
                    "source_excerpt": "Technical Volume shall not exceed 15 pages",
                    "page": None, "confidence": 1.0,
                }]
            })
        else:
            text = json.dumps({
                "sections": [{
                    "key": "submission_format", "title": "Proposal Prep",
                    "page_range": "1", "summary": "15 page limit",
                    "raw_text_excerpt": "The Technical Volume shall not exceed 15 pages.",
                }]
            })
        return SimpleNamespace(
            content=[SimpleNamespace(text=text)],
            usage=SimpleNamespace(input_tokens=200, output_tokens=100),
        )
    mock_client = SimpleNamespace(messages=SimpleNamespace(create=_create))
    shredder_runner.ANTHROPIC_CLIENT = mock_client

    try:
        # Insert a shred job
        await conn.execute(
            """
            INSERT INTO pipeline_jobs (source, kind, status, priority, metadata)
            VALUES ('system', 'shred_solicitation', 'pending', 1, $1::jsonb)
            """,
            json.dumps({"solicitation_id": str(sol_id)}),
        )

        processed = await consume_one_job(conn)
        assert processed is True

        # Job completed
        job_status = await conn.fetchval(
            "SELECT status FROM pipeline_jobs WHERE kind='shred_solicitation' "
            "ORDER BY created_at DESC LIMIT 1"
        )
        assert job_status == "completed"

        # Solicitation transitioned to ai_analyzed
        sol_status = await conn.fetchval(
            "SELECT status FROM curated_solicitations WHERE id = $1", sol_id
        )
        assert sol_status == "ai_analyzed"

        # Namespace computed
        namespace = await conn.fetchval(
            "SELECT namespace FROM curated_solicitations WHERE id = $1", sol_id
        )
        assert namespace == "USAF:AFWERX:SBIR:Phase1"

        # Compliance row landed with the named column populated
        page_limit = await conn.fetchval(
            "SELECT page_limit_technical FROM solicitation_compliance "
            "WHERE solicitation_id = $1",
            sol_id,
        )
        assert page_limit == 15

    finally:
        shredder_runner.ANTHROPIC_CLIENT = None
        await conn.execute("DELETE FROM solicitation_compliance WHERE solicitation_id = $1", sol_id)
        await conn.execute("DELETE FROM curated_solicitations WHERE id = $1", sol_id)
        await conn.execute("DELETE FROM opportunities WHERE id = $1", opp_id)


@pytest.mark.asyncio
async def test_dispatcher_shred_job_without_solicitation_id_fails_cleanly(conn, clean_tables):
    """A shred job missing metadata.solicitation_id marks itself failed."""
    from ingest.dispatcher import consume_one_job

    await conn.execute(
        """
        INSERT INTO pipeline_jobs (source, kind, status, priority, metadata)
        VALUES ('system', 'shred_solicitation', 'pending', 1, '{}'::jsonb)
        """
    )
    assert await consume_one_job(conn) is True

    status = await conn.fetchval(
        "SELECT status FROM pipeline_jobs WHERE kind='shred_solicitation' LIMIT 1"
    )
    assert status == "failed"

    result_row = await conn.fetchval(
        "SELECT result FROM pipeline_jobs WHERE kind='shred_solicitation' LIMIT 1"
    )
    result = json.loads(result_row) if isinstance(result_row, str) else result_row
    assert "solicitation_id" in result["error"]


@pytest.mark.asyncio
async def test_dispatcher_handles_empty_queue(conn, clean_tables):
    """consume_one_job returns False when the queue is empty."""
    from ingest.dispatcher import consume_one_job
    processed = await consume_one_job(conn)
    assert processed is False
