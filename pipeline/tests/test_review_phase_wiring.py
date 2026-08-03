"""Proposal Studio — the 3-phase (Draft→Refine→Compliance) gated workflow (docs/PROPOSAL_STUDIO_DESIGN.md).

Verifies the three OnReviewPhaseRequested workflows validate/register/branch and reuse the existing
cohort actions, and the advance_studio_phase ACTION's state machine: manual opens the human gate,
auto chains the next phase, auto+compliance completes. Advisory — no stage advance, no business write.
"""
import sys
import unittest.mock

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from workflows.base import StepType, all_registered_workflows, discover_workflows
from workflows.on_review_phase_requested import (
    OnReviewPhaseRequestedDraft,
    OnReviewPhaseRequestedRefine,
    OnReviewPhaseRequestedCompliance,
)
from workflows.actions.studio_actions import advance_studio_phase, NEXT_PHASE

PID = "c3db60b1-2f0e-4bc8-903c-1ec098906c58"
TID = "17780cad-76c0-4cef-95ec-2a536bcf5c8f"

_WF = {
    "draft": OnReviewPhaseRequestedDraft,
    "refine": OnReviewPhaseRequestedRefine,
    "compliance": OnReviewPhaseRequestedCompliance,
}


def test_workflows_validate_register_and_branch():
    discover_workflows()
    names = [c.__name__ for c in all_registered_workflows()]
    for phase, wf in _WF.items():
        assert wf.validate() == [], f"{wf.__name__} did not validate"
        assert wf.__name__ in names
        t = wf.trigger
        assert t.namespace == "proposal" and t.type == "review_phase.requested" and t.phase == "end"
        # branches on payload.phase — matches ONLY its phase
        assert t.condition({"proposal_id": PID, "phase": phase}) is True
        other = "refine" if phase == "draft" else "draft"
        assert t.condition({"proposal_id": PID, "phase": other}) is False


def test_each_phase_ends_in_the_advance_action_reusing_existing_actions():
    # Draft reuses plan/seed/draft; Refine reuses reformat/restyle/cost/package; Compliance the gate cohort.
    draft_actions = {s.action for s in OnReviewPhaseRequestedDraft.steps if s.step_type == StepType.AI_INVOKE}
    assert {"tool.proposal.plan_draft", "tool.proposal.seed_suggest", "tool.proposal.draft_all_sections"} <= draft_actions
    comp_actions = {s.action for s in OnReviewPhaseRequestedCompliance.steps if s.step_type == StepType.AI_INVOKE}
    assert {"tool.proposal.check_compliance", "tool.proposal.check_continuity",
            "tool.proposal.audit_traceability", "tool.proposal.scan_redaction"} <= comp_actions
    # every phase's LAST step is the advance ACTION
    for wf in _WF.values():
        last = wf.steps[-1]
        assert last.step_type == StepType.ACTION
        assert last.action == "workflows.actions.studio_actions.advance_studio_phase"


def test_guidance_threaded_into_drafting_steps():
    # the admin's review comments reach the drafting/restyle steps as payload.guidance
    draft = {s.name: s for s in OnReviewPhaseRequestedDraft.steps}
    assert draft["draft_sections"].input_map.get("guidance") == "payload.guidance"
    refine = {s.name: s for s in OnReviewPhaseRequestedRefine.steps}
    assert refine["restyle"].input_map.get("guidance") == "payload.guidance"


@pytest.mark.asyncio
async def test_advance_manual_opens_human_gate():
    conn = MagicMock()
    conn.execute = AsyncMock()
    with patch("events.emit_event", new=AsyncMock(return_value="e1")) as em:
        r = await advance_studio_phase(conn, proposal_id=PID, tenant_id=TID, phase="draft", auto=False)
    assert r["status"] == "awaiting_review"
    joined = " ".join(str(c) for c in conn.execute.call_args_list)
    assert "awaiting_review" in joined
    types = [c.kwargs.get("type") for c in em.call_args_list]
    assert "review_phase.completed" in types
    # manual NEVER auto-chains
    assert "review_phase.requested" not in types


@pytest.mark.asyncio
async def test_advance_auto_chains_next_phase():
    conn = MagicMock()
    conn.execute = AsyncMock()
    with patch("events.emit_event", new=AsyncMock(return_value="e1")) as em:
        r = await advance_studio_phase(conn, proposal_id=PID, tenant_id=TID, phase="draft", auto=True)
    assert r["next"] == "refine" and r["auto"] is True
    reqs = [c for c in em.call_args_list if c.kwargs.get("type") == "review_phase.requested"]
    assert reqs, "auto did not chain the next phase"
    p = reqs[0].kwargs["payload"]
    assert p["phase"] == "refine" and p["auto"] is True


@pytest.mark.asyncio
async def test_advance_auto_compliance_completes():
    conn = MagicMock()
    conn.execute = AsyncMock()
    with patch("events.emit_event", new=AsyncMock(return_value="e1")) as em:
        r = await advance_studio_phase(conn, proposal_id=PID, tenant_id=TID, phase="compliance", auto=True)
    assert r["next"] == "complete"
    joined = " ".join(str(c) for c in conn.execute.call_args_list)
    assert "complete" in joined
    # the final phase does NOT chain another review_phase.requested
    types = [c.kwargs.get("type") for c in em.call_args_list]
    assert "review_phase.requested" not in types


@pytest.mark.asyncio
async def test_advance_bad_input_is_safe_noop():
    conn = MagicMock()
    conn.execute = AsyncMock()
    r = await advance_studio_phase(conn, proposal_id=None, phase="draft")
    assert r["advanced"] is False
    r2 = await advance_studio_phase(conn, proposal_id=PID, phase="nonsense")
    assert r2["advanced"] is False
    assert NEXT_PHASE == {"draft": "refine", "refine": "compliance", "compliance": "complete"}
