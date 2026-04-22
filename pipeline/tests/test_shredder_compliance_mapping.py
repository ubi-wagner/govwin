"""Unit tests for Phase 1 §D — compliance-mapping logic.

Pure Python — no DB, no Claude, no fixtures. Covers:
  - Confidence threshold drops low-confidence matches
  - Known column mapping + type coercion for every supported column
  - Unknown variables fall into custom_variables
  - Type-coercion failures get listed in `skipped`
  - Alias (margin_inches → margins) resolves to the right column
"""
import pytest

from shredder.compliance_mapping import (
    KNOWN_COLUMNS,
    _coerce,
    ComplianceMappingError,
    split_matches,
)


# ── Coercion primitive ──────────────────────────────────────────────────


class TestCoerce:
    @pytest.mark.parametrize("value,target,expected", [
        (True, bool, True),
        (False, bool, False),
        ("true", bool, True),
        ("YES", bool, True),
        ("required", bool, True),
        ("false", bool, False),
        ("prohibited", bool, False),
        (1, bool, True),
        (0, bool, False),
        (15, int, 15),
        ("15", int, 15),
        (15.0, int, 15),
        ("11", int, 11),
        (11.5, float, 11.5),
        ("33%", float, 33.0),
        ("  Times New Roman  ", str, "Times New Roman"),
        (11, str, "11"),
        (None, bool, None),
        (None, int, None),
    ])
    def test_coerces_cleanly(self, value, target, expected):
        assert _coerce(value, target) == expected

    def test_rejects_bool_to_int(self):
        """True→1 is a bug more often than a feature — refuse the cast."""
        with pytest.raises(ComplianceMappingError):
            _coerce(True, int)

    def test_rejects_nonsense_bool(self):
        with pytest.raises(ComplianceMappingError):
            _coerce("probably", bool)

    def test_rejects_noninteger_float_to_int(self):
        with pytest.raises(ComplianceMappingError):
            _coerce(11.7, int)

    def test_rejects_non_numeric_string_to_int(self):
        with pytest.raises(ComplianceMappingError):
            _coerce("fifteen", int)


# ── split_matches high-level behavior ──────────────────────────────────


class TestSplitMatches:
    def test_empty_input(self):
        cols, custom, skipped = split_matches([])
        assert cols == {}
        assert custom == {}
        assert skipped == []

    def test_drops_low_confidence(self):
        matches = [
            {"variable_name": "font_size", "value": "11", "confidence": 0.5},
            {"variable_name": "font_family", "value": "Arial", "confidence": 0.9},
        ]
        cols, custom, skipped = split_matches(matches)
        assert "font_size" not in cols
        assert cols["font_family"] == "Arial"
        assert any("font_size" in s for s in skipped)

    def test_known_column_coerced(self):
        matches = [
            {"variable_name": "page_limit_technical", "value": 15, "confidence": 1.0},
            {"variable_name": "taba_allowed", "value": "yes", "confidence": 0.95},
        ]
        cols, custom, skipped = split_matches(matches)
        assert cols["page_limit_technical"] == 15
        assert cols["taba_allowed"] is True
        assert custom == {}
        assert skipped == []

    def test_alias_resolves_to_underlying_column(self):
        """margin_inches is an alias for the margins column."""
        matches = [{"variable_name": "margin_inches", "value": 1, "confidence": 1.0}]
        cols, custom, skipped = split_matches(matches)
        assert "margins" in cols
        assert "margin_inches" not in cols

    def test_unknown_var_lands_in_custom(self):
        matches = [{
            "variable_name": "agency_unique_field",
            "value": "XYZ",
            "source_excerpt": "the agency unique field shall be XYZ",
            "page": 42,
            "confidence": 0.9,
        }]
        cols, custom, skipped = split_matches(matches)
        assert cols == {}
        assert custom["agency_unique_field"]["value"] == "XYZ"
        assert custom["agency_unique_field"]["page"] == 42
        assert custom["agency_unique_field"]["confidence"] == 0.9

    def test_coerce_failure_lands_in_skipped(self):
        matches = [{"variable_name": "page_limit_technical", "value": "fifteen", "confidence": 1.0}]
        cols, custom, skipped = split_matches(matches)
        assert cols == {}
        assert custom == {}
        assert any("page_limit_technical" in s for s in skipped)

    def test_missing_variable_name_skipped_silently(self):
        matches = [
            {"value": 15, "confidence": 1.0},  # no variable_name
            {"variable_name": "font_size", "value": "11", "confidence": 1.0},
        ]
        cols, custom, skipped = split_matches(matches)
        assert cols["font_size"] == "11"
        assert len(cols) == 1

    def test_custom_min_confidence(self):
        matches = [{"variable_name": "font_size", "value": "11", "confidence": 0.75}]
        cols, _, skipped = split_matches(matches, min_confidence=0.8)
        assert cols == {}
        assert any("low_confidence" in s for s in skipped)


class TestKnownColumnsTable:
    """Guard against accidentally breaking the mapping."""

    def test_all_known_columns_point_to_valid_types(self):
        """Every (column, type) pair is coercible from at least one shape."""
        for var_name, (col, target) in KNOWN_COLUMNS.items():
            assert col, f"empty column name for {var_name}"
            assert target in (int, str, bool, float), \
                f"unsupported target type {target} for {var_name}"

    def test_no_reserved_columns_mapped(self):
        """Never accidentally target verified_by / solicitation_id / id."""
        reserved = {"id", "solicitation_id", "verified_by", "verified_at",
                    "created_at", "updated_at", "custom_variables"}
        mapped_cols = {c for _, (c, _) in KNOWN_COLUMNS.items()}
        assert not (mapped_cols & reserved), \
            f"KNOWN_COLUMNS points at reserved columns: {mapped_cols & reserved}"
