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
import uuid
from datetime import datetime, timezone
from typing import Any

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


async def draft_v0(conn: asyncpg.Connection, **inputs: Any) -> dict[str, Any]:
    proposal_id = inputs.get("proposal_id") or inputs.get("proposalId")
    tenant_id = inputs.get("tenant_id") or inputs.get("tenantId")

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

    # Only the still-fillable sections (the landing primitive re-checks per section).
    rows = await conn.fetch(
        """
        SELECT s.id, s.title, s.status, s.section_type, s.page_allocation, s.artifact_id,
               a.format_spec
        FROM proposal_sections s
        LEFT JOIN proposal_artifacts a ON a.id = s.artifact_id
        WHERE s.proposal_id = $1 AND s.status IN ('empty', 'ai_drafted')
        ORDER BY s.section_number
        """,
        proposal_uuid,
    )
    if not rows:
        return {"drafted": 0, "skipped": False, "reason": "no_empty_sections"}

    sol_id = await conn.fetchval("SELECT solicitation_id FROM proposals WHERE id = $1", proposal_uuid)
    rfp = await _load_rfp_context(conn, proposal_uuid)

    try:
        fabric = AgentFabric()
    except Exception as exc:  # noqa: BLE001 — no API key / config
        log.warning("draft_v0: AgentFabric unavailable — skipping: %s", exc)
        return {"drafted": 0, "skipped": True, "reason": f"no_fabric:{exc}"}

    drafted = 0
    skipped = 0
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
                    "instruction": "Draft a substantive V0 strawman for this section grounded in the company's library atoms.",
                },
            }
            result = await fabric.invoke_agent(conn, "section_drafter", context, tenant_id=tenant_id)
            if result.get("status") != "completed":
                log.info("draft_v0: section %s drafter status=%s — skipping", section_id, result.get("status"))
                skipped += 1
                continue

            markdown = (result.get("result") or {}).get("text") or ""
            if not markdown.strip():
                skipped += 1
                continue

            canvas = s["format_spec"] if (s["format_spec"] and isinstance(s["format_spec"], dict) and s["format_spec"]) else _DEFAULT_CANVAS
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
            conn, namespace="proposal", type="v0_completed",
            payload={"proposalId": str(proposal_id), "drafted": drafted, "skipped": skipped},
            tenant_id=tenant_id,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("draft_v0: v0_completed emit failed (non-fatal): %s", exc)

    log.info("draft_v0: proposal %s — drafted %d, skipped %d", proposal_id, drafted, skipped)
    return {"drafted": drafted, "skipped_sections": skipped}
