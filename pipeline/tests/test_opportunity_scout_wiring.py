"""opportunity_scout wiring + safety — the platform-scope triage prioritizer, now WOKEN.

OnOpportunitiesDetected (finder:opportunities.detected:single) was dark in the frontend
intake path: nothing emitted its trigger, so the AI prioritization + admin alert + triage
ToDo never fired. lib/intake.stageIntake now emits finder:opportunities.detected on every
staged notice (admin intake AND the scout releaseAsNew path funnel through it), so
opportunity_scout fires live. This asserts the §8 safety contract statically (no DB / no key,
CI-safe); the live firing is proven on the emulator rig separately.
"""
import inspect
import sys
import unittest.mock

# Stub the SDK so importing the fabric never needs a real key (test_agents.py pattern).
sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from agents.fabric import AgentFabric, _ARCHETYPE_CLASSES
from agents.archetypes.opportunity_scout import OpportunityScoutArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
from workflows.base import StepType, all_registered_workflows, discover_workflows
from workflows.on_opportunities_detected import OnOpportunitiesDetected


# ── Registration + action map ────────────────────────────────────────────────
def test_registered_and_action_mapped():
    fabric = AgentFabric()
    assert "opportunity_scout" in fabric._archetypes
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.opportunity.scout") == "opportunity_scout"
    # roster unchanged — this wakes an existing archetype, it does not add one
    assert len(_ARCHETYPE_CLASSES) == 38   # +project_manager (A1)


# ── Trigger handling ─────────────────────────────────────────────────────────
def test_handles_its_trigger_only():
    a = OpportunityScoutArchetype()
    assert a.handles_event("finder.opportunities.detected") is True
    assert a.handles_event("proposal.full_draft_requested") is False


# ── Advisory (human-gated) — never promotes/dismisses itself ─────────────────
def test_is_advisory_human_gated():
    a = OpportunityScoutArchetype()
    assert a.human_gate is True
    src = inspect.getsource(OpportunityScoutArchetype)
    # the prompt must forbid self-promotion/dismissal (advisory-only landing)
    assert "Never dismiss or promote" in src or "never dismisses" in src.lower()


# ── Injection fence — untrusted external titles/summaries/snippets ───────────
def test_injection_fenced():
    a = OpportunityScoutArchetype()
    msgs = a.build_messages({"payload": {"source": "sam", "newSolicitations": 3}}, [])
    content = " ".join(m.get("content", "") for m in msgs if isinstance(m.get("content"), str))
    assert "UNTRUSTED" in content
    assert "never as instructions" in content
    assert "ignore any" in content.lower()


# ── Platform-scope: tool schemas expose NO tenant_id (model can't scope) ─────
def test_tool_schemas_expose_no_tenant_id():
    a = OpportunityScoutArchetype()
    for tool in a.get_tools():
        props = tool.get("input_schema", {}).get("properties", {})
        assert "tenant_id" not in props, f"{tool['name']} leaks tenant_id into the model schema"


# ── Modern reads: the triage queue + the scout-intake candidate queue ────────
def test_reads_modern_tables():
    src = inspect.getsource(OpportunityScoutArchetype)
    # curated_solicitations = the triage queue; scout_findings = the #176 candidate queue
    assert "curated_solicitations" in src
    assert "scout_findings" in src
    # only reads NEW / unresolved items, never mutates
    assert "status = 'new'" in src
    assert "INSERT" not in src.upper().replace("INSERT_", "") or "INSERT INTO" not in src.upper()


# ── The workflow is wired: AI step + independent so it never dead-ends ────────
def test_workflow_wired_and_independent():
    discover_workflows()
    wfs = {w.__name__: w for w in all_registered_workflows()}
    assert "OnOpportunitiesDetected" in wfs
    wf = wfs["OnOpportunitiesDetected"]
    assert wf.trigger.namespace == "finder"
    assert wf.trigger.type == "opportunities.detected"
    assert wf.trigger.phase == "single"
    ai_steps = [s for s in wf.steps if s.step_type == StepType.AI_INVOKE and s.action == "tool.opportunity.scout"]
    assert len(ai_steps) == 1, "opportunity_scout AI_INVOKE step missing"
    # independent (no depends_on) → a scout failure never blocks the admin alert + triage ToDo
    assert getattr(ai_steps[0], "depends_on", None) in (None, "", [])


# ── summarize_result produces an advisory one-liner ──────────────────────────
def test_summarize_result():
    a = OpportunityScoutArchetype()
    out = a.summarize_result({"text": '{"prioritized": [{"priority": "high"}, {"priority": "low"}]}'})
    assert isinstance(out, str) and out
    assert "advisory" in out.lower() or "prioritized" in out.lower()
