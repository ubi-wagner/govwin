"""
cost_estimator × budget_model (P4) — proves the agent's compute_budget tool is wired to
the deterministic engine and returns EXACT, audit-grade numbers through the agent execute
path (not an LLM guess). Tenant-bound (no tenant_id), pure (no conn/DB), advisory. No LLM.
"""
from agents.archetypes.cost_estimator import CostEstimatorArchetype

# The canonical template basis (mirrors frontend/lib/templates/dod-sbir-phase1-cost.ts):
# $102,500 direct labor; fringe 35 / OH 45 / G&A 15 / fee 7; materials 6k + subs 23k.
TEMPLATE_INPUT = {
    "labor": [
        {"name": "PI", "category": "Principal Investigator", "hours": 500, "unburdened_rate": 85},
        {"name": "Eng", "category": "Senior Engineer", "hours": 400, "unburdened_rate": 75},
        {"name": "Sci", "category": "Research Scientist", "hours": 300, "unburdened_rate": 70},
        {"name": "Tech", "category": "Technician", "hours": 200, "unburdened_rate": 45},
    ],
    "rates": {"fringe_pct": 0.35, "overhead_pct": 0.45, "gna_pct": 0.15, "fee_pct": 0.07},
    "odcs": [{"kind": "materials", "label": "Prototype", "amount": 6000},
             {"kind": "travel", "label": "Trips", "amount": 2000}],
    "subs": [{"org": "University", "role": "Research", "amount": 23000, "is_research_institution": True}],
}


async def _run(tool_input):
    agent = CostEstimatorArchetype()
    # conn=None + empty context: compute_budget is PURE (no DB, no tenant data). Async
    # so pytest-asyncio owns the loop (a sync run_until_complete corrupts the shared loop).
    return await agent.execute_tool(None, "compute_budget", tool_input, {})


def test_compute_budget_tool_is_exposed_and_tenant_bound():
    agent = CostEstimatorArchetype()
    assert "compute_budget" in agent.tools
    tool = next(t for t in agent.get_tools() if t["name"] == "compute_budget")
    # Tenant-bound invariant: the calculator never takes a tenant_id.
    assert "tenant_id" not in tool["input_schema"].get("properties", {})


async def test_exact_math_through_agent_execute_path():
    out = await _run(TEMPLATE_INPUT)
    assert "error" not in out, out
    grand = out["budget"]["grand"]
    # Audit-exact roll-up — identical to the exported cost sheet.
    assert grand["direct_labor"] == 102500.00
    assert grand["total_before_gna"] == 231643.75
    assert grand["total_est_cost"] == 266390.31
    assert grand["total_price"] == 285037.63


async def test_pop_months_bucketing_sums_to_grand():
    inp = dict(TEMPLATE_INPUT, pop={"type": "months", "total_months": 24, "bucket_months": 6})
    out = await _run(inp)
    assert len(out["budget"]["periods"]) == 4
    assert out["budget"]["grand"]["total_price"] == 285037.63


async def test_pop_base_option_bucketing():
    inp = dict(TEMPLATE_INPUT, pop={"type": "base_option",
                                    "periods": [{"name": "Base", "months": 12},
                                                {"name": "Option 1", "months": 12}]})
    out = await _run(inp)
    assert [p["name"] for p in out["budget"]["periods"]] == ["Base", "Option 1"]
    assert out["budget"]["grand"]["total_price"] == 285037.63


async def test_ceiling_flag_surfaces_through_agent():
    inp = dict(TEMPLATE_INPUT, ceiling=250000)
    out = await _run(inp)
    issues = " ".join(f["issue"].lower() for f in out["budget"]["realism_flags"])
    assert "ceiling" in issues


async def test_loose_shape_is_tolerated_not_fabricated():
    # Missing rates → no burden, and a placeholder flag rather than invented dollars.
    out = await _run({"labor": [{"hours": 100, "unburdened_rate": 50}]})
    assert out["budget"]["grand"]["total_price"] == 5000.00  # pure direct labor
    issues = " ".join(f["issue"].lower() for f in out["budget"]["realism_flags"])
    assert "no indirect rates" in issues


async def test_bad_input_returns_error_not_crash():
    # A non-dict labor entry is skipped; a truly broken pop still resolves to single bucket.
    out = await _run({"labor": ["not-a-dict"], "rates": {"fringe_pct": 0.3}, "pop": "garbage"})
    assert "error" not in out
    assert out["budget"]["grand"]["direct_labor"] == 0.0
