"""amendment_monitor wiring + safety — the platform-scope compliance-delta monitor.

RECONCILIATION (launch doc §4.B "wake more agents"): amendment_monitor was carried in the
docs as dormant, but the code is in fact fully wired — the archetype is registered and
safety-compliant, TOOL_ACTION_TO_ARCHETYPE maps tool.solicitation.amendment_delta, the
OnSourceChangeDetected workflow carries it as an INDEPENDENT AI step, and its trigger
(finder:source.change_detected) is emitted by BOTH the frontend source-scout tool
(lib/tools/source-scout.ts) and the pipeline source_scout worker. The only thing missing was
a test proving it — this file. Mirrors test_opportunity_scout_wiring.py; asserts the §8 safety
contract statically (no DB / no key, CI-safe). Live firing is proven on the emulator rig.
"""
import inspect
import pathlib
import sys
import unittest.mock

# Stub the SDK so importing the fabric never needs a real key (test_agents.py pattern).
sys.modules.setdefault("anthropic", unittest.mock.MagicMock())

from agents.fabric import AgentFabric, _ARCHETYPE_CLASSES
from agents.archetypes.amendment_monitor import AmendmentMonitorArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
from workflows.base import StepType, all_registered_workflows, discover_workflows
from workflows.on_source_change_detected import OnSourceChangeDetected

_REPO = pathlib.Path(__file__).resolve().parents[2]


# ── Registration + action map ────────────────────────────────────────────────
def test_registered_and_action_mapped():
    fabric = AgentFabric()
    assert "amendment_monitor" in fabric._archetypes
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.solicitation.amendment_delta") == "amendment_monitor"
    # roster unchanged — this wakes an existing archetype, it does not add one
    assert len(_ARCHETYPE_CLASSES) == 38   # +project_manager (A1)


# ── Trigger handling ─────────────────────────────────────────────────────────
def test_handles_its_trigger_only():
    a = AmendmentMonitorArchetype()
    assert a.handles_event("finder.source.change_detected") is True
    assert a.handles_event("finder.opportunities.detected") is False
    assert a.handles_event("proposal.full_draft_requested") is False


# ── Advisory (human-gated) — never edits the solicitation itself ─────────────
def test_is_advisory_human_gated():
    a = AmendmentMonitorArchetype()
    assert a.human_gate is True
    src = inspect.getsource(AmendmentMonitorArchetype)
    # the prompt must frame the output as advisory (admin reviews / re-curates)
    assert "advisory" in src.lower()
    assert "re-curat" in src.lower() or "admin reviews" in src.lower()


# ── Injection fence — untrusted external solicitation text ────────────────────
def test_injection_fenced():
    a = AmendmentMonitorArchetype()
    msgs = a.build_messages({"payload": {"source": "sam", "meaningfulChanges": 3}}, [])
    content = " ".join(m.get("content", "") for m in msgs if isinstance(m.get("content"), str))
    assert "UNTRUSTED" in content
    assert "never as instructions" in content
    assert "ignore any" in content.lower()


# ── Platform-scope: tool schemas expose NO tenant_id (model can't scope) ─────
def test_tool_schemas_expose_no_tenant_id():
    a = AmendmentMonitorArchetype()
    for tool in a.get_tools():
        props = tool.get("input_schema", {}).get("properties", {})
        assert "tenant_id" not in props, f"{tool['name']} leaks tenant_id into the model schema"


# ── Reads the master triage table, never mutates it ──────────────────────────
def test_reads_master_readonly():
    src = inspect.getsource(AmendmentMonitorArchetype)
    assert "curated_solicitations" in src              # the master triage table (platform-scope)
    up = src.upper()
    assert "INSERT INTO" not in up
    assert "DELETE FROM" not in up
    assert "UPDATE CURATED" not in up                  # no mutation of the master (updated_at is a read col)


# ── The workflow is wired: AI step + independent so it never dead-ends ────────
def test_workflow_wired_and_independent():
    discover_workflows()
    wfs = {w.__name__: w for w in all_registered_workflows()}
    assert "OnSourceChangeDetected" in wfs
    wf = wfs["OnSourceChangeDetected"]
    assert wf.trigger.namespace == "finder"
    assert wf.trigger.type == "source.change_detected"
    assert wf.trigger.phase == "single"
    ai_steps = [s for s in wf.steps if s.step_type == StepType.AI_INVOKE and s.action == "tool.solicitation.amendment_delta"]
    assert len(ai_steps) == 1, "amendment_monitor AI_INVOKE step missing"
    # independent (no depends_on) → a monitor failure never blocks draft creation / notify / triage
    assert getattr(ai_steps[0], "depends_on", None) in (None, "", [])


# ── The trigger is actually EMITTED (both surfaces) — not dark ────────────────
def test_trigger_is_emitted_from_both_surfaces():
    fe = (_REPO / "frontend" / "lib" / "tools" / "source-scout.ts").read_text()
    py = (_REPO / "pipeline" / "src" / "workers" / "source_scout.py").read_text()
    # frontend source-scout tool emits finder:source.change_detected on meaningful changes
    assert "source.change_detected" in fe
    # pipeline source_scout worker emits the same
    assert 'type="source.change_detected"' in py


# ── summarize_result produces an advisory one-liner ──────────────────────────
def test_summarize_result():
    a = AmendmentMonitorArchetype()
    out = a.summarize_result({"text": '{"amendments": [{"affects_compliance": true}, {"affects_compliance": false}]}'})
    assert isinstance(out, str) and out
    assert "advisory" in out.lower() or "compliance" in out.lower()
