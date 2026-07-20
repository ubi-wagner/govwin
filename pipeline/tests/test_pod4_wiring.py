"""POD 4 — our-org RFP-admin ops agents + NEW admin-side automation workflows.

curation_qa: pre-release QA gate on `finder:solicitation.triaged` (toState=review_requested).
ops_digest: the FIRST scheduled (cron-shaped) automation — a main-loop scheduler emits
`system:ops.digest_requested` → OnOpsDigestRequested runs the agent → NOTIFY master_admin.
Both platform-scope, advisory, independent actors. LLM runs on deploy; we verify WIRING."""
import inspect

from agents.fabric import AgentFabric
from agents.archetypes.curation_qa import CurationQaArchetype
from agents.archetypes.ops_digest import OpsDigestArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
from workflows.base import StepType
from workflows.on_solicitation_review_requested import OnSolicitationReviewRequested
from workflows.on_ops_digest_requested import OnOpsDigestRequested


def test_registered_and_actions_map():
    fabric = AgentFabric()
    assert "curation_qa" in fabric._archetypes
    assert "ops_digest" in fabric._archetypes
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.curation.qa") == "curation_qa"
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.ops.digest") == "ops_digest"


def test_no_tenant_id_in_schemas():
    for cls in (CurationQaArchetype, OpsDigestArchetype):
        for tool in cls().get_tools():
            assert "tenant_id" not in tool["input_schema"].get("properties", {}), cls.__name__


def test_curation_qa_injection_fenced_and_reads_master():
    blob = " ".join(
        m["content"] for m in CurationQaArchetype().build_messages({"payload": {"solicitation_id": "s1"}}, [])
        if isinstance(m.get("content"), str)
    )
    assert "UNTRUSTED" in blob and "never as instructions" in blob
    src = inspect.getsource(CurationQaArchetype)
    assert "untrusted_content" in src
    assert "curated_solicitations" in src and "solicitation_compliance" in src


def test_ops_digest_reads_aggregates():
    src = inspect.getsource(OpsDigestArchetype)
    assert "agent_task_log" in src and "proposal_portals" in src


def test_pre_release_qa_gate_workflow():
    t = OnSolicitationReviewRequested.trigger
    assert t.namespace == "finder" and t.type == "solicitation.triaged" and t.phase == "end"
    # condition matches ONLY the request_review transition
    assert t.condition({"toState": "review_requested"}) is True
    assert t.condition({"toState": "approved"}) is False
    steps = {s.name: s for s in OnSolicitationReviewRequested.steps}
    assert steps["ai_curation_qa"].step_type == StepType.AI_INVOKE
    assert steps["ai_curation_qa"].action == "tool.curation.qa"
    # notify never waits on the agent → advisory, never dead-ends
    assert steps["notify_reviewer"].depends_on is None


def test_scheduled_ops_digest_workflow_and_scheduler():
    t = OnOpsDigestRequested.trigger
    assert t.namespace == "system" and t.type == "ops.digest_requested" and t.phase == "single"
    steps = {s.name: s for s in OnOpsDigestRequested.steps}
    assert steps["ai_ops_digest"].step_type == StepType.AI_INVOKE
    assert steps["ai_ops_digest"].action == "tool.ops.digest"
    assert steps["notify_master_admin"].depends_on is None
    # the scheduled trigger emitter exists in the pipeline main loop
    import main
    assert hasattr(main, "run_ops_digest_scheduler")
