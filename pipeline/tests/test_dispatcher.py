"""Unit tests for pipeline.src.ingest.dispatcher.

Because no test DB is available in CI (TEST_DATABASE_URL unreachable),
the SQL-dependent paths (tick_schedules, consume_one_job's full DB flow)
are tested with a fake async connection object that records calls.

Covers:
  1. INGESTERS mapping: each known source maps to the correct ingester class.
  2. _run_ingest_job routing: unknown source marks job failed; known source
     dispatches to the right ingester (with a fake conn).
  3. consume_one_job: when the DB returns no pending job, returns False.
  4. tick_schedules routing: DB error path returns 0.
  5. Double-emit regression: exactly ONE finder:topics.expanded event is
     emitted per expand job — PIPE-03/PIPE-06 fix verified here.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ingest.dispatcher import INGESTERS, _run_ingest_job


# ---------------------------------------------------------------------------
# Helpers / Fakes
# ---------------------------------------------------------------------------

class _FakeConn:
    """Minimal fake asyncpg-like connection that records SQL calls."""

    def __init__(self):
        self.executed: list[tuple[str, tuple]] = []   # (sql, args)
        self.fetchrow_result: Any = None               # returned by fetchrow
        self.fetchval_result: Any = None               # returned by fetchval
        self.fetch_result: list = []                   # returned by fetch
        # Collected event inserts: list of (namespace, type, payload_dict)
        self.events: list[dict] = []

    async def execute(self, sql: str, *args) -> None:
        self.executed.append((sql, args))
        # Sniff event inserts so tests can assert on emitted events.
        low = sql.lower()
        if "insert into system_events" in low and args:
            # args layout (based on dispatcher/topic_expander):
            #   ($1=id, $2='finder', $3=type, $4=phase, $5=actor_type,
            #    $6=actor_id, $7=payload::jsonb, $8=now())
            # OR positional depending on the call site.  We sniff the
            # SQL for the literal namespace string and type placeholder.
            import re
            ns_match = re.search(r"'([^']+)'", sql)
            ns = ns_match.group(1) if ns_match else "?"
            # Type is the next string literal.
            literals = re.findall(r"'([^']+)'", sql)
            evt_type = literals[1] if len(literals) > 1 else "?"
            payload_raw = None
            for a in args:
                if isinstance(a, str) and a.startswith("{"):
                    try:
                        payload_raw = json.loads(a)
                    except Exception:
                        pass
            self.events.append({
                "namespace": ns,
                "type": evt_type,
                "payload": payload_raw,
            })

    async def fetchrow(self, sql: str, *args) -> Any:
        self.executed.append((sql, args))
        return self.fetchrow_result

    async def fetchval(self, sql: str, *args) -> Any:
        self.executed.append((sql, args))
        return self.fetchval_result

    async def fetch(self, sql: str, *args) -> list:
        self.executed.append((sql, args))
        return self.fetch_result


# ---------------------------------------------------------------------------
# 1. INGESTERS mapping
# ---------------------------------------------------------------------------

class TestIngestersMapping:
    def test_all_known_sources_present(self):
        assert set(INGESTERS) == {"sam_gov", "sbir_gov", "grants_gov", "dsip"}

    def test_sam_gov_maps_to_sam_gov_ingester(self):
        from ingest.sam_gov import SamGovIngester
        assert INGESTERS["sam_gov"] is SamGovIngester

    def test_sbir_gov_maps_to_sbir_gov_ingester(self):
        from ingest.sbir_gov import SbirGovIngester
        assert INGESTERS["sbir_gov"] is SbirGovIngester

    def test_grants_gov_maps_to_grants_gov_ingester(self):
        from ingest.grants_gov import GrantsGovIngester
        assert INGESTERS["grants_gov"] is GrantsGovIngester

    def test_dsip_maps_to_dsip_ingester(self):
        from ingest.dsip import DsipIngester
        assert INGESTERS["dsip"] is DsipIngester


# ---------------------------------------------------------------------------
# 2. _run_ingest_job routing
# ---------------------------------------------------------------------------

class TestRunIngestJob:
    @pytest.mark.asyncio
    async def test_unknown_source_marks_job_failed(self):
        """An unrecognised source triggers an UPDATE … SET status='failed'."""
        conn = _FakeConn()
        job_id = uuid.uuid4()
        await _run_ingest_job(conn, job_id, "nonexistent_source", {})
        sql_fragments = [s for s, _ in conn.executed]
        assert any("failed" in s.lower() for s in sql_fragments), (
            "Expected a 'failed' status update for unknown source"
        )

    @pytest.mark.asyncio
    async def test_known_source_dispatches_to_correct_ingester(self):
        """A known source calls the matching ingester's .run() method."""
        from ingest.base import IngestResult

        fake_result = IngestResult(source="sam_gov", run_type="incremental")
        fake_result.inserted = 5
        fake_result.updated = 2
        fake_result.skipped = 0
        fake_result.failed = 0
        fake_result.pages_fetched = 1

        conn = _FakeConn()
        job_id = uuid.uuid4()

        from ingest.sam_gov import SamGovIngester

        with patch.object(SamGovIngester, "run", new=AsyncMock(return_value=fake_result)):
            await _run_ingest_job(conn, job_id, "sam_gov", {"run_type": "incremental"})

        # Should have called UPDATE … SET status='completed'
        assert any("completed" in s.lower() for s, _ in conn.executed)

    @pytest.mark.asyncio
    async def test_result_json_stored_in_pipeline_jobs(self):
        """Job result JSON is written to pipeline_jobs.result."""
        from ingest.base import IngestResult

        fake_result = IngestResult(source="sbir_gov", run_type="full")
        fake_result.inserted = 10
        fake_result.updated = 3
        fake_result.skipped = 1
        fake_result.failed = 0
        fake_result.pages_fetched = 2

        conn = _FakeConn()
        job_id = uuid.uuid4()

        from ingest.sbir_gov import SbirGovIngester

        with patch.object(SbirGovIngester, "run", new=AsyncMock(return_value=fake_result)):
            await _run_ingest_job(conn, job_id, "sbir_gov", {})

        # Find the execute call that stores the result JSON.
        result_calls = [
            (s, a) for s, a in conn.executed
            if "completed" in s.lower() and a
        ]
        assert result_calls, "No 'completed' update with args found"
        # The JSON arg should contain the inserted count.
        result_args = result_calls[0][1]
        result_json = next(
            (a for a in result_args if isinstance(a, str) and "inserted" in a),
            None,
        )
        assert result_json is not None, "result JSON not found in execute args"
        parsed = json.loads(result_json)
        assert parsed["inserted"] == 10


# ---------------------------------------------------------------------------
# 3. consume_one_job returns False when queue is empty
# ---------------------------------------------------------------------------

class TestConsumeOneJobEmptyQueue:
    @pytest.mark.asyncio
    async def test_returns_false_when_no_pending_job(self):
        """consume_one_job returns False and does nothing when the queue is empty."""
        from ingest.dispatcher import consume_one_job

        conn = _FakeConn()
        conn.fetchrow_result = None  # No pending job
        result = await consume_one_job(conn)
        assert result is False


# ---------------------------------------------------------------------------
# 4. tick_schedules: DB error path returns 0
# ---------------------------------------------------------------------------

class TestTickSchedulesErrorPath:
    @pytest.mark.asyncio
    async def test_db_error_returns_zero(self):
        """tick_schedules returns 0 and logs when the DB fetch raises."""
        from ingest.dispatcher import tick_schedules

        conn = _FakeConn()

        async def _raise(*args, **kwargs):
            raise RuntimeError("simulated DB error")

        conn.fetch = _raise  # type: ignore[assignment]

        result = await tick_schedules(conn)
        assert result == 0

    @pytest.mark.asyncio
    async def test_no_due_schedules_returns_zero(self):
        """tick_schedules returns 0 when no schedules are due."""
        from ingest.dispatcher import tick_schedules

        conn = _FakeConn()
        conn.fetch_result = []  # No due schedules
        result = await tick_schedules(conn)
        assert result == 0

    @pytest.mark.asyncio
    async def test_non_ingester_schedules_skipped(self):
        """Schedules for non-ingester sources (e.g. 'scoring') are ignored."""
        from ingest.dispatcher import tick_schedules

        conn = _FakeConn()
        # Return a schedule for 'scoring' which is not in INGESTERS.
        conn.fetch_result = [
            {
                "id": uuid.uuid4(),
                "source": "scoring",
                "run_type": "daily",
                "cron_expression": "0 0 * * *",
                "next_run_at": None,
            }
        ]
        result = await tick_schedules(conn)
        # 'scoring' is skipped → 0 jobs inserted
        assert result == 0


# ---------------------------------------------------------------------------
# 5. Double-emit regression test (PIPE-03 / PIPE-06 fix)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_expand_topics_job_emits_exactly_one_topics_expanded_event():
    """Regression: exactly ONE finder:topics.expanded event per expand job.

    After the PIPE-03/PIPE-06 fix, the duplicate emit in
    dispatcher._run_expand_topics_job was removed.  The only emit is the
    rollup from topic_expander._emit_topics_expanded.

    Strategy: we patch ``ingest.topic_expander.expand_solicitation_topics``
    on the module itself so the ``from ingest.topic_expander import
    expand_solicitation_topics`` inside _run_expand_topics_job resolves to
    our fake, which emits exactly one finder:topics.expanded event just like
    the real expander does.
    """
    import sys
    import ingest.topic_expander as _te_module

    sol_id = str(uuid.uuid4())
    job_id = uuid.uuid4()

    conn = _FakeConn()

    expand_result = {
        "status": "completed",
        "solicitationId": sol_id,
        "sourceProfileId": None,
        "expanded": 3,
        "skipped": 0,
        "topics_upserted": 3,
        "topics_skipped": 0,
        "inserted": 3,
        "updated": 0,
        "durationMs": 42,
    }

    async def _fake_expand(conn_arg, *, solicitation_id, **kwargs):
        """Simulate the real expander: emit exactly 1 finder:topics.expanded event."""
        await conn_arg.execute(
            """
            INSERT INTO system_events
              (id, namespace, type, phase, actor_type, actor_id,
               payload, created_at)
            VALUES ($1, 'finder', 'topics.expanded', 'single',
                    'pipeline', 'ingest:topic_expander',
                    $2::jsonb, now())
            """,
            uuid.uuid4(),
            json.dumps({
                "solicitationId": solicitation_id,
                "expanded": 3,
                "skipped": 0,
            }),
        )
        return expand_result

    from ingest import dispatcher as _dispatcher

    # Patch expand_solicitation_topics on the topic_expander module so that
    # when dispatcher does `from ingest.topic_expander import expand_solicitation_topics`
    # (lazy, inside the function body), it picks up our fake.
    original_fn = _te_module.expand_solicitation_topics
    _te_module.expand_solicitation_topics = _fake_expand
    try:
        await _dispatcher._run_expand_topics_job(
            conn,
            job_id,
            metadata={"solicitation_id": sol_id},
        )
    finally:
        _te_module.expand_solicitation_topics = original_fn

    # Count finder:topics.expanded events across all conn.execute calls.
    topics_expanded_events = [
        e for e in conn.events
        if e["namespace"] == "finder" and e["type"] == "topics.expanded"
    ]

    # After PIPE-03/PIPE-06: exactly 1 event (from the expander only).
    assert len(topics_expanded_events) == 1, (
        f"Expected 1 finder:topics.expanded event, got {len(topics_expanded_events)}. "
        f"Events: {topics_expanded_events}"
    )
