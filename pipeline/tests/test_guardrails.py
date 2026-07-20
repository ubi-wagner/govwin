"""#120 Agent guardrails — the 'guardrail' step of advisory → guardrail → land-or-review.

Pure-function tests for enforce_guardrails (no DB). Proves: disallowed content routes to
review (never auto-applies), the scoring adjustment is clamped to ±cap (bounded auto-apply),
tenant config overrides the cap, and a clean result applies."""
import sys
import unittest.mock

if "anthropic" not in sys.modules:
    sys.modules["anthropic"] = unittest.mock.MagicMock()

from agents.guardrails import (  # noqa: E402
    enforce_guardrails,
    SCORE_ADJUSTMENT_CAP,
)


def test_clean_result_applies():
    v = enforce_guardrails("proposal_architect", {"text": "A tidy outline.", "cost_usd": 0.01})
    assert v["decision"] == "apply"
    assert v["reasons"] == []


def test_disallowed_content_routes_to_review():
    v = enforce_guardrails(
        "section_drafter",
        {"text": "here is a secret_key=ABCDEF that leaked", "cost_usd": 0.02},
    )
    assert v["decision"] == "review"
    assert any("disallowed_content" in r for r in v["reasons"])


def test_scoring_adjustment_within_cap_applies_bounded():
    v = enforce_guardrails("scoring_strategist", {"adjustment": 10})
    assert v["decision"] == "apply"
    assert v["bounded"]["bounded_adjustment"] == 10


def test_scoring_adjustment_over_cap_is_clamped():
    v = enforce_guardrails("scoring_strategist", {"adjustment": 42})
    assert v["decision"] == "apply"  # clamped, still applied (bounded auto-apply)
    assert v["bounded"]["bounded_adjustment"] == SCORE_ADJUSTMENT_CAP
    assert any("score_adjustment_clamped" in r for r in v["reasons"])


def test_negative_adjustment_over_cap_is_clamped():
    v = enforce_guardrails("scoring_strategist", {"score_adjustment": -99})
    assert v["bounded"]["bounded_adjustment"] == -SCORE_ADJUSTMENT_CAP


def test_adjustment_extracted_from_json_text():
    v = enforce_guardrails("scoring_strategist", {"text": '{"adjustment": 30, "rationale": "x"}'})
    assert v["bounded"]["bounded_adjustment"] == SCORE_ADJUSTMENT_CAP


def test_tenant_config_overrides_cap():
    v = enforce_guardrails("scoring_strategist", {"adjustment": 20}, {"score_adjustment_cap": 25})
    assert v["decision"] == "apply"
    assert v["bounded"]["bounded_adjustment"] == 20  # 20 <= 25, not clamped


def test_non_scoring_agent_large_number_not_clamped():
    """The ±cap only applies to scoring_strategist — other agents aren't score-clamped."""
    v = enforce_guardrails("capture_strategist", {"adjustment": 999, "text": "fine"})
    assert "bounded_adjustment" not in v["bounded"]
    assert v["decision"] == "apply"


def test_custom_denylist_routes_to_review():
    v = enforce_guardrails(
        "librarian", {"text": "contains FORBIDDEN token"}, {"denylist": ["FORBIDDEN"]}
    )
    assert v["decision"] == "review"


def test_cost_over_ceiling_is_flagged_but_applies():
    v = enforce_guardrails("proposal_architect", {"text": "ok", "cost_usd": 0.90})
    assert v["decision"] == "apply"
    assert any("cost_over_ceiling" in r for r in v["reasons"])
