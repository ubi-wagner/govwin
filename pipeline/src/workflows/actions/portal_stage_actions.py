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
import uuid as _uuid

logger = logging.getLogger(__name__)


async def _summarize_review(conn, proposal_id):
    """Roll up the review cohort's advisory findings (the ai_review comments the color-team / section
    reviewers posted per section) into a short human summary + count. Reads the DB directly — the
    ACTION's own logic, NOT an input-map dependency, so the input-map-ancestor invariant is untouched.
    Best-effort: returns (0, None) on any error so the gate never dead-ends."""
    if not proposal_id:
        return 0, None
    try:
        pid = _uuid.UUID(proposal_id) if isinstance(proposal_id, str) else proposal_id
        rows = await conn.fetch(
            """SELECT content FROM proposal_comments
               WHERE proposal_id = $1 AND recommendation_type = 'ai_review' AND resolved = false
               ORDER BY created_at DESC LIMIT 5""",
            pid,
        )
        note_count = len(rows)
        sample = ((rows[0]["content"] or "")[:280]) if rows else None
        return note_count, sample
    except Exception as exc:  # noqa: BLE001
        logger.warning("record_stage_review: review-note summary failed: %s", exc)
        return 0, None


async def record_stage_review(
    conn,
    portal_id=None,
    proposal_id=None,
    tenant_id=None,
    stage_key=None,
    agent_manager_key=None,
    auto=None,
    _ai_step_status=None,
    **_ignored,
):
    """Emit capture:stage_review.completed (the cohort has reviewed the stage), carrying a SUMMARY of
    what the manager found so the human closing the gate sees the review, not just "reviewed". Safe
    no-op on bad input — never dead-ends the workflow. Advisory: no advance, no business-table write.

    B17 — the `verdict` is now DERIVED, not asserted. This step is independent of `review_manager`
    by design (an advisory agent must never gate a hard step), and it used to emit
    `verdict='reviewed'` as a literal. On the auto path that was actively dangerous: a manager that
    safe-skipped produced zero advisory notes, zero notes read as "clean", and clean authorized an
    automatic stage advance. Silence passed the gate.

    `_ai_step_status` is the engine's own record of what the AI steps in this instance did (see
    `cohort_evidence`). No cohort step completed ⇒ `verdict='not_reviewed'`, and the frontend gate
    (`closeAgentManagerGate`) refuses to auto-advance on anything but an affirmative pass. The
    ASSISTED path is untouched: a human still reads the summary — which now says plainly that the
    review did not run — and closes the gate on their own judgement.
    """
    if not portal_id:
        return {"completed": False, "reason": "bad_input"}

    from workflows.actions.cohort_evidence import cohort_verdict  # noqa: PLC0415

    verdict, cohort_ran, evidence = cohort_verdict(_ai_step_status)
    note_count, sample = await _summarize_review(conn, proposal_id)
    plural = "s" if note_count != 1 else ""
    if not cohort_ran:
        # Say what happened, not what was hoped for. This sentence is what the person standing at
        # the gate reads, and it is the difference between "the AI checked it" and "nothing checked
        # it" — which is the whole of this bug.
        summary = (
            "AI manager review did NOT run — no cohort output for this stage "
            f"({evidence}). Close this gate on your own reading of the work."
        )
    elif note_count:
        summary = f"AI manager review complete — {note_count} advisory note{plural} from the cohort."
    else:
        summary = "AI manager review complete — no blocking notes."

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
                "verdict": verdict,
                "cohortRan": cohort_ran,
                "evidence": evidence,
                "summary": summary,
                "noteCount": note_count,
                "sample": sample,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("record_stage_review: completed emit failed: %s", exc)

    return {
        "completed": True,
        "portalId": portal_id,
        "auto": bool(auto),
        "noteCount": note_count,
        "verdict": verdict,
        "cohortRan": cohort_ran,
    }
