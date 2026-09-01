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


async def test_bridge_refuses_against_a_real_database(conns):
    """The retired bridge refuses, and leaves BOTH databases untouched.

    This file used to assert the opposite against real Postgres: that publishing moved cms_posts
    rows live, stripped editing bookkeeping from the public copy, preserved order, and was
    idempotent on republish. All of that was true, and all of it stopped mattering when
    front-facing content moved to `content_pages` — the bridge then wrote a table the website no
    longer reads, so a publish reported a count and changed nothing a visitor could see.

    Worth knowing WHY this was the last place still asserting the old contract: the file is
    skipif-gated on a live database, so it does not run in the ordinary suite. Three unit tests
    asserting the same behaviour failed loudly and were rewritten; this one was silently skipped,
    and only turned up because `check-cms-content-retirable.mjs` scans the tree for anything that
    still touches the table rather than trusting a green test run.

    The both-databases assertion is the point. A refusal that had already flipped cms_posts to
    published would leave the CMS store believing it had shipped content the public copy never
    received — a half-write is the state nobody can reason about six months later.
    """
    from fastapi import HTTPException
    from src.routers.page_blocks import _bridge_publish
    cms, shared = conns
    hero = f"{_PAGE}-hero"
    await _seed(cms, hero, "hero", 0, body="orig hero", metadata={"cta_text": "A"})

    with pytest.raises(HTTPException) as exc:
        await _bridge_publish(cms, shared, page=_PAGE, from_statuses=("draft", "pending", "published"))

    assert exc.value.status_code == 410
    # The refusal names where content IS authored. An error that only says "no" sends the reader
    # back through a service that is no longer the answer.
    assert "/admin/site" in exc.value.detail and "content_pages" in exc.value.detail

    # Nothing moved, on either side.
    assert await cms.fetchval("SELECT status FROM cms_posts WHERE slug=$1", hero) == "draft"
    assert await shared.fetchval("SELECT count(*) FROM cms_content WHERE slug=$1", hero) == 0
