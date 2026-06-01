"""
================================================================================
Workflow Actions: CMS content draft + publish (the content vertical)
================================================================================

WHO:    Called by the OnCmsContentRequested workflow (the keystone CMS vertical).

WHAT:   draft_content writes a PENDING cms_content row from the launch overlay;
        the workflow then parks at a review ToDo; publish_content flips the
        approved row live once the reviewer completes that task. Together they
        prove the keystone chain end to end: launch-with-overlay -> draft ->
        human review (ledger task + nudges) -> publish.

WHY:    The template definition is code (on_cms_content_requested.py; revision
        control = filename), the process_templates row is its activation/audit
        switch, and the overlay is the frozen process_instances.payload. This
        vertical is the smallest real content lifecycle that exercises all of it.

NOTE:   The actual AI body-generation already lives in the CMS content_generator
        worker (services/cms). This action seeds the reviewable draft body from
        the overlay's `brief` and is the exact slot where a Claude call can later
        replace the seed — the gate + lifecycle is what the keystone proves, not
        the model invocation.

ERROR HANDLING:
    - draft_content is idempotent on slug (ON CONFLICT re-drafts, never 500s on
      the UNIQUE(slug) constraint); off-list content_type falls back to a safe
      default so the CHECK constraint never trips.
    - publish_content matches only rows still in ('pending','draft'); an already-
      published / missing row returns {published: False, reason} (not an error).
    - Event emission is best-effort (wrapped) — a failed emit never fails the step.
================================================================================
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

import asyncpg

from events import emit_event

log = logging.getLogger("pipeline.workflows.actions.cms_content")

# cms_content.content_type is CHECK-constrained (migration 031). Fall back to a
# safe member if the overlay supplies something off-list.
_ALLOWED_CONTENT_TYPES = {
    "blog_post", "resource", "guide", "announcement", "faq",
    "testimonial", "team_member", "social_post", "page_block",
}
_DEFAULT_CONTENT_TYPE = "blog_post"


def _slugify(text: str) -> str:
    out = "".join(c if c.isalnum() else "-" for c in (text or "").lower()).strip("-")
    while "--" in out:
        out = out.replace("--", "-")
    return out[:80] or f"draft-{uuid.uuid4().hex[:8]}"


async def draft_content(
    conn: asyncpg.Connection,
    *,
    title: str,
    brief: str = "",
    content_type: str = _DEFAULT_CONTENT_TYPE,
    slug: Optional[str] = None,
    excerpt: Optional[str] = None,
    author: Optional[str] = None,
    tags: Optional[list[str]] = None,
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    """Create (or re-draft) a PENDING cms_content row from the launch overlay.

    status='pending' = awaiting human review; published stays false. Idempotent on
    slug: re-launching the same slug re-drafts the existing row rather than failing
    the UNIQUE(slug) constraint. Returns contentId + slug for the downstream review
    and publish steps.
    """
    title = (title or "").strip()[:500] or "Untitled draft"
    ctype = content_type if content_type in _ALLOWED_CONTENT_TYPES else _DEFAULT_CONTENT_TYPE
    slug_val = (slug or _slugify(title))[:200]
    body = (brief or "").strip()  # seed body from the brief; AI fill is a follow-up
    tag_list = [str(t)[:60] for t in (tags or [])][:20]

    created_by_uuid: Optional[uuid.UUID] = None
    if created_by:
        try:
            created_by_uuid = uuid.UUID(created_by)
        except (ValueError, AttributeError):
            created_by_uuid = None

    row = await conn.fetchrow(
        """
        INSERT INTO cms_content
            (id, slug, title, content_type, body, excerpt, author, tags,
             published, status, metadata, created_by, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                false, 'pending', '{}'::jsonb, $9, now(), now())
        ON CONFLICT (slug) DO UPDATE
            SET title = EXCLUDED.title,
                content_type = EXCLUDED.content_type,
                body = EXCLUDED.body,
                excerpt = EXCLUDED.excerpt,
                author = EXCLUDED.author,
                tags = EXCLUDED.tags,
                status = 'pending',
                published = false,
                updated_at = now()
        RETURNING id::text AS id
        """,
        uuid.uuid4(), slug_val, title, ctype, body, excerpt, author, tag_list,
        created_by_uuid,
    )
    content_id = row["id"] if row else None

    try:
        await emit_event(
            conn, namespace="library", type="content.drafted", phase="single",
            payload={"contentId": content_id, "slug": slug_val,
                     "contentType": ctype, "status": "pending"},
        )
    except Exception as exc:
        log.error("draft_content: failed to emit content.drafted: %s", exc)

    log.info("draft_content: pending cms_content %s (slug=%s)", content_id, slug_val)
    return {"contentId": content_id, "slug": slug_val, "status": "pending",
            "contentType": ctype}


async def publish_content(
    conn: asyncpg.Connection,
    *,
    content_id: Optional[str] = None,
    slug: Optional[str] = None,
) -> dict[str, Any]:
    """Publish an approved draft: status->'published', published=true, published_at=now().

    Reached only after the review ToDo is completed — completing the task IS the
    approval; rejection is a cancel / force-fail of the instance, not a publish.
    Matches by content_id when present, else by slug. Emits library:content.published.
    """
    if not content_id and not slug:
        return {"published": False, "reason": "no_target"}

    row = None
    if content_id:
        try:
            cid = uuid.UUID(content_id)
        except (ValueError, AttributeError):
            return {"published": False, "reason": "bad_content_id"}
        row = await conn.fetchrow(
            """
            UPDATE cms_content
            SET status = 'published', published = true,
                published_at = now(), updated_at = now()
            WHERE id = $1 AND status IN ('pending', 'draft')
            RETURNING id::text AS id, slug
            """,
            cid,
        )
    else:
        row = await conn.fetchrow(
            """
            UPDATE cms_content
            SET status = 'published', published = true,
                published_at = now(), updated_at = now()
            WHERE slug = $1 AND status IN ('pending', 'draft')
            RETURNING id::text AS id, slug
            """,
            slug,
        )

    if not row:
        # Already published or not found — not an error, just nothing to do.
        log.info("publish_content: nothing to publish (content_id=%s slug=%s)",
                 content_id, slug)
        return {"published": False, "reason": "not_pending_or_missing",
                "contentId": content_id, "slug": slug}

    published_id = row["id"]
    published_slug = row["slug"]
    try:
        await emit_event(
            conn, namespace="library", type="content.published", phase="single",
            payload={"contentId": published_id, "slug": published_slug},
        )
    except Exception as exc:
        log.error("publish_content: failed to emit content.published: %s", exc)

    log.info("publish_content: published cms_content %s (slug=%s)",
             published_id, published_slug)
    return {"published": True, "contentId": published_id, "slug": published_slug}
