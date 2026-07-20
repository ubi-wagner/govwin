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

from agents.fabric import (  # noqa: E402
    AgentFabric,
    _ARCHETYPE_CLASSES,
    _cost_for,
    MODEL_PRICING,
    RATE_LIMIT_PER_HOUR,
    DEFAULT_MONTHLY_BUDGET_USD,
    PER_CALL_CEILING_USD,
)


EXPECTED_ARCHETYPES = {
    # original 10
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
    # Batch B (#127) — new-tenant cold-start
    "onboarding_agent",
    # Batch A (#128) — master-side pipeline (platform-scope)
    "ingest_analyst",
    "matrix_stager",
    "skeleton_architect",
    "opportunity_scout",
    # Batch C (#129) — outcome / amendment / cost / PP
    "outcome_analyst",
    "amendment_monitor",
    "cost_estimator",
    "pp_matcher",
    # POD 4 (#130-131) — our-org RFP-admin ops
    "curation_qa",
    "ops_digest",
}


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------

class TestAgentFabricConstruction:
    def setup_method(self):
        self.fabric = AgentFabric()

    def test_archetype_class_list_has_all_entries(self):
        """_ARCHETYPE_CLASSES must contain exactly the expected roster (19 after #117-#129)."""
        assert len(_ARCHETYPE_CLASSES) == len(EXPECTED_ARCHETYPES)

    def test_fabric_registers_all_archetypes(self):
        """Every class in _ARCHETYPE_CLASSES must be registered after init."""
        assert len(self.fabric._archetypes) == len(EXPECTED_ARCHETYPES)

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


# ---------------------------------------------------------------------------
# Per-model cost
# ---------------------------------------------------------------------------

class TestCostFor:
    """_cost_for prices each model from its own rate, not a flat Sonnet rate."""

    def test_sonnet_priced_at_3_15_per_million(self):
        # 1M input + 1M output = $3 + $15 = $18
        assert _cost_for("claude-sonnet-4-20250514", 1_000_000, 1_000_000) == pytest.approx(18.0)

    def test_haiku_priced_at_1_5_per_million(self):
        # 1M input + 1M output = $1 + $5 = $6
        assert _cost_for("claude-haiku-4-5-20251001", 1_000_000, 1_000_000) == pytest.approx(6.0)

    def test_haiku_is_cheaper_than_sonnet_for_same_tokens(self):
        haiku = _cost_for("claude-haiku-4-5-20251001", 500_000, 200_000)
        sonnet = _cost_for("claude-sonnet-4-20250514", 500_000, 200_000)
        assert haiku < sonnet

    def test_unknown_model_falls_back_to_sonnet_pricing(self):
        unknown = _cost_for("some-future-model", 1_000_000, 0)
        sonnet = _cost_for("claude-sonnet-4-20250514", 1_000_000, 0)
        assert unknown == pytest.approx(sonnet)
        assert unknown == pytest.approx(3.0)

    def test_zero_tokens_is_zero_cost(self):
        assert _cost_for("claude-haiku-4-5-20251001", 0, 0) == 0.0

    def test_pricing_table_has_both_live_models(self):
        assert "claude-sonnet-4-20250514" in MODEL_PRICING
        assert "claude-haiku-4-5-20251001" in MODEL_PRICING


# ---------------------------------------------------------------------------
# Settable limits (tenant override -> platform default -> constant)
# ---------------------------------------------------------------------------

_TENANT = "11111111-1111-4111-8111-111111111111"
_PLATFORM_DEFAULTS = {
    "ai_enabled": True,
    "default_monthly_budget": 50.0,
    "default_rate_limit": 50,
    "platform_monthly_cap": None,
}


class TestSettableLimits:
    """_check_rate_limit / _check_budget resolve tenant -> platform -> constant."""

    def setup_method(self):
        self.fabric = AgentFabric()

    async def test_rate_limit_honors_tenant_override(self):
        conn = unittest.mock.AsyncMock()
        conn.fetchrow.side_effect = [
            {"rate_limit_per_hour": 5},  # tenant override below the platform default
            {"cnt": 5},                  # 5 calls this hour
        ]
        ok = await self.fabric._check_rate_limit(conn, _TENANT, dict(_PLATFORM_DEFAULTS))
        assert ok is False  # 5 >= tenant override of 5

    async def test_rate_limit_falls_back_to_platform_default(self):
        conn = unittest.mock.AsyncMock()
        conn.fetchrow.side_effect = [
            {"rate_limit_per_hour": None},  # no tenant override
            {"cnt": 49},                    # under the platform default of 50
        ]
        ok = await self.fabric._check_rate_limit(conn, _TENANT, dict(_PLATFORM_DEFAULTS))
        assert ok is True

    async def test_budget_zero_disables_tenant(self):
        conn = unittest.mock.AsyncMock()
        conn.fetchrow.side_effect = [{"monthly_budget": 0}]
        ok = await self.fabric._check_budget(conn, _TENANT, dict(_PLATFORM_DEFAULTS))
        assert ok is False

    async def test_budget_uses_platform_default_when_no_tenant_row(self):
        conn = unittest.mock.AsyncMock()
        conn.fetchrow.side_effect = [
            None,                     # no tenant_agent_config row -> platform default $50
            {"total_cost": 49.0},     # under $50
        ]
        ok = await self.fabric._check_budget(conn, _TENANT, dict(_PLATFORM_DEFAULTS))
        assert ok is True

    async def test_platform_cap_blocks_even_when_tenant_under_budget(self):
        conn = unittest.mock.AsyncMock()
        conn.fetchrow.side_effect = [
            {"monthly_budget": 50.0},  # tenant budget
            {"total_cost": 10.0},      # tenant spend well under its budget
            {"total_cost": 100.0},     # platform-wide spend hits the cap
        ]
        platform = dict(_PLATFORM_DEFAULTS, platform_monthly_cap=100.0)
        ok = await self.fabric._check_budget(conn, _TENANT, platform)
        assert ok is False

    async def test_ai_disabled_platform_wide_blocks_budget(self):
        conn = unittest.mock.AsyncMock()
        platform = dict(_PLATFORM_DEFAULTS, ai_enabled=False)
        ok = await self.fabric._check_budget(conn, _TENANT, platform)
        assert ok is False
        conn.fetchrow.assert_not_called()  # short-circuits before any query

    async def test_load_platform_config_falls_back_on_error(self):
        conn = unittest.mock.AsyncMock()
        conn.fetchrow.side_effect = Exception("relation does not exist")
        cfg = await self.fabric._load_platform_config(conn)
        assert cfg["ai_enabled"] is True
        assert cfg["default_rate_limit"] == RATE_LIMIT_PER_HOUR
        assert cfg["default_monthly_budget"] == DEFAULT_MONTHLY_BUDGET_USD
        assert cfg["default_per_call_ceiling"] == PER_CALL_CEILING_USD
        assert cfg["platform_monthly_cap"] is None


# ---------------------------------------------------------------------------
# AI review write-back -> proposal_comments (C3 Increment 2)
# ---------------------------------------------------------------------------

import uuid  # noqa: E402

_REQUESTER = "22222222-2222-4222-8222-222222222222"
_PROPOSAL = "33333333-3333-4333-8333-333333333333"
_SECTION = "44444444-4444-4444-8444-444444444444"


class TestPostSectionRecommendation:
    """_post_section_recommendation writes a completed AI section review into
    proposal_comments as an 'ai_review' recommendation, attributed to the admin
    who requested it, so it surfaces in the section's context-box thread.
    Best-effort: a failure here must never propagate out of the task loop."""

    def setup_method(self):
        self.fabric = AgentFabric()

    def _row(self, **overrides):
        row = {"proposal_id": _PROPOSAL, "section_id": _SECTION}
        row.update(overrides)
        return row

    async def test_posts_recommendation_on_happy_path(self):
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requested_by": _REQUESTER, "category": "team"},
            {"result": {"summary": "Tighten the technical approach."}},
        )
        conn.execute.assert_awaited_once()
        args = conn.execute.call_args.args
        assert "INSERT INTO proposal_comments" in args[0]
        assert "ai_review" in args[0]
        assert args[1] == _PROPOSAL
        assert args[2] == _SECTION
        assert args[3] == uuid.UUID(_REQUESTER)
        assert args[4] == "Tighten the technical approach."
        assert args[5] == "team"

    async def test_accepts_camelcase_requested_by(self):
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requestedBy": _REQUESTER},
            {"result": {"summary": "ok"}},
        )
        conn.execute.assert_awaited_once()
        assert conn.execute.call_args.args[3] == uuid.UUID(_REQUESTER)

    async def test_falls_back_to_text_when_no_summary(self):
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requested_by": _REQUESTER},
            {"result": {"text": "Body of the review."}},
        )
        conn.execute.assert_awaited_once()
        assert conn.execute.call_args.args[4] == "Body of the review."

    async def test_skips_when_no_section_id(self):
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(section_id=None),
            {"requested_by": _REQUESTER},
            {"result": {"summary": "ok"}},
        )
        conn.execute.assert_not_called()

    async def test_skips_when_no_requested_by(self):
        # proposal_comments.user_id is NOT NULL — without an author we must skip.
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"category": "team"},
            {"result": {"summary": "ok"}},
        )
        conn.execute.assert_not_called()

    async def test_skips_when_text_is_blank(self):
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requested_by": _REQUESTER},
            {"result": {"summary": "   "}},  # whitespace-only -> nothing to post
        )
        conn.execute.assert_not_called()

    async def test_truncates_text_to_10000_chars(self):
        conn = unittest.mock.AsyncMock()
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requested_by": _REQUESTER},
            {"result": {"summary": "x" * 20000}},
        )
        assert len(conn.execute.call_args.args[4]) == 10000

    async def test_swallows_db_error(self):
        conn = unittest.mock.AsyncMock()
        conn.execute.side_effect = Exception("insert failed")
        # Must not raise — write-back is best-effort.
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requested_by": _REQUESTER},
            {"result": {"summary": "ok"}},
        )

    async def test_swallows_invalid_requester_uuid(self):
        conn = unittest.mock.AsyncMock()
        # A non-UUID requester makes uuid.UUID() raise; the best-effort guard
        # swallows it and no row is written.
        await self.fabric._post_section_recommendation(
            conn,
            self._row(),
            {"requested_by": "not-a-uuid"},
            {"result": {"summary": "ok"}},
        )
        conn.execute.assert_not_called()
