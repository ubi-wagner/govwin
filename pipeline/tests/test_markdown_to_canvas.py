"""Unit tests for the markdown → CanvasDocument converter (the strawman landing format)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from document.markdown_to_canvas import markdown_to_nodes, build_canvas_document  # noqa: E402

SAMPLE = """\
# Technical Approach

Our approach delivers **substantive** results grounded in past performance.

## Objectives

- Reduce latency by 40%
- Improve reliability

## Work Plan

1. Phase I feasibility
2. Phase II prototype
"""


def _types(nodes):
    return [n["type"] for n in nodes]


def test_structure_and_order():
    nodes = markdown_to_nodes(SAMPLE)
    assert _types(nodes) == [
        "heading", "text_block", "heading", "bulleted_list", "heading", "numbered_list"
    ], _types(nodes)


def test_heading_levels_clamped():
    nodes = markdown_to_nodes("# A\n\n## B\n\n#### D")
    levels = [n["content"]["level"] for n in nodes if n["type"] == "heading"]
    assert levels == [1, 2, 3], levels  # #### clamps to 3


def test_inline_emphasis_stripped():
    nodes = markdown_to_nodes("This is **bold** and *italic* and `code`.")
    assert nodes[0]["content"]["text"] == "This is bold and italic and code."


def test_list_items():
    nodes = markdown_to_nodes("- one\n- two\n- three")
    assert nodes[0]["type"] == "bulleted_list"
    assert [i["text"] for i in nodes[0]["content"]["items"]] == ["one", "two", "three"]


def test_node_shape_matches_canvas_document_ts():
    node = markdown_to_nodes("hello")[0]
    for key in ("id", "type", "content", "style", "provenance", "history", "library_eligible"):
        assert key in node, f"missing {key}"
    assert node["provenance"]["source"] == "ai_draft"
    assert node["provenance"]["drafted_by"] == "system"
    assert node["history"][0]["action"] == "created"
    assert node["library_eligible"] is True
    assert node["style"] == {}


def test_build_canvas_document_shape():
    doc = build_canvas_document(
        SAMPLE,
        document_id="doc-1",
        canvas={"format": "letter", "width": 612},
        metadata={"title": "T", "status": "ai_drafted"},
    )
    assert doc["version"] == 1
    assert doc["document_id"] == "doc-1"
    assert doc["canvas"]["format"] == "letter"
    assert isinstance(doc["nodes"], list) and len(doc["nodes"]) == 6
    assert doc["metadata"]["status"] == "ai_drafted"


def test_empty_input_is_safe():
    assert markdown_to_nodes("") == []
    assert markdown_to_nodes(None) == []  # type: ignore[arg-type]


if __name__ == "__main__":
    # Runnable without pytest (pure stdlib).
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\nPASS — {len(fns)} tests")
