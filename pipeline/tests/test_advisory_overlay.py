"""AdvisoryOverlay (P2) — the reusable advisory/adversarial overlay sub-workflow. Verifies it
REGISTERS + VALIDATES, is TRIGGER-GATED + INERT (nothing emits its event), FANS OUT to a target
advisor, RECONCILES via advisory_manager, is BOUNDED (runaway cap), and LANDS in a HITL review that
never auto-advances a gate. Structural wiring checks — no LLM, no DB."""
import sys
import unittest.mock

# The fabric/processor import path pulls in `anthropic` (absent in the sandbox) via TOOL_ACTION check.
sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from workflows.base import EventTrigger, StepType  # noqa: E402
from workflows.advisory_overlay import (  # noqa: E402
    AdvisoryOverlay,
    OVERLAY_FANOUT_SLOTS,
    _TARGET_ADVISOR_ACTION,
)
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE  # noqa: E402


def test_registers_and_validates():
    assert AdvisoryOverlay.validate() == [], AdvisoryOverlay.validate()


def test_trigger_is_advisory_overlay_requested():
    t = AdvisoryOverlay.trigger
    assert isinstance(t, EventTrigger)
    assert t.namespace == "proposal"
    assert t.type == "proposal.advisory_overlay_requested"
    # Condition requires a proposal_id.
    assert t.condition({"proposal_id": "p"}) is True
    assert t.condition({}) is False


def test_trigger_gated_matches_only_its_event():
    """The overlay only fires on its own event — a full match, and never a failed op."""
    t = AdvisoryOverlay.trigger
    ok = {"namespace": "proposal", "type": "proposal.advisory_overlay_requested",
          "phase": "end", "payload": {"proposal_id": "p"}}
    assert t.matches(ok) is True
    # Wrong event type → no match (inert to everything else).
    assert t.matches({**ok, "type": "proposal.created"}) is False
    # A failed op (error set) never triggers.
    assert t.matches({**ok, "error": {"msg": "x"}}) is False


def test_fans_out_to_a_target_advisor():
    """N fan-out runs to a single target advisor (perspective-diverse), bounded by the runaway cap."""
    fanout = [s for s in AdvisoryOverlay.steps if s.name.startswith("fanout_")]
    assert len(fanout) == OVERLAY_FANOUT_SLOTS
    assert OVERLAY_FANOUT_SLOTS >= 2, "a fan-out must run the target more than once"
    # All fan-out runs target the SAME advisor action (the target), each an AI_INVOKE.
    for s in fanout:
        assert s.step_type == StepType.AI_INVOKE
        assert s.action == _TARGET_ADVISOR_ACTION
    # Each run carries a distinct lens directive (param #2 — directed prompting).
    lenses = {s.input_map.get("review_lens") for s in fanout}
    assert len(lenses) == OVERLAY_FANOUT_SLOTS, "each fan-out run must get its own lens slot"
    # The target advisor action resolves to a registered advisor archetype.
    assert TOOL_ACTION_TO_ARCHETYPE.get(_TARGET_ADVISOR_ACTION) is not None


def test_reconciles_via_advisory_manager():
    """A reconcile step invokes advisory_manager (discrepancy → survival → remediation)."""
    reconcile = next((s for s in AdvisoryOverlay.steps if s.name == "reconcile"), None)
    assert reconcile is not None
    assert reconcile.step_type == StepType.AI_INVOKE
    assert reconcile.action == "tool.advisory.reconcile"
    assert TOOL_ACTION_TO_ARCHETYPE.get(reconcile.action) == "advisory_manager"
    # Reconcile comes AFTER the fan-out (depends on the anchor run).
    assert reconcile.depends_on == "fanout_0"
    # The resolution strategy (param #5) is threaded in.
    assert reconcile.input_map.get("resolution") == "payload.resolution"


def test_pre_augmentation_is_wired_and_independent():
    """Param #4: an optional pre-tool (market/SOTA) runs before the advisor, INDEPENDENT so its
    failure/skip never blocks the fan-out."""
    pre = next((s for s in AdvisoryOverlay.steps if s.name == "pre_augment"), None)
    assert pre is not None
    assert pre.step_type == StepType.AI_INVOKE
    assert pre.action == "tool.market.analyze_sota"
    assert pre.depends_on is None  # independent — never blocks the fan-out


def test_lands_in_hitl_and_never_auto_advances():
    """Param #6: the landing is a HITL review TODO — it never auto-advances a gate."""
    land = next((s for s in AdvisoryOverlay.steps if s.name == "land_review"), None)
    assert land is not None
    assert land.step_type == StepType.TODO
    assert land.task_type  # a real human task
    assert land.assignee_role  # assigned to a human role
    # A hard human gate must never be blocked behind an advisory agent (launch-readiness invariant):
    # land_review is INDEPENDENT and LAST, so it parks after reconcile via list order.
    assert land.depends_on is None
    assert AdvisoryOverlay.steps[-1].name == "land_review"
    # No step advances a proposal stage/gate (no proposal.advanced emission, no advance action).
    for s in AdvisoryOverlay.steps:
        assert "advanced" not in (s.action or "")
        assert "advance" not in (s.action or "")
        # Every non-HITL step is an advisory AI_INVOKE — none writes/advances a business gate.
        if s.step_type != StepType.TODO:
            assert s.step_type == StepType.AI_INVOKE


def test_all_ai_invoke_actions_resolve():
    for s in AdvisoryOverlay.steps:
        if s.step_type == StepType.AI_INVOKE:
            assert TOOL_ACTION_TO_ARCHETYPE.get(s.action) is not None, s.action
