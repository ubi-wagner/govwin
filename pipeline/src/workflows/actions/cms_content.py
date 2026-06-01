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

NOTE:   draft_content generates the body with Claude, mirroring the CMS
        content_generator contract (same system prompt + JSON shape:
        title/excerpt/body/tags/meta). It falls back to the overlay `brief` as the
        body when no ANTHROPIC_API_KEY is set or generation fails, so the vertical
        works with or without a key and a model hiccup never hard-fails the draft.

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

import json
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

# Mirror the CMS content_generator's contract so a draft body matches its voice and
# JSON shape (title/excerpt/body/tags/meta). Keep in sync with
# services/cms/src/workers/content_generator.py.
_DEFAULT_SYSTEM_PROMPT = (
    "You are a content writer for the SBIR Engine. Write clear, actionable content "
    "for small businesses pursuing federal R&D funding. Use short sentences. Be specific. "
    "No fluff. Focus on SBIR/STTR, proposal writing, and federal procurement strategy."
)
_JSON_OUTPUT_INSTRUCTIONS = (
    'Respond with a JSON object containing:\n'
    '- "title": string (compelling, SEO-friendly)\n'
    '- "excerpt": string (1-2 sentences, hooks the reader)\n'
    '- "body": string (full article in markdown format, 400-800 words)\n'
    '- "tags": array of strings (3-6 relevant tags)\n'
    '- "meta_title": string (for SEO, under 60 chars)\n'
    '- "meta_description": string (for SEO, under 160 chars)\n\n'
    'Return ONLY valid JSON, no markdown fences.'
)


def _slugify(text: str) -> str:
    out = "".join(c if c.isalnum() else "-" for c in (text or "").lower()).strip("-")
    while "--" in out:
        out = out.replace("--", "-")
    return out[:80] or f"draft-{uuid.uuid4().hex[:8]}"


async def _generate_body(brief: str, content_type: str) -> Optional[dict[str, Any]]:
    """Generate article fields with Claude, mirroring the CMS content_generator
    contract: {title, excerpt, body, tags, meta_title, meta_description}.

    Returns None — caller falls back to the brief as the body — when no
    ANTHROPIC_API_KEY is configured, the brief is empty, or generation/parse fails.
    So the vertical works with or without a key, and a model hiccup never hard-fails
    the draft step (the human still gets a reviewable draft).
    """
    if not (brief or "").strip():
        return None
    try:
        from config import ANTHROPIC_API_KEY, CLAUDE_MODEL
    except Exception:
        return None
    if not ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
        category = (content_type or "blog_post").replace("_", " ")
        user = (
            f"Write a {category} article.\n\n"
            f"Topic/instructions: {brief}\n\n"
            f"{_JSON_OUTPUT_INSTRUCTIONS}"
        )
        resp = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=4096,
            temperature=0.7,
            system=_DEFAULT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user}],
        )
        text = resp.content[0].text if resp.content else ""
        json_text = text.strip()
        if json_text.startswith("```"):
            json_text = json_text.split("\n", 1)[1] if "\n" in json_text else json_text[3:]
            if json_text.endswith("```"):
                json_text = json_text[:-3]
            json_text = json_text.strip()
        data = json.loads(json_text)
        if not isinstance(data, dict) or not data.get("body"):
            return None
        return data
    except Exception as exc:
        log.error("draft_content: AI generation failed, falling back to brief: %s", exc)
        return None


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
    tag_list = [str(t)[:60] for t in (tags or [])][:20]
    excerpt_val = excerpt

    # Generate the body with Claude (reusing the CMS content_generator contract).
    # Falls back to the brief as the body when no key is configured or generation
    # fails, so the vertical works with or without AI and never hard-fails here.
    body = (brief or "").strip()
    meta: dict[str, Any] = {"generated": False}
    generated = False
    gen = await _generate_body(brief, ctype)
    if gen:
        generated = True
        body = (gen.get("body") or body).strip()
        if not excerpt_val:
            excerpt_val = gen.get("excerpt")
        if not tag_list:
            tag_list = [str(t)[:60] for t in (gen.get("tags") or [])][:20]
        meta = {
            "generated": True,
            "generator": "draft_content",
            "metaTitle": gen.get("meta_title"),
            "metaDescription": gen.get("meta_description"),
        }

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
                false, 'pending', $9::jsonb, $10, now(), now())
        ON CONFLICT (slug) DO UPDATE
            SET title = EXCLUDED.title,
                content_type = EXCLUDED.content_type,
                body = EXCLUDED.body,
                excerpt = EXCLUDED.excerpt,
                author = EXCLUDED.author,
                tags = EXCLUDED.tags,
                metadata = EXCLUDED.metadata,
                status = 'pending',
                published = false,
                updated_at = now()
        RETURNING id::text AS id
        """,
        uuid.uuid4(), slug_val, title, ctype, body, excerpt_val, author, tag_list,
        json.dumps(meta), created_by_uuid,
    )
    content_id = row["id"] if row else None

    try:
        await emit_event(
            conn, namespace="library", type="content.drafted", phase="single",
            payload={"contentId": content_id, "slug": slug_val, "contentType": ctype,
                     "status": "pending", "generated": generated},
        )
    except Exception as exc:
        log.error("draft_content: failed to emit content.drafted: %s", exc)

    log.info("draft_content: pending cms_content %s (slug=%s, generated=%s)",
             content_id, slug_val, generated)
    return {"contentId": content_id, "slug": slug_val, "status": "pending",
            "contentType": ctype, "generated": generated}


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
