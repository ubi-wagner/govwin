"""Real-DB integration test for the pipeline CMS content vertical actions.

Skipped unless TEST_DATABASE_URL (the Main/Pipeline DB) is set. Exercises the
real draft_content / publish_content SQL against a live Postgres: draft writes a
pending cms_content row from the brief, publish flips it live, re-publish is a
no-op, and re-drafting the same slug updates in place (ON CONFLICT) rather than
duplicating.

The fixture ensures the minimal cms_content / system_events shapes the actions
touch (CREATE/ALTER ... IF NOT EXISTS) so it runs against a blank OR migrated DB,
under a unique slug it cleans up afterward. AI generation is stubbed off, so the
brief is the body (deterministic, no network).
"""
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
    """CREATE TABLE IF NOT EXISTS cms_content (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE, title text NOT NULL DEFAULT '',
        content_type text NOT NULL DEFAULT 'blog_post', body text NOT NULL DEFAULT '',
        excerpt text, author text, tags text[] NOT NULL DEFAULT '{}',
        published boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'draft',
        published_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}',
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now())""",
    "ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'",
    "ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS created_by uuid",
    """CREATE TABLE IF NOT EXISTS system_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        namespace text, type text, phase text, actor_type text, actor_id text,
        actor_email text, tenant_id uuid, parent_event_id uuid,
        payload jsonb, created_at timestamptz NOT NULL DEFAULT now())""",
]


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
        await c.execute("DELETE FROM cms_content WHERE slug = $1", slug)
        await c.close()


async def test_draft_then_publish_roundtrip(conn):
    from workflows.actions import cms_content
    c, slug = conn

    # draft_content writes a PENDING row; the brief is the body (AI stubbed off).
    out = await cms_content.draft_content(c, title="Why SBIR", brief="A short brief.", slug=slug)
    assert out["status"] == "pending"
    row = await c.fetchrow("SELECT status, published, body FROM cms_content WHERE slug=$1", slug)
    assert row["status"] == "pending" and row["published"] is False
    assert row["body"] == "A short brief."

    # publish_content flips the approved draft live.
    pub = await cms_content.publish_content(c, slug=slug)
    assert pub["published"] is True
    row = await c.fetchrow("SELECT status, published, published_at FROM cms_content WHERE slug=$1", slug)
    assert row["status"] == "published" and row["published"] is True and row["published_at"] is not None

    # Re-publishing an already-live row is a no-op, not an error.
    again = await cms_content.publish_content(c, slug=slug)
    assert again["published"] is False and again["reason"] == "not_pending_or_missing"


async def test_redraft_same_slug_updates_in_place(conn):
    from workflows.actions import cms_content
    c, slug = conn
    await cms_content.draft_content(c, title="First", brief="one", slug=slug)
    await cms_content.draft_content(c, title="Second", brief="two", slug=slug)
    rows = await c.fetch("SELECT title, body, status FROM cms_content WHERE slug=$1", slug)
    assert len(rows) == 1  # ON CONFLICT (slug) re-drafts, does not duplicate
    assert rows[0]["title"] == "Second"
    assert rows[0]["body"] == "two"
    assert rows[0]["status"] == "pending"
