"""Real-DB integration test for the page-block publish bridge (cms_posts -> cms_content).

Skipped unless BOTH TEST_DATABASE_URL (Main/shared DB) and TEST_CMS_DATABASE_URL
(CMS DB) are set. Exercises the real `_bridge_publish` SQL across two databases:
a saved draft leaves the live row untouched, publish carries it to the public
reference, editing bookkeeping is stripped from the public copy but kept in
cms_posts, and display order is preserved.

The fixture creates the minimal cms_posts / cms_content shapes the code touches
(CREATE/ALTER ... IF NOT EXISTS), so it runs against a blank OR a migrated DB,
under an isolated test page tag it cleans up afterward. No jsonb codec is set —
matching the app pools, which manually json.dumps (so fetched metadata is a
JSON string the code/tests parse).
"""
import json
import os
import uuid

import pytest

asyncpg = pytest.importorskip("asyncpg")

SHARED_URL = os.getenv("TEST_DATABASE_URL")
CMS_URL = os.getenv("TEST_CMS_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not (SHARED_URL and CMS_URL),
    reason="set TEST_DATABASE_URL and TEST_CMS_DATABASE_URL to run real-DB tests",
)

_PAGE = "itest_" + uuid.uuid4().hex[:8]

_CMS_POSTS_DDL = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    """CREATE TABLE IF NOT EXISTS cms_posts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE, title text NOT NULL DEFAULT '',
        body text NOT NULL DEFAULT '', excerpt text,
        category text NOT NULL DEFAULT 'page_block', tags text[] NOT NULL DEFAULT '{}',
        status text NOT NULL DEFAULT 'draft', author_name text, author_email text,
        featured_image_url text, published_at timestamptz,
        metadata jsonb NOT NULL DEFAULT '{}', display_order int NOT NULL DEFAULT 0,
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now())""",
    "ALTER TABLE cms_posts ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'",
    "ALTER TABLE cms_posts ADD COLUMN IF NOT EXISTS display_order int NOT NULL DEFAULT 0",
]

_CMS_CONTENT_DDL = [
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    """CREATE TABLE IF NOT EXISTS cms_content (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug text NOT NULL UNIQUE, title text NOT NULL DEFAULT '',
        content_type text NOT NULL DEFAULT 'page_block', body text NOT NULL DEFAULT '',
        excerpt text, author text, tags text[] NOT NULL DEFAULT '{}',
        published boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'draft',
        published_at timestamptz, featured_image text, external_url text,
        display_order int NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now())""",
    "ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS display_order int NOT NULL DEFAULT 0",
    "ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'",
]


@pytest.fixture
async def conns():
    cms = await asyncpg.connect(CMS_URL)
    shared = await asyncpg.connect(SHARED_URL)
    for stmt in _CMS_POSTS_DDL:
        await cms.execute(stmt)
    for stmt in _CMS_CONTENT_DDL:
        await shared.execute(stmt)

    async def _cleanup():
        await cms.execute("DELETE FROM cms_posts WHERE $1 = ANY(tags)", _PAGE)
        await shared.execute("DELETE FROM cms_content WHERE $1 = ANY(tags)", _PAGE)

    await _cleanup()
    try:
        yield cms, shared
    finally:
        await _cleanup()
        await cms.close()
        await shared.close()


async def _seed(cms, slug, section, order, *, body, metadata=None):
    await cms.execute(
        """INSERT INTO cms_posts (slug, title, body, category, tags, status, metadata, display_order)
           VALUES ($1, $2, $3, 'page_block', $4, 'draft', $5::jsonb, $6)""",
        slug, section.title(), body, [_PAGE, section], json.dumps(metadata or {}), order,
    )


async def test_publish_bridges_and_keeps_live_stable(conns):
    from src.routers.page_blocks import _bridge_publish
    cms, shared = conns
    hero, cta = f"{_PAGE}-hero", f"{_PAGE}-cta"
    await _seed(cms, hero, "hero", 0, body="orig hero", metadata={"cta_text": "A"})
    await _seed(cms, cta, "cta", 1, body="orig cta")

    statuses = ("draft", "pending", "published")

    # First publish: both drafts go live.
    assert await _bridge_publish(cms, shared, page=_PAGE, from_statuses=statuses) == 2
    assert await shared.fetchval("SELECT body FROM cms_content WHERE slug=$1", hero) == "orig hero"

    # Save an edit -> draft, with editing bookkeeping in metadata.
    await cms.execute(
        """UPDATE cms_posts SET body='edited hero', status='draft',
               metadata='{"cta_text":"B","_versions":[1],"_currentVersion":2,"_draftedBy":"x"}'::jsonb
           WHERE slug=$1""",
        hero,
    )
    # The live row is UNCHANGED until publish — the core guarantee.
    assert await shared.fetchval("SELECT body FROM cms_content WHERE slug=$1", hero) == "orig hero"

    # Publish -> live updated; editing bookkeeping stripped from the public copy.
    await _bridge_publish(cms, shared, page=_PAGE, from_statuses=statuses)
    row = await shared.fetchrow("SELECT body, status, metadata FROM cms_content WHERE slug=$1", hero)
    pub_meta = json.loads(row["metadata"])
    assert row["body"] == "edited hero" and row["status"] == "published"
    assert pub_meta == {"cta_text": "B"}  # _versions / _currentVersion / _draftedBy removed

    # Version history is retained on the CMS side (cms_posts), not the public copy.
    cms_meta = json.loads(await cms.fetchval("SELECT metadata FROM cms_posts WHERE slug=$1", hero))
    assert "_versions" in cms_meta

    # Order preserved on the public reference.
    orders = await shared.fetch(
        "SELECT display_order FROM cms_content WHERE $1 = ANY(tags) ORDER BY display_order", _PAGE)
    assert [r["display_order"] for r in orders] == [0, 1]


async def test_republish_is_idempotent(conns):
    from src.routers.page_blocks import _bridge_publish
    cms, shared = conns
    slug = f"{_PAGE}-solo"
    await _seed(cms, slug, "hero", 0, body="solo")
    statuses = ("draft", "pending", "published")
    await _bridge_publish(cms, shared, page=_PAGE, from_statuses=statuses)
    await _bridge_publish(cms, shared, page=_PAGE, from_statuses=statuses)
    assert await shared.fetchval("SELECT count(*) FROM cms_content WHERE $1 = ANY(tags)", _PAGE) == 1
