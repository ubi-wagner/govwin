"""markdown → canvas: the RICH block + inline vocabulary.

WHY THESE EXIST. v1 of the converter handled four node types and its `_strip_inline` DELETED every
emphasis marker on the way through ("no inline_formats yet"). Both limits produced the same
symptom in finished volumes — a wall of undifferentiated body text with no table anywhere outside
the cost form, even when the drafter had written both. Measured against a hand-built reference
volume for the same solicitation, a generated one carried ONE font face where the reference
carried nine.

The offset arithmetic is the part that must not rot: a run whose `start + length` exceeds the text
length is not cosmetic — the docx writer indexes into the string with it.
"""
from document.markdown_to_canvas import markdown_to_nodes, parse_inline


def _types(md: str) -> list[str]:
    return [n["type"] for n in markdown_to_nodes(md)]


def _first(md: str, node_type: str) -> dict:
    for n in markdown_to_nodes(md):
        if n["type"] == node_type:
            return n
    raise AssertionError(f"no {node_type} node in {_types(md)}")


# ── inline emphasis survives as runs ─────────────────────────────────────────────────────────
def test_bold_and_italic_become_runs_not_deleted_markers():
    text, runs = parse_inline("The **prototype** adapts *CEL* licensing.")
    assert text == "The prototype adapts CEL licensing."
    assert runs == [
        {"start": 4, "length": 9, "format": "bold"},
        {"start": 21, "length": 3, "format": "italic"},
    ]
    # the offsets actually point at the words they claim
    assert text[4:13] == "prototype"
    assert text[21:24] == "CEL"


def test_underscore_forms_and_inline_code():
    text, runs = parse_inline("__Bold__ and _italic_ and `code`.")
    assert text == "Bold and italic and code."
    assert [r["format"] for r in runs] == ["bold", "italic", "code"]
    for r in runs:
        assert 0 <= r["start"] and r["start"] + r["length"] <= len(text)


def test_underscores_inside_a_word_are_not_emphasis():
    # snake_case identifiers are everywhere in this domain (compute_budget, page_limit).
    text, runs = parse_inline("Call compute_budget with max_pages set.")
    assert text == "Call compute_budget with max_pages set."
    assert runs == []


def test_nested_emphasis_keeps_the_outer_run_and_flattens_the_inner():
    # The canvas models runs as a FLAT list, so an overlap cannot be represented.
    text, runs = parse_inline("**Bold with *inner* italic**")
    assert text == "Bold with inner italic"
    assert runs == [{"start": 0, "length": 22, "format": "bold"}]


def test_leading_whitespace_does_not_shift_the_offsets():
    text, runs = parse_inline("   **lead** trail   ")
    assert text == "lead trail"
    assert runs == [{"start": 0, "length": 4, "format": "bold"}]
    assert text[0:4] == "lead"


def test_every_run_stays_inside_the_text_it_annotates():
    md = "A **b** c *d* e `f` g **h** i _j_ k"
    text, runs = parse_inline(md)
    for r in runs:
        assert r["start"] >= 0
        assert r["start"] + r["length"] <= len(text), (r, text)


def test_a_paragraph_with_no_emphasis_omits_the_key_entirely():
    # An empty array is noise in every stored document; renderers treat absent and empty alike.
    node = _first("Plain sentence with no markers.", "text_block")
    assert "inline_formats" not in node["content"]


def test_headings_and_list_items_are_plain_text():
    # Their content models have no runs — the markers must be stripped, not carried.
    assert _first("# The **bold** heading", "heading")["content"]["text"] == "The bold heading"
    items = _first("- an *emphasised* item", "bulleted_list")["content"]["items"]
    assert items == [{"text": "an emphasised item"}]


# ── block types ──────────────────────────────────────────────────────────────────────────────
def test_markdown_table_becomes_a_table_node():
    node = _first(
        "| Milestone | Month |\n| --- | --- |\n| Kickoff | 0 |\n| Demo | 4 |",
        "table",
    )
    c = node["content"]
    assert c["headers"] == ["Milestone", "Month"]
    assert c["rows"] == [["Kickoff", "0"], ["Demo", "4"]]
    assert c["header_style"] == {"bold": True}


def test_a_ragged_table_is_padded_to_the_header_width():
    # A ragged row breaks the docx/xlsx writers, which index by column.
    c = _first("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |", "table")["content"]
    assert all(len(r) == 3 for r in c["rows"]), c["rows"]


def test_a_lone_piped_line_is_prose_not_a_one_row_table():
    # "Use the | character" must not become a table.
    assert "table" not in _types("Pipe | separated | prose with no separator row")


def test_blockquote_and_divider_and_code_fence():
    md = "> Only the first ten pages are evaluated.\n\n---\n\n```python\nprint(1)\n\nprint(2)\n```"
    ts = _types(md)
    assert ts == ["blockquote", "divider", "code_block"]
    code = _first(md, "code_block")["content"]
    # a blank line INSIDE the fence is code, not a paragraph break
    assert code["code"] == "print(1)\n\nprint(2)"
    assert code["language"] == "python"


def test_all_three_rule_spellings():
    for rule in ("---", "***", "___"):
        assert _types(f"a\n\n{rule}\n\nb") == ["text_block", "divider", "text_block"]


def test_an_unterminated_fence_still_lands_its_content():
    node = _first("```\nnever closed", "code_block")
    assert node["content"]["code"] == "never closed"


def test_a_full_section_produces_the_whole_vocabulary():
    md = (
        "# Technical Approach\n\n"
        "The **prototype** adapts US Patent *11,234,567*.\n\n"
        "| Milestone | Month |\n| --- | --- |\n| Kickoff | 0 |\n\n"
        "> Only the first ten pages are evaluated.\n\n"
        "---\n\n"
        "## Risks\n"
        "- Supply chain\n"
        "- Integration\n\n"
        "1. First\n2. Second\n"
    )
    assert _types(md) == [
        "heading", "text_block", "table", "blockquote", "divider",
        "heading", "bulleted_list", "numbered_list",
    ]


# ── node envelope invariants ─────────────────────────────────────────────────────────────────
def test_every_new_node_type_carries_the_full_envelope():
    md = "| a |\n| --- |\n| 1 |\n\n> q\n\n---\n\n```\nx\n```"
    for n in markdown_to_nodes(md):
        assert set(n) >= {"id", "type", "content", "style", "provenance", "history", "library_eligible"}
        assert n["provenance"]["source"] == "ai_draft"
        assert isinstance(n["history"], list) and n["history"]


def test_conversion_is_stable_across_runs():
    md = "# H\n\nBody with **bold**.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"
    a = [(n["type"], n["content"]) for n in markdown_to_nodes(md)]
    b = [(n["type"], n["content"]) for n in markdown_to_nodes(md)]
    assert a == b


def test_empty_and_whitespace_input_are_safe():
    assert markdown_to_nodes("") == []
    assert markdown_to_nodes("   \n\n  \n") == []
