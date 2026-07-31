"""
Budget model (P4) — the deterministic cost-volume fill engine. Pure math, no DB / LLM.

Verifies the burden waterfall reproduces the canonical frontend cost-volume template
(frontend/lib/templates/dod-sbir-phase1-cost.ts) EXACTLY, that PoP bucketing is
linear (sum-of-buckets == single-bucket), and that every cost-realism flag fires on
its trigger and stays silent otherwise.
"""
from proposal.budget_model import (  # noqa: E402
    IndirectCaps,
    IndirectRates,
    LaborLine,
    OtherDirectCost,
    Subcontract,
    compute_budget,
    pop_base_plus_option,
    pop_by_months,
    pop_by_year,
    round_cents,
    single_period,
)

# ── The canonical template basis (dod-sbir-phase1-cost.ts) ──────────────────────
# 4 labor lines → $102,500 direct labor; fringe 35% / OH 45% / G&A 15% / fee 7%;
# materials $6,000 + travel $2,000 + subs $23,000.
TEMPLATE_LABOR = [
    LaborLine("PI", "Principal Investigator", hours=500, unburdened_rate=85),
    LaborLine("Engineer", "Senior Engineer", hours=400, unburdened_rate=75),
    LaborLine("Scientist", "Research Scientist", hours=300, unburdened_rate=70),
    LaborLine("Tech", "Technician", hours=200, unburdened_rate=45),
]
TEMPLATE_RATES = IndirectRates(fringe_pct=0.35, overhead_pct=0.45, gna_pct=0.15, fee_pct=0.07)
TEMPLATE_ODCS = [
    OtherDirectCost("materials", "Prototype components", 6000),
    OtherDirectCost("travel", "Kickoff + final review", 2000),
]
TEMPLATE_SUBS = [Subcontract("University Lab", "Research task", 23000, is_research_institution=True)]


def _template_budget(**kw):
    return compute_budget(TEMPLATE_LABOR, TEMPLATE_RATES, TEMPLATE_ODCS, TEMPLATE_SUBS, **kw)


# ── Golden waterfall ────────────────────────────────────────────────────────────


def test_direct_labor_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.direct_labor) == 102500.00


def test_fringe_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.fringe) == 35875.00  # 102,500 × 0.35


def test_overhead_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.overhead) == 62268.75  # (102,500 + 35,875) × 0.45


def test_total_before_gna_matches_template():
    r = _template_budget()
    # 102,500 + 35,875 + 62,268.75 + 6,000 + 2,000 + 23,000
    assert round_cents(r.grand.total_before_gna) == 231643.75


def test_gna_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.gna) == 34746.56  # 231,643.75 × 0.15


def test_total_est_cost_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.total_est_cost) == 266390.31


def test_fee_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.fee) == 18647.32  # 266,390.3125 × 0.07


def test_total_price_matches_template():
    r = _template_budget()
    assert round_cents(r.grand.total_price) == 285037.63


def test_zero_rates_yield_pure_direct_price():
    r = compute_budget(TEMPLATE_LABOR, IndirectRates(), TEMPLATE_ODCS, TEMPLATE_SUBS)
    # No burden → price == direct labor + ODC + subs.
    assert round_cents(r.grand.total_price) == round_cents(102500 + 6000 + 2000 + 23000)


# ── PoP bucketing is linear ─────────────────────────────────────────────────────


def test_pop_by_months_sums_to_single_period():
    single = _template_budget(periods=single_period())
    bucketed = _template_budget(periods=pop_by_months(24, 6))  # 4 equal 6-mo buckets
    assert len(bucketed.periods) == 4
    assert round_cents(bucketed.grand.total_price) == round_cents(single.grand.total_price)


def test_pop_base_plus_option_sums_to_single_period():
    single = _template_budget(periods=single_period())
    bucketed = _template_budget(periods=pop_base_plus_option([("Base", 12), ("Option 1", 12)]))
    assert [p.name for p in bucketed.periods] == ["Base", "Option 1"]
    assert round_cents(bucketed.grand.total_price) == round_cents(single.grand.total_price)


def test_pop_by_year_sums_to_single_period():
    single = _template_budget(periods=single_period())
    bucketed = _template_budget(periods=pop_by_year(3))
    assert len(bucketed.periods) == 3
    assert round_cents(bucketed.grand.total_price) == round_cents(single.grand.total_price)


def test_even_split_divides_labor_equally():
    r = _template_budget(periods=pop_by_year(2))
    p0, p1 = r.periods
    assert round_cents(p0.direct_labor) == round_cents(p1.direct_labor) == 51250.00


def test_explicit_allocation_respected():
    # Front-load 70/30 across two periods.
    labor = [LaborLine("PI", "PI", hours=1000, unburdened_rate=100, allocation=[0.7, 0.3])]
    r = compute_budget(labor, IndirectRates(), periods=pop_by_year(2))
    assert round_cents(r.periods[0].direct_labor) == 70000.00
    assert round_cents(r.periods[1].direct_labor) == 30000.00


def test_partial_trailing_bucket():
    periods = pop_by_months(30, 12)  # 12, 12, 6
    assert [p.months for p in periods] == [12, 12, 6]


def test_uneven_months_weight_allocation():
    # A 12+6 month base+option splits evenly-by-months (2/3, 1/3), not per-period.
    r = compute_budget(
        [LaborLine("PI", "PI", hours=900, unburdened_rate=100)],
        IndirectRates(),
        periods=pop_base_plus_option([("Base", 12), ("Option", 6)]),
    )
    assert round_cents(r.periods[0].direct_labor) == 60000.00  # 2/3 of 90,000
    assert round_cents(r.periods[1].direct_labor) == 30000.00  # 1/3 of 90,000


# ── Realism flags ───────────────────────────────────────────────────────────────


def _issues(r):
    return " || ".join(f.issue for f in r.realism_flags)


def test_ceiling_flag_fires_when_over():
    r = _template_budget(ceiling=250000)  # price ~285k > 250k
    assert any(f.severity == "high" and "ceiling" in f.issue.lower() for f in r.realism_flags)


def test_ceiling_flag_silent_when_under():
    r = _template_budget(ceiling=500000)
    assert not any("ceiling" in f.issue.lower() for f in r.realism_flags)


def test_indirect_cap_flag_fires():
    r = _template_budget(indirect_caps=IndirectCaps(overhead_pct=0.40))  # OH 45% > cap 40%
    assert any("overhead" in f.issue.lower() and "cap" in f.issue.lower() for f in r.realism_flags)


def test_indirect_cap_flag_silent_when_within():
    r = _template_budget(indirect_caps=IndirectCaps(overhead_pct=0.50, fringe_pct=0.40, gna_pct=0.20))
    assert not any("cap" in f.issue.lower() for f in r.realism_flags)


def test_partner_max_flag_fires():
    # subs 23,000 / price ~285,038 ≈ 8.1%; cap at 5% trips it.
    r = _template_budget(partner_max_pct=0.05)
    assert any("partner limit" in f.issue.lower() for f in r.realism_flags)


def test_partner_max_flag_silent_when_within():
    r = _template_budget(partner_max_pct=0.33)
    assert not any("partner limit" in f.issue.lower() for f in r.realism_flags)


def test_sbir_workshare_floor_flag_fires():
    # Heavy subcontracting drops SBC work share below the 67% SBIR floor.
    labor = [LaborLine("PI", "PI", hours=100, unburdened_rate=100)]  # $10k labor
    subs = [Subcontract("Big Sub", "Most of the work", 100000)]      # $100k subs
    r = compute_budget(labor, IndirectRates(fringe_pct=0.3), subs=subs, program="sbir")
    assert any("work share" in f.issue.lower() and "sbir" in f.issue.lower() for f in r.realism_flags)


def test_sbir_workshare_floor_silent_when_compliant():
    r = _template_budget(program="sbir")  # labor-heavy → SBC share well above 67%
    assert not any("work share" in f.issue.lower() for f in r.realism_flags)


def test_sttr_ri_floor_flag_fires():
    # STTR needs RI ≥ 30%; a tiny RI sub trips the medium flag.
    labor = [LaborLine("PI", "PI", hours=1000, unburdened_rate=100)]
    subs = [Subcontract("RI", "research", 5000, is_research_institution=True)]
    r = compute_budget(labor, IndirectRates(), subs=subs, program="sttr")
    assert any("research-institution share" in f.issue.lower() for f in r.realism_flags)


def test_fee_reasonableness_flag_fires():
    r = compute_budget(TEMPLATE_LABOR, IndirectRates(fee_pct=0.15))  # 15% > 10%
    assert any("fee/profit" in f.issue.lower() for f in r.realism_flags)


def test_missing_labor_placeholder_flag():
    r = compute_budget([], TEMPLATE_RATES)
    assert any("no direct labor" in f.issue.lower() for f in r.realism_flags)


def test_missing_rates_placeholder_flag():
    r = compute_budget(TEMPLATE_LABOR, IndirectRates())
    assert any("no indirect rates" in f.issue.lower() for f in r.realism_flags)


def test_clean_budget_has_no_high_flags():
    r = _template_budget(ceiling=500000, partner_max_pct=0.33, program="sbir")
    assert not any(f.severity == "high" for f in r.realism_flags)


# ── Output shape ────────────────────────────────────────────────────────────────


def test_as_display_is_json_ready():
    r = _template_budget(ceiling=250000)
    d = r.as_display()
    assert set(d.keys()) == {"periods", "grand", "workshare", "realism_flags", "rates"}
    assert d["grand"]["total_price"] == 285037.63
    assert isinstance(d["periods"], list) and d["periods"]
    assert d["realism_flags"] and d["realism_flags"][0]["severity"] in {"low", "medium", "high"}


# ── Guards ──────────────────────────────────────────────────────────────────────


def test_bad_odc_kind_raises():
    try:
        compute_budget(TEMPLATE_LABOR, TEMPLATE_RATES, [OtherDirectCost("bogus", "x", 1)])
    except ValueError as e:
        assert "unknown ODC kind" in str(e)
    else:
        raise AssertionError("expected ValueError on bad ODC kind")


def test_allocation_length_mismatch_raises():
    labor = [LaborLine("PI", "PI", hours=100, unburdened_rate=100, allocation=[1.0])]
    try:
        compute_budget(labor, IndirectRates(), periods=pop_by_year(3))
    except ValueError as e:
        assert "allocation length" in str(e)
    else:
        raise AssertionError("expected ValueError on allocation length mismatch")


def test_pop_by_months_rejects_nonpositive():
    for bad in ((0, 6), (24, 0), (-1, 6)):
        try:
            pop_by_months(*bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected ValueError for {bad}")
