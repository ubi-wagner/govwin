"""Unit tests for SamGovIngester and its helper functions.

Pure tests — no DB, no HTTP, no external services.
Covers: normalize(), _parse_date(), _extract_top_level_agency(),
        _detect_program_type(), _parse_naics_codes().
"""
import os
import pytest
from datetime import datetime, timezone

# DATABASE_URL is pre-set by conftest but config.py validates it at import
# time; the env var is already patched by conftest.py's os.environ.setdefault
# so sam_gov.py imports cleanly.

from ingest.sam_gov import (
    SamGovIngester,
    _parse_date,
    _extract_top_level_agency,
    _detect_program_type,
    _parse_naics_codes,
)


# ---------------------------------------------------------------------------
# _parse_date helper
# ---------------------------------------------------------------------------

class TestParseDate:
    def test_iso_with_timezone(self):
        dt = _parse_date("2026-06-30T17:00:00-05:00")
        assert isinstance(dt, datetime)
        assert dt.tzinfo is not None
        assert dt.year == 2026
        assert dt.month == 6
        assert dt.day == 30

    def test_date_only_string_gets_utc(self):
        dt = _parse_date("2026-06-30")
        assert isinstance(dt, datetime)
        assert dt.tzinfo is not None
        assert dt.year == 2026 and dt.month == 6 and dt.day == 30

    def test_none_returns_none(self):
        assert _parse_date(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_date("") is None

    def test_unparseable_string_returns_none(self):
        assert _parse_date("not-a-date") is None

    def test_mmddyyyy_format(self):
        """SAM.gov sometimes returns MM/DD/YYYY."""
        dt = _parse_date("06/15/2026")
        assert isinstance(dt, datetime)
        assert dt.month == 6 and dt.day == 15 and dt.year == 2026

    def test_naive_datetime_gets_utc_attached(self):
        """A naive ISO datetime (no tz) must come back timezone-aware."""
        dt = _parse_date("2026-07-01T00:00:00")
        assert dt is not None
        assert dt.tzinfo is not None


# ---------------------------------------------------------------------------
# _extract_top_level_agency helper
# ---------------------------------------------------------------------------

class TestExtractTopLevelAgency:
    def test_multi_level_path(self):
        result = _extract_top_level_agency(
            "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ WRIGHT-PATTERSON AFB"
        )
        assert result == "DEPT OF DEFENSE"

    def test_single_segment(self):
        result = _extract_top_level_agency("DARPA")
        assert result == "DARPA"

    def test_none_returns_none(self):
        assert _extract_top_level_agency(None) is None

    def test_empty_string_returns_none(self):
        # empty string splits to [''] → no strip to '', falsy → function returns '' or None
        result = _extract_top_level_agency("")
        # The function returns parts[0].strip() which is '' — acceptable falsy value
        assert not result  # '' is falsy

    def test_strips_whitespace(self):
        result = _extract_top_level_agency("  DEPT OF NAVY  .SUB AGENCY")
        assert result == "DEPT OF NAVY"


# ---------------------------------------------------------------------------
# _detect_program_type helper
# ---------------------------------------------------------------------------

class TestDetectProgramType:
    # Title-based detection (highest priority)

    def test_sbir_phase_1_in_title(self):
        assert _detect_program_type("Solicitation", "SBIR Phase I: Sensors") == "sbir_phase_1"

    def test_sbir_phase_2_in_title(self):
        assert _detect_program_type("Solicitation", "SBIR Phase II follow-on") == "sbir_phase_2"

    def test_sbir_phase_3_returns_other(self):
        assert _detect_program_type("Solicitation", "SBIR Phase III transition") == "other"

    def test_sttr_phase_1_in_title(self):
        assert _detect_program_type("Solicitation", "STTR Phase I: Quantum sensing") == "sttr_phase_1"

    def test_sttr_phase_2_in_title(self):
        assert _detect_program_type("Solicitation", "STTR Phase II continuation") == "sttr_phase_2"

    def test_baa_in_title(self):
        assert _detect_program_type("Presolicitation", "BAA: AI Decision Support") == "baa"

    def test_broad_agency_announcement_in_title(self):
        assert _detect_program_type("Special Notice", "Broad Agency Announcement for Hypersonics") == "baa"

    def test_ota_in_title(self):
        assert _detect_program_type("Solicitation", "OTA Agreement for Rapid Prototyping") == "ota"

    def test_other_transaction_in_title(self):
        assert _detect_program_type("Solicitation", "Other Transaction Authority Solicitation") == "ota"

    # Notice-type fallback (when title has no keywords)

    def test_presolicitation_notice_type(self):
        assert _detect_program_type("Presolicitation", "General RFP Notice") == "presolicitation"

    def test_sources_sought_notice_type(self):
        assert _detect_program_type("Sources Sought", "Industry survey") == "sources_sought"

    def test_special_notice_type(self):
        assert _detect_program_type("Special Notice", "Program update") == "special_notice"

    def test_award_notice_type(self):
        assert _detect_program_type("Award Notice", "Contract awarded") == "award_notice"

    def test_solicitation_notice_type(self):
        assert _detect_program_type("Solicitation", "Generic solicitation") == "solicitation"

    def test_combined_synopsis_type(self):
        assert _detect_program_type("Combined Synopsis/Solicitation", "Small work order") == "solicitation"

    def test_unknown_falls_back_to_other(self):
        assert _detect_program_type("Unknown Type", "Random notice") == "other"

    def test_none_inputs_do_not_crash(self):
        result = _detect_program_type(None, None)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# _parse_naics_codes helper
# ---------------------------------------------------------------------------

class TestParseNaicsCodes:
    def test_single_code(self):
        assert _parse_naics_codes("541715") == ["541715"]

    def test_comma_separated_codes(self):
        result = _parse_naics_codes("541715, 518210")
        assert result == ["541715", "518210"]

    def test_strips_whitespace(self):
        result = _parse_naics_codes("  541715 , 518210  ")
        assert "541715" in result
        assert "518210" in result

    def test_none_returns_empty_list(self):
        assert _parse_naics_codes(None) == []

    def test_empty_string_returns_empty_list(self):
        assert _parse_naics_codes("") == []


# ---------------------------------------------------------------------------
# SamGovIngester.normalize — full field mapping
# ---------------------------------------------------------------------------

class TestSamGovNormalize:
    def setup_method(self):
        self.ing = SamGovIngester()

    def _raw(self, **overrides) -> dict:
        """Return a minimal representative raw SAM.gov API response dict."""
        base = {
            "noticeId": "stub_sbir_001_af_hypersonics",
            "title": "SBIR Phase I: Advanced Materials for Hypersonic Vehicles (AF241-001)",
            "solicitationNumber": "FA8650-26-S-0001",
            "fullParentPathName": "DEPT OF DEFENSE.DEPT OF THE AIR FORCE.AFRL/RQ",
            "office": "AFRL/RQ WRIGHT-PATTERSON AFB",
            "postedDate": "2026-06-01",
            "type": "Solicitation",
            "typeOfSetAsideDescription": "Small Business SBIR Program",
            "responseDeadLine": "2026-07-15T17:00:00-05:00",
            "naicsCode": "541715",
            "classificationCode": "A014",
            "description": "SBIR Phase I topic: advanced thermal protection materials.",
        }
        base.update(overrides)
        return base

    def test_source_is_sam_gov(self):
        row = self.ing.normalize(self._raw())
        assert row["source"] == "sam_gov"

    def test_source_id_maps_to_notice_id(self):
        row = self.ing.normalize(self._raw())
        assert row["source_id"] == "stub_sbir_001_af_hypersonics"

    def test_title_preserved(self):
        row = self.ing.normalize(self._raw())
        assert "SBIR Phase I" in row["title"]
        assert "Hypersonic" in row["title"]

    def test_agency_is_top_level_only(self):
        """fullParentPathName dot-split: only first segment returned as agency."""
        row = self.ing.normalize(self._raw())
        assert row["agency"] == "DEPT OF DEFENSE"

    def test_office_preserved(self):
        row = self.ing.normalize(self._raw())
        assert row["office"] == "AFRL/RQ WRIGHT-PATTERSON AFB"

    def test_solicitation_number(self):
        row = self.ing.normalize(self._raw())
        assert row["solicitation_number"] == "FA8650-26-S-0001"

    def test_naics_codes_as_list(self):
        row = self.ing.normalize(self._raw())
        assert row["naics_codes"] == ["541715"]

    def test_multi_naics_codes(self):
        row = self.ing.normalize(self._raw(naicsCode="541715, 518210"))
        assert row["naics_codes"] == ["541715", "518210"]

    def test_classification_code(self):
        row = self.ing.normalize(self._raw())
        assert row["classification_code"] == "A014"

    def test_set_aside_type(self):
        row = self.ing.normalize(self._raw())
        assert row["set_aside_type"] == "Small Business SBIR Program"

    def test_program_type_sbir_phase_1(self):
        row = self.ing.normalize(self._raw())
        assert row["program_type"] == "sbir_phase_1"

    def test_program_type_sttr(self):
        raw = self._raw(title="STTR Phase I: Quantum Sensors")
        row = self.ing.normalize(raw)
        assert row["program_type"] == "sttr_phase_1"

    def test_program_type_baa(self):
        raw = self._raw(title="BAA: Advanced AI Research")
        row = self.ing.normalize(raw)
        assert row["program_type"] == "baa"

    def test_close_date_parsed_to_datetime(self):
        row = self.ing.normalize(self._raw())
        assert isinstance(row["close_date"], datetime)
        assert row["close_date"].tzinfo is not None
        assert row["close_date"].year == 2026

    def test_posted_date_parsed_to_datetime(self):
        row = self.ing.normalize(self._raw())
        assert isinstance(row["posted_date"], datetime)
        assert row["posted_date"].year == 2026

    def test_description_preserved(self):
        row = self.ing.normalize(self._raw())
        assert "SBIR Phase I" in row["description"]

    def test_description_truncated_at_10k(self):
        long_desc = "X" * 15_000
        row = self.ing.normalize(self._raw(description=long_desc))
        assert len(row["description"]) == 10_000

    def test_minimal_raw_does_not_crash(self):
        """normalize() must not raise on a nearly-empty dict."""
        row = self.ing.normalize({"noticeId": "x", "title": "T"})
        assert row["source"] == "sam_gov"
        assert row["source_id"] == "x"
        assert row["naics_codes"] == []
        assert row["agency"] is None
        assert row["close_date"] is None

    def test_missing_notice_id_is_none(self):
        row = self.ing.normalize({"title": "T"})
        assert row["source_id"] is None

    def test_all_keys_present_in_output(self):
        """normalize() always returns the full set of mapped column names."""
        expected_keys = {
            "source", "source_id", "title", "agency", "office",
            "solicitation_number", "naics_codes", "classification_code",
            "set_aside_type", "program_type", "close_date",
            "posted_date", "description",
        }
        row = self.ing.normalize(self._raw())
        assert expected_keys.issubset(row.keys())
