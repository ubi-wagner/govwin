"""A mold is scaffolding, not a draft.

Provisioning stamps content_source='template' on every section it seeds from a master mold. That
label used to be a blanket "leave it alone" in both draft_v0's selection and publish_section_draft's
landing guard — correct when a mold meant a priced cost workbook or a filled slide deck, and quietly
catastrophic once the mold builder started seeding every authored section with a STRUCTURAL skeleton:
the item heading, a rules callout, empty text blocks. Every section then looked "already drafted",
the V0 drafter selected none of them, and the workflow reported drafted:0 / no_empty_sections while
the customer's proposal sat with headings and no prose. No error anywhere.

These lock the replacement rule: judge the canvas by what it CONTAINS.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from workflows.actions.draft_v0 import _has_prose  # noqa: E402


def _mold_skeleton():
    """Exactly what lib/ingest/molds.ts buildMoldCanvas emits for a structural mold."""
    return {
        "version": 1,
        "nodes": [
            {"type": "heading", "content": {"text": "Phase I Statement of Work", "level": 1}},
            {"type": "callout", "content": {"text": "Technical Volume — 3 pages maximum · Times New Roman 10pt.", "variant": "info"}},
            {"type": "heading", "content": {"text": "Task 1", "level": 2}},
            {"type": "text_block", "content": {"text": ""}},
            {"type": "text_block", "content": {"text": ""}},
        ],
    }


def test_structural_mold_is_not_a_draft():
    assert _has_prose(_mold_skeleton()) is False


def test_mold_with_many_headings_is_still_not_a_draft():
    # The technical-volume mold stamps one heading per mandated section. A dozen headings is a
    # dozen headings, not a proposal.
    doc = {"nodes": [{"type": "heading", "content": {"text": f"Section {i}", "level": 2}} for i in range(12)]}
    assert _has_prose(doc) is False


def test_a_written_section_is_protected():
    doc = {"nodes": [
        {"type": "heading", "content": {"text": "Phase I Statement of Work", "level": 1}},
        {"type": "text_block", "content": {"text": " ".join(["The Phase I effort establishes technical feasibility"] * 6)}},
    ]}
    assert _has_prose(doc) is True


def test_a_priced_workbook_is_protected():
    # The computed cost volume lands as a table. Overwriting it with a strawman would destroy
    # real numbers, which is what the original guard existed to prevent.
    doc = {"nodes": [{"type": "table", "content": {
        "headers": ["Category", "Hours", "Rate", "Cost"],
        "rows": [[f"Line {i}", "190", "$50.00", "$12,825.00"] for i in range(9)],
    }}]}
    assert _has_prose(doc) is True


def test_a_filled_bulleted_list_counts():
    doc = {"nodes": [{"type": "bulleted_list", "content": {"items": [
        {"text": "Demonstrated feasibility of adapting the seeker-confusion inventions to EO cameras"},
        {"text": "Defined preliminary HALAR and DEXTER architecture with a MOSA specification"},
        {"text": "Quantified expected performance, tracking disruption and reduced size weight and power"},
    ]}}]}
    assert _has_prose(doc) is True


def test_v2_sections_shape_is_handled():
    doc = {"sections": [{"groups": [{"nodes": [
        {"type": "text_block", "content": {"text": " ".join(["substantive proposal prose here"] * 10)}},
    ]}]}]}
    assert _has_prose(doc) is True


def test_json_string_and_junk_are_safe():
    assert _has_prose(json.dumps(_mold_skeleton())) is False
    for junk in (None, "", "not json", 42, [], {}):
        assert _has_prose(junk) is False
