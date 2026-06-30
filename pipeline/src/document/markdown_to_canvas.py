"""
Markdown → CanvasDocument converter (the strawman/draft → canvas landing format).

section_drafter (and any AI drafter) emits markdown; proposal_sections.content holds
a CanvasDocument JSON that the frontend canvas renders. This bridges the two: it parses
a markdown draft into CanvasNode dicts and wraps them in a CanvasDocument matching
frontend/lib/types/canvas-document.ts EXACTLY (version/document_id/canvas/nodes/metadata,
and per-node id/type/content/style/provenance/history/library_eligible).

Pure stdlib — no external deps, so it is trivially unit-testable. v1 handles
heading / text_block / bulleted_list / numbered_list. Tables/images come from library
atoms and human edits, not the AI strawman, so they are intentionally out of scope here.
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


def _strip_inline(text: str) -> str:
    """Drop markdown emphasis markers for v1 (no inline_formats yet)."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)        # bold
    text = re.sub(r"__(.+?)__", r"\1", text)            # bold (underscore)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)\*", r"\1", text)  # italic
    text = re.sub(r"`(.+?)`", r"\1", text)              # inline code
    return text.strip()


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

    def flush_para() -> None:
        nonlocal para
        if para:
            text = _strip_inline(" ".join(para).strip())
            if text:
                nodes.append(_node("text_block", {"text": text}, actor_id=actor_id, actor_name=actor_name, source=source))
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

    def flush_all() -> None:
        flush_para()
        flush_bullets()
        flush_numbers()

    for raw in (md or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            flush_all()
            continue

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
