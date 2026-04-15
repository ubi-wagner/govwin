"""Memory-namespace key computation — Phase 1 §D6.

Computes the deterministic `{agency}:{program_office}:{type}:{phase}`
(or 3-part `{agency}:{type}:{phase}`) string stored in
`curated_solicitations.namespace` and used by `memory.search_namespace`
for cross-cycle pre-fill. Rules are BINDING and sourced from
docs/NAMESPACES.md §"Memory namespace keys".

This module is intentionally pure Python — no DB, no HTTP, no side
effects — so it can be unit-tested table-driven without fixtures.
"""
from __future__ import annotations

import re
from typing import Optional

# Agencies that run their SBIR/STTR/funding programs directly without
# a distinct program-office segment. Keys for these agencies collapse
# to the 3-part form `{agency}:{type}:{phase}`.
_THREE_PART_AGENCIES = frozenset({"NSF", "NIH", "DOE", "USDA", "DOT", "DHS", "NASA"})

# Canonical agency aliases. Free-form `opportunities.agency` strings
# get mapped to a stable acronym. A future docs/AGENCY_MAP.md will
# grow this; for Phase 1 we seed with the common cases observed in
# the SAM.gov / SBIR.gov / Grants.gov stub fixtures plus real-world
# names that show up in triage.
_AGENCY_ALIASES: dict[str, str] = {
    "DEPT OF DEFENSE": "DOD",
    "DEPARTMENT OF DEFENSE": "DOD",
    "DEPT OF THE AIR FORCE": "USAF",
    "DEPARTMENT OF THE AIR FORCE": "USAF",
    "AIR FORCE": "USAF",
    "DEPT OF THE NAVY": "NAVY",
    "DEPARTMENT OF THE NAVY": "NAVY",
    "DEPT OF THE ARMY": "ARMY",
    "DEPARTMENT OF THE ARMY": "ARMY",
    "NATIONAL SCIENCE FOUNDATION": "NSF",
    "NATIONAL INSTITUTES OF HEALTH": "NIH",
    "DEPARTMENT OF ENERGY": "DOE",
    "DEPT OF ENERGY": "DOE",
    "DEFENSE ADVANCED RESEARCH PROJECTS AGENCY": "DARPA",
    "DEPT OF HOMELAND SECURITY": "DHS",
    "DEPARTMENT OF HOMELAND SECURITY": "DHS",
    "DEPARTMENT OF TRANSPORTATION": "DOT",
    "DEPARTMENT OF AGRICULTURE": "USDA",
    "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION": "NASA",
}

# Reserved placeholder for the program_office / phase segment when
# classification cannot confidently populate it. MUST NOT appear in
# the agency or type segments (docs/NAMESPACES.md §"Reserved values").
UNKNOWN = "unknown"

_PUNCT_RE = re.compile(r"[^\w\s]")


def _normalize_agency(agency: Optional[str]) -> Optional[str]:
    """Uppercase + strip punctuation + alias resolution."""
    if not agency:
        return None
    cleaned = _PUNCT_RE.sub(" ", agency).strip().upper()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return _AGENCY_ALIASES.get(cleaned, cleaned)


def _normalize_office(office: Optional[str], agency: Optional[str]) -> Optional[str]:
    """Uppercase + strip punctuation. Returns None if null or equal to agency."""
    if not office:
        return None
    cleaned = _PUNCT_RE.sub(" ", office).strip().upper()
    cleaned = re.sub(r"\s+", " ", cleaned)
    # Collapse to 3-part when office matches agency verbatim (docs/NAMESPACES.md §derivation rule 2)
    if agency and cleaned == agency:
        return None
    return cleaned or None


def _normalize_type(program_type: Optional[str]) -> Optional[str]:
    """Map ingester program_type values to the canonical type segment.

    Ingesters emit values like 'sbir_phase_1' — we want just 'SBIR' for
    the type segment. Phase is extracted separately.
    """
    if not program_type:
        return None
    value = program_type.strip().lower()
    for prefix, canonical in (
        ("sbir", "SBIR"),
        ("sttr", "STTR"),
        ("baa", "BAA"),
        ("ota", "OTA"),
        ("rif", "RIF"),
        ("cso", "CSO"),
    ):
        if value.startswith(prefix):
            return canonical
    return None


def _normalize_phase(program_type: Optional[str], phase: Optional[str]) -> Optional[str]:
    """Derive the phase segment.

    Prefers an explicit `phase` arg (e.g. 'Phase I' from SBIR.gov). Falls
    back to inspecting the ingester-style program_type suffix
    ('sbir_phase_1' -> 'Phase1').
    """
    if phase:
        p = phase.strip().lower()
        # Order matters: check Phase3/Phase2 before Phase1 because "ii"
        # and "iii" end with "i" and would otherwise fire the Phase1 branch.
        if "phase" in p and ("3" in p or "iii" in p):
            return "Phase3"
        if "phase" in p and ("2" in p or "ii" in p):
            return "Phase2"
        if "phase" in p and ("1" in p or p.endswith(" i") or p.endswith("phasei") or p == "phase i"):
            return "Phase1"
        if p in ("direct", "open"):
            return p.capitalize()

    if program_type:
        pt = program_type.strip().lower()
        if pt.endswith("phase_1") or pt.endswith("phase1"):
            return "Phase1"
        if pt.endswith("phase_2") or pt.endswith("phase2"):
            return "Phase2"
        if pt.endswith("phase_3") or pt.endswith("phase3"):
            return "Phase3"
        if pt in ("baa", "ota", "rif", "cso"):
            return "Open"
    return None


def compute_namespace_key(
    agency: Optional[str],
    office: Optional[str],
    program_type: Optional[str],
    phase: Optional[str] = None,
) -> Optional[str]:
    """Compute the canonical memory-namespace key for a solicitation.

    Returns `{agency}:{program_office}:{type}:{phase}` (or the 3-part
    form for agencies in _THREE_PART_AGENCIES). Returns None when the
    required parts (agency or type) cannot be derived — such rows must
    stay in triage until reclassified.

    See docs/NAMESPACES.md §"Memory namespace keys" for rules.
    """
    a = _normalize_agency(agency)
    t = _normalize_type(program_type)
    if not a or not t:
        return None

    p = _normalize_phase(program_type, phase) or UNKNOWN

    # 3-part form for agencies that run programs without a distinct office
    if a in _THREE_PART_AGENCIES:
        return f"{a}:{t}:{p}"

    # 4-part form — office defaults to `unknown` when null but only
    # after the 3-part-agency check above (so NSF doesn't get `:unknown:`)
    o = _normalize_office(office, a) or UNKNOWN
    return f"{a}:{o}:{t}:{p}"
