"""
================================================================================
Portal stage-review actions (TW-8 — the AI-manager stage gate)
docs/TENANT_WORKFLOW_SETUP_DESIGN.md §3½
================================================================================
The landing ACTION of OnPortalStageReviewRequested: emit `capture:stage_review.completed` — the
completion TRIGGER the FRONTEND gate-close consumes (assisted human tick of the gate ToDo, or the
opted-in auto advance via the gate-advance route).

SAFETY: advisory-only. This writes NO business table and NEVER advances the portal stage —
advancePortalStage stays the sole (frontend) authority. It only emits the completion event so the
frontend can close the gate. Mirrors studio_actions.advance_studio_phase (which emits the phase
completion and owns no business content).
"""
import logging

logger = logging.getLogger(__name__)


async def record_stage_review(
    conn,
    portal_id=None,
    proposal_id=None,
    tenant_id=None,
    stage_key=None,
    agent_manager_key=None,
    auto=None,
    **_ignored,
):
    """Emit capture:stage_review.completed (the cohort has reviewed the stage). Safe no-op on bad
    input — never dead-ends the workflow. Advisory: no advance, no business-table write."""
    if not portal_id:
        return {"completed": False, "reason": "bad_input"}

    from events import emit_event  # noqa: PLC0415

    try:
        await emit_event(
            conn,
            namespace="capture",
            type="stage_review.completed",
            phase="single",
            tenant_id=tenant_id,
            payload={
                "portalId": portal_id,
                "proposalId": proposal_id,
                "stageKey": stage_key,
                "agentManagerKey": agent_manager_key,
                "auto": bool(auto),
                "verdict": "reviewed",
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("record_stage_review: completed emit failed: %s", exc)

    return {"completed": True, "portalId": portal_id, "auto": bool(auto)}
