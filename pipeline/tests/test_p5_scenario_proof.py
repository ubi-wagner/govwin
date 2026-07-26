"""
P5 scenario proof — the Proposal Draft Manager program, proven at the deterministic +
structural level (a live LLM+DB Playwright drive is the deferred manual step; here we prove
everything that does NOT require the model or a running engine):

  1. SBIR Phase I cost volume — the woken cost_estimator's engine fills a realistic,
     compliant Phase I budget (base + option) under the $250k cap, work-share ≥ 67%.
  2. Army/AF cross-pedigree — the continuity reviewer that catches a leaked non-customer
     agency reference IS the adversarial overlay's fan-out target, so the scenario is wired
     to be caught (1:n adversarial continuity review).
  3. Contract coherence — the full-draft → Mode C → AdvisoryOverlay spine is internally
     consistent end to end (event types, payload keys, policy branch).
No LLM, no DB.
"""
import sys
import unittest.mock

sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from proposal.budget_model import (  # noqa: E402
    IndirectRates,
    LaborLine,
    OtherDirectCost,
    Subcontract,
    compute_budget,
    pop_base_plus_option,
    round_cents,
)
from workflows.advisory_overlay import (  # noqa: E402
    AdvisoryOverlay,
    AdvisoryOverlayAuto,
    _TARGET_ADVISOR_ACTION,
)
from workflows.on_full_draft_requested import OnFullDraftRequestedModeC  # noqa: E402
from workflows.actions.advisory_actions import _OVERLAY_TYPE  # noqa: E402
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE  # noqa: E402


# ── 1. SBIR Phase I cost volume (base + option), $250k cap, work-share compliant ──


def _sbir_phase1_budget():
    # A realistic small-business Phase I labor basis (SBC does the bulk of the effort),
    # right-sized to fit the ~$250k Phase I cap after full burden.
    labor = [
        LaborLine("PI", "Principal Investigator", hours=600, unburdened_rate=80),
        LaborLine("Engineer", "Senior Engineer", hours=500, unburdened_rate=70),
        LaborLine("Technician", "Technician", hours=250, unburdened_rate=45),
    ]
    rates = IndirectRates(fringe_pct=0.30, overhead_pct=0.40, gna_pct=0.12, fee_pct=0.07)
    odcs = [
        OtherDirectCost("materials", "Prototype components", 8000),
        OtherDirectCost("travel", "Kickoff + final IPR", 3000),
    ]
    # A modest university sub (research institution) — kept small to preserve SBC work share.
    subs = [Subcontract("University Lab", "Characterization", 12000, is_research_institution=True)]
    periods = pop_base_plus_option([("Base (6 mo)", 6), ("Option (6 mo)", 6)])
    return compute_budget(
        labor, rates, odcs, subs, periods,
        ceiling=250000, partner_max_pct=0.33, program="sbir",
    )


def test_sbir_phase1_is_under_the_phase1_cap():
    r = _sbir_phase1_budget()
    assert r.grand.total_price <= 250000, round_cents(r.grand.total_price)


def test_sbir_phase1_workshare_is_compliant():
    r = _sbir_phase1_budget()
    # SBC performs ≥ 67% of the effort → no work-share flag.
    assert r.workshare["sbc_work_pct"] >= 0.67
    assert not any("work share" in f.issue.lower() for f in r.realism_flags)


def test_sbir_phase1_has_no_high_severity_flags():
    r = _sbir_phase1_budget()
    assert not any(f.severity == "high" for f in r.realism_flags), [f.issue for f in r.realism_flags]


def test_sbir_phase1_base_plus_option_rolls_up_exactly():
    r = _sbir_phase1_budget()
    assert [p.name for p in r.periods] == ["Base (6 mo)", "Option (6 mo)"]
    # The two PoP buckets sum to the grand total (linearity of the burden waterfall).
    summed = sum(p.total_price for p in r.periods)
    assert round_cents(summed) == round_cents(r.grand.total_price)


def test_sbir_phase1_burden_waterfall_is_exact():
    r = _sbir_phase1_budget()
    g = r.grand
    dl = 600 * 80 + 500 * 70 + 250 * 45  # 48000 + 35000 + 11250 = 94250
    assert round_cents(g.direct_labor) == float(dl)
    fringe = dl * 0.30
    overhead = (dl + fringe) * 0.40
    before_gna = dl + fringe + overhead + 8000 + 3000 + 12000
    gna = before_gna * 0.12
    est = before_gna + gna
    price = est * 1.07
    assert round_cents(g.total_price) == round_cents(price)


# ── 2. Army/AF cross-pedigree — the continuity reviewer is the adversarial target ──


def test_continuity_reviewer_is_the_adversarial_overlay_target():
    """The Army/AF leaked-agency-reference check lives in continuity_manager. The adversarial
    overlay fans OUT over exactly that reviewer, so the scenario is wired to be caught by a
    1:n perspective-diverse continuity pass (not a single-shot review)."""
    assert _TARGET_ADVISOR_ACTION == "tool.proposal.check_continuity"
    assert TOOL_ACTION_TO_ARCHETYPE[_TARGET_ADVISOR_ACTION] == "continuity_manager"
    # Mode C also runs continuity as a first-class gate step (before any elevation).
    names = {s.name for s in OnFullDraftRequestedModeC.steps}
    assert "gate_continuity" in names


# ── 3. Full-draft → Mode C → AdvisoryOverlay contract coherence ──────────────────


def test_mode_c_elevation_emits_exactly_what_the_overlay_triggers_on():
    # The elevation action emits _OVERLAY_TYPE; both overlay classes trigger on that type.
    assert _OVERLAY_TYPE == "proposal.advisory_overlay_requested"
    assert AdvisoryOverlay.trigger.type == _OVERLAY_TYPE
    assert AdvisoryOverlayAuto.trigger.type == _OVERLAY_TYPE
    assert AdvisoryOverlay.trigger.phase == "end" == AdvisoryOverlayAuto.trigger.phase


def test_mode_c_request_overlay_reads_the_frontend_threaded_payload_keys():
    """Mode C's request_overlay input_map reads the EXACT snake_case fields the full-draft
    route emits (adversarial / adversarial_policy / adversarial_resolution)."""
    step = next(s for s in OnFullDraftRequestedModeC.steps if s.name == "request_overlay")
    im = step.input_map
    assert im["adversarial"] == "payload.adversarial"
    assert im["policy"] == "payload.adversarial_policy"
    assert im["resolution"] == "payload.adversarial_resolution"


def test_policy_branch_is_total_and_mutually_exclusive():
    """Every policy value routes to exactly one overlay landing (no gap, no double-fire)."""
    hitl = AdvisoryOverlay.trigger.condition
    auto = AdvisoryOverlayAuto.trigger.condition
    for policy in ("hitl", "auto", None, "bogus"):
        p = {"proposal_id": "x"}
        if policy is not None:
            p["policy"] = policy
        picks = [name for name, cond in (("hitl", hitl), ("auto", auto)) if cond(p)]
        assert len(picks) == 1, (policy, picks)  # exactly one lands it
    # auto only for 'auto'; everything else (incl. bogus/absent) is the safe HITL default.
    assert auto({"proposal_id": "x", "policy": "auto"}) is True
    assert hitl({"proposal_id": "x", "policy": "bogus"}) is True
