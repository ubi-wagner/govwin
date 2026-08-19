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
    # Triggers on the TOOL's event, not the triage route's.
    #
    # Two producers exist for "curation was submitted for review": the workspace calls the
    # request-review TOOL (frontend/lib/tools/solicitation-request-review.ts), which emits
    # `finder:solicitation.review_requested` via emitEventSingle — hence phase 'single'; and the
    # triage ROUTE emits `finder:solicitation.triaged` with toState='review_requested'. Only the
    # first fires from the workspace, so PATTERN_AUDIT HIGH-1 re-pointed this workflow at it. The
    # QA pass never ran while it listened to the legacy twin.
    #
    # This test asserted the legacy trigger long after that fix, so it failed on the CURRENT
    # wiring — and its condition assertions called t.condition(...) on a trigger that no longer
    # has one. Pinned to the tool's emit here so re-pointing it back at the twin fails loudly.
    assert (t.namespace, t.type, t.phase) == ("finder", "solicitation.review_requested", "single")
    # No condition: the event type IS the signal. A condition was only needed by the twin, whose
    # type also covered approve/reject/return transitions and had to filter on toState.
    assert t.condition is None
    steps = {s.name: s for s in OnSolicitationReviewRequested.steps}
    assert steps["ai_curation_qa"].step_type == StepType.AI_INVOKE
    assert steps["ai_curation_qa"].action == "tool.curation.qa"
    # notify never waits on the agent → advisory, never dead-ends
    assert steps["notify_reviewer"].depends_on is None


def test_scheduled_ops_digest_workflow_and_shared_cron():
    t = OnOpsDigestRequested.trigger
    assert t.namespace == "system" and t.type == "ops.digest_requested" and t.phase == "single"
    steps = {s.name: s for s in OnOpsDigestRequested.steps}
    assert steps["ai_ops_digest"].step_type == StepType.AI_INVOKE
    assert steps["ai_ops_digest"].action == "tool.ops.digest"
    assert steps["notify_master_admin"].depends_on is None
    # The scheduled trigger runs on the SHARED cron manager (ingest.dispatcher.tick_schedules)
    # — run_type='event' schedules emit the event → the workflow processor runs the workflow.
    # No bespoke scheduler loop; UTC canonical.
    from ingest import dispatcher
    import inspect
    src = inspect.getsource(dispatcher.tick_schedules)
    assert 'run_type"] == "event"' in src and "system_events" in src
