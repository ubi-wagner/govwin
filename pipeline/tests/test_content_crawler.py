"""The content/opportunity crawler worker feeds the scouts: reads enabled scout_sources,
fetches via a pluggable fetcher, writes deduped scout_findings + a scout_runs history row with
outcome. Drive-tested against the sandbox DB with a stub fetcher (no network) — proving the
crawl → findings → history → outcome loop and idempotent dedup end-to-end."""
import os
import uuid

import asyncpg
import pytest

from workers.content_crawler import crawl_all, crawl_source, dedup_hash

DATABASE_URL = os.getenv("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")


async def _stub_fetch(_source):
    return [
        {"title": "Agency posts new SBIR topics", "url": "https://x/1", "snippet": "...", "kind": "post"},
        {"title": "Program office update", "url": "https://x/2", "snippet": "...", "kind": "article"},
    ]


@pytest.mark.asyncio
async def test_crawl_writes_findings_run_and_dedups():
    conn = await asyncpg.connect(DATABASE_URL)
    src_id = None
    try:
        src_id = await conn.fetchval(
            """INSERT INTO scout_sources (name, kind, url, purpose, enabled)
               VALUES ('TEST crawler src', 'rss', $1, 'content', true) RETURNING id""",
            f"https://test/{uuid.uuid4()}",
        )
        source = {"id": src_id, "name": "TEST crawler src", "purpose": "content"}

        # First crawl: 2 items → 2 new findings + a completed run.
        res = await crawl_source(conn, source, _stub_fetch)
        assert res["found"] == 2 and res["new"] == 2 and res["status"] == "completed"

        findings = await conn.fetchval("SELECT count(*) FROM scout_findings WHERE source_id = $1", src_id)
        assert findings == 2
        run = await conn.fetchrow(
            "SELECT role, kind, found_count, new_count, status, outcome FROM scout_runs WHERE source_id = $1", src_id)
        assert run["role"] == "scout" and run["kind"] == "crawl"
        assert run["found_count"] == 2 and run["new_count"] == 2 and run["status"] == "completed"

        # Re-crawl the same items: dedup → 0 new (idempotent).
        res2 = await crawl_source(conn, source, _stub_fetch)
        assert res2["found"] == 2 and res2["new"] == 0
        assert await conn.fetchval("SELECT count(*) FROM scout_findings WHERE source_id = $1", src_id) == 2

        # A failing fetcher is recorded as a failed run, not raised.
        async def _boom(_s):
            raise RuntimeError("network down")
        res3 = await crawl_source(conn, source, _boom)
        assert res3["status"] == "failed"
    finally:
        if src_id is not None:
            await conn.execute("DELETE FROM scout_findings WHERE source_id = $1", src_id)
            await conn.execute("DELETE FROM scout_runs WHERE source_id = $1", src_id)
            await conn.execute("DELETE FROM scout_sources WHERE id = $1", src_id)
        await conn.close()


def test_dedup_hash_stable():
    a = dedup_hash("s1", "https://u", "t")
    b = dedup_hash("s1", "https://u", "t")
    c = dedup_hash("s1", "https://u", "different")
    assert a == b and a != c
