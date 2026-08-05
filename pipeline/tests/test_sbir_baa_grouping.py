"""SBIR.gov BAA multi-topic grouping (regression for the NOT-NULL umbrella bug).

Before the fix, `_ensure_parent_solicitation` INSERTed the `multi_topic` parent
curated_solicitations row WITHOUT an opportunity_id — but that column is NOT NULL, so
the INSERT threw, was swallowed by the except, and `_create_triage_row` fell back to a
per-topic 'single' row. Every SBIR.gov BAA thus degraded to one solicitation per topic
instead of one umbrella BAA with N topics. The fix creates an inactive umbrella
opportunity first, backs the parent with it, and links each topic via solicitation_id
(the canonical multi-topic shape). This test drives the REAL ingest run loop and asserts
the grouped structure lands.
"""
from __future__ import annotations

import os
import sys
import uuid

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import asyncpg  # noqa: E402
from ingest.sbir_gov import SbirGovIngester  # noqa: E402

DATABASE_URL = os.getenv("DATABASE_URL")


def _topic(sol_number: str, topic_number: str, title: str) -> dict:
    """One SBIR.gov-schema item = one topic sharing a BAA solicitation_number."""
    return {
        "solicitation_title": "Probe BAA (multi-topic)",
        "solicitation_number": sol_number,
        "program": "SBIR",
        "phase": "Phase I",
        "agency": "Probe Agency",
        "branch": "Probe Office",
        "solicitation_year": "2026",
        "release_date": "2026-01-01",
        "open_date": "2026-01-01",
        "solicitation_close_date": "2026-12-31",
        "application_close_date": None,
        "description": "Probe BAA description.",
        "topic_number": topic_number,
        "topics": [{"topic_number": topic_number, "topic_title": title, "description": title}],
        "poc_name": "Probe POC",
        "poc_email": "probe@example.gov",
    }


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_baa_topics_group_under_one_multi_topic_parent():
    conn = await asyncpg.connect(DATABASE_URL)
    sol_number = f"PROBE-{uuid.uuid4().hex[:8]}"
    topics = [
        _topic(sol_number, f"{sol_number}-T1", "Topic One"),
        _topic(sol_number, f"{sol_number}-T2", "Topic Two"),
    ]
    ing = SbirGovIngester()

    async def fake_fetch(*args):  # base run() calls fetch_page(client, api_key, cursor)
        cursor = args[-1]
        return (([], None) if cursor is not None else (topics, None))

    ing.fetch_page = fake_fetch
    try:
        await ing.run(conn, run_type="manual")

        # Exactly ONE parent curated_solicitations, multi_topic, backed by an umbrella opp.
        parents = await conn.fetch(
            "SELECT id, solicitation_type, opportunity_id FROM curated_solicitations "
            "WHERE solicitation_number = $1",
            sol_number,
        )
        assert len(parents) == 1, f"expected 1 grouped parent, got {len(parents)}"
        parent = parents[0]
        assert parent["solicitation_type"] == "multi_topic"
        assert parent["opportunity_id"] is not None, "parent must be backed by an umbrella opp"

        # The umbrella opportunity is inactive (a container, not a fundable unit).
        umbrella = await conn.fetchrow(
            "SELECT is_active, source_id FROM opportunities WHERE id = $1",
            parent["opportunity_id"],
        )
        assert umbrella["is_active"] is False
        assert umbrella["source_id"].endswith("::umbrella")

        # Both topics attach to the parent via solicitation_id, each with its topic_number.
        topic_rows = await conn.fetch(
            "SELECT topic_number FROM opportunities WHERE solicitation_id = $1 "
            "AND source_id NOT LIKE '%::umbrella' ORDER BY topic_number",
            parent["id"],
        )
        got = [r["topic_number"] for r in topic_rows]
        assert got == [f"{sol_number}-T1", f"{sol_number}-T2"], got

        # No stray per-topic 'single' rows (the old degraded behavior).
        singles = await conn.fetchval(
            "SELECT count(*) FROM curated_solicitations cs "
            "JOIN opportunities o ON o.id = cs.opportunity_id "
            "WHERE cs.solicitation_type = 'single' AND o.solicitation_number = $1",
            sol_number,
        )
        assert singles == 0, f"expected no per-topic single rows, got {singles}"
    finally:
        # Clean up (FK-safe): break topic→parent links, drop the parent, then the opps.
        await conn.execute(
            "UPDATE opportunities SET solicitation_id = NULL WHERE solicitation_number = $1",
            sol_number,
        )
        await conn.execute(
            "DELETE FROM curated_solicitations WHERE solicitation_number = $1", sol_number
        )
        await conn.execute(
            "DELETE FROM opportunities WHERE solicitation_number = $1", sol_number
        )
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_two_baas_get_distinct_umbrellas_no_hash_collision():
    """Two different BAAs in one run must NOT collide on the umbrella content_hash.

    The umbrella hash is derived from _hash(); a first cut passed only {source} so both
    umbrellas hashed identically and the SECOND BAA tripped opportunities_content_hash_key
    (unique), silently degrading it back to per-topic 'single' rows. This guards that.
    """
    conn = await asyncpg.connect(DATABASE_URL)
    a = f"PROBE-{uuid.uuid4().hex[:8]}"
    b = f"PROBE-{uuid.uuid4().hex[:8]}"
    items = [
        _topic(a, f"{a}-T1", "A One"), _topic(a, f"{a}-T2", "A Two"),
        _topic(b, f"{b}-T1", "B One"), _topic(b, f"{b}-T2", "B Two"),
    ]
    ing = SbirGovIngester()

    async def fake_fetch(*args):
        return (([], None) if args[-1] is not None else (items, None))

    ing.fetch_page = fake_fetch
    try:
        await ing.run(conn, run_type="manual")
        for sol_number in (a, b):
            parents = await conn.fetch(
                "SELECT solicitation_type FROM curated_solicitations WHERE solicitation_number = $1",
                sol_number,
            )
            assert len(parents) == 1 and parents[0]["solicitation_type"] == "multi_topic", \
                f"{sol_number}: expected one multi_topic parent, got {[p['solicitation_type'] for p in parents]}"
        # Two distinct umbrella opportunities exist.
        umbrellas = await conn.fetchval(
            "SELECT count(*) FROM opportunities WHERE source_id = ANY($1::text[])",
            [f"{a}::umbrella", f"{b}::umbrella"],
        )
        assert umbrellas == 2, f"expected 2 distinct umbrellas, got {umbrellas}"
    finally:
        for sol_number in (a, b):
            await conn.execute(
                "UPDATE opportunities SET solicitation_id = NULL WHERE solicitation_number = $1",
                sol_number,
            )
            await conn.execute(
                "DELETE FROM curated_solicitations WHERE solicitation_number = $1", sol_number
            )
            await conn.execute(
                "DELETE FROM opportunities WHERE solicitation_number = $1", sol_number
            )
        await conn.close()
