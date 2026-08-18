"""
================================================================================
Action: publish_section_draft  (E5 — the strawman/draft LANDING primitive)
================================================================================

The canonical, deterministic mechanism for landing a generated draft into a
proposal section. Any drafter — the 3-source strawman, the section_drafter AI
agent, or a tool — calls THIS to publish; the generation lives upstream, the
safe landing lives here.

Contract (kwargs from a workflow step's input_map):
    proposal_id  (required) — tenant-bound; the section MUST belong to it
    section_id   (required) — the section to fill
    content      (required) — the draft (canvas-document JSON or text)
    source       (optional) — 'ai' | 'strawman' | 'tool' (default 'strawman')
    ai_model     (optional) — model id, for the version audit
    instruction  (optional) — the prompt/recipe, for the version audit

SAFETY — never clobbers human work. A draft only lands into a section whose
status is 'empty' or 'ai_drafted' (an untouched or previously auto-drafted
section). 'in_progress' / 'complete' / 'approved' are LEFT ALONE (the action
returns skipped). Tenant scope is enforced by requiring the section under the
given proposal_id (which the workflow payload bound to the tenant at launch).

On publish: bumps proposal_sections (content, status='ai_drafted', version+1),
writes a canvas_versions snapshot (the audit + undo point), and emits
proposal:section.drafted. Idempotent enough for re-run: a re-publish of an
already-ai_drafted section just lands a new version (the human hasn't touched it).
================================================================================
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import asyncpg

log = logging.getLogger("pipeline.workflows.actions.publish_section_draft")

_LANDABLE = ("empty", "ai_drafted")


def _counts(content: Any) -> tuple[int, int]:
    """char + word counts for the version audit (best-effort over any shape)."""
    text = content if isinstance(content, str) else json.dumps(content or {})
    return len(text), len(text.split())


async def publish_section_draft(conn: asyncpg.Connection, **inputs: Any) -> dict[str, Any]:
    proposal_id = inputs.get("proposal_id")
    section_id = inputs.get("section_id")
    content = inputs.get("content")
    source = inputs.get("source") or "strawman"
    ai_model = inputs.get("ai_model")
    instruction = inputs.get("instruction")

    if not proposal_id or not section_id or content is None:
        log.warning("publish_section_draft: missing proposal_id/section_id/content — skipping")
        return {"published": False, "skipped": True, "reason": "missing_input"}

    try:
        section_uuid = uuid.UUID(str(section_id))
        proposal_uuid = uuid.UUID(str(proposal_id))
    except (ValueError, AttributeError):
        log.warning("publish_section_draft: malformed section/proposal id — skipping")
        return {"published": False, "skipped": True, "reason": "bad_id"}

    # Tenant/ownership + status gate: the section must belong to this proposal AND
    # be safe to fill (untouched or prior auto-draft). One row, one lock.
    row = await conn.fetchrow(
        """
        SELECT id, status, version, content_source
        FROM proposal_sections
        WHERE id = $1::uuid AND proposal_id = $2::uuid
        FOR UPDATE
        """,
        section_uuid,
        proposal_uuid,
    )
    if row is None:
        log.warning("publish_section_draft: section %s not in proposal %s — skipping", section_id, proposal_id)
        return {"published": False, "skipped": True, "reason": "section_not_found"}
    if row["status"] not in _LANDABLE:
        log.info("publish_section_draft: section %s is '%s' (human-owned) — leaving it alone",
                 section_id, row["status"])
        return {"published": False, "skipped": True, "reason": f"status_{row['status']}"}
    # AUTHORITATIVE anti-clobber guard: a released-UNLOCKED build lets the customer edit an
    # 'ai_drafted' section immediately; a plain content save leaves status='ai_drafted' but stamps
    # content_source='human_edit'. Status alone would still admit it into the landable set and this
    # action would overwrite the human's work (unrecoverably — the prior human content isn't archived
    # here). Refuse the moment a human has touched it, regardless of status. (The save route also
    # advances such a section to 'in_progress'; this is the belt to that suspenders.)
    if row["content_source"] == "human_edit":
        log.info("publish_section_draft: section %s carries a human edit (content_source=human_edit) — leaving it alone", section_id)
        return {"published": False, "skipped": True, "reason": "human_edited"}
    # PROVISIONED MOLD guard: provisioning stamps content_source='template' on sections it fills
    # with an admin-authored mold, the computed cost workbook, or a registry template — all
    # status='ai_drafted', which the landable set would otherwise admit. Those canvases ARE the
    # intended V0 (a slide deck skeleton, a priced workbook); overwriting one with a 1-node
    # letter strawman destroys admin-authored structure seconds after release. Leave them alone.
    if row["content_source"] == "template":
        log.info("publish_section_draft: section %s is provisioned from a mold (content_source=template) — leaving it alone", section_id)
        return {"published": False, "skipped": True, "reason": "template_provisioned"}

    # canvas_versions.content is jsonb NOT NULL. A str must be valid JSON text; a bare
    # plain-text string would fail the jsonb bind (invalid input syntax for type json).
    # Validate, and JSON-encode plain text so it lands as a JSON string value, not a 500.
    if isinstance(content, str):
        try:
            json.loads(content)
            content_json = content
        except (json.JSONDecodeError, ValueError):
            content_json = json.dumps(content)
    else:
        content_json = json.dumps(content)
    new_version = int(row["version"] or 0) + 1
    # Advance the LIVE version pointer PAST the snapshot so proposal_sections.version stays STRICTLY
    # greater than MAX(canvas_versions.version_number) — the same invariant the human save/lock/advance
    # paths hold. Numbering the snapshot at the advanced version (the old behaviour) let a later human
    # save's archive collide on the slot (ON CONFLICT DO NOTHING drops it + keeps the ai_strawman label).
    live_version = new_version + 1
    char_count, word_count = _counts(content)
    # canvas_versions.source is a constrained enum; map the logical source label
    # (strawman/ai/tool) onto it. The label is preserved in edit_summary + the event.
    cv_source = "ai_draft" if source in ("ai", "strawman") else "system"

    try:
        await conn.execute(
            """
            UPDATE proposal_sections
            SET content = $2, status = 'ai_drafted', version = $3, updated_at = now()
            WHERE id = $1::uuid
            """,
            row["id"], content_json, live_version,
        )
        await conn.execute(
            """
            INSERT INTO canvas_versions
                (id, section_id, version_number, content, snapshot_reason, source,
                 ai_instruction, ai_model, char_count, word_count, edit_summary)
            VALUES ($1, $2, $3, $4, 'ai_strawman', $5, $6, $7, $8, $9, $10)
            """,
            uuid.uuid4(), row["id"], new_version, content_json, cv_source,
            instruction, ai_model, char_count, word_count,
            f"Published {source} draft",
        )
    except Exception as e:
        log.error("publish_section_draft: landing failed for section %s: %s", section_id, e)
        raise

    # Best-effort event (proposal namespace; the section is the entity).
    try:
        from events import emit_event
        await emit_event(
            conn, namespace="proposal", type="section.drafted",
            payload={
                "proposalId": str(proposal_id),
                "sectionId": str(section_id),
                "version": live_version,  # the section's CURRENT version (snapshot lives at new_version)
                "source": source,
            },
        )
    except Exception as e:
        log.warning("publish_section_draft: event emit failed (non-fatal): %s", e)

    log.info("publish_section_draft: landed v%d into section %s (source=%s)", live_version, section_id, source)
    return {"published": True, "section_id": str(section_id), "version": live_version, "source": source}
