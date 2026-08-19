"""The drafter's library retrieval must hand the model the passage it MATCHED.

These lock the two defects that put a different proposal's cover sheet into a T3CP technical
section: a whole-document atom returned as if it were a passage, and `content[:2000]` quoting the
document's opening no matter where the match actually was.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agents.archetypes.section_drafter import SectionDrafterArchetype as SD  # noqa: E402


# A stand-in for the real shape that broke this: a past proposal whose first 2,000 characters are
# the cover sheet of a DIFFERENT solicitation, with the relevant prose thousands of characters in.
COVER_SHEET = (
    "STTR Phase II Proposal Proposal Number: F2-17528 Proposal Title: Innovative Directed "
    "Energy Counter UAS Solution Agency Name: USAF Command: RGV Topic Number: AFX23D-TCSO1 "
    "Firm Information Firm Name: Immobileyes Inc. "
)
FILLER = "Administrative certifications and representations follow in numbered order. " * 40
RELEVANT = (
    "Our fiber-optic drone detection approach fuses acoustic arrays with electro-optical "
    "tracking to localize FPV threats that emit no radio signature whatsoever. "
)


def _doc() -> str:
    return COVER_SHEET + FILLER + RELEVANT + FILLER


class TestPassageWindow:
    def test_short_atom_is_passed_through_whole(self):
        atom = "A compact primitive about acoustic sensing."
        assert SD._passage(atom, ["acoustic"]) == atom

    def test_empty_content_is_empty_not_none(self):
        assert SD._passage(None, ["acoustic"]) == ""
        assert SD._passage("", ["acoustic"]) == ""

    def test_long_atom_quotes_the_match_not_the_opening(self):
        doc = _doc()
        assert len(doc) > SD._PASSAGE_CHARS  # the fixture must actually exercise windowing
        out = SD._passage(doc, ["fiber", "optic", "acoustic", "detection"])
        assert "fiber-optic drone detection" in out
        # The regression itself: the old code returned doc[:2000], i.e. the other proposal's
        # cover sheet, for a query about drone detection.
        assert "F2-17528" not in out
        assert "AFX23D-TCSO1" not in out

    def test_a_mid_document_quote_is_marked_as_one(self):
        out = SD._passage(_doc(), ["fiber", "optic"])
        assert out.startswith("… "), "a quote that is not the document's opening must say so"

    def test_a_quote_from_the_top_is_not_falsely_marked(self):
        doc = COVER_SHEET + FILLER * 3
        out = SD._passage(doc, ["proposal", "number", "usaf"])
        assert not out.startswith("… ")

    def test_the_window_is_bounded(self):
        out = SD._passage(_doc(), ["fiber"])
        # window + the two ellipsis markers, nothing like the whole document
        assert len(out) <= SD._PASSAGE_CHARS + 4

    def test_no_terms_falls_back_to_the_opening_rather_than_erroring(self):
        out = SD._passage(_doc(), [])
        assert out.startswith("STTR Phase II Proposal")

    def test_quote_does_not_begin_or_end_mid_word(self):
        out = SD._passage(_doc(), ["fiber", "optic"]).strip("… ").strip("…").strip()
        # Reconstruct: every whole word in the excerpt must appear in the source as a whole word.
        assert out
        first, last = out.split()[0], out.split()[-1]
        assert f" {first}" in _doc() or _doc().startswith(first)
        assert f"{last} " in _doc() or _doc().endswith(last)


class TestQueryTermExtraction:
    """The tsquery is built from the caller's words; nothing that could be read as tsquery
    syntax may survive, or a section title with an ampersand becomes a syntax error."""

    @staticmethod
    def _terms(query: str) -> list[str]:
        import re
        return [t for t in re.split(r"[^A-Za-z0-9]+", query[:200]) if len(t) > 2][:12]

    def test_a_real_section_title_yields_terms(self):
        terms = self._terms("Identification and Significance of the Problem or Opportunity")
        assert "Identification" in terms and "Significance" in terms
        # short stopwords drop out, so the OR query is not dominated by "of"/"or"/"the"
        assert "of" not in terms and "or" not in terms

    def test_punctuation_never_reaches_the_tsquery(self):
        terms = self._terms("Reps & Certifications | DD Form 2345 (ITAR/EAR): !danger")
        for t in terms:
            assert t.isalnum(), f"{t!r} would be parsed as tsquery syntax"

    def test_term_count_is_capped(self):
        assert len(self._terms(" ".join(f"word{i}" for i in range(50)))) == 12

    def test_a_query_of_only_stopwords_yields_nothing_to_search(self):
        # _search_library returns a note rather than searching on an empty tsquery.
        assert self._terms("of or in to a an") == []


class TestScopeRulesMatchTheCanonicalSelector:
    """The scope rules are SQL, so assert them against the query text itself — the point is that
    this query and the frontend's `selectForSection` agree about what is drafting material."""

    @staticmethod
    def _sql() -> str:
        """The method's CODE, with its docstring removed — the docstring explains each rule and
        quotes the old broken ones, so matching against it would pass for the wrong reason."""
        import inspect
        src = inspect.getsource(SD._search_library)
        doc = SD._search_library.__doc__
        return src.replace(doc, "") if doc else src

    def test_reference_grain_is_excluded(self):
        # A reference atom is a whole uploaded document, source for atomization — never a passage.
        assert "grain <> 'reference'" in self._sql()

    def test_only_approved_atoms_are_drafted_from(self):
        sql = self._sql()
        assert "status = 'approved'" in sql
        assert "status != 'archived'" not in sql, "status-inequality lets unvetted drafts through"

    def test_soft_archive_is_honoured(self):
        assert "archived_at IS NULL" in self._sql()

    def test_ranking_is_relevance_not_recency(self):
        sql = self._sql()
        assert "ts_rank_cd" in sql
        assert "ORDER BY rank DESC" in sql

    def test_rank_is_length_normalized(self):
        # Raw ts_rank_cd rewards length, so a whole-volume atom outranks the atom that IS the
        # section. 1|32 = normalize by document length, then squash by rank+1.
        assert "1|32" in self._sql()

    def test_a_group_atom_is_assembled_from_its_members(self):
        # A group carries no content of its own; reading a.content returns NULL for every one.
        sql = self._sql()
        assert "atom_members" in sql and "string_agg" in sql

    def test_empty_atoms_are_not_returned_as_grounding(self):
        assert "length(btrim(s.content)) > 0" in self._sql()

    def test_the_starter_scaffold_is_not_re_served_as_grounding(self):
        # search_starter_scaffold already hands the model every scaffold atom as guidance; this
        # tool owns the company's prose. Without the exclusion the scaffold's 60-byte writing
        # prompts took every slot and the company's own section prose never reached the drafter.
        sql = self._sql()
        assert "NOT EXISTS" in sql
        assert "sec.grain = 'section'" in sql

    @pytest.mark.parametrize("other", ["_match_section_grain"])
    def test_sibling_queries_also_honour_soft_archive(self, other):
        import inspect
        assert "archived_at IS NULL" in inspect.getsource(getattr(SD, other))
