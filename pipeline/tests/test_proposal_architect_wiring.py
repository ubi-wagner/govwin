"""#117 proposal_architect wiring + security. Greenfielded (library_atoms; tenant-discretion;
injection-fenced). Placed as a declarative AI_INVOKE STEP actor in OnProposalCreated —
advisory, independent of drafting so it never blocks the loop. LLM runs on deploy."""
from agents.fabric import AgentFabric
from agents.archetypes.proposal_architect import ProposalArchitectArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE
from workflows.base import StepType
from workflows.on_proposal_created import OnProposalCreated


def test_registered_and_action_maps():
    assert "proposal_architect" in AgentFabric()._archetypes
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.proposal.architect") == "proposal_architect"


def test_tenant_discretion_no_tenant_id_in_schemas():
    for tool in ProposalArchitectArchetype().get_tools():
        assert "tenant_id" not in tool["input_schema"].get("properties", {}), tool["name"]


def test_is_an_ai_invoke_step_actor_in_the_workflow():
    """It sits in the proposal-created workflow as an AI_INVOKE step (an actor beside the
    human/action steps), routing to proposal_architect."""
    steps = {s.name: s for s in OnProposalCreated.steps}
    assert "architect_review" in steps
    s = steps["architect_review"]
    assert s.step_type == StepType.AI_INVOKE
    assert s.action == "tool.proposal.architect"
    # advisory: it does NOT block drafting (draft_sections has no depends_on architect_review)
    assert steps["draft_sections"].depends_on != "architect_review"


def test_search_library_targets_atoms_not_units():
    import inspect
    src = inspect.getsource(ProposalArchitectArchetype._search_library)
    assert "library_atoms" in src and "library_units" not in src
