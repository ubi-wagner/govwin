"""
Adversarial-gate (P4-D) — the AdvisoryOverlay applied with policy=auto, plus the Mode C
elevation seam. Verifies:
  - request_advisory_overlay GATES on `adversarial` (Python gate, since the managed engine
    can't skip a dependent of a false CONDITION) and emits the correct trigger contract;
  - record_advisory_reconciliation emits the auto-land audit event;
  - AdvisoryOverlayAuto lands via an ACTION (advisory record), AdvisoryOverlay via a HITL TODO;
  - both never advance a gate / write a business table.
Structural + action-level — no LLM, no DB (emit_event is mocked).
"""
import sys
import unittest.mock

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from workflows.base import StepType  # noqa: E402
from workflows.advisory_overlay import AdvisoryOverlay, AdvisoryOverlayAuto  # noqa: E402
from workflows.actions.advisory_actions import (  # noqa: E402
    DEFAULT_LENSES,
    record_advisory_reconciliation,
    request_advisory_overlay,
)


def _mock_emit():
    """Patch events.emit_event with an AsyncMock; return (patcher, mock)."""
    m = unittest.mock.AsyncMock(return_value="evt-id")
    p = unittest.mock.patch("events.emit_event", new=m)
    return p, m


# ── request_advisory_overlay — the elevation gate ───────────────────────────────


async def test_no_op_when_not_adversarial():
    p, emit = _mock_emit()
    with p:
        out = await request_advisory_overlay(None, adversarial=None, proposal_id="prop-1")
    assert out == {"requested": False, "reason": "not_adversarial"}
    emit.assert_not_called()  # NOTHING emitted when the admin didn't ask for it


async def test_no_op_when_missing_proposal():
    p, emit = _mock_emit()
    with p:
        out = await request_advisory_overlay(None, adversarial=True, proposal_id=None)
    assert out["requested"] is False
    emit.assert_not_called()


async def test_emits_overlay_request_when_adversarial():
    p, emit = _mock_emit()
    with p:
        out = await request_advisory_overlay(
            None, adversarial=True, proposal_id="prop-1", tenant_id="t-1",
            opportunity_id="opp-1", policy="auto", resolution="refute_vote",
        )
    assert out["requested"] is True and out["policy"] == "auto"
    # start + end pair, both on the AdvisoryOverlay trigger contract.
    assert emit.call_count == 2
    kw = emit.call_args_list[-1].kwargs
    assert kw["namespace"] == "proposal"
    assert kw["type"] == "proposal.advisory_overlay_requested"
    assert kw["phase"] == "end"
    payload = kw["payload"]
    assert payload["proposal_id"] == "prop-1"
    assert payload["policy"] == "auto"
    assert payload["resolution"] == "refute_vote"
    # per-lens directives the overlay reads as lens_0/1/2
    assert payload["lens_0"] == DEFAULT_LENSES[0]


async def test_invalid_policy_defaults_to_hitl():
    p, emit = _mock_emit()
    with p:
        out = await request_advisory_overlay(None, adversarial=True, proposal_id="p", policy="bogus")
    assert out["policy"] == "hitl"
    assert emit.call_args_list[-1].kwargs["payload"]["policy"] == "hitl"


async def test_absent_policy_defaults_to_hitl():
    p, emit = _mock_emit()
    with p:
        out = await request_advisory_overlay(None, adversarial=True, proposal_id="p")
    assert out["policy"] == "hitl"


# ── record_advisory_reconciliation — the auto-land ──────────────────────────────


async def test_auto_land_records_reconciled_event():
    p, emit = _mock_emit()
    with p:
        out = await record_advisory_reconciliation(
            None, proposal_id="prop-1", tenant_id="t-1", resolution="majority",
        )
    assert out == {"recorded": True, "landing": "auto"}
    kw = emit.call_args_list[-1].kwargs
    assert kw["type"] == "proposal.advisory_overlay_reconciled"
    assert kw["payload"]["landing"] == "auto"


async def test_auto_land_no_op_without_proposal():
    p, emit = _mock_emit()
    with p:
        out = await record_advisory_reconciliation(None, proposal_id=None)
    assert out["recorded"] is False
    emit.assert_not_called()


# ── The two overlay landings ────────────────────────────────────────────────────


def test_hitl_overlay_lands_in_todo():
    last = AdvisoryOverlay.steps[-1]
    assert last.step_type == StepType.TODO
    assert last.assignee_role  # a human owns it


def test_auto_overlay_lands_in_action_not_todo():
    # AUTO landing = an advisory record ACTION, NOT a human TODO.
    assert not any(s.step_type == StepType.TODO for s in AdvisoryOverlayAuto.steps)
    last = AdvisoryOverlayAuto.steps[-1]
    assert last.step_type == StepType.ACTION
    assert last.action == "workflows.actions.advisory_actions.record_advisory_reconciliation"
    # Independent + last (a landing step must never gate behind an advisory agent — the
    # no-dead-end invariant; it reads its fields from the payload, not reconcile's output).
    assert last.depends_on is None


def test_both_overlays_share_the_fanout_and_reconcile_spine():
    hitl = [s.name for s in AdvisoryOverlay.steps]
    auto = [s.name for s in AdvisoryOverlayAuto.steps]
    # identical up to the landing step
    assert hitl[:-1] == auto[:-1]
    assert "reconcile" in hitl and "fanout_0" in hitl and "pre_augment" in hitl


def test_neither_overlay_advances_a_gate():
    for cls in (AdvisoryOverlay, AdvisoryOverlayAuto):
        for s in cls.steps:
            assert "advanced" not in (s.action or "")
            assert "advance" not in (s.action or "")
