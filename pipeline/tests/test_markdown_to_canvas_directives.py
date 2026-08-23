"""
markdown_to_canvas — the three node types the shipped MOLDS use and markdown could not say.

Measured demand (frontend/scripts/analyze-node-demand.mjs) ranks node types by what the product
actually asks for. Molds are the independent signal there — they are hand-authored by admins, not
produced by the AI path, so they are not circular the way authored content and the atom library
are. The molds use page_break, callout and divider; the pipeline drafter round-trips through
markdown; and two of those three did not survive the trip.

What the round-trip did BEFORE this, measured rather than assumed:

    DEMANDED-BUT-MISSING: callout, page_break
       leaked into blockquote: '[!WARNING] 2 mandatory requirement(s) are traced to this section.'
       leaked into text_block: '<!-- pagebreak -->'

`divider` already worked (`***`), and so did `blockquote` — a correction to an earlier claim that
the converter handled five types; it handled seven. The remaining two are the gap.

The leaks matter more than the absences. A dropped node is content that never arrives; a LEAK is
markup arriving as prose, so `<!-- pagebreak -->` rendered as visible text in the customer's
proposal, and every alert began with a literal "[!WARNING]". That is worse than losing it.

Syntax choices are conventional rather than invented, which is the point of extending markdown
instead of replacing it:
  · callout    → GitHub's `> [!WARNING]` alert, a de-facto standard
  · divider    → `***`, NOT `---`, which collides with the table separator row and frontmatter
  · page_break → `<!-- pagebreak -->`, since markdown has no notion of one; an HTML comment
                 degrades to nothing visible in any renderer that does not know it, which is the
                 property that makes markdown safe to extend at all
"""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from document.markdown_to_canvas import markdown_to_nodes  # noqa: E402


def _types(md: str) -> Counter:
    return Counter(n["type"] for n in markdown_to_nodes(md))


def _text_of(nodes, node_type):
    return [str((n.get("content") or {}).get("text", "")) for n in nodes if n["type"] == node_type]


def test_alert_blockquote_becomes_a_callout_with_its_variant():
    nodes = markdown_to_nodes("> [!WARNING]\n> Two mandatory requirements are traced here.")
    callouts = [n for n in nodes if n["type"] == "callout"]
    assert len(callouts) == 1
    assert callouts[0]["content"]["variant"] == "warning"
    assert callouts[0]["content"]["text"] == "Two mandatory requirements are traced here."


def test_the_alert_marker_does_not_leak_into_the_visible_text():
    # The exact defect: the quote became a blockquote whose text began "[!WARNING]".
    nodes = markdown_to_nodes("> [!CAUTION]\n> Mind the gap.")
    for n in nodes:
        assert "[!" not in str((n.get("content") or {}).get("text", ""))


def test_every_alert_variant_maps():
    for marker, variant in [
        ("NOTE", "note"), ("TIP", "tip"), ("IMPORTANT", "info"),
        ("WARNING", "warning"), ("CAUTION", "warning"),
    ]:
        nodes = markdown_to_nodes(f"> [!{marker}]\n> body text")
        got = [n for n in nodes if n["type"] == "callout"]
        assert got, f"{marker} did not produce a callout"
        assert got[0]["content"]["variant"] == variant


def test_an_ordinary_quote_is_still_a_blockquote():
    # The regression guard on the change above: only MARKED quotes become callouts.
    nodes = markdown_to_nodes("> Simply a quotation, with no marker at all.")
    assert [n["type"] for n in nodes] == ["blockquote"]
    assert _text_of(nodes, "blockquote") == ["Simply a quotation, with no marker at all."]


def test_pagebreak_comment_becomes_a_page_break_node():
    nodes = markdown_to_nodes("Before.\n\n<!-- pagebreak -->\n\nAfter.")
    assert [n["type"] for n in nodes] == ["text_block", "page_break", "text_block"]


def test_pagebreak_spelling_is_forgiving():
    for spelling in ("<!-- pagebreak -->", "<!-- page-break -->", "<!--PAGE_BREAK-->", "<!--  page break  -->"):
        assert _types(spelling)["page_break"] == 1, spelling


def test_other_html_comments_are_dropped_not_rendered():
    # A comment reaching the page as prose is markup leaking into the customer's proposal.
    nodes = markdown_to_nodes("Kept.\n\n<!-- an editorial note nobody should ever see -->\n\nAlso kept.")
    assert [n["type"] for n in nodes] == ["text_block", "text_block"]
    joined = " ".join(_text_of(nodes, "text_block"))
    assert "<!--" not in joined and "editorial note" not in joined


def test_divider_uses_asterisks_not_dashes():
    # `---` is the table separator and the frontmatter fence; `***` is unambiguous.
    assert _types("a\n\n***\n\nb")["divider"] == 1


def test_a_dashed_rule_does_not_eat_a_following_table():
    md = "| Requirement | Addressed |\n| --- | --- |\n| One | Yes |\n"
    t = _types(md)
    assert t["table"] == 1, f"table lost: {t}"


def test_the_full_drafter_shape_round_trips_with_no_leaks():
    md = (
        "# Technical Approach\n\nLead paragraph.\n\n"
        "## Approach\n\nBody.\n\n- bullet one\n- bullet two\n\n"
        "| Requirement | Addressed in |\n| --- | --- |\n| A work plan | §1 |\n| Key personnel | §2 |\n\n"
        "> [!WARNING]\n> 2 mandatory requirement(s) are traced to this section.\n\n"
        "***\n\n<!-- pagebreak -->\n"
    )
    nodes = markdown_to_nodes(md)
    t = Counter(n["type"] for n in nodes)
    for required in ("heading", "text_block", "bulleted_list", "table", "callout", "divider", "page_break"):
        assert t[required] >= 1, f"{required} missing from {dict(t)}"
    for n in nodes:
        body = str((n.get("content") or {}).get("text", ""))
        assert "<!--" not in body and "[!" not in body, f"markup leaked: {body!r}"
