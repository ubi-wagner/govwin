"""Table-driven tests for Phase 1 §D6 — memory-namespace key computation.

Validates docs/NAMESPACES.md §"Memory namespace keys" examples and
edge cases. No DB, no HTTP — pure Python.
"""
import pytest

from shredder.namespace import compute_namespace_key


# Canonical examples from docs/NAMESPACES.md §"Memory namespace keys"
CANONICAL_EXAMPLES = [
    # (agency, office, program_type, phase, expected_key)
    ("Department of the Air Force", "AFWERX", "sbir_phase_1", None, "USAF:AFWERX:SBIR:Phase1"),
    ("Department of the Air Force", "AFWERX", "sbir_phase_2", None, "USAF:AFWERX:SBIR:Phase2"),
    ("Department of the Army", "DEVCOM", "sttr_phase_2", None, "ARMY:DEVCOM:STTR:Phase2"),
    # 3-part keys (agency runs program directly)
    ("National Science Foundation", None, "sbir_phase_1", None, "NSF:SBIR:Phase1"),
    ("National Institutes of Health", None, "sbir_phase_2", None, "NIH:SBIR:Phase2"),
    # 4-part key with unknown office
    ("DARPA", None, "baa", None, "DARPA:unknown:BAA:Open"),
]


@pytest.mark.parametrize("agency,office,program_type,phase,expected", CANONICAL_EXAMPLES)
def test_canonical_examples(agency, office, program_type, phase, expected):
    """Every example from docs/NAMESPACES.md produces the documented key."""
    assert compute_namespace_key(agency, office, program_type, phase) == expected


class TestAgencyNormalization:
    def test_acronym_passthrough(self):
        assert compute_namespace_key("USAF", "AFWERX", "sbir_phase_1", None) == "USAF:AFWERX:SBIR:Phase1"

    def test_alias_resolution_dod(self):
        assert compute_namespace_key("Department of Defense", "DARPA", "baa", None) == "DOD:DARPA:BAA:Open"

    def test_lowercase_input_uppercases(self):
        assert compute_namespace_key("usaf", "afwerx", "sbir_phase_1", None) == "USAF:AFWERX:SBIR:Phase1"

    def test_strips_punctuation(self):
        # Punctuation becomes space; consecutive spaces collapse.
        # "U.S. Air Force" has no canonical alias, so the normalized
        # form is what we get back as the agency segment.
        assert compute_namespace_key("U.S. Air Force", "AFWERX", "sbir_phase_1", None) == "U S AIR FORCE:AFWERX:SBIR:Phase1"


class TestOfficeHandling:
    def test_office_same_as_agency_collapses(self):
        """When office matches agency verbatim, 4-part → use 'unknown' office."""
        # DOD/DOD would become DOD:unknown:... rather than DOD:DOD:...
        assert compute_namespace_key("DOD", "DOD", "baa", None) == "DOD:unknown:BAA:Open"

    def test_null_office_for_4_part_agency(self):
        """Non-3-part agency with null office → office becomes 'unknown'."""
        assert compute_namespace_key("USAF", None, "sbir_phase_1", None) == "USAF:unknown:SBIR:Phase1"

    def test_three_part_agency_ignores_office(self):
        """NSF never gets an office segment even when one is provided."""
        assert compute_namespace_key("NSF", "SOMETHING", "sbir_phase_1", None) == "NSF:SBIR:Phase1"


class TestTypeNormalization:
    def test_sbir_suffix_variants(self):
        assert compute_namespace_key("USAF", "AFWERX", "SBIR", None) == "USAF:AFWERX:SBIR:unknown"

    def test_sttr_phase_2(self):
        assert compute_namespace_key("NAVY", "ONR", "sttr_phase_2", None) == "NAVY:ONR:STTR:Phase2"

    def test_unknown_type_returns_none(self):
        """Without a recognizable type, no key can be computed."""
        assert compute_namespace_key("USAF", "AFWERX", "mystery_program", None) is None

    def test_missing_type_returns_none(self):
        assert compute_namespace_key("USAF", "AFWERX", None, None) is None

    def test_missing_agency_returns_none(self):
        assert compute_namespace_key(None, "AFWERX", "sbir_phase_1", None) is None


class TestPhaseDerivation:
    def test_phase_arg_wins_over_program_type(self):
        # program_type suggests Phase1, explicit phase says Phase II
        key = compute_namespace_key("USAF", "AFWERX", "sbir_phase_1", "Phase II")
        assert key == "USAF:AFWERX:SBIR:Phase2"

    def test_baa_gets_open_phase(self):
        assert compute_namespace_key("DARPA", "I2O", "baa", None) == "DARPA:I2O:BAA:Open"

    def test_ota_gets_open_phase(self):
        assert compute_namespace_key("DOD", "OSTP", "ota", None) == "DOD:OSTP:OTA:Open"

    def test_unclassifiable_phase_falls_back_to_unknown(self):
        # SBIR with no phase info anywhere
        assert compute_namespace_key("USAF", "AFWERX", "SBIR", None) == "USAF:AFWERX:SBIR:unknown"


class TestReservedValues:
    def test_unknown_never_in_agency_or_type(self):
        """The UNKNOWN placeholder must not appear in agency or type segments."""
        # Can't construct a key where agency is unknown (returns None)
        assert compute_namespace_key(None, "AFWERX", "sbir_phase_1", None) is None
        # Can't construct a key where type is unknown (returns None)
        assert compute_namespace_key("USAF", "AFWERX", None, None) is None

    def test_unknown_allowed_in_office_segment(self):
        key = compute_namespace_key("USAF", None, "sbir_phase_1", None)
        assert "unknown" in key
        assert key.split(":")[0] != "unknown"
        assert key.split(":")[2] != "unknown"

    def test_unknown_allowed_in_phase_segment(self):
        key = compute_namespace_key("USAF", "AFWERX", "SBIR", None)
        assert key.endswith(":unknown")
