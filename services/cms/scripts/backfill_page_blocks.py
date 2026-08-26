"""
One-time backfill: copy existing page_block rows from Main Postgres cms_content
(the public reference) into CMS Postgres cms_posts (the editing + version store).

After Phase 2, the page-block editor reads/writes cms_posts and publish bridges
back to cms_content. This seeds cms_posts so the editor opens with the content
that is currently live. Idempotent on slug — safe to re-run.

Usage (from services/cms):
    SHARED_DATABASE_URL=...  CMS_DATABASE_URL=...  python -m scripts.backfill_page_blocks

Run it once after migration 010 has been applied to CMS_DATABASE_URL.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import pathlib

import asyncpg

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("cms.backfill_page_blocks")

# cms_content.status -> cms_posts.status. Post-migration-010 they share a vocab;
# the legacy 'private' state maps to 'archived'.
_STATUS_MAP = {
    "published": "published",
    "draft": "draft",
    "pending": "pending",
    "private": "archived",
    "archived": "archived",
}


async def backfill() -> int:
    shared_url = os.getenv("SHARED_DATABASE_URL") or os.getenv("DATABASE_URL")
    # The resolver, not the raw variable — see src/models/database.py for why the name is a
    # chain during the CMS_DATABASE_URL → CRM_DATABASE rename.
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    from src.models.database import crm_database_url

    cms_url = crm_database_url()
    if not shared_url:
        raise SystemExit("SHARED_DATABASE_URL (or DATABASE_URL) is required")
    if not cms_url:
        raise SystemExit("CRM_DATABASE is required")

    shared = await asyncpg.connect(shared_url)
    cms = await asyncpg.connect(cms_url)
    copied = 0
    try:
        rows = await shared.fetch(
            """
            SELECT slug, title, body, excerpt, author, tags, status,
                   COALESCE(metadata, '{}'::jsonb) AS metadata,
                   COALESCE(display_order, 0) AS display_order,
                   featured_image, published_at
            FROM cms_content
            WHERE content_type = 'page_block'
            ORDER BY display_order ASC
            """
        )
        for r in rows:
            status = _STATUS_MAP.get(r["status"], "draft")
            meta = r["metadata"]
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except (json.JSONDecodeError, TypeError):
                    meta = {}
            await cms.execute(
                """
                INSERT INTO cms_posts
                    (slug, title, body, excerpt, category, tags, status,
                     metadata, display_order, author_name, featured_image_url,
                     published_at, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'page_block', $5, $6,
                        $7::jsonb, $8, $9, $10, $11, now(), now())
                ON CONFLICT (slug) DO UPDATE SET
                    title = EXCLUDED.title,
                    body = EXCLUDED.body,
                    excerpt = EXCLUDED.excerpt,
                    tags = EXCLUDED.tags,
                    status = EXCLUDED.status,
                    metadata = EXCLUDED.metadata,
                    display_order = EXCLUDED.display_order,
                    featured_image_url = EXCLUDED.featured_image_url,
                    updated_at = now()
                """,
                r["slug"], r["title"] or "", r["body"] or "", r["excerpt"],
                list(r["tags"] or []), status, json.dumps(meta),
                r["display_order"], r["author"], r["featured_image"],
                r["published_at"],
            )
            copied += 1
        log.info("backfill_page_blocks: upserted %d page block(s) into cms_posts", copied)
        return copied
    finally:
        await shared.close()
        await cms.close()


if __name__ == "__main__":
    asyncio.run(backfill())
