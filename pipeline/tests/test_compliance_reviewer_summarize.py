"""Regression: compliance_reviewer.summarize_result must never crash on a
`summary` that arrives as a STRING instead of the structured object.

Surfaced by a live in-workflow drive of all 36 archetypes: the model returned
`{"summary": "<free text>"}`, and `s.get("total_variables")` raised
AttributeError (not caught by the except tuple), failing the whole invoke_agent
run with status=error. The summarizer is advisory memory text — a differently
shaped model reply must degrade gracefully, never bring the agent down.
"""
import json
from agents.archetypes.compliance_reviewer import ComplianceReviewerArchetype


def test_structured_summary_object_still_formats():
    a = ComplianceReviewerArchetype()
    text = json.dumps({"summary": {
        "total_variables": 10, "pass_count": 7, "fail_count": 1,
        "partial_count": 2, "overall_compliance_pct": 70,
    }})
    s = a.summarize_result({"text": text})
    assert "7/10 pass" in s and "70% compliant" in s


def test_string_summary_does_not_crash():
    """The exact shape that broke the live run: summary is a plain string."""
    a = ComplianceReviewerArchetype()
    text = json.dumps({"summary": "Looks compliant overall; verify page limits."})
    s = a.summarize_result({"text": text})  # must not raise
    assert isinstance(s, str) and "compliant" in s.lower()


def test_non_json_text_falls_back():
    a = ComplianceReviewerArchetype()
    s = a.summarize_result({"text": "The draft appears to PASS all mandatory items."})
    assert isinstance(s, str) and s


def test_empty_result_is_safe():
    a = ComplianceReviewerArchetype()
    assert isinstance(a.summarize_result({}), str)
