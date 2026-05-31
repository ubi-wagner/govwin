"""Fix 1 — HITL wait_for aligns with the real producer (Launch Review #1/#1b).

The proposal review gate waited on proposal.advanced:**single**, but the advance
route only emits start/end — so it never resumed via events (only the 3-day
timeout). Fixed to phase="end" (the end event carries previousStage). The
source-change gate had no producer at all and a copy-pasted condition; it's now
force-advance-only with the dead condition removed.

These tests exercise the SAME EventTrigger.matches() that INC-1's
match_waiting_instances uses, so green here means the resume path is finally live
against the real producer, not just a synthetic test event.
"""
from workflows.on_proposal_advanced import OnProposalAdvancedToReview
from workflows.on_source_change_detected import OnSourceChangeDetected


def _wait_for(cls, step_name):
    step = next(s for s in cls.steps if s.name == step_name)
    return step.wait_for


def test_proposal_review_gate_matches_real_end_event():
    wf = _wait_for(OnProposalAdvancedToReview, "wait_for_review")
    assert wf.matches({
        "namespace": "proposal", "type": "proposal.advanced", "phase": "end",
        "payload": {"previousStage": "review"},
    }) is True


def test_proposal_review_gate_does_not_match_phantom_single():
    wf = _wait_for(OnProposalAdvancedToReview, "wait_for_review")
    assert wf.matches({
        "namespace": "proposal", "type": "proposal.advanced", "phase": "single",
        "payload": {"previousStage": "review"},
    }) is False


def test_proposal_review_gate_condition_still_scopes_to_review():
    wf = _wait_for(OnProposalAdvancedToReview, "wait_for_review")
    assert wf.matches({
        "namespace": "proposal", "type": "proposal.advanced", "phase": "end",
        "payload": {"previousStage": "draft"},
    }) is False


def test_source_gate_dead_condition_removed():
    # No producer exists; the gate is force-advance-only. The bogus
    # previousStage=="review" condition (copy-paste) must be gone.
    step = next(
        s for s in OnSourceChangeDetected.steps if s.name == "wait_for_admin_review"
    )
    assert step.wait_for.condition is None
