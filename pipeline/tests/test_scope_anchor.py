"""
Where a SCOPED colour-team finding lands.

Before mig 207 a review was one-per-section, so `agent_task_queue.section_id` addressed it
completely and the write-back needed no anchor. Now a review can be aimed at one node, one
library-derived group, a page range or the whole document — and the finding has to say which, or a
comment about a single figure renders as a comment about the whole section.

The anchor reuses the shape mig 183 already added for span-anchored comments (`{nodeId, quote}`)
rather than inventing a parallel one. That is what keeps the partial index
`idx_proposal_comments_anchor_node` (on `anchor->>'nodeId'`) working and every existing reader
untouched — a reader that only knows `nodeId` and `quote` simply ignores the scope keys.

Two properties matter more than the mapping itself:

  · AN UNSCOPED REVIEW WRITES NO ANCHOR. The section fan-out is a live path; if it started
    emitting anchors, every existing section-thread comment would change shape for no reason.

  · A MALFORMED INPUT PRODUCES NO MALFORMED ANCHOR. `input` is a jsonb column filled by a
    different service. Every value is either checked against a closed vocabulary or dropped.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agents.fabric import _scope_anchor  # noqa: E402


def test_an_unscoped_review_writes_no_anchor():
    # The exact shape the section fan-out sends today.
    assert _scope_anchor({"requested_by": "u", "section_title": "Technical Approach"}) is None


def test_a_section_scope_writes_no_anchor_either():
    # section_id already addresses it completely; an anchor would be noise.
    assert _scope_anchor({"scope_level": "section"}) is None


def test_a_node_scope_carries_the_node_id_where_the_index_can_see_it():
    a = _scope_anchor({"scope_level": "node", "scope_ref": {"nodeId": "sec-1__n-4"}})
    assert a["scopeLevel"] == "node"
    assert a["nodeId"] == "sec-1__n-4"  # bare key — idx_proposal_comments_anchor_node reads this


def test_a_group_scope_carries_the_group_id():
    a = _scope_anchor({"scope_level": "group", "scope_ref": {"groupId": "g-abc"}})
    assert a == {"scopeLevel": "group", "groupId": "g-abc"}


def test_a_page_range_survives_the_round_trip_as_integers():
    a = _scope_anchor({"scope_level": "pages", "scope_ref": {"pages": {"start": 3, "end": 5}}})
    assert a["pages"] == {"start": 3, "end": 5}


def test_a_document_scope_records_the_level_with_no_ref():
    assert _scope_anchor({"scope_level": "document"}) == {"scopeLevel": "document"}


def test_the_label_travels_so_the_ui_can_say_what_was_reviewed():
    a = _scope_anchor({"scope_level": "pages", "scope_label": "Pages 3–5",
                       "scope_ref": {"pages": {"start": 3, "end": 5}}})
    assert a["scopeLabel"] == "Pages 3–5"


def test_camelCase_input_is_read_too():
    # The frontend mirrors every key in both cases; neither spelling may be the only one that works.
    a = _scope_anchor({"scopeLevel": "node", "scopeRef": {"nodeId": "n-1"}, "scopeLabel": "image"})
    assert a == {"scopeLevel": "node", "scopeLabel": "image", "nodeId": "n-1"}


def test_an_unknown_level_is_refused_rather_than_stored():
    assert _scope_anchor({"scope_level": "paragraph", "scope_ref": {"nodeId": "n-1"}}) is None
    assert _scope_anchor({"scope_level": 42}) is None


def test_a_malformed_ref_degrades_to_the_level_alone():
    for ref in ("not-a-dict", None, [], {"pages": "3-5"}, {"pages": {"start": "x"}},
                {"pages": {"start": 9, "end": 2}}, {"nodeId": ""}, {"nodeId": 17}):
        a = _scope_anchor({"scope_level": "pages", "scope_ref": ref})
        assert a == {"scopeLevel": "pages"}, ref


def test_oversized_strings_are_bounded():
    a = _scope_anchor({"scope_level": "node", "scope_ref": {"nodeId": "x" * 5000},
                       "scope_label": "y" * 5000})
    assert len(a["nodeId"]) == 200
    assert len(a["scopeLabel"]) == 200


def test_a_zero_or_negative_page_is_refused():
    for pages in ({"start": 0, "end": 2}, {"start": -1, "end": 1}):
        assert _scope_anchor({"scope_level": "pages", "scope_ref": {"pages": pages}}) \
            == {"scopeLevel": "pages"}
