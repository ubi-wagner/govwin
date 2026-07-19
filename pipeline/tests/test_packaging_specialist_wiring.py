"""#117 packaging_specialist wiring + security. Tenant-discretion (no tenant_id in schemas);
placed as an AI_INVOKE step actor in OnProposalAdvancedToFinal — advisory, independent of
the export/notify loop. LLM runs on deploy."""
from agents.fabric import AgentFabric
from agents.archetypes.packaging_specialist import PackagingSpecialistArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
from workflows.base import StepType
from workflows.on_proposal_advanced import OnProposalAdvancedToFinal


def test_registered_and_action_maps():
    assert "packaging_specialist" in AgentFabric()._archetypes
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.proposal.package") == "packaging_specialist"


def test_tenant_discretion_no_tenant_id_in_schemas():
    for tool in PackagingSpecialistArchetype().get_tools():
        assert "tenant_id" not in tool["input_schema"].get("properties", {}), tool["name"]


def test_is_an_ai_invoke_step_actor_independent_of_export():
    steps = {s.name: s for s in OnProposalAdvancedToFinal.steps}
    assert "ai_package_review" in steps
    s = steps["ai_package_review"]
    assert s.step_type == StepType.AI_INVOKE and s.action == "tool.proposal.package"
    # advisory: the export step doesn't depend on the agent
    assert steps["generate_export_preview"].depends_on != "ai_package_review"
