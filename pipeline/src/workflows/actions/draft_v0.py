"""
================================================================================
Action: draft_v0  (B5 — the 3-source V0 strawman orchestration)
================================================================================

The generative core of the spine. On a freshly-created proposal, this drafts every
EMPTY section from three sources — the RFP excerpt, the tenant's library atoms, and
the tenant profile — and LANDS each draft via publish_section_draft (whose
empty/ai_drafted gate is the safe way to cross the advisory boundary; human-owned
sections are never clobbered).

Flow per section:
    section_drafter (AI, markdown) → markdown_to_canvas → publish_section_draft

Heavily guarded for a deploy-first rollout:
    • only EMPTY / ai_drafted sections are touched (the landing primitive enforces it)
    • if the fabric/API key is unavailable → graceful skip (no crash, no DB write)
    • per-section try/except — one bad section never aborts the rest
    • idempotent — re-run only re-drafts still-empty sections

Wired as an ACTION step on OnProposalCreated (action string:
'workflows.actions.draft_v0.draft_v0'); the processor calls draft_v0(conn, **inputs).
================================================================================
"""
from __future__ import annotations

import logging
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from workflows.actions.authorable import is_authorable

import asyncpg

log = logging.getLogger("pipeline.workflows.actions.draft_v0")

# Default canvas rules if a section's artifact has no frozen format_spec.
_DEFAULT_CANVAS = {
    "format": "letter",
    "width": 612,
    "height": 792,
    "margins": {"top": 72, "right": 72, "bottom": 72, "left": 72},
    "header": None,
    "footer": None,
    "font_default": {"family": "Times New Roman", "size": 11},
    "line_spacing": 1.15,
    "max_pages": None,
    "max_slides": None,
}

_RFP_EXCERPT_CHARS = 18000


async def _load_rfp_context(conn: asyncpg.Connection, proposal_id: uuid.UUID) -> dict[str, Any]:
    """RFP excerpt + evaluation criteria for the drafter, from the proposal's solicitation."""
    out: dict[str, Any] = {"rfp_excerpt": "", "evaluation_criteria": None}
    try:
        row = await conn.fetchrow(
            """
            SELECT cs.full_text, sc.evaluation_criteria
            FROM proposals p
            LEFT JOIN curated_solicitations cs ON cs.id = p.solicitation_id
            LEFT JOIN solicitation_compliance sc ON sc.solicitation_id = p.solicitation_id
            WHERE p.id = $1
            LIMIT 1
            """,
            proposal_id,
        )
        if row:
            if row["full_text"]:
                out["rfp_excerpt"] = str(row["full_text"])[:_RFP_EXCERPT_CHARS]
            out["evaluation_criteria"] = row["evaluation_criteria"]
    except Exception as exc:  # noqa: BLE001 — best-effort context
        log.warning("draft_v0: rfp context load failed: %s", exc)
    return out


def _metadata(section: asyncpg.Record, proposal_id: str, solicitation_id: str | None) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "title": section["title"] or "Section",
        "volume_id": str(section["artifact_id"]) if section["artifact_id"] else "",
        "required_item_id": "",
        "proposal_id": proposal_id,
        "solicitation_id": solicitation_id or "",
        "created_at": now,
        "last_modified_at": now,
        "last_modified_by": "system",
        "version_number": 1,
        "status": "ai_drafted",
    }



def _is_placeholder(text: str) -> bool:
    """Is this block ENTIRELY a bracketed instruction, e.g. "[Describe the problem …]"?

    Molds from the code registry (frontend/lib/provision-proposal.ts falls back to
    `resolveTemplateKey` when no admin-authored mold is linked, which is the default state of a
    freshly built-out master) seed their text blocks with long bracketed prompts telling the writer
    what to put there. That is scaffolding in exactly the sense headings and callouts are — but it
    is made of WORDS, so the word counter read it as a finished draft.

    Whole-block only, deliberately: the drafter's own system prompt asks it to leave
    "[PLACEHOLDER: description]" markers inside real paragraphs for claims needing verification, and
    a paragraph carrying one of those IS a draft and must never be clobbered.
    """
    t = (text or "").strip()
    return len(t) > 1 and t.startswith("[") and t.endswith("]")


def _has_prose(content) -> bool:
    """Does this canvas carry actual written prose, as opposed to empty structure?

    A mold seeds headings, a rules callout and EMPTY OR PLACEHOLDER text blocks — that is
    scaffolding, not a draft, and the section still needs writing. A filled mold, a priced cost
    workbook or a human draft carries words, and must never be clobbered. Headings, callouts and
    whole-block bracketed placeholders are deliberately not counted: they are the scaffolding.

    THE BUG THIS FIXES. The threshold below is 25 words, chosen when a mold's text blocks were
    assumed EMPTY. The code-registry molds carry ~507 words per section of which ~500 sit inside
    brackets — 20× the threshold — so `content_source='template'` + `_has_prose` excluded every
    registry-molded section from drafting, and Mode C reported "sections: 2" on a 14-section
    proposal. That is the exact failure the comment in `draft_v0` says was fixed ("every section
    looked 'already drafted' and carried not one word of prose"); the registry-fallback path
    reopened it, because those blocks are not empty — they are full of instructions.
    """
    if not content:
        return False
    doc = content
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except (ValueError, TypeError):
            return False
    if not isinstance(doc, dict):
        return False

    nodes = doc.get("nodes")
    if not isinstance(nodes, list):
        nodes = [
            n
            for section in (doc.get("sections") or [])
            for group in (section.get("groups") or [])
            for n in (group.get("nodes") or [])
        ]

    words = 0
    for n in nodes or []:
        if not isinstance(n, dict):
            continue
        kind = n.get("type")
        if kind in ("heading", "callout", "page_break", "divider"):
            continue
        c = n.get("content") or {}
        if not isinstance(c, dict):
            continue

        # A TABLE is structure, not prose. Its cells are field LABELS on an unfilled form —
        # "Proposal Number", "Topic Number", "Firm Name" — and counting those as writing is what
        # made an untouched cover-sheet mold look like a finished draft. What distinguishes a
        # FILLED form (or a priced cost workbook, which must never be clobbered) is not that it
        # has words but that it has VALUES: any cell carrying a number means somebody filled it in.
        if kind == "table":
            if _table_has_values(c):
                return True
            continue

        texts = []
        if isinstance(c.get("text"), str) and not _is_placeholder(c["text"]):
            texts.append(c["text"])
        for item in c.get("items") or []:
            if isinstance(item, dict) and isinstance(item.get("text"), str) and not _is_placeholder(item["text"]):
                texts.append(item["text"])
        words += sum(len(t.split()) for t in texts)
        if words >= 25:      # a real paragraph; scaffolding never reaches this
            return True
    return False


def _table_has_values(content: dict) -> bool:
    """Does this table carry entered VALUES, as opposed to an empty form's labels?

    A cell counts as a value when it parses as a number (or carries an explicit numeric `value`,
    which is how the cost workbook stores its computed cells). Row/column headers are excluded —
    they are the form. One value is enough: a partially filled form is still somebody's work.
    """
    for row in content.get("rows") or []:
        if not isinstance(row, list):
            continue
        for cell in row:
            if isinstance(cell, dict):
                if isinstance(cell.get("value"), (int, float)) and cell["value"] != 0:
                    return True
                text = cell.get("text")
            elif isinstance(cell, str):
                text = cell
            else:
                continue
            if isinstance(text, str):
                stripped = text.strip().replace(",", "").replace("$", "").replace("%", "")
                if stripped and stripped not in ("0", "0.0", "-"):
                    try:
                        if float(stripped) != 0:
                            return True
                    except ValueError:
                        pass
    return False


async def draft_v0(conn: asyncpg.Connection, **inputs: Any) -> dict[str, Any]:
    proposal_id = inputs.get("proposal_id") or inputs.get("proposalId")
    tenant_id = inputs.get("tenant_id") or inputs.get("tenantId")
    # Voice register, threaded from the full-draft / studio caller. The AI_INVOKE step these
    # workflows used to run passed it to the archetype; keeping it here means switching them onto
    # this action does not silently drop the author's chosen register (Mode B is literally a
    # restyle pass, so losing it would make that mode a no-op).
    voice = inputs.get("voice") or []
    if isinstance(voice, str):
        voice = [v.strip() for v in voice.split(",") if v.strip()]

    if not proposal_id:
        log.warning("draft_v0: missing proposal_id — skipping")
        return {"drafted": 0, "skipped": True, "reason": "missing_proposal_id"}
    try:
        proposal_uuid = uuid.UUID(str(proposal_id))
    except (ValueError, AttributeError):
        return {"drafted": 0, "skipped": True, "reason": "bad_proposal_id"}

    # Lazy imports so an import error in one dependency degrades to a safe skip
    # rather than crashing the workflow processor.
    try:
        from agents.fabric import AgentFabric
        from document.markdown_to_canvas import build_canvas_document
        from workflows.actions.publish_section_draft import publish_section_draft
    except Exception as exc:  # noqa: BLE001
        log.warning("draft_v0: dependency import failed — skipping: %s", exc)
        return {"drafted": 0, "skipped": True, "reason": f"import:{exc}"}

    # Only the still-fillable sections (the landing primitive re-checks per section). Exclude any
    # section a human has already touched (content_source='human_edit') even if its status is still
    # 'ai_drafted' — a released-UNLOCKED build invites the customer to edit ai_drafted sections
    # immediately, and this async drafter (incl. its manager retries) must never overwrite that work.
    #
    # A 'template' section — provisioned from an admin-authored mold, the computed cost workbook, or
    # a registry template — is judged by what its canvas actually CONTAINS, not by the label. This
    # used to be a blanket exclusion, written when a mold meant priced tables and slide geometry:
    # real content the strawman must never clobber. Once the mold builder started seeding every
    # authored section with a STRUCTURAL skeleton (the item heading, the rules callout, empty text
    # blocks), that blanket exclusion silently switched drafting off for the entire proposal — every
    # section looked "already drafted" and carried not one word of prose. Two features each correct
    # on its own, wrong together, and the only symptom was a workflow reporting
    # drafted:0 / no_empty_sections while the customer's build sat empty.
    #
    # So: fetch template sections too, and keep the ones with no prose. A skeleton gets drafted; a
    # priced cost workbook or a filled mold is left alone.
    rows = await conn.fetch(
        """
        SELECT s.id, s.title, s.status, s.section_type, s.page_allocation,
               s.character_allocation, s.artifact_id,
               s.content, s.content_source, s.meta, a.format_spec
        FROM proposal_sections s
        LEFT JOIN proposal_artifacts a ON a.id = s.artifact_id
        WHERE s.proposal_id = $1 AND s.status IN ('empty', 'ai_drafted')
          AND s.content_source IS DISTINCT FROM 'human_edit'
        ORDER BY s.section_number
        """,
        proposal_uuid,
    )
    rows = [r for r in rows if r["content_source"] != "template" or not _has_prose(r["content"])]
    # Drop the sections that are not written at all — forms, signed attachments, the computed cost
    # workbook. publish_section_draft refuses these at landing, and the two selections MUST agree:
    # without this the drafter spends a model call per certification and every one is thrown away at
    # the door, which is the expensive way to do nothing. Same rule, one module.
    before = len(rows)
    rows = [r for r in rows if is_authorable(r["meta"])]
    if before != len(rows):
        log.info("draft_v0: skipping %d form/attachment section(s) — obtained or filed, not authored here",
                 before - len(rows))
    if not rows:
        return {"drafted": 0, "skipped": False, "reason": "no_authorable_sections"}

    sol_id = await conn.fetchval("SELECT solicitation_id FROM proposals WHERE id = $1", proposal_uuid)
    rfp = await _load_rfp_context(conn, proposal_uuid)

    try:
        fabric = AgentFabric()
    except Exception as exc:  # noqa: BLE001 — no API key / config
        log.warning("draft_v0: AgentFabric unavailable — skipping: %s", exc)
        return {"drafted": 0, "skipped": True, "reason": f"no_fabric:{exc}"}

    # :start — the multi-section V0 draft run is now reconstructable in-flight, linked to
    # the :end below (the malformed `proposal:v0_completed` type is fixed to the dotted
    # entity.action form `proposal:draft.completed`). Emitted once we're committed to draft.
    draft_start_id = ""
    try:
        from events import emit_event as _emit_start
        draft_start_id = await _emit_start(
            conn, namespace="proposal", type="draft.completed", phase="start",
            payload={"proposalId": str(proposal_id), "sections": len(rows)},
            tenant_id=tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("draft_v0: draft.completed:start emit failed (non-fatal): %s", exc)

    drafted = 0
    skipped = 0
    held = 0
    blocked = 0
    blocked_reason = ""
    for s in rows:
        section_id = str(s["id"])
        try:
            context = {
                "type": "tool.proposal.draft_section",
                "tenant_id": tenant_id,
                "proposal_id": str(proposal_id),
                "section_id": section_id,
                "payload": {
                    "section_title": s["title"],
                    "rfp_excerpt": rfp["rfp_excerpt"],
                    "evaluation_criteria": rfp["evaluation_criteria"] or [],
                    "page_limit": s["page_allocation"],
                    # The item's CHARACTER cap, where the agency measures in characters rather
                    # than pages (cover-sheet abstract, project summary). Without it the drafter
                    # had no idea it was writing into a fixed-size form field that REFUSES the
                    # overflow, so it aimed at nothing and the human trimmed by hand afterwards.
                    "character_limit": s["character_allocation"],
                    "instruction": "Draft a substantive V0 strawman for this section grounded in the company's library atoms.",
                    **({"voice": voice} if voice else {}),
                },
            }
            result = await fabric.invoke_agent(conn, "section_drafter", context, tenant_id=tenant_id)
            if result.get("status") != "completed":
                log.info("draft_v0: section %s drafter status=%s — skipping", section_id, result.get("status"))
                skipped += 1
                # A guardrail REFUSAL is not a per-section problem — the tenant's hourly rate limit
                # or monthly budget is spent, so every remaining section will be refused the same
                # way. Stop, and remember why.
                #
                # This used to run the whole list anyway and report a clean "drafted 6, skipped 7"
                # with the workflow status 'completed'. The customer saw half a proposal drafted,
                # the other half untouched, and nothing anywhere said the AI budget had run out —
                # which reads as the feature being broken rather than the cap being hit. Measured
                # on a live drive: a 14-section proposal costs ~23 agent calls per full-draft run
                # against a default cap of 50/hour, so the SECOND run in an hour lands here.
                reason = str(result.get("error") or result.get("reason") or "")
                if any(k in reason.lower() for k in ("rate limit", "budget", "ai is disabled", "cap")):
                    blocked_reason = reason
                    blocked = len(rows) - (drafted + skipped)
                    log.error(
                        "draft_v0: proposal %s — agent guardrail refused (%s); stopping with %d "
                        "section(s) undrafted", proposal_id, reason, blocked,
                    )
                    break
                continue

            markdown = (result.get("result") or {}).get("text") or ""
            if not markdown.strip():
                skipped += 1
                continue

            # Guardrail gate (the "advisory → guardrail → land-or-review" contract). The fabric
            # COMPUTES a verdict (result["guardrail"]) but does not enforce it; draft_v0 is the
            # site that lands content into the proposal_sections business table, so it must. A
            # "review" decision (secret/PII denylist hit, injection heuristic, …) means the draft
            # is NOT safe to auto-land — leave the section empty so the human's pre-staged review
            # ToDo picks it up, instead of publishing flagged text. Compounds the C1 fence: an
            # injection that makes the drafter emit forbidden content is now caught before landing.
            guardrail = result.get("guardrail") or {}
            if guardrail.get("decision") == "review":
                log.warning(
                    "draft_v0: section %s HELD for review (guardrail) — not auto-landed; reasons=%s",
                    section_id, guardrail.get("reasons"),
                )
                held += 1
                skipped += 1
                continue

            # Prefer the section's OWN canvas envelope when provisioning stamped one (e.g. an
            # empty slide_16_9 skeleton for a blank slide item) — the drafter must inherit that
            # geometry, not overwrite a deck with a letter document.
            existing_canvas = None
            try:
                raw = s["content"]
                body = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw if isinstance(raw, dict) else None)
                if isinstance(body, dict) and isinstance(body.get("canvas"), dict) and body["canvas"].get("format"):
                    existing_canvas = body["canvas"]
            except (ValueError, TypeError):
                existing_canvas = None
            canvas = existing_canvas or (s["format_spec"] if (s["format_spec"] and isinstance(s["format_spec"], dict) and s["format_spec"]) else _DEFAULT_CANVAS)
            canvas_doc = build_canvas_document(
                markdown,
                document_id=section_id,
                canvas=canvas,
                metadata=_metadata(s, str(proposal_id), str(sol_id) if sol_id else None),
                source="ai_draft",
            )

            landed = await publish_section_draft(
                conn,
                proposal_id=str(proposal_id),
                section_id=section_id,
                content=canvas_doc,
                source="strawman",
                ai_model=getattr(fabric, "DEFAULT_MODEL", None),
                instruction="3-source V0 strawman",
            )
            if landed.get("published"):
                drafted += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001 — one section must never abort the rest
            log.error("draft_v0: section %s failed: %s", section_id, exc)
            skipped += 1

    # Completion event (best-effort).
    try:
        from events import emit_event
        await emit_event(
            conn, namespace="proposal", type="draft.completed", phase="end",
            parent_event_id=draft_start_id or None,
            payload={"proposalId": str(proposal_id), "drafted": drafted, "skipped": skipped,
                     "held": held, "blocked": blocked,
                     **({"blockedReason": blocked_reason} if blocked_reason else {})},
            tenant_id=tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("draft_v0: draft.completed:end emit failed (non-fatal): %s", exc)

    log.info("draft_v0: proposal %s — drafted %d, skipped %d (held %d for review, %d blocked)",
             proposal_id, drafted, skipped, held, blocked)
    return {
        "drafted": drafted,
        "skipped_sections": skipped,
        "held_for_review": held,
        # Surfaced so the workflow's outcome and the customer-facing notification can say "the AI
        # budget ran out with N sections left" instead of silently delivering a partial draft.
        "blocked_sections": blocked,
        **({"blocked_reason": blocked_reason} if blocked_reason else {}),
    }
