"""Map Claude-extracted compliance variable names to named DB columns.

The `compliance_extraction.txt` prompt returns matches keyed by
`variable_name`. Most of those names correspond to a real column on
`solicitation_compliance` (e.g. `page_limit_technical` → column,
`font_family` → column, `taba_allowed` → column). The long tail —
one-off variables from custom compliance rubrics, agency-specific
quirks — lives in `solicitation_compliance.custom_variables` (JSONB).

This module defines:
  1. The allow-list of names that map to real columns (KNOWN_COLUMNS).
  2. The type cast per column, since Claude returns JSON values and
     the columns are typed (int, text, boolean, numeric).
  3. A pure translator function that splits a list of matches into
     (named_column_updates: dict, custom_variables: dict).

Kept separate from `runner.py` so it can be unit-tested without any
DB or Claude dependency and so the mapping is easy to extend without
editing the orchestrator.
"""
from __future__ import annotations

from typing import Any


# Map of Claude variable_name → (column_name, target_type).
# The target_type is how we coerce Claude's JSON value into what
# postgres wants (int, str, bool, float). Anything not in this map
# falls through to `custom_variables`.
#
# Column names are verbatim from solicitation_compliance (see
# db/migrations/001_baseline.sql). If a variable is added there, add
# a row here too so the shredder can populate it automatically.
KNOWN_COLUMNS: dict[str, tuple[str, type]] = {
    # Page limits
    "page_limit_technical": ("page_limit_technical", int),
    "page_limit_cost": ("page_limit_cost", int),
    # Formatting
    "font_family": ("font_family", str),
    "font_size": ("font_size", str),
    "margins": ("margins", str),
    "margin_inches": ("margins", str),  # common Claude phrasing → margins column
    "line_spacing": ("line_spacing", str),
    # Headers/footers
    "header_required": ("header_required", bool),
    "header_format": ("header_format", str),
    "footer_required": ("footer_required", bool),
    "footer_format": ("footer_format", str),
    # Submission + media
    "submission_format": ("submission_format", str),
    "images_tables_allowed": ("images_tables_allowed", bool),
    "slides_allowed": ("slides_allowed", bool),
    "slide_limit": ("slide_limit", int),
    # Budget / partners
    "taba_allowed": ("taba_allowed", bool),
    "indirect_rate_cap": ("indirect_rate_cap", float),
    "partner_max_pct": ("partner_max_pct", float),
    "cost_sharing_required": ("cost_sharing_required", bool),
    "cost_volume_format": ("cost_volume_format", str),
    # PI rules
    "pi_must_be_employee": ("pi_must_be_employee", bool),
    "pi_university_allowed": ("pi_university_allowed", bool),
    # Security
    "clearance_required": ("clearance_required", str),
    "itar_required": ("itar_required", bool),
}


class ComplianceMappingError(ValueError):
    """Raised when a Claude match can't be coerced into the column's type."""


def _coerce(value: Any, target: type) -> Any:
    """Coerce a JSON-loaded value into the target Python type.

    Raises ComplianceMappingError on unrecoverable type mismatch.
    None passes through to let callers decide whether to skip.
    """
    if value is None:
        return None

    if target is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            v = value.strip().lower()
            if v in ("true", "yes", "y", "1", "required", "mandatory"):
                return True
            if v in ("false", "no", "n", "0", "not required", "prohibited"):
                return False
        raise ComplianceMappingError(f"cannot coerce {value!r} to bool")

    if target is int:
        if isinstance(value, bool):
            raise ComplianceMappingError(f"refusing to coerce bool {value!r} to int")
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, str) and value.strip().lstrip("-").isdigit():
            return int(value.strip())
        raise ComplianceMappingError(f"cannot coerce {value!r} to int")

    if target is float:
        if isinstance(value, bool):
            raise ComplianceMappingError(f"refusing to coerce bool {value!r} to float")
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip().rstrip("%"))
            except ValueError as e:
                raise ComplianceMappingError(f"cannot coerce {value!r} to float") from e
        raise ComplianceMappingError(f"cannot coerce {value!r} to float")

    if target is str:
        if isinstance(value, str):
            return value.strip()
        return str(value)

    raise ComplianceMappingError(f"unsupported target type {target.__name__}")


def split_matches(
    matches: list[dict[str, Any]],
    min_confidence: float = 0.7,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """Split Claude compliance matches into column updates + custom vars.

    Args:
        matches: List of {variable_name, value, confidence, ...} dicts.
        min_confidence: Skip matches below this threshold. The prompt
            instructs Claude to only return >=0.7 so this is defense in
            depth against a misbehaving model.

    Returns:
        (column_updates, custom_variables, skipped)

        - column_updates: {db_column_name: coerced_value} for matches
          that mapped cleanly to a known column.
        - custom_variables: {variable_name: raw_match_dict} for matches
          that didn't map (stored in solicitation_compliance.custom_variables).
        - skipped: list of variable_names dropped (below confidence or
          failed type coercion). Logged by the runner for visibility.
    """
    column_updates: dict[str, Any] = {}
    custom_variables: dict[str, Any] = {}
    skipped: list[str] = []

    for match in matches:
        name = match.get("variable_name")
        if not name:
            continue

        confidence = match.get("confidence", 0.0)
        if not isinstance(confidence, (int, float)) or confidence < min_confidence:
            skipped.append(f"{name}:low_confidence={confidence}")
            continue

        value = match.get("value")

        # Known column path — coerce value, fold into column_updates.
        # Last-write-wins if the same column appears twice (aliases like
        # margin_inches → margins); not a concern in practice.
        if name in KNOWN_COLUMNS:
            col, target = KNOWN_COLUMNS[name]
            try:
                column_updates[col] = _coerce(value, target)
            except ComplianceMappingError as e:
                skipped.append(f"{name}:coerce_failed={e}")
            continue

        # Long-tail path — keep the full match dict so curators see
        # confidence + source_excerpt when they review.
        custom_variables[name] = {
            "value": value,
            "source_excerpt": match.get("source_excerpt"),
            "page": match.get("page"),
            "confidence": confidence,
        }

    return column_updates, custom_variables, skipped
