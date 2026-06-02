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


def test_source_gate_matches_real_diff_reviewed_producer():
    # The diffs route PATCH emits finder:source_diff.reviewed (start/end). The
    # gate now matches that real producer on phase="end" (was the phantom
    # source.changes_reviewed:single nothing emits). Launch Review #1b.
    step = next(
        s for s in OnSourceChangeDetected.steps if s.name == "wait_for_admin_review"
    )
    wf = step.wait_for
    assert wf.condition is None
    assert wf.matches({
        "namespace": "finder", "type": "source_diff.reviewed", "phase": "end",
        "payload": {"sourceId": "s1", "diffId": "d1"},
    }) is True
    assert wf.matches({
        "namespace": "finder", "type": "source.changes_reviewed", "phase": "single",
        "payload": {},
    }) is False
