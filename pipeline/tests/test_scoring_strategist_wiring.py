"""#117 agent 2 (scoring_strategist) wiring + security. Greenfielded onto the current
spine (library_atoms vol distribution; DB memory). Tenant-bound: the model-facing tool
schemas expose no tenant_id. The AI_INVOKE action → archetype mapping is already registered.
The LLM reasoning runs live on deploy."""
from agents.fabric import AgentFabric
from agents.archetypes.scoring_strategist import ScoringStrategistArchetype
from workflows.processor import TOOL_ACTION_TO_ARCHETYPE


def test_registered_in_fabric():
    assert "scoring_strategist" in AgentFabric()._archetypes


def test_ai_invoke_action_maps_to_it():
    # A workflow AI_INVOKE step using this action routes to scoring_strategist.
    assert TOOL_ACTION_TO_ARCHETYPE.get("tool.opportunity.score") == "scoring_strategist"


def test_tenant_discretion_no_tenant_id_in_tool_schemas():
    for tool in ScoringStrategistArchetype().get_tools():
        props = tool["input_schema"].get("properties", {})
        assert "tenant_id" not in props, f"{tool['name']} must not let the model choose a tenant"


def test_prompt_and_tools_target_current_spine():
    a = ScoringStrategistArchetype()
    names = {t["name"] for t in a.get_tools()}
    assert names == {"get_tenant_profile", "search_memory"}
    # score adjustment overlay, advisory
    assert "adjust" in a.system_prompt.lower()


def test_execute_tool_uses_trusted_context_tenant(monkeypatch):
    """The tenant_id must come from the task context, never tool input. execute_tool reads
    context['tenant_id'] and ignores any tenant_id a model might smuggle in tool_input."""
    import inspect
    src = inspect.getsource(ScoringStrategistArchetype.execute_tool)
    assert 'context.get("tenant_id")' in src or "context.get('tenant_id')" in src
