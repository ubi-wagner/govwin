"""
================================================================================
Workflow Actions: CMS content draft + publish (the content vertical)
================================================================================

WHO:    Called by the OnCmsContentRequested workflow (the keystone CMS vertical).

WHAT:   draft_content writes a DRAFT version into the unified content_pages store
        (V8) from the launch overlay; the workflow then parks at a review ToDo;
        publish_content promotes the approved draft to 'active' once the reviewer
        completes that task. Together they prove the keystone chain end to end:
        launch-with-overlay -> draft -> human review (ledger task + nudges) ->
        publish. Generated content lands in the same content_pages document store
        the admin Site Content editor reads, so AI drafts and hand-written drafts
        share one lifecycle (V8 consolidation).

WHY:    The template definition is code (on_cms_content_requested.py; revision
        control = filename), the process_templates row is its activation/audit
        switch, and the overlay is the frozen process_instances.payload. This
        vertical is the smallest real content lifecycle that exercises all of it.

CONTENT MODEL (V8):
    Each save is a whole-document snapshot: a new content_pages row for
    (page_key=slug, content_type) at version_no = max+1, status='draft'. The body
    rides in a single 'body' block; tags/excerpt/author/SEO ride in metadata.
    Publish promotes one draft to 'active' and archives the prior active + sibling
    drafts, so the partial-unique index (one active per content_type+page_key)
    always holds and editing never mutates the live row.

NOTE:   draft_content generates the body with Claude, mirroring the CMS
        content_generator contract (same system prompt + JSON shape:
        title/excerpt/body/tags/meta). It falls back to the overlay `brief` as the
        body when no ANTHROPIC_API_KEY is set or generation fails, so the vertical
        works with or without a key and a model hiccup never hard-fails the draft.

ERROR HANDLING:
    - draft_content always adds a new draft version (snapshot model, never an
      in-place mutation); off-list content_type falls back to a safe default so the
      CHECK constraint never trips.
    - publish_content matches only rows still in ('draft','pending'); an already-
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
from sdk_compat import sampling_kwargs

log = logging.getLogger("pipeline.workflows.actions.cms_content")

# content_pages document types (V8). 'page' is reserved for marketing pages;
# generated content defaults to blog_post when the overlay supplies an off-list
# type, so the content_type CHECK on content_pages never trips (migration 057).
_CONTENT_PAGES_DOC_TYPES = {"blog_post", "resource", "guide", "testimonial", "team_member"}
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
            # `temperature` only where the installed SDK still accepts it (src/sdk_compat.py).
            # anthropic 1.0.0 dropped it, and because the except-branch below falls back to the
            # brief on ANY exception, this call failing looked from the outside like a draft that
            # simply chose not to generate — a 100% failure reported as a working feature.
            **sampling_kwargs(0.7),
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
    """Create a DRAFT content_pages document from the launch overlay (V8).

    status='draft' = awaiting human review; promoted to 'active' on publish. Each
    call adds a new draft version for (slug, content_type). The body lives in a
    single block; tags/excerpt/author/SEO ride in metadata. Returns contentId +
    slug + contentType for the downstream review and publish steps. AI generation
    falls back to the brief when no key is configured.
    """
    title = (title or "").strip()[:500] or "Untitled draft"
    ctype = content_type if content_type in _CONTENT_PAGES_DOC_TYPES else "blog_post"
    slug_val = (slug or _slugify(title))[:200]
    tag_list = [str(t)[:60] for t in (tags or [])][:20]
    excerpt_val = excerpt

    # Generate the body with Claude (reusing the CMS content_generator contract).
    # Falls back to the brief as the body when no key is configured or generation
    # fails, so the vertical works with or without AI and never hard-fails here.
    body = (brief or "").strip()
    generated = False
    gen_meta: dict[str, Any] = {}
    gen = await _generate_body(brief, ctype)
    if gen:
        generated = True
        body = (gen.get("body") or body).strip()
        if not excerpt_val:
            excerpt_val = gen.get("excerpt")
        if not tag_list:
            tag_list = [str(t)[:60] for t in (gen.get("tags") or [])][:20]
        gen_meta = {"metaTitle": gen.get("meta_title"), "metaDescription": gen.get("meta_description")}

    blocks = [{"section": "body", "title": title, "body": body, "excerpt": excerpt_val, "metadata": {}}]
    metadata = {"tags": tag_list, "excerpt": excerpt_val, "author": author,
                "generated": generated, "generator": "draft_content", **gen_meta}

    row = await conn.fetchrow(
        """
        INSERT INTO content_pages
            (page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by)
        VALUES ($1, $2,
                (SELECT COALESCE(max(version_no), 0) + 1 FROM content_pages WHERE page_key = $1 AND content_type = $2),
                'draft', $3, $4::jsonb, $5::jsonb, 'AI draft', $6)
        RETURNING id::text AS id
        """,
        slug_val, ctype, title, json.dumps(blocks), json.dumps(metadata), created_by,
    )
    content_id = row["id"] if row else None

    try:
        await emit_event(
            conn, namespace="library", type="content.drafted", phase="single",
            payload={"contentId": content_id, "slug": slug_val, "contentType": ctype,
                     "status": "draft", "generated": generated},
        )
    except Exception as exc:
        log.error("draft_content: failed to emit content.drafted: %s", exc)

    log.info("draft_content: draft content_pages %s (slug=%s, type=%s, generated=%s)",
             content_id, slug_val, ctype, generated)
    return {"contentId": content_id, "slug": slug_val, "status": "draft",
            "contentType": ctype, "generated": generated}


async def publish_content(
    conn: asyncpg.Connection,
    *,
    content_id: Optional[str] = None,
    slug: Optional[str] = None,
) -> dict[str, Any]:
    """Publish an approved draft: promote the content_pages draft -> active and
    archive the prior active + other drafts for that (page_key, content_type) (V8).

    Reached only after the review ToDo is completed — completing the task IS the
    approval; rejection is a cancel / force-fail of the instance, not a publish.
    Matches by content_id when present, else the latest draft for slug. Emits
    library:content.published.
    """
    if not content_id and not slug:
        return {"published": False, "reason": "no_target"}

    if content_id:
        try:
            cid = uuid.UUID(content_id)
        except (ValueError, AttributeError):
            return {"published": False, "reason": "bad_content_id"}
        target = await conn.fetchrow(
            "SELECT id, page_key, content_type FROM content_pages "
            "WHERE id = $1 AND status IN ('draft', 'pending')",
            cid,
        )
    else:
        target = await conn.fetchrow(
            "SELECT id, page_key, content_type FROM content_pages "
            "WHERE page_key = $1 AND status = 'draft' ORDER BY version_no DESC LIMIT 1",
            slug,
        )

    if not target:
        # Already published or not found — not an error, just nothing to do.
        log.info("publish_content: nothing to publish (content_id=%s slug=%s)",
                 content_id, slug)
        return {"published": False, "reason": "not_pending_or_missing",
                "contentId": content_id, "slug": slug}

    async with conn.transaction():
        await conn.execute(
            "UPDATE content_pages SET status = 'archived', archived_at = now() "
            "WHERE page_key = $1 AND content_type = $2 AND status IN ('active', 'draft') AND id <> $3",
            target["page_key"], target["content_type"], target["id"],
        )
        await conn.execute(
            "UPDATE content_pages SET status = 'active', published_at = now() WHERE id = $1",
            target["id"],
        )

    published_id = str(target["id"])
    published_slug = target["page_key"]
    try:
        await emit_event(
            conn, namespace="library", type="content.published", phase="single",
            payload={"contentId": published_id, "slug": published_slug},
        )
    except Exception as exc:
        log.error("publish_content: failed to emit content.published: %s", exc)

    log.info("publish_content: published content_pages %s (slug=%s)",
             published_id, published_slug)
    return {"published": True, "contentId": published_id, "slug": published_slug}
