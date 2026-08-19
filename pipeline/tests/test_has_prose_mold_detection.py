"""`_has_prose` — the gate that decides whether a section still needs writing.

It has to answer one question correctly in both directions, and getting either wrong is bad in a
different way:

  FALSE NEGATIVE (says "needs writing" about real content) → the drafter CLOBBERS a human's work.
  FALSE POSITIVE (says "already written" about a mold)     → the drafter SKIPS the section, and
                                                             "Full draft" silently does nothing.

The false positive is what shipped. `provision-proposal.ts` falls back to the CODE REGISTRY when no
admin-authored mold is linked — the default state of a freshly built-out master — and those molds
are a cover sheet plus form tables plus long bracketed instructions. Measured on a live 14-section
proposal: 507 words per section, 500 of them inside brackets, against a 25-word threshold. Mode C
reported "sections: 2" and drafted 2.

Two rules fix it, and both are about telling STRUCTURE from CONTENT:
  • a whole block that is one bracketed instruction is scaffolding, not writing
  • a table's cells are a form's LABELS; what makes a form filled is VALUES, not words
"""
import json

from workflows.actions.draft_v0 import _has_prose


def _doc(nodes):
    return {"nodes": nodes}


def _text(t):
    return {"type": "text_block", "content": {"text": t}}


LONG = "The prototype adapts the patented registration stage for a maritime sensor mast. " * 3


# ── must say NEEDS WRITING ───────────────────────────────────────────────────────────────────
def test_an_empty_mold_needs_writing():
    assert _has_prose(_doc([
        {"type": "heading", "content": {"level": 1, "text": "Technical Approach"}},
        {"type": "callout", "content": {"text": "10 pages maximum · Times New Roman 10pt"}},
        _text(""),
    ])) is False


def test_a_registry_mold_full_of_BRACKETED_INSTRUCTIONS_needs_writing():
    """The shipped bug: these blocks are not empty, they are full of instructions."""
    assert _has_prose(_doc([
        {"type": "heading", "content": {"level": 1, "text": "Identification and Significance"}},
        _text("[Describe the military or defense problem this topic addresses, the current state of "
              "the art, and why existing approaches are inadequate. Reference the specific DoW "
              "patent(s) you intend to commercialize and the associated laboratory.]"),
        _text("[Explain the technical modifications required to adapt the patented invention to the "
              "proposed product concept, including anticipated performance improvements.]"),
    ])) is False


def test_a_cover_sheet_of_UNFILLED_FORM_TABLES_needs_writing():
    """Field labels are the form, not a draft of it."""
    assert _has_prose(_doc([
        {"type": "heading", "content": {"level": 1, "text": "SBIR Phase I Cover Sheet"}},
        {"type": "table", "content": {"rows": [
            ["Proposal Number", ""], ["Topic Number", ""], ["Firm Name", ""],
            ["Principal Investigator", ""], ["Business Official", ""], ["Proposed Cost", ""],
        ]}},
    ])) is False


def test_bracketed_LIST_ITEMS_are_scaffolding_too():
    assert _has_prose(_doc([
        {"type": "numbered_list", "content": {"items": [
            {"text": "[Objective 1: e.g., Demonstrate feasibility of {approach} by {date}]"},
            {"text": "[Objective 2: e.g., Develop and validate a prototype {component}]"},
            {"text": "[Objective 3: e.g., Characterize {parameter} across {conditions}]"},
        ]}},
    ])) is False


# ── must say ALREADY WRITTEN (never clobber) ─────────────────────────────────────────────────
def test_a_real_draft_is_protected():
    assert _has_prose(_doc([{"type": "heading", "content": {"text": "x"}}, _text(LONG)])) is True


def test_a_paragraph_carrying_an_INLINE_placeholder_marker_is_still_a_draft():
    """The drafter's own system prompt asks it to leave "[PLACEHOLDER: …]" markers inside real
    paragraphs for claims needing verification. Only a WHOLE block that is one bracket is
    scaffolding — otherwise the fix would eat the drafter's own output."""
    assert _has_prose(_doc([_text(
        f"{LONG} [PLACEHOLDER: confirm the CEL application number with counsel]"
    )])) is True


def test_a_PRICED_cost_workbook_is_protected():
    """What distinguishes a filled form from an empty one is VALUES, not words."""
    assert _has_prose(_doc([
        {"type": "heading", "content": {"text": "Cost Summary"}},
        {"type": "table", "content": {
            "headers": ["Cost Element", "Amount"],
            "rows": [
                [{"text": "A. Direct Labor"}, {"text": "$93,500", "value": 93500}],
                [{"text": "B. Fringe Benefits"}, {"text": "$32,725", "value": 32725}],
            ],
        }},
    ])) is True


def test_a_form_with_even_ONE_entered_value_is_protected():
    # A partially filled form is still somebody's work.
    assert _has_prose(_doc([{"type": "table", "content": {"rows": [
        ["Proposal Number", "F2-17528"], ["Topic Number", ""], ["Proposed Cost", "249,880"],
    ]}}])) is True


def test_a_zero_only_table_is_not_treated_as_filled():
    # A provisional workbook stamped with zeros has not been priced.
    assert _has_prose(_doc([{"type": "table", "content": {"rows": [
        ["Direct Labor", "0"], ["Fringe", "$0"], ["Overhead", "-"],
    ]}}])) is False


# ── robustness ───────────────────────────────────────────────────────────────────────────────
def test_accepts_a_json_string_and_the_v2_sections_shape():
    v2 = {"sections": [{"groups": [{"nodes": [_text(LONG)]}]}]}
    assert _has_prose(json.dumps(v2)) is True
    assert _has_prose(json.dumps({"sections": [{"groups": [{"nodes": [_text("[fill this in]")]}]}]})) is False


def test_malformed_input_is_safe():
    for bad in (None, "", "not json", 42, [], {"nodes": "nope"}):
        assert _has_prose(bad) is False
