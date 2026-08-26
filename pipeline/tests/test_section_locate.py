"""An agent reading a 1.3M-char BAA must not be handed its cover page.

Every agent that reads a solicitation took a PREFIX — full_text[:8000] through [:24000]. On the
DoW 2026 SBIR BAA that is 0.6%-1.8% of the document, and what sits there is the cover page and the
table of contents. "Page Limitations" first appears at char 624,462; "font" at 105,016; "margins"
at 59,834. None is inside any agent's window, so matrix_stager was inferring the compliance matrix
from a contents listing.

These pin the replacement: the SAME budget, chosen rather than taken.
"""
from __future__ import annotations

import pytest

from shredder.section_locate import PRIORITY, TOPICS, locate_sections

RULES = """
5.4 Page Limitations
The Technical Volume shall not exceed 10 pages in length. Pages in excess of the page limitation
will not be evaluated. The page count includes all figures and tables.
"""
FORMAT = """
5.5 Formatting Requirements
Text must use a font size of no less than 10 point. Margins shall be one inch on all sides and the
document must be single-spaced on 8.5 x 11 paper size.
"""


def _contents_page(entries: int = 20) -> str:
    """A realistic table of contents — every topic keyword, dot leaders, and no rules at all."""
    rows = []
    for i in range(entries):
        rows.append(f"5.{i} Page Limitations and Font Size Requirements {'.' * 30} {i + 10}")
    return "Table of Contents\n" + "\n".join(rows) + "\n"


def _filler(n: int) -> str:
    return ("The Government intends to award multiple contracts under this announcement. " * 40 + "\n") * (n // 3200 + 1)


class TestTheTableOfContentsTrap:
    """The single densest concentration of topic keywords in the document, stating nothing."""

    def test_does_not_return_the_contents_page(self):
        doc = _contents_page(24) + _filler(60_000) + RULES + _filler(60_000)
        r = locate_sections(doc, budget=8_000)
        assert "shall not exceed 10 pages" in r.text
        # The contents rows must not have won: their dot-leader signature is the giveaway.
        assert "................." not in r.text

    def test_a_document_with_no_contents_page_is_unaffected(self):
        doc = _filler(60_000) + RULES + _filler(60_000)
        r = locate_sections(doc, budget=8_000)
        assert "shall not exceed 10 pages" in r.text


class TestFindingTheRules:
    def test_reaches_a_rule_buried_far_past_any_prefix(self):
        # The rule sits ~600k in, exactly like the real BAA. A prefix reader can never see it.
        doc = _filler(600_000) + RULES + _filler(100_000)
        assert doc.index("Page Limitations") > 500_000
        r = locate_sections(doc, budget=8_000)
        assert "shall not exceed 10 pages" in r.text
        assert "page limitation" not in doc[:24_000].lower(), "fixture must reproduce the prefix blind spot"

    def test_covers_several_topics_at_once_within_one_budget(self):
        doc = _filler(50_000) + RULES + _filler(50_000) + FORMAT + _filler(50_000)
        r = locate_sections(doc, budget=16_000)
        assert "page_limits" in r.covered
        assert "formatting" in r.covered
        assert "shall not exceed" in r.text
        assert "font size" in r.text.lower()

    def test_labels_each_passage_with_its_heading_so_it_stays_citable(self):
        doc = _filler(40_000) + RULES + _filler(40_000)
        r = locate_sections(doc, budget=8_000)
        assert "5.4 Page Limitations" in r.text
        assert r.spans and r.spans[0].heading

    def test_offsets_point_at_the_real_text(self):
        # An excerpt whose offsets do not resolve is not citable, which defeats the whole point.
        doc = _filler(40_000) + RULES + _filler(40_000)
        r = locate_sections(doc, budget=8_000)
        for s in r.spans:
            assert doc[s.start:s.end] in r.text


class TestScoring:
    def test_distinct_phrasings_beat_raw_repetition(self):
        # Raw hit count rewards a chatty passage over the right one — "submission" scored 62 against
        # "page_limits" at 7 on a real BAA purely because it owns common words like "submit".
        chatty = "Submit the submission. Submit again. " * 200
        doc = _filler(30_000) + chatty + _filler(30_000) + RULES + _filler(30_000)
        r = locate_sections(doc, budget=4_000)
        assert "shall not exceed 10 pages" in r.text

    def test_a_compliance_topic_outranks_a_context_topic(self):
        # page_limits and formatting are what the compliance matrix is FOR; eligibility is context.
        assert PRIORITY["page_limits"] > PRIORITY["eligibility"]
        assert PRIORITY["formatting"] > PRIORITY["eligibility"]


class TestBudget:
    def test_never_exceeds_the_budget_it_was_given(self):
        doc = _filler(50_000) + RULES + _filler(50_000) + FORMAT + _filler(50_000)
        for budget in (2_000, 6_000, 16_000, 24_000):
            r = locate_sections(doc, budget=budget)
            # Passage text plus its "[source: …]" labels; the labels are small and bounded.
            assert len(r.text) <= budget + 200 * max(1, len(r.spans))

    def test_a_small_document_passes_through_whole(self):
        doc = RULES + FORMAT
        r = locate_sections(doc, budget=16_000)
        assert r.whole_document is True
        assert r.text == doc


class TestHonestGaps:
    @pytest.mark.parametrize("bad", [None, "", "   "])
    def test_empty_input_reports_every_topic_missing_rather_than_inventing(self, bad):
        r = locate_sections(bad)
        assert r.text == ""
        assert set(r.missing) == set(TOPICS)

    def test_a_document_stating_none_of_it_returns_nothing_not_a_prefix(self):
        # Falling back to the first N chars would be the old bug wearing a new name. An empty
        # excerpt with every topic listed missing is the honest answer.
        doc = "Lorem ipsum dolor sit amet. " * 5_000
        r = locate_sections(doc, budget=8_000)
        assert r.text == ""
        assert r.missing

    def test_reports_which_topics_it_could_not_find(self):
        doc = _filler(40_000) + RULES + _filler(40_000)
        r = locate_sections(doc, budget=16_000, topics={
            "page_limits": TOPICS["page_limits"],
            "nowhere": ["a phrase this document certainly does not contain"],
        })
        assert "page_limits" in r.covered
        assert "nowhere" in r.missing
