"""OnFullDraftRequested (P2) — the Proposal Draft Manager orchestration, 3 modes (a/b/c). Verifies the
three mode workflows REGISTER + VALIDATE, share the proposal.full_draft_requested trigger, BRANCH on
payload.mode, thread the Voice-of-Proposal register, sequence the spine → per-section → cost → package
→ review gate cohort (Mode C), and END every mode in a HITL review that NEVER auto-advances a gate
(outputs are review-staged). Structural wiring checks — no LLM, no DB."""
import sys
import unittest.mock

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from workflows.base import StepType  # noqa: E402
from workflows.on_full_draft_requested import (  # noqa: E402
    OnFullDraftRequestedModeA,
    OnFullDraftRequestedModeB,
    OnFullDraftRequestedModeC,
)
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE  # noqa: E402

_MODES = {
    "a": OnFullDraftRequestedModeA,
    "b": OnFullDraftRequestedModeB,
    "c": OnFullDraftRequestedModeC,
}


def test_all_three_modes_register_and_validate():
    for mode, cls in _MODES.items():
        assert cls.validate() == [], f"mode {mode}: {cls.validate()}"


def test_trigger_is_full_draft_requested_for_all_modes():
    for mode, cls in _MODES.items():
        t = cls.trigger
        assert t.namespace == "proposal"
        assert t.type == "proposal.full_draft_requested"
        assert t.phase == "end"


def test_mode_branching_present():
    """Each mode class matches ONLY its own payload.mode (and requires proposal_id)."""
    for mode, cls in _MODES.items():
        cond = cls.trigger.condition
        assert cond({"proposal_id": "p", "mode": mode}) is True
        # Rejects the other two modes → the three are mutually exclusive branches.
        for other in _MODES:
            if other != mode:
                assert cond({"proposal_id": "p", "mode": other}) is False
        # Requires a proposal_id.
        assert cond({"mode": mode}) is False


def test_trigger_matches_full_event_and_rejects_failed_op():
    c = OnFullDraftRequestedModeC.trigger
    ev = {"namespace": "proposal", "type": "proposal.full_draft_requested", "phase": "end",
          "payload": {"proposal_id": "p", "mode": "c"}}
    assert c.matches(ev) is True
    assert c.matches({**ev, "error": {"m": "x"}}) is False  # failed op never triggers
    assert c.matches({**ev, "payload": {"proposal_id": "p", "mode": "a"}}) is False  # wrong mode


def test_spine_head_is_the_proposal_manager_plan_in_every_mode():
    """All three modes share the spine head: proposal_manager PLANS the per-section draft."""
    for mode, cls in _MODES.items():
        plan = next((s for s in cls.steps if s.name == "plan_draft"), None)
        assert plan is not None, f"mode {mode} missing plan_draft"
        assert plan.action == "tool.proposal.plan_draft"
        assert TOOL_ACTION_TO_ARCHETYPE.get(plan.action) == "proposal_manager"


def test_voice_threaded_into_drafting_steps():
    """payload.voice is threaded into the plan + drafting/restyle steps (guarded no-op when absent)."""
    # Mode A: plan + draft carry voice.
    a_draft = next(s for s in OnFullDraftRequestedModeA.steps if s.name == "draft_sections")
    assert a_draft.input_map.get("voice") == "payload.voice"
    a_plan = next(s for s in OnFullDraftRequestedModeA.steps if s.name == "plan_draft")
    assert a_plan.input_map.get("voice") == "payload.voice"
    # Mode B: restyle carries voice.
    b_restyle = next(s for s in OnFullDraftRequestedModeB.steps if s.name == "restyle")
    assert b_restyle.input_map.get("voice") == "payload.voice"
    # Mode C: draft + restyle carry voice.
    c_draft = next(s for s in OnFullDraftRequestedModeC.steps if s.name == "draft_sections")
    assert c_draft.input_map.get("voice") == "payload.voice"


def test_mode_c_sequences_full_pipeline_cost_package_and_gate_cohort():
    """Mode C = per-section [seed → draft → format → style] → cost → package → gate cohort."""
    steps = {s.name: s for s in OnFullDraftRequestedModeC.steps}
    # Per-section pipeline actions.
    assert steps["seed_suggest"].action == "tool.proposal.seed_suggest"
    assert steps["draft_sections"].action == "tool.proposal.draft_all_sections"
    assert steps["reformat"].action == "tool.proposal.reformat_section"
    assert steps["restyle"].action == "tool.proposal.restyle"
    # Chained in order.
    assert steps["draft_sections"].depends_on == "seed_suggest"
    assert steps["reformat"].depends_on == "draft_sections"
    assert steps["restyle"].depends_on == "reformat"
    # Cost + package.
    assert steps["cost_estimate"].action == "tool.proposal.cost_estimate"
    assert steps["package"].action == "tool.proposal.package"
    assert steps["package"].depends_on == "restyle"
    # The review GATE COHORT — continuity + traceability + redaction, each independent (no dependents),
    # each depending on the assembled package.
    cohort = {
        "gate_continuity": ("tool.proposal.check_continuity", "continuity_manager"),
        "gate_traceability": ("tool.proposal.audit_traceability", "traceability_auditor"),
        "gate_redaction": ("tool.proposal.scan_redaction", "redaction_guard"),
    }
    for name, (action, arch) in cohort.items():
        assert steps[name].action == action
        assert TOOL_ACTION_TO_ARCHETYPE.get(action) == arch
        assert steps[name].depends_on == "package"


def test_every_mode_ends_in_hitl_review_and_never_auto_advances():
    """Outputs are review-staged: each mode ends in a HITL review TODO; NO step advances a gate."""
    for mode, cls in _MODES.items():
        todos = [s for s in cls.steps if s.step_type == StepType.TODO]
        assert len(todos) == 1, f"mode {mode} must end in exactly one HITL review TODO"
        assert todos[0].assignee_role  # a human owns it
        # The TODO is the LAST step (parks after everything else has run).
        assert cls.steps[-1].step_type == StepType.TODO, f"mode {mode}: TODO must be last"
        # No step auto-advances a proposal stage/gate (no proposal.advanced, no advance action).
        for s in cls.steps:
            assert "advanced" not in (s.action or "")
            assert "advance" not in (s.action or "")
            # Every non-HITL step is an advisory AI_INVOKE — none auto-writes/advances a gate.
            if s.step_type != StepType.TODO:
                assert s.step_type == StepType.AI_INVOKE, f"mode {mode} step {s.name} not advisory"


def test_all_ai_invoke_actions_resolve_to_registered_archetypes():
    for mode, cls in _MODES.items():
        for s in cls.steps:
            if s.step_type == StepType.AI_INVOKE:
                assert TOOL_ACTION_TO_ARCHETYPE.get(s.action) is not None, (mode, s.name, s.action)


def test_mode_a_is_minimal_and_mode_c_is_fuller():
    """Mode A (HITL) has fewer auto steps than Mode C (full auto)."""
    assert len(OnFullDraftRequestedModeA.steps) < len(OnFullDraftRequestedModeC.steps)
