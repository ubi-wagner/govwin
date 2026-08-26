"""
Markdown → CanvasDocument converter (the strawman/draft → canvas landing format).

section_drafter (and any AI drafter) emits markdown; proposal_sections.content holds
a CanvasDocument JSON that the frontend canvas renders. This bridges the two: it parses
a markdown draft into CanvasNode dicts and wraps them in a CanvasDocument matching
frontend/lib/types/canvas-document.ts EXACTLY (version/document_id/canvas/nodes/metadata,
and per-node id/type/content/style/provenance/history/library_eligible).

Pure stdlib — no external deps, so it is trivially unit-testable.

WHAT CHANGED AND WHY. v1 handled heading / text_block / bulleted_list / numbered_list, and
`_strip_inline` DELETED every `**bold**` and `*italic*` marker on the way through ("no
inline_formats yet"). Both limits showed up as the same symptom in finished volumes: a wall of
undifferentiated body text. Measured against a hand-built reference volume for the same
solicitation, a generated one carried ONE font face where the reference carried nine, and no
table anywhere outside the cost form — even when the drafter had written both.

An evaluator skimming for "does this address the requirement" navigates by visual weight. Emphasis
and tables are not decoration; they are how a reader finds the answer. So this now parses:

    **bold** / __bold__ / *italic* / _italic_ / `code`   → text_block.inline_formats runs
    | a | b |  (with a --- separator row)                → table  (header row + body rows)
    > quoted                                             → blockquote
    ``` fenced ```                                       → code_block
    ---  ***  ___  (on their own line)                   → divider

Images still come from library atoms and the capture tool rather than the drafter — a model
cannot produce a raster — so `![]()` is deliberately left alone.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

# NodeTypes that are NOT library-eligible (mirror createNode in canvas-document.ts).
_NON_LIBRARY = ("page_break", "spacer", "toc")

_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
_BULLET = re.compile(r"^\s*[-*+]\s+(.*\S)\s*$")
_NUMBERED = re.compile(r"^\s*\d+[.)]\s+(.*\S)\s*$")
_QUOTE = re.compile(r"^\s*>\s?(.*)$")
_FENCE = re.compile(r"^\s*```\s*(\w+)?\s*$")
# A rule, NOT a bullet: `---` alone. `_BULLET` would otherwise never see it (it needs text after
# the dash), but `***` would match the italic scanner, so match rules before anything else.
_RULE = re.compile(r"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$")
# GitHub alert marker opening a blockquote: `> [!WARNING]`.
_ALERT = re.compile(r"^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$", re.I)
# Any HTML comment on its own line, and the page-break directive specifically.
_COMMENT = re.compile(r"^<!--.*-->$")
_PAGEBREAK = re.compile(r"^<!--\s*page[\s_-]?break\s*-->$", re.I)

# A table row: at least one pipe, and pipes are not all at the very ends of an empty line.
_TABLE_ROW = re.compile(r"^\s*\|(.+)\|\s*$")
# The separator under a table header: | --- | :---: | ---: |
_TABLE_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")

# Inline emphasis, longest-marker-first so `**x**` is never read as two `*x*`.
_INLINE = [
    (re.compile(r"\*\*(.+?)\*\*", re.S), "bold"),
    (re.compile(r"__(.+?)__", re.S), "bold"),
    (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", re.S), "italic"),
    (re.compile(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", re.S), "italic"),
    (re.compile(r"`(.+?)`", re.S), "code"),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _node(
    node_type: str,
    content: dict[str, Any],
    *,
    actor_id: str,
    actor_name: str,
    source: str,
) -> dict[str, Any]:
    ts = _now()
    return {
        "id": str(uuid.uuid4()),
        "type": node_type,
        "content": content,
        "style": {},
        "provenance": {
            "source": source,
            "drafted_by": actor_id,
            "drafted_at": ts,
        },
        "history": [
            {"actor_id": actor_id, "actor_name": actor_name, "action": "created", "timestamp": ts}
        ],
        "library_eligible": node_type not in _NON_LIBRARY,
    }


def parse_inline(text: str) -> tuple[str, list[dict[str, Any]]]:
    """Strip markdown emphasis markers and RETURN them as inline_formats runs.

    The v1 behaviour (`_strip_inline`) deleted the markers and kept only the plain text, so a
    drafter that carefully bolded its key claims produced a canvas with no emphasis anywhere — the
    single largest contributor to generated volumes reading as a wall of undifferentiated type.

    Offsets are computed against the FINAL plain string, which is why markers are consumed
    left-to-right in one pass rather than by successive `re.sub` calls: after a substitution every
    offset to its right has moved, and a run whose start+length exceeds the text length is not a
    cosmetic problem — the docx writer indexes into the string with it.

    Nested emphasis (`**bold with *italic* inside**`) keeps the OUTER run and flattens the inner
    markers into text; representing overlaps would need a tree, and the canvas format models runs
    as a flat list. `code` maps to the `code` format the canvas defines for inline monospace.
    """
    out: list[str] = []
    runs: list[dict[str, Any]] = []
    i = 0
    n = len(text)
    while i < n:
        m = None
        fmt = ""
        for pattern, name in _INLINE:
            candidate = pattern.match(text, i)
            if candidate:
                m, fmt = candidate, name
                break
        if m:
            inner = m.group(1)
            # Flatten any markers left inside the captured span (see the nesting note above).
            plain_inner, _ = parse_inline(inner) if _has_marker(inner) else (inner, [])
            start = len("".join(out))
            out.append(plain_inner)
            if plain_inner:
                runs.append({"start": start, "length": len(plain_inner), "format": fmt})
            i = m.end()
            continue
        out.append(text[i])
        i += 1

    plain = "".join(out)
    # `.strip()` moves every offset; do it by adjusting the runs rather than after the fact.
    lead = len(plain) - len(plain.lstrip())
    plain = plain.strip()
    if lead:
        runs = [{**r, "start": r["start"] - lead} for r in runs]
    runs = [r for r in runs if r["start"] >= 0 and r["start"] + r["length"] <= len(plain)]
    runs.sort(key=lambda r: r["start"])
    return plain, runs


def _has_marker(text: str) -> bool:
    return any(ch in text for ch in ("*", "_", "`"))


def _strip_inline(text: str) -> str:
    """Plain text only — for nodes whose content model has no runs (headings, list items)."""
    return parse_inline(text)[0]


def _split_row(line: str) -> list[str]:
    """Cells of a markdown table row, without the outer pipes."""
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    return [c.strip() for c in inner.split("|")]


def markdown_to_nodes(
    md: str,
    *,
    actor_id: str = "system",
    actor_name: str = "AI Strawman",
    source: str = "ai_draft",
) -> list[dict[str, Any]]:
    """Parse a markdown draft into CanvasNode dicts (heading / text_block / lists)."""
    nodes: list[dict[str, Any]] = []
    para: list[str] = []
    bullets: list[str] = []
    numbers: list[str] = []
    quote: list[str] = []
    table: list[str] = []
    fence: list[str] | None = None   # non-None while inside a ``` block
    fence_lang = ""

    def flush_para() -> None:
        nonlocal para
        if para:
            text, runs = parse_inline(" ".join(para).strip())
            if text:
                content: dict[str, Any] = {"text": text}
                # Omit the key entirely when there is no emphasis — an empty array is noise in
                # every stored document and the renderers treat absent and empty identically.
                if runs:
                    content["inline_formats"] = runs
                nodes.append(_node("text_block", content, actor_id=actor_id, actor_name=actor_name, source=source))
        para = []

    def flush_bullets() -> None:
        nonlocal bullets
        if bullets:
            nodes.append(_node("bulleted_list", {"items": [{"text": b} for b in bullets]}, actor_id=actor_id, actor_name=actor_name, source=source))
        bullets = []

    def flush_numbers() -> None:
        nonlocal numbers
        if numbers:
            nodes.append(_node("numbered_list", {"items": [{"text": n} for n in numbers]}, actor_id=actor_id, actor_name=actor_name, source=source))
        numbers = []

    # GitHub's alert syntax — `> [!WARNING]` on the first line of a blockquote. A de-facto
    # standard rather than an invented directive, and it is what the shipped molds use a `callout`
    # node for. Without this the marker LEAKED: the quote became a blockquote whose visible text
    # began "[!WARNING]", so the reader saw the markup.
    _ALERT_VARIANT = {
        "note": "note", "tip": "tip", "important": "info",
        "warning": "warning", "caution": "warning",
    }

    def flush_quote() -> None:
        nonlocal quote
        if quote:
            lines_ = list(quote)
            variant: str | None = None
            m_alert = _ALERT.match(lines_[0]) if lines_ else None
            if m_alert:
                variant = _ALERT_VARIANT.get(m_alert.group(1).lower())
                lines_ = lines_[1:]                     # drop the marker line itself
            text, runs = parse_inline(" ".join(lines_).strip())
            if text:
                content: dict[str, Any] = {"text": text}
                if runs:
                    content["inline_formats"] = runs
                if variant:
                    # A callout carries its severity; a blockquote does not.
                    nodes.append(_node("callout", {"variant": variant, **content},
                                       actor_id=actor_id, actor_name=actor_name, source=source))
                else:
                    nodes.append(_node("blockquote", content,
                                       actor_id=actor_id, actor_name=actor_name, source=source))
        quote = []

    def flush_table() -> None:
        nonlocal table
        # A single row with no separator is not a table — it is a line that happens to contain a
        # pipe, and turning it into a one-column table would be worse than leaving it as prose.
        if len(table) >= 2:
            headers = _split_row(table[0])
            rows = [_split_row(r) for r in table[2:]] if _TABLE_SEP.match(table[1]) else [_split_row(r) for r in table[1:]]
            width = len(headers)
            # Pad/trim so every row matches the header width; a ragged table breaks the exporters.
            rows = [(r + [""] * width)[:width] for r in rows]
            nodes.append(_node(
                "table",
                {"headers": [_strip_inline(h) for h in headers],
                 "rows": [[_strip_inline(c) for c in r] for r in rows],
                 "header_style": {"bold": True},
                 "border_style": "single"},
                actor_id=actor_id, actor_name=actor_name, source=source,
            ))
        elif table:
            for line in table:
                text, runs = parse_inline(line.strip())
                if text:
                    content: dict[str, Any] = {"text": text}
                    if runs:
                        content["inline_formats"] = runs
                    nodes.append(_node("text_block", content, actor_id=actor_id, actor_name=actor_name, source=source))
        table = []

    def flush_all() -> None:
        flush_para()
        flush_bullets()
        flush_numbers()
        flush_quote()
        flush_table()

    for raw in (md or "").splitlines():
        line = raw.rstrip()

        # ── fenced code: consume verbatim until the closing fence ──────────────────────────
        # Checked FIRST, before the blank-line flush: a blank line inside a code block is part of
        # the code, not a paragraph break.
        f = _FENCE.match(line)
        if fence is not None:
            if f:
                nodes.append(_node(
                    "code_block",
                    {"code": "\n".join(fence), "language": fence_lang or None},
                    actor_id=actor_id, actor_name=actor_name, source=source,
                ))
                fence, fence_lang = None, ""
            else:
                fence.append(raw)
            continue
        if f:
            flush_all()
            fence, fence_lang = [], (f.group(1) or "")
            continue

        if not line.strip():
            flush_all()
            continue

        # ── a horizontal rule ─────────────────────────────────────────────────────────────
        # Before the bullet scanner: `---` alone would otherwise be ambiguous, and `***` would be
        # read by the italic pass.
        if _RULE.match(line):
            flush_all()
            nodes.append(_node("divider", {"line_style": "solid"}, actor_id=actor_id, actor_name=actor_name, source=source))
            continue

        # ── table rows accumulate until a non-row line ────────────────────────────────────
        if _TABLE_ROW.match(line):
            flush_para()
            flush_bullets()
            flush_numbers()
            flush_quote()
            table.append(line)
            continue
        if table:
            flush_table()

        # ── HTML comments ─────────────────────────────────────────────────────────────────
        # Markdown has no page break, so `<!-- pagebreak -->` is the directive. Everything else in
        # comment syntax is DROPPED rather than rendered: a comment that reaches the page as
        # visible text is markup leaking into the customer's proposal, which is how
        # `<!-- pagebreak -->` used to arrive — as a literal text_block a reviewer would read.
        m_comment = _COMMENT.match(line)
        if m_comment:
            flush_all()
            if _PAGEBREAK.match(line):
                nodes.append(_node("page_break", {}, actor_id=actor_id, actor_name=actor_name, source=source))
            continue

        # ── blockquote ────────────────────────────────────────────────────────────────────
        q = _QUOTE.match(line)
        if q:
            flush_para()
            flush_bullets()
            flush_numbers()
            quote.append(q.group(1).strip())
            continue
        if quote:
            flush_quote()

        h = _HEADING.match(line)
        if h:
            flush_all()
            level = min(len(h.group(1)), 3)
            nodes.append(_node("heading", {"level": level, "text": _strip_inline(h.group(2))}, actor_id=actor_id, actor_name=actor_name, source=source))
            continue

        b = _BULLET.match(line)
        if b:
            flush_para()
            flush_numbers()
            bullets.append(_strip_inline(b.group(1)))
            continue

        n = _NUMBERED.match(line)
        if n:
            flush_para()
            flush_bullets()
            numbers.append(_strip_inline(n.group(1)))
            continue

        # plain text → accumulate into the current paragraph
        flush_bullets()
        flush_numbers()
        para.append(line.strip())

    # An unterminated ``` fence still has to land its content rather than vanish.
    if fence is not None and fence:
        nodes.append(_node(
            "code_block",
            {"code": "\n".join(fence), "language": fence_lang or None},
            actor_id=actor_id, actor_name=actor_name, source=source,
        ))
    flush_all()
    return nodes


def build_canvas_document(
    md: str,
    *,
    document_id: str,
    canvas: dict[str, Any],
    metadata: dict[str, Any],
    actor_id: str = "system",
    actor_name: str = "AI Strawman",
    source: str = "ai_draft",
) -> dict[str, Any]:
    """Wrap a markdown draft into a full CanvasDocument (matches canvas-document.ts)."""
    return {
        "version": 1,
        "document_id": document_id,
        "canvas": canvas,
        "nodes": markdown_to_nodes(md, actor_id=actor_id, actor_name=actor_name, source=source),
        "metadata": metadata,
    }
