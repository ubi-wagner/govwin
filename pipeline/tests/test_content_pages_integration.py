"""Real-DB integration test for the V8 content_pages store (page-versioned content).

Skipped unless TEST_DATABASE_URL is set. Validates the save -> publish lifecycle the
frontend content-admin lib performs against real Postgres: each save is a new draft
version; publish promotes the latest draft to the single active version and archives
the prior active + intermediate drafts; editing a draft never moves the live row; the
public read sees the new active content. Uses an isolated page_key it cleans up.
"""
import json
import os
import uuid

import pytest

asyncpg = pytest.importorskip("asyncpg")

URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not URL, reason="set TEST_DATABASE_URL to run real-DB tests")

_DDL = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    """CREATE TABLE IF NOT EXISTS content_pages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        page_key text NOT NULL, content_type text NOT NULL DEFAULT 'page',
        version_no int NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'draft',
        title text, blocks jsonb NOT NULL DEFAULT '[]', metadata jsonb NOT NULL DEFAULT '{}',
        audit_note text, created_by text, created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz, archived_at timestamptz)""",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pages_active ON content_pages (page_key) WHERE status='active'",
]


async def _save_draft(conn, page_key, blocks, note):
    # Mirrors content-admin.saveDraft: a new draft version (max+1) for the page.
    return await conn.fetchrow(
        """
        INSERT INTO content_pages (page_key, content_type, version_no, status, title, blocks, audit_note, created_by)
        VALUES ($1, 'page',
                (SELECT COALESCE(max(version_no), 0) + 1 FROM content_pages WHERE page_key = $1),
                'draft', $1, $2::jsonb, $3, 'tester')
        RETURNING id, version_no
        """,
        page_key, json.dumps(blocks), note,
    )


async def _publish(conn, page_key):
    # Mirrors content-admin.publishPage: promote latest draft, archive prior active + drafts.
    async with conn.transaction():
        draft = await conn.fetchrow(
            "SELECT id, version_no FROM content_pages WHERE page_key=$1 AND status='draft' ORDER BY version_no DESC LIMIT 1",
            page_key,
        )
        if not draft:
            return None
        await conn.execute(
            "UPDATE content_pages SET status='archived', archived_at=now() "
            "WHERE page_key=$1 AND status IN ('active','draft') AND id <> $2",
            page_key, draft["id"],
        )
        await conn.execute(
            "UPDATE content_pages SET status='active', published_at=now() WHERE id=$1",
            draft["id"],
        )
        return draft["version_no"]


@pytest.fixture
async def conn():
    c = await asyncpg.connect(URL)
    for stmt in _DDL:
        await c.execute(stmt)
    page_key = "itest_page_" + uuid.uuid4().hex[:8]
    try:
        yield c, page_key
    finally:
        await c.execute("DELETE FROM content_pages WHERE page_key=$1", page_key)
        await c.close()


async def test_save_publish_lifecycle(conn):
    c, page_key = conn

    # Save + publish v1.
    await _save_draft(c, page_key, [{"section": "hero", "displayOrder": 0, "title": "V1", "body": "one"}], "first")
    assert await _publish(c, page_key) == 1

    # Edit: save v2 draft — the live row must stay v1 until publish.
    await _save_draft(c, page_key, [{"section": "hero", "displayOrder": 0, "title": "V2", "body": "two"}], "second")
    live_before = await c.fetchval(
        "SELECT (blocks->0->>'title') FROM content_pages WHERE page_key=$1 AND status='active'", page_key)
    assert live_before == "V1"

    # Publish v2.
    assert await _publish(c, page_key) == 2
    rows = await c.fetch("SELECT version_no, status FROM content_pages WHERE page_key=$1 ORDER BY version_no", page_key)
    assert [(r["version_no"], r["status"]) for r in rows] == [(1, "archived"), (2, "active")]
    assert await c.fetchval(
        "SELECT (blocks->0->>'title') FROM content_pages WHERE page_key=$1 AND status='active'", page_key) == "V2"
    # exactly one active (the partial unique index holds)
    assert await c.fetchval(
        "SELECT count(*) FROM content_pages WHERE page_key=$1 AND status='active'", page_key) == 1


async def test_publish_without_draft_is_noop(conn):
    c, page_key = conn
    assert await _publish(c, page_key) is None
