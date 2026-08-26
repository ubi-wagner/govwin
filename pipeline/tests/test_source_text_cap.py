"""The shredder must not quietly read a fifth of a solicitation.

MAX_CHARS_PER_DOCUMENT was 200_000 with a comment asserting that "a typical BAA can reach 150K" and
that the ceiling "covers all known RFP formats". The real documents in docs/ say otherwise:

    DoD 25.1 SBIR BAA      1,341,245 chars
    DoW 2026 SBIR BAA      1,013,966 chars
    DoD 25.A STTR BAA        449,600 chars

So the annual BAAs — the documents this product exists to read — were cut to 15-20% of their
length, silently. Whatever a solicitation states past the cut is invisible to the pattern
extractor, which then reports "not stated in the source" and the field falls back to a
"Default — unverified" that reads like a finding rather than a blind spot we created.
docs/INGEST_PROVENANCE.md: a value the product did not read from the solicitation must never look
like one it did.

These pin both halves — the ceiling clears real documents, and crossing it is REPORTED rather than
merely happening.
"""
from __future__ import annotations

import pytest

from shredder.extractor import MAX_CHARS_PER_DOCUMENT, cap_source_text

# Measured from the PDFs in docs/, not guessed.
LARGEST_REAL_SOLICITATION = 1_341_245
OLD_CAP = 200_000


class TestTheCeiling:
    def test_clears_the_largest_real_solicitation(self):
        assert MAX_CHARS_PER_DOCUMENT > LARGEST_REAL_SOLICITATION
        _text, e = cap_source_text("z" * LARGEST_REAL_SOLICITATION)
        assert e["truncated"] is False

    def test_the_old_ceiling_would_have_lost_most_of_it(self):
        # The regression this pins: 85% of the largest real BAA, gone without a word.
        _text, e = cap_source_text("z" * LARGEST_REAL_SOLICITATION, cap=OLD_CAP)
        assert e["truncated"] is True
        lost = 1 - e["chars"] / e["original_chars"]
        assert lost > 0.8


class TestReporting:
    def test_under_the_cap_passes_through_and_reports_no_truncation(self):
        text, e = cap_source_text("the solicitation text")
        assert text == "the solicitation text"
        assert e["truncated"] is False
        assert e["chars"] == e["original_chars"]

    def test_over_the_cap_caps_and_SAYS_SO(self):
        text, e = cap_source_text("x" * (MAX_CHARS_PER_DOCUMENT + 5_000))
        assert len(text) == MAX_CHARS_PER_DOCUMENT
        assert e["truncated"] is True
        assert e["original_chars"] == MAX_CHARS_PER_DOCUMENT + 5_000
        assert e["cap_chars"] == MAX_CHARS_PER_DOCUMENT

    def test_exactly_at_the_cap_is_not_truncated(self):
        _text, e = cap_source_text("y" * MAX_CHARS_PER_DOCUMENT)
        assert e["truncated"] is False

    @pytest.mark.parametrize("raw", [None, ""])
    def test_empty_input_does_not_claim_to_have_read_anything(self, raw):
        text, e = cap_source_text(raw)
        assert text == ""
        assert e["chars"] == 0
        assert e["truncated"] is False


class TestParityWithTheFrontend:
    def test_the_record_carries_the_four_fields_both_services_agree_on(self):
        # lib/ingest/source-text-cap.ts writes {chars, truncated, originalChars, capChars}; this
        # writes the snake_case twins. A reader that understands one must understand the other, so
        # the SET of facts has to match even though the spelling does not.
        _text, e = cap_source_text("a" * 10)
        assert set(e) == {"chars", "truncated", "original_chars", "cap_chars"}

    def test_the_two_services_use_the_same_ceiling(self):
        # Kept in sync by hand across a language boundary, so assert the number rather than trusting
        # that a future edit to one side remembers the other.
        assert MAX_CHARS_PER_DOCUMENT == 2_000_000
