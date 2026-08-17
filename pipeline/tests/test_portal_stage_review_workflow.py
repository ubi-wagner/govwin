"""OnPortalStageReviewRequested (TW-8b) — the AI-manager portal stage gate engine chain. Verifies the
workflow REGISTERS + VALIDATES, triggers on capture:stage_review.requested:end (portalId gated), runs the
advisory review MANAGER then lands capture:stage_review.completed via the record ACTION, and is
advisory-only: NO step advances the portal stage (advancePortalStage stays the sole frontend authority).
Structural wiring checks — no LLM, no DB (the live end-to-end run is scripts/drive_stage_review_chain.py)."""
import sys
import unittest.mock

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from workflows.base import StepType  # noqa: E402
from workflows.on_portal_stage_review import OnPortalStageReviewRequested as W  # noqa: E402
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE  # noqa: E402


def test_registers_and_validates():
    assert W.validate() == [], W.validate()


def test_trigger_is_stage_review_requested_end_gated_on_portal():
    t = W.trigger
    assert t.namespace == "capture"
    assert t.type == "stage_review.requested"
    assert t.phase == "end"
    # Condition: a portalId must be present (a proposal/other stage_review has no portalId).
    assert t.condition({"portalId": "x"}) is True
    assert t.condition({}) is False
    assert t.condition({"proposalId": "p"}) is False


def test_trigger_matches_full_event_and_rejects_failed_op():
    ev = {"namespace": "capture", "type": "stage_review.requested", "phase": "end",
          "payload": {"portalId": "pf"}}
    assert W.trigger.matches(ev) is True
    assert W.trigger.matches({**ev, "error": {"m": "x"}}) is False   # a failed op never triggers
    assert W.trigger.matches({**ev, "phase": "start"}) is False      # only the END event


def test_review_manager_is_the_advisory_reconcile_step():
    mgr = next((s for s in W.steps if s.name == "review_manager"), None)
    assert mgr is not None
    assert mgr.step_type == StepType.AI_INVOKE
    assert mgr.action == "tool.advisory.reconcile"
    # Mapped to a registered archetype, so register_workflow does NOT drop it.
    assert TOOL_ACTION_TO_ARCHETYPE.get(mgr.action) == "advisory_manager"


def test_record_action_is_independent_of_the_advisory_manager():
    """record emits the completion event and must NOT gate behind the advisory review_manager: the
    platform no-deadend invariant (test_ai_invoke_steps_never_block_the_pipeline) forbids a hard step
    depending on an AI_INVOKE, which safe-skips when the fabric/key is absent. record reads only
    payload.* (see the test below), so it needs no ordering dependency; the manager runs in parallel
    as an advisory leaf and its findings surface at the gate via its own landing."""
    rec = next((s for s in W.steps if s.name == "record"), None)
    assert rec is not None
    assert rec.step_type == StepType.ACTION
    assert rec.action == "workflows.actions.portal_stage_actions.record_stage_review"
    # Independent — NOT gated on the advisory agent (an AI_INVOKE never gates a hard step).
    assert rec.depends_on is None


def test_record_reads_full_correlation_off_payload_not_agent_result():
    """The record step only references payload.* (never the agent step's result), honoring the
    input-map-ancestor invariant AND so the completion carries every correlation key. tenantId MUST
    be read from the payload (resolve_input has no access to the top-level tenant_id column)."""
    rec = next(s for s in W.steps if s.name == "record")
    im = rec.input_map
    assert im["portal_id"] == "payload.portalId"
    assert im["proposal_id"] == "payload.proposalId"
    assert im["tenant_id"] == "payload.tenantId"
    assert im["stage_key"] == "payload.stageKey"
    assert im["agent_manager_key"] == "payload.agentManagerKey"
    assert im["auto"] == "payload.autoAdvance"
    # None of the input paths reach into the agent step's result (would violate the ancestor rule).
    assert all(not v.startswith("step.") for v in im.values())


def test_advisory_only_no_step_advances_the_portal():
    """Platform invariant: advisory → the engine NEVER advances/locks/submits. No step's action
    contains 'advance' — advancePortalStage (frontend) stays the sole stage-mutation authority."""
    for s in W.steps:
        assert "advance" not in (s.action or ""), s.name
        assert "lock" not in (s.action or ""), s.name
    # Exactly two steps: the advisory manager, then the completion-emitting record ACTION.
    assert [s.step_type for s in W.steps] == [StepType.AI_INVOKE, StepType.ACTION]
