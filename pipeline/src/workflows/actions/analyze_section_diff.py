"""
Action: analyze_section_diff
Workflow: OnProposalSectionEdited (PIPE-15)

Invokes DiffAnalyzer to capture edit metrics when a proposal section is saved.
The result is advisory — it creates an episodic memory for the learning flywheel
but does NOT auto-apply any content changes or modify business state.

Degrades gracefully if DiffAnalyzer is unavailable (missing deps) or if
the required inputs are absent/empty.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("pipeline.workflows.actions.analyze_section_diff")


async def analyze_section_diff(conn, **inputs) -> dict:
    """Invoke DiffAnalyzer for an edited proposal section.

    Expected inputs (from workflow step input_map):
        tenant_id    (str UUID)
        proposal_id  (str UUID)
        section_id   (str UUID)
        original     (str) — agent-drafted content before edit
        edited       (str) — human-saved content after edit
        agent_role   (str, optional) — defaults to 'section_drafter'

    Returns:
        Advisory analysis dict: {edit_type, edit_percentage, lines_added,
        lines_removed, memory_created} or {skipped: True, reason} on error.
    """
    tenant_id: str | None = inputs.get("tenant_id")
    proposal_id: str | None = inputs.get("proposal_id")
    section_id: str | None = inputs.get("section_id")
    original: str = inputs.get("original") or ""
    edited: str = inputs.get("edited") or ""
    agent_role: str = inputs.get("agent_role") or "section_drafter"

    if not tenant_id or not proposal_id:
        logger.warning(
            "analyze_section_diff: missing tenant_id or proposal_id, skipping"
        )
        return {"skipped": True, "reason": "missing_tenant_or_proposal"}

    if not original and not edited:
        logger.info("analyze_section_diff: both original and edited empty, skipping")
        return {"skipped": True, "reason": "no_content"}

    context = {
        "proposal_id": proposal_id,
        "section_id": section_id,
    }

    # #149: this action MUTATES state (episodic_memories + agent_task_log flags via the
    # delegate) — emit its OWN domain start/end pair so the analysis is observable from the
    # DB directly, not only via the delegate's system:memory.edit_analyzed event.
    from events import emit_event  # noqa: PLC0415
    start_id = ""
    try:
        start_id = await emit_event(
            conn, namespace="proposal", type="section.diff_analyzed", phase="start",
            tenant_id=tenant_id, payload={"proposalId": proposal_id, "sectionId": section_id},
        )
    except Exception as exc:
        logger.error("analyze_section_diff: start emit failed: %s", exc)

    async def _end(payload: dict) -> None:
        try:
            await emit_event(
                conn, namespace="proposal", type="section.diff_analyzed", phase="end",
                parent_event_id=start_id or None, tenant_id=tenant_id, payload=payload,
            )
        except Exception as exc:
            logger.error("analyze_section_diff: end emit failed: %s", exc)

    try:
        from agents.learning.diff_analyzer import DiffAnalyzer  # noqa: PLC0415

        analyzer = DiffAnalyzer()
        result = await analyzer.analyze_edit(
            conn,
            tenant_id=tenant_id,
            agent_role=agent_role,
            original=original,
            edited=edited,
            context=context,
        )
        logger.info(
            "section diff analyzed: tenant=%s proposal=%s section=%s type=%s pct=%.1f",
            tenant_id,
            proposal_id,
            section_id,
            result.get("edit_type"),
            result.get("edit_percentage", 0.0),
        )
        await _end({"proposalId": proposal_id, "sectionId": section_id,
                    "editType": result.get("edit_type"), "editPercentage": result.get("edit_percentage", 0.0)})
        return result
    except ImportError as exc:
        logger.warning(
            "analyze_section_diff: DiffAnalyzer unavailable (%s), skipping", exc
        )
        await _end({"proposalId": proposal_id, "sectionId": section_id, "error": f"import_error:{exc}"[:300]})
        return {"skipped": True, "reason": f"import_error:{exc}"}
    except Exception as exc:
        logger.error("analyze_section_diff failed: %s", exc)
        await _end({"proposalId": proposal_id, "sectionId": section_id, "error": str(exc)[:300]})
        return {"skipped": True, "reason": str(exc)[:300]}
