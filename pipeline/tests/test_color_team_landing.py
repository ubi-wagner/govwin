"""The color team's review must reach the builder, and its verdict must be its own.

Two defects these lock, both found by running the review over a real drafted build and reading
what landed on the page.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agents.archetypes.color_team_reviewer import ColorTeamReviewerArchetype as CT  # noqa: E402


REVIEW = """0. DISQUALIFIER AUDIT
   A. PLACEHOLDER — template residue still present: "[Senior Engineer]".
   B. UNNAMED KEY PERSONNEL — Principal Investigator referenced by role with no named individual.
   C. FORMAT/SPECIFICITY — none found.

1. Overall Score: Marginal
2. Compliance Status: partially compliant
3. Strengths
   • Opens on the requirement rather than on the company.
4. Weaknesses
   • There is no good evidence of a transition path to a program of record.
5. Risks
   • Placeholder content is a scoring cap.
6. Priority Recommendations
   1. Replace every bracketed placeholder and name every key person.
"""


class TestVerdictIsTheReviewsOwn:
    def test_reads_the_declared_score_not_a_stray_word(self):
        # The old scan ran the ladder best-first over the WHOLE document, so this Marginal review —
        # which says "no good evidence" in its weaknesses — was recorded as "Good".
        assert CT.summarize_result(CT, {"text": REVIEW}) == "Review: Marginal — significant weaknesses identified"

    @pytest.mark.parametrize("score,expected", [
        ("Outstanding", "Review: Outstanding — proposal exceeds requirements"),
        ("Good", "Review: Good — proposal meets requirements with strengths"),
        ("Acceptable", "Review: Acceptable — meets minimum requirements"),
        ("Marginal", "Review: Marginal — significant weaknesses identified"),
        ("Unacceptable", "Review: Unacceptable — major deficiencies found"),
    ])
    def test_every_rung_of_the_ladder(self, score, expected):
        assert CT.summarize_result(CT, {"text": f"1. Overall Score: {score}\nrest of review"}) == expected

    def test_tolerates_formatting_around_the_score(self):
        for line in ("Overall Score - Good", "**Overall Score:** Good", "overall score good"):
            assert "Good" in CT.summarize_result(CT, {"text": line})

    def test_an_unacceptable_review_mentioning_outstanding_actions_is_not_outstanding(self):
        text = "1. Overall Score: Unacceptable\n6. Recommendations\n   1. Close the outstanding action items."
        assert CT.summarize_result(CT, {"text": text}) == "Review: Unacceptable — major deficiencies found"

    def test_falls_back_when_no_score_is_declared(self):
        out = CT.summarize_result(CT, {"text": "The reviewer could not reach a verdict."})
        assert out.startswith("Review completed:")

    def test_empty_result_does_not_raise(self):
        assert CT.summarize_result(CT, {}).startswith("Review completed:")


class TestTheFullReviewReachesTheBuilder:
    """The comment written to proposal_comments must be the review, not the memory label."""

    @staticmethod
    def _src() -> str:
        import inspect
        from agents.fabric import AgentFabric
        return inspect.getsource(AgentFabric._post_section_recommendation)

    def test_prefers_the_full_text_over_the_summary(self):
        src = self._src()
        assert 'res.get("text") or res.get("summary")' in src
        # The old order threw the whole review away in favour of five words.
        assert 'res.get("summary") or res.get("text")' not in src

    def test_still_writes_something_when_only_a_summary_exists(self):
        # An archetype that returns no `text` must not silently post nothing.
        assert 'res.get("summary")' in self._src()

    def test_the_column_budget_is_large_enough_for_a_real_review(self):
        assert "text[:10000]" in self._src()
        assert len(REVIEW) < 10000
