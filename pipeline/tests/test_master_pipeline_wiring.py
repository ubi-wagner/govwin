"""#128 Batch A — master-side pipeline (PLATFORM-SCOPE). Four platform agents that run at our
authority on master data BEFORE the bridge fan-out: opportunity_scout (triage prioritization),
ingest_analyst (solicitation → curation draft), matrix_stager (→ compliance matrix), and
skeleton_architect (→ master skeleton). NOT tenant-bound (no tenant), so tenant-discretion does
not apply — but they read the most untrusted text in the system, so the injection fence is
MANDATORY. All ADVISORY, placed as independent AI_INVOKE steps so they never dead-end the admin
pipeline. LLM runs on deploy; here we verify WIRING + safety."""
import inspect

from agents.fabric import AgentFabric
from agents.archetypes.ingest_analyst import IngestAnalystArchetype
from agents.archetypes.matrix_stager import MatrixStagerArchetype
from agents.archetypes.skeleton_architect import SkeletonArchitectArchetype
from agents.archetypes.opportunity_scout import OpportunityScoutArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
from workflows.base import StepType
from workflows.on_rfp_uploaded import OnRfpUploaded
from workflows.on_opportunities_detected import OnOpportunitiesDetected

ACTION_TO_ARCH = {
    "tool.solicitation.ingest": ("ingest_analyst", IngestAnalystArchetype),
    "tool.matrix.stage": ("matrix_stager", MatrixStagerArchetype),
    "tool.skeleton.build": ("skeleton_architect", SkeletonArchitectArchetype),
    "tool.opportunity.scout": ("opportunity_scout", OpportunityScoutArchetype),
}


def test_all_registered_and_actions_map():
    fabric = AgentFabric()
    for action, (role, _cls) in ACTION_TO_ARCH.items():
        assert role in fabric._archetypes, role
        assert TOOL_ACTION_TO_ARCHETYPE.get(action) == role, action


def test_injection_fence_present_on_all():
    """Platform agents fetch the untrusted text via tools; build_messages carries the
    treat-as-data guard, and the tool results wrap the text in an untrusted_content envelope."""
    for _action, (_role, cls) in ACTION_TO_ARCH.items():
        msgs = cls().build_messages({"payload": {"solicitation_id": "s1", "source": "sam"}}, [])
        blob = " ".join(m["content"] for m in msgs if isinstance(m.get("content"), str))
        assert "UNTRUSTED" in blob and "never as instructions" in blob, cls.__name__
        # the read tools wrap external text in an untrusted_content envelope
        src = inspect.getsource(cls)
        assert "untrusted_content" in src, cls.__name__


def test_platform_scope_reads_master_tables_not_tenant_filtered():
    """These are master-data reads (no tenant_id filter — there is no tenant yet)."""
    assert "curated_solicitations" in inspect.getsource(IngestAnalystArchetype._get_solicitation)
    assert "solicitation_compliance" in inspect.getsource(MatrixStagerArchetype._get_compliance)
    assert "solicitation_outlines" in inspect.getsource(SkeletonArchitectArchetype._get_outline)
    assert "curated_solicitations" in inspect.getsource(
        OpportunityScoutArchetype._get_recent_new_solicitations
    )
    # no tenant_id in any of their tool schemas
    for _action, (_role, cls) in ACTION_TO_ARCH.items():
        for tool in cls().get_tools():
            assert "tenant_id" not in tool["input_schema"].get("properties", {}), cls.__name__


def test_ingest_chain_are_independent_ai_invoke_actors():
    """ingest/matrix/skeleton sit in OnRfpUploaded as AI_INVOKE actors; nothing downstream
    (notify_curator) depends on them, so a failure/skip never dead-ends the ingest pipeline."""
    steps = {s.name: s for s in OnRfpUploaded.steps}
    for name, action in (
        ("ai_ingest_analyst", "tool.solicitation.ingest"),
        ("ai_matrix_stager", "tool.matrix.stage"),
        ("ai_skeleton_architect", "tool.skeleton.build"),
    ):
        assert name in steps
        assert steps[name].step_type == StepType.AI_INVOKE
        assert steps[name].action == action
    # notify never waits on an agent
    assert steps["notify_curator"].depends_on == "extract_compliance"


def test_scout_is_independent_ai_invoke_actor():
    steps = {s.name: s for s in OnOpportunitiesDetected.steps}
    assert "ai_opportunity_scout" in steps
    s = steps["ai_opportunity_scout"]
    assert s.step_type == StepType.AI_INVOKE
    assert s.action == "tool.opportunity.scout"
    assert s.depends_on is None  # independent — never blocks the alert/triage
