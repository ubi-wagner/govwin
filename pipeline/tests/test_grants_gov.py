"""
Tests for Grants.gov ingester — date parsing, program type detection,
content hashing, ALN extraction, and deduplication.

All tests are pure (no DB or API calls needed).
"""

import hashlib
import json
from datetime import datetime, timezone

import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from ingest.grants_gov import (
    _content_hash,
    _parse_date,
    _detect_program_type,
    _extract_aln_codes,
    SBIR_GRANT_AGENCIES,
    SBIR_KEYWORDS,
)


# ── Date parsing ──

class TestDateParsing:
    def test_us_date_format(self):
        result = _parse_date("03/15/2025")
        assert result is not None
        assert result.year == 2025
        assert result.month == 3
        assert result.day == 15

    def test_iso_format(self):
        result = _parse_date("2025-03-15")
        assert result is not None
        assert result.year == 2025

    def test_iso_format_with_tz(self):
        result = _parse_date("2025-03-15T17:00:00-05:00")
        assert result is not None
        assert result.year == 2025

    def test_none_returns_none(self):
        assert _parse_date(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_date("") is None

    def test_invalid_format_returns_none(self):
        assert _parse_date("not-a-date") is None

    def test_result_has_utc_timezone(self):
        result = _parse_date("2025-06-01")
        assert result is not None
        assert result.tzinfo == timezone.utc


# ── Program type detection ──

class TestProgramTypeDetection:
    def test_sbir_phase_1(self):
        assert _detect_program_type("SBIR Phase I", "") == "sbir_phase_1"

    def test_sbir_phase_2(self):
        assert _detect_program_type("SBIR Phase II Grant", "") == "sbir_phase_2"

    def test_sbir_phase_2_numeric(self):
        assert _detect_program_type("SBIR Phase 2", "") == "sbir_phase_2"

    def test_sttr_phase_1(self):
        assert _detect_program_type("STTR Phase I Application", "") == "sttr_phase_1"

    def test_sttr_phase_2(self):
        assert _detect_program_type("STTR Phase II Continuation", "") == "sttr_phase_2"

    def test_sbir_in_description(self):
        assert _detect_program_type("Grant Opportunity", "This is an SBIR Phase I grant") == "sbir_phase_1"

    def test_sttr_takes_priority(self):
        """STTR should be detected even if SBIR also appears."""
        assert _detect_program_type("STTR/SBIR Phase I", "") == "sttr_phase_1"

    def test_no_match_returns_other(self):
        assert _detect_program_type("Generic Grant Opportunity", "Some description") == "other"

    def test_sbir_phase_3_returns_other(self):
        assert _detect_program_type("SBIR Phase III", "") == "other"

    def test_case_insensitive(self):
        assert _detect_program_type("sbir phase i", "") == "sbir_phase_1"


# ── ALN/CFDA extraction ──

class TestALNExtraction:
    def test_single_aln(self):
        assert _extract_aln_codes("93.395") == ["93.395"]

    def test_multiple_alns(self):
        result = _extract_aln_codes("93.395, 93.396")
        assert result == ["93.395", "93.396"]

    def test_aln_in_text(self):
        result = _extract_aln_codes("NIH funding under ALN 93.395")
        assert "93.395" in result

    def test_none_returns_empty(self):
        assert _extract_aln_codes(None) == []

    def test_empty_string_returns_empty(self):
        assert _extract_aln_codes("") == []

    def test_no_match_returns_empty(self):
        assert _extract_aln_codes("no codes here") == []


# ── Content hashing ──

class TestContentHashing:
    def test_same_content_same_hash(self):
        data = {"id": 12345, "title": "SBIR Phase I"}
        assert _content_hash(data) == _content_hash(data)

    def test_different_content_different_hash(self):
        data1 = {"id": 12345, "title": "Version A"}
        data2 = {"id": 12345, "title": "Version B"}
        assert _content_hash(data1) != _content_hash(data2)

    def test_hash_length(self):
        assert len(_content_hash({"test": True})) == 16

    def test_key_order_doesnt_matter(self):
        data1 = {"b": 2, "a": 1}
        data2 = {"a": 1, "b": 2}
        assert _content_hash(data1) == _content_hash(data2)


# ── Configuration ──

class TestConfiguration:
    def test_sbir_agencies_includes_key_agencies(self):
        assert "HHS" in SBIR_GRANT_AGENCIES     # NIH
        assert "DOE" in SBIR_GRANT_AGENCIES
        assert "NSF" in SBIR_GRANT_AGENCIES
        assert "USDA" in SBIR_GRANT_AGENCIES
        assert "NASA" in SBIR_GRANT_AGENCIES
        assert "DOC" in SBIR_GRANT_AGENCIES      # NIST, NOAA

    def test_keywords_cover_sbir_sttr(self):
        assert "SBIR" in SBIR_KEYWORDS
        assert "STTR" in SBIR_KEYWORDS

    def test_at_least_6_target_agencies(self):
        assert len(SBIR_GRANT_AGENCIES) >= 6

    def test_at_least_2_keywords(self):
        assert len(SBIR_KEYWORDS) >= 2


# ── Ingester instantiation ──

class TestIngesterInit:
    def test_can_instantiate_with_none_conn(self):
        from ingest.grants_gov import GrantsGovIngester
        ingester = GrantsGovIngester(conn=None)
        assert ingester.conn is None
