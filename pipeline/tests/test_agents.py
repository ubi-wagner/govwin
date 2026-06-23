"""Unit tests for AgentFabric and archetype registration.

AgentFabric imports the 'anthropic' SDK which is not installed in the
test environment.  We mock it at the module level before any import so
construction succeeds without a network call or API key.

All tests here are pure structural checks (no DB, no LLM calls):
  - AgentFabric registers exactly 10 archetypes on construction.
  - Each archetype exposes the three required interface properties:
    role_name, system_prompt, tools.
  - Looking up an unknown archetype returns an error result.
  - The _ARCHETYPE_CLASSES list drives registration (count consistency).
"""
import sys
import unittest.mock

import pytest

# ── Mock 'anthropic' before the pipeline modules are imported ─────────
# The fabric module does `import anthropic` at module scope.  anthropic
# is not installed in the CI/test environment, so we stub it out with a
# MagicMock.  This is safe because the tests never call the Anthropic
# API — they only exercise construction and attribute inspection.
if "anthropic" not in sys.modules:
    sys.modules["anthropic"] = unittest.mock.MagicMock()

from agents.fabric import AgentFabric, _ARCHETYPE_CLASSES  # noqa: E402


EXPECTED_ARCHETYPES = {
    "capture_strategist",
    "color_team_reviewer",
    "compliance_reviewer",
    "librarian",
    "opportunity_analyst",
    "packaging_specialist",
    "partner_coordinator",
    "proposal_architect",
    "scoring_strategist",
    "section_drafter",
}


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------

class TestAgentFabricConstruction:
    def setup_method(self):
        self.fabric = AgentFabric()

    def test_archetype_class_list_has_10_entries(self):
        """_ARCHETYPE_CLASSES must contain exactly 10 entries."""
        assert len(_ARCHETYPE_CLASSES) == 10

    def test_fabric_registers_all_archetypes(self):
        """Every class in _ARCHETYPE_CLASSES must be registered after init."""
        assert len(self.fabric._archetypes) == 10

    def test_registered_archetype_names_match_expected_set(self):
        registered = set(self.fabric._archetypes.keys())
        assert registered == EXPECTED_ARCHETYPES

    def test_memory_store_initialised(self):
        from agents.memory import MemoryStore
        assert isinstance(self.fabric.memory, MemoryStore)

    def test_tool_registry_initialised(self):
        from agents.tools import ToolRegistry
        assert isinstance(self.fabric.tool_registry, ToolRegistry)


# ---------------------------------------------------------------------------
# Archetype interface — role_name / system_prompt / tools
# ---------------------------------------------------------------------------

class TestArchetypeInterface:
    def setup_method(self):
        self.fabric = AgentFabric()

    @pytest.mark.parametrize("archetype_name", sorted(EXPECTED_ARCHETYPES))
    def test_role_name_is_non_empty_string(self, archetype_name):
        arch = self.fabric._archetypes[archetype_name]
        rn = arch.role_name
        assert isinstance(rn, str)
        assert rn  # non-empty
        assert rn == archetype_name  # role_name matches the key it was registered under

    @pytest.mark.parametrize("archetype_name", sorted(EXPECTED_ARCHETYPES))
    def test_system_prompt_is_non_empty_string(self, archetype_name):
        arch = self.fabric._archetypes[archetype_name]
        sp = arch.system_prompt
        assert isinstance(sp, str)
        assert len(sp) > 50  # must have a real prompt, not a stub

    @pytest.mark.parametrize("archetype_name", sorted(EXPECTED_ARCHETYPES))
    def test_tools_is_non_empty_list_of_strings(self, archetype_name):
        arch = self.fabric._archetypes[archetype_name]
        tools = arch.tools
        assert isinstance(tools, list)
        assert len(tools) > 0
        for t in tools:
            assert isinstance(t, str), f"{archetype_name}.tools must be list[str], got {type(t)}"

    @pytest.mark.parametrize("archetype_name", sorted(EXPECTED_ARCHETYPES))
    def test_handles_event_returns_bool(self, archetype_name):
        """handles_event() must return a bool for any string event type."""
        arch = self.fabric._archetypes[archetype_name]
        result = arch.handles_event("capture.pursuit.evaluation_requested")
        assert isinstance(result, bool)


# ---------------------------------------------------------------------------
# Fabric routing for unknown archetype
# ---------------------------------------------------------------------------

class TestInvokeUnknownArchetype:
    def setup_method(self):
        self.fabric = AgentFabric()

    @pytest.mark.asyncio
    async def test_invoke_unknown_archetype_returns_error_status(self):
        """invoke_agent for an unregistered archetype returns status=error
        without touching a DB connection."""
        result = await self.fabric.invoke_agent(
            conn=None,  # conn is never reached for unknown archetype
            archetype_name="nonexistent_archetype",
            context={"type": "test.event"},
        )
        assert result["status"] == "error"
        assert "Unknown archetype" in result["reason"]
        assert "nonexistent_archetype" in result["reason"]


# ---------------------------------------------------------------------------
# register_archetype — manual registration
# ---------------------------------------------------------------------------

class TestRegisterArchetype:
    def setup_method(self):
        self.fabric = AgentFabric()

    def test_manual_registration_adds_to_archetypes(self):
        mock_arch = unittest.mock.MagicMock()
        mock_arch.role_name = "test_role"
        self.fabric.register_archetype("test_role", mock_arch)
        assert "test_role" in self.fabric._archetypes
        assert self.fabric._archetypes["test_role"] is mock_arch

    def test_overwrite_registration_replaces_instance(self):
        arch_a = unittest.mock.MagicMock()
        arch_b = unittest.mock.MagicMock()
        self.fabric.register_archetype("capture_strategist", arch_a)
        self.fabric.register_archetype("capture_strategist", arch_b)
        assert self.fabric._archetypes["capture_strategist"] is arch_b
