"""Real-DB integration test for the pipeline CMS content vertical actions (V8).

Skipped unless TEST_DATABASE_URL (the Main/Pipeline DB) is set. Exercises the
real draft_content / publish_content SQL against a live Postgres against the
unified content_pages store:
  - draft writes a DRAFT version (brief is the body, AI stubbed off);
  - re-drafting the same slug adds a NEW version (snapshot model, not in-place);
  - publish promotes the target draft to active and archives prior active +
    sibling drafts, leaving exactly one active row;
  - re-publishing an already-live row is a no-op.

The fixture ensures the minimal content_pages / system_events shapes the actions
touch (CREATE ... IF NOT EXISTS) so it runs against a blank OR migrated DB, under
a unique slug it cleans up afterward. AI generation is stubbed off, so the brief
is the body (deterministic, no network).
"""
import json
import os
import uuid

import pytest
from unittest.mock import AsyncMock

asyncpg = pytest.importorskip("asyncpg")

URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not URL, reason="set TEST_DATABASE_URL to run real-DB tests")

_DDL = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    """CREATE TABLE IF NOT EXISTS content_pages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        page_key text NOT NULL,
        content_type text NOT NULL DEFAULT 'page',
        version_no integer NOT NULL DEFAULT 1,
        status text NOT NULL DEFAULT 'draft',
        title text NOT NULL DEFAULT '',
        blocks jsonb NOT NULL DEFAULT '[]',
        metadata jsonb NOT NULL DEFAULT '{}',
        audit_note text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        archived_at timestamptz)""",
    """CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pages_active
        ON content_pages (content_type, page_key) WHERE status = 'active'""",
    """CREATE TABLE IF NOT EXISTS system_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        namespace text, type text, phase text, actor_type text, actor_id text,
        actor_email text, tenant_id uuid, parent_event_id uuid,
        payload jsonb, created_at timestamptz NOT NULL DEFAULT now())""",
]


def _blocks(row):
    """asyncpg returns jsonb as text unless a codec is registered — decode it."""
    b = row["blocks"]
    return json.loads(b) if isinstance(b, str) else b


@pytest.fixture(autouse=True)
def _no_ai(monkeypatch):
    # Deterministic + no network: draft_content falls back to the brief as body.
    from workflows.actions import cms_content
    monkeypatch.setattr(cms_content, "_generate_body", AsyncMock(return_value=None))


@pytest.fixture
async def conn():
    c = await asyncpg.connect(URL)
    for stmt in _DDL:
        await c.execute(stmt)
    slug = f"itest-{uuid.uuid4().hex[:10]}"
    try:
        yield c, slug
    finally:
        await c.execute("DELETE FROM content_pages WHERE page_key = $1", slug)
        await c.close()


async def test_draft_then_publish_roundtrip(conn):
    from workflows.actions import cms_content
    c, slug = conn

    # draft_content writes a DRAFT version; the brief is the body (AI stubbed off).
    out = await cms_content.draft_content(c, title="Why SBIR", brief="A short brief.", slug=slug)
    assert out["status"] == "draft"
    row = await c.fetchrow(
        "SELECT status, version_no, blocks FROM content_pages "
        "WHERE page_key=$1 AND content_type='blog_post' ORDER BY version_no DESC LIMIT 1",
        slug,
    )
    assert row["status"] == "draft"
    assert _blocks(row)[0]["body"] == "A short brief."

    # publish_content promotes the approved draft to active.
    pub = await cms_content.publish_content(c, slug=slug)
    assert pub["published"] is True
    row = await c.fetchrow(
        "SELECT status, published_at FROM content_pages "
        "WHERE page_key=$1 AND content_type='blog_post' AND status='active'",
        slug,
    )
    assert row is not None and row["published_at"] is not None

    # Re-publishing an already-live row (no remaining draft) is a no-op, not error.
    again = await cms_content.publish_content(c, slug=slug)
    assert again["published"] is False and again["reason"] == "not_pending_or_missing"


async def test_redraft_same_slug_adds_new_version(conn):
    from workflows.actions import cms_content
    c, slug = conn
    await cms_content.draft_content(c, title="First", brief="one", slug=slug)
    await cms_content.draft_content(c, title="Second", brief="two", slug=slug)
    rows = await c.fetch(
        "SELECT version_no, title, status FROM content_pages "
        "WHERE page_key=$1 AND content_type='blog_post' ORDER BY version_no",
        slug,
    )
    # Snapshot model: each draft is a new version (not an in-place update).
    assert [r["version_no"] for r in rows] == [1, 2]
    assert rows[-1]["title"] == "Second"
    assert all(r["status"] == "draft" for r in rows)


async def test_publish_archives_prior_versions(conn):
    from workflows.actions import cms_content
    c, slug = conn
    await cms_content.draft_content(c, title="v1", brief="one", slug=slug)
    d2 = await cms_content.draft_content(c, title="v2", brief="two", slug=slug)

    # Publish the latest draft → it becomes the sole active; the other draft archives.
    pub = await cms_content.publish_content(c, content_id=d2["contentId"], slug=slug)
    assert pub["published"] is True
    rows = await c.fetch(
        "SELECT version_no, status FROM content_pages "
        "WHERE page_key=$1 AND content_type='blog_post'",
        slug,
    )
    statuses = [r["status"] for r in rows]
    assert statuses.count("active") == 1   # exactly one live version (partial-unique safe)
    assert "draft" not in statuses          # sibling draft was archived
