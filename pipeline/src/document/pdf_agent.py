"""
PDF Document Agent — read-only ingest and atomization of PDF files.

Uses pymupdf4llm for high-quality markdown extraction from PDFs, preserving
headings, lists, tables, and page structure. PDF is a read-only format in
this system: the agent can ingest and atomize but cannot write native PDF.

To produce PDF output from edited content, hand off the CanvasBundle to a
DOCX or PPTX agent, then use that agent's export_pdf() to render via
LibreOffice.

Pipeline:
    PDF in → PdfAgent.ingest() → CanvasBundle → edit on canvas →
    docx_agent.export(bundle) → converter.convert_to_pdf() → PDF out
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Optional

from .base import (
    AgentCapability,
    AtomGroup,
    CanvasBundle,
    CanvasNode,
    ComplianceConstraints,
    DocumentAgent,
    ExportResult,
)

logger = logging.getLogger(__name__)

try:
    import pymupdf
    import pymupdf4llm

    _HAS_PYMUPDF = True
except ImportError:
    _HAS_PYMUPDF = False
    pymupdf = None  # type: ignore[assignment]
    pymupdf4llm = None  # type: ignore[assignment]

# PDF points per inch — used for page dimension conversion
_POINTS_PER_INCH = 72.0
MAX_PDF_PAGES = 500


def _make_id() -> str:
    """Generate a short unique node ID."""
    return str(uuid.uuid4())


# ── Markdown line-by-line parser ─────────────────────────────────────────

_RE_HEADING = re.compile(r"^(#{1,6})\s+(.+)$")
_RE_BULLET = re.compile(r"^[\s]*[-*]\s+(.+)$")
_RE_NUMBERED = re.compile(r"^[\s]*\d+\.\s+(.+)$")
_RE_TABLE_ROW = re.compile(r"^\|(.+)\|$")
_RE_TABLE_SEPARATOR = re.compile(r"^\|[\s:|-]+\|$")
_RE_HORIZ_RULE = re.compile(r"^-{3,}$")
_RE_PAGE_MARKER = re.compile(r"^-{3,}$|^={3,}$|^\f")


def _parse_markdown_to_nodes(md_text: str) -> list[CanvasNode]:
    """
    Parse pymupdf4llm markdown output into CanvasNode objects.

    Handles: headings, paragraphs, bulleted lists, numbered lists,
    markdown tables, and page break markers.
    """
    nodes: list[CanvasNode] = []
    lines = md_text.split("\n")
    i = 0

    # Accumulators for multi-line constructs
    bullet_items: list[str] = []
    numbered_items: list[str] = []
    table_rows: list[list[str]] = []
    in_table = False

    def _flush_bullets() -> None:
        nonlocal bullet_items
        if bullet_items:
            nodes.append(CanvasNode(
                id=_make_id(),
                type="bulleted_list",
                content={"items": list(bullet_items)},
            ))
            bullet_items = []

    def _flush_numbered() -> None:
        nonlocal numbered_items
        if numbered_items:
            nodes.append(CanvasNode(
                id=_make_id(),
                type="numbered_list",
                content={"items": list(numbered_items)},
            ))
            numbered_items = []

    def _flush_table() -> None:
        nonlocal table_rows, in_table
        if table_rows:
            # First row is headers, remaining are data rows
            headers = table_rows[0] if table_rows else []
            data = table_rows[1:] if len(table_rows) > 1 else []
            nodes.append(CanvasNode(
                id=_make_id(),
                type="table",
                content={
                    "headers": headers,
                    "rows": data,
                },
            ))
            table_rows = []
        in_table = False

    def _flush_all() -> None:
        _flush_bullets()
        _flush_numbered()
        _flush_table()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip empty lines (flush accumulators first)
        if not stripped:
            # Empty line breaks list accumulation but not table accumulation
            if not in_table:
                _flush_bullets()
                _flush_numbered()
            i += 1
            continue

        # ── Headings ──
        m_heading = _RE_HEADING.match(stripped)
        if m_heading:
            _flush_all()
            level = len(m_heading.group(1))
            text = m_heading.group(2).strip()
            nodes.append(CanvasNode(
                id=_make_id(),
                type="heading",
                content={"text": text, "level": level},
            ))
            i += 1
            continue

        # ── Table rows ──
        m_table = _RE_TABLE_ROW.match(stripped)
        if m_table:
            # Check for separator row (| --- | --- |) — skip it
            if _RE_TABLE_SEPARATOR.match(stripped):
                in_table = True
                i += 1
                continue

            _flush_bullets()
            _flush_numbered()
            in_table = True
            cells = [c.strip() for c in m_table.group(1).split("|")]
            table_rows.append(cells)
            i += 1
            continue

        # If we were in a table and this line is not a table row, flush
        if in_table:
            _flush_table()

        # ── Horizontal rule / page break ──
        if _RE_HORIZ_RULE.match(stripped) or stripped == "\f":
            _flush_all()
            nodes.append(CanvasNode(
                id=_make_id(),
                type="page_break",
                content={},
            ))
            i += 1
            continue

        # ── Bulleted list ──
        m_bullet = _RE_BULLET.match(stripped)
        if m_bullet:
            _flush_numbered()
            _flush_table()
            bullet_items.append(m_bullet.group(1).strip())
            i += 1
            continue

        # ── Numbered list ──
        m_numbered = _RE_NUMBERED.match(stripped)
        if m_numbered:
            _flush_bullets()
            _flush_table()
            numbered_items.append(m_numbered.group(1).strip())
            i += 1
            continue

        # ── Normal paragraph (text block) ──
        _flush_all()
        # Accumulate consecutive non-empty, non-special lines as one paragraph
        para_lines = [stripped]
        i += 1
        while i < len(lines):
            next_stripped = lines[i].strip()
            if not next_stripped:
                break
            if (
                _RE_HEADING.match(next_stripped)
                or _RE_BULLET.match(next_stripped)
                or _RE_NUMBERED.match(next_stripped)
                or _RE_TABLE_ROW.match(next_stripped)
                or _RE_HORIZ_RULE.match(next_stripped)
                or next_stripped == "\f"
            ):
                break
            para_lines.append(next_stripped)
            i += 1

        nodes.append(CanvasNode(
            id=_make_id(),
            type="text_block",
            content={"text": " ".join(para_lines)},
        ))

    # Flush any remaining accumulators
    _flush_all()

    return nodes


# ── PDF Agent ────────────────────────────────────────────────────────────


class PdfAgent(DocumentAgent):
    """
    Document agent for PDF files.

    Capabilities:
      - READ_NATIVE: ingest PDFs via pymupdf4llm markdown extraction
      - IMAGES: extract/reference images embedded in PDFs

    Does NOT support WRITE_NATIVE. To produce PDF output from edited
    content, hand off the bundle to a DOCX agent and use its export_pdf().
    """

    def __init__(self) -> None:
        if not _HAS_PYMUPDF:
            raise ImportError(
                "pymupdf and pymupdf4llm are required for PdfAgent. "
                "Install with: pip install pymupdf pymupdf4llm"
            )

    @property
    def format_id(self) -> str:
        return "pdf"

    @property
    def display_name(self) -> str:
        return "PDF Document Agent"

    @property
    def file_extensions(self) -> list[str]:
        return ["pdf"]

    @property
    def capabilities(self) -> set[AgentCapability]:
        return {
            AgentCapability.READ_NATIVE,
            AgentCapability.IMAGES,
        }

    # ── Ingest ────────────────────────────────────────────────────────

    async def ingest(self, file_bytes: bytes, filename: str) -> CanvasBundle:
        """
        Read a PDF file and produce a CanvasBundle.

        Uses pymupdf4llm for markdown extraction, then parses the markdown
        into structured CanvasNodes. Extracts document metadata (title,
        author, page count, dimensions) from the pymupdf Document object.
        """
        if not file_bytes:
            raise ValueError(f"PdfAgent: empty file '{filename}'")

        doc = pymupdf.open(stream=file_bytes, filetype="pdf")
        if doc.page_count > MAX_PDF_PAGES:
            doc.close()
            raise ValueError(
                f"PdfAgent: '{filename}' has {doc.page_count} pages, "
                f"exceeding the {MAX_PDF_PAGES}-page limit"
            )
        try:
            # Extract markdown via pymupdf4llm
            md_text: str = pymupdf4llm.to_markdown(doc)

            # Parse markdown into canvas nodes
            nodes = _parse_markdown_to_nodes(md_text)

            # Extract metadata from the PDF document object
            pdf_meta = doc.metadata or {}
            page_count = doc.page_count

            # Page dimensions from first page (in points)
            page_width: Optional[float] = None
            page_height: Optional[float] = None
            if page_count > 0:
                first_page = doc[0]
                page_width = first_page.rect.width
                page_height = first_page.rect.height

            metadata: dict[str, Any] = {
                "title": pdf_meta.get("title", "") or "",
                "author": pdf_meta.get("author", "") or "",
                "subject": pdf_meta.get("subject", "") or "",
                "keywords": pdf_meta.get("keywords", "") or "",
                "creation_date": pdf_meta.get("creationDate", "") or "",
                "mod_date": pdf_meta.get("modDate", "") or "",
                "page_count": page_count,
                "source_filename": filename,
            }

            if page_width is not None and page_height is not None:
                metadata["page_width_pt"] = page_width
                metadata["page_height_pt"] = page_height

            # Build compliance constraints from page dimensions
            constraints = ComplianceConstraints()
            if page_width is not None and page_height is not None:
                # Detect standard page sizes
                w_in = page_width / _POINTS_PER_INCH
                h_in = page_height / _POINTS_PER_INCH
                if abs(w_in - 8.5) < 0.5 and abs(h_in - 11.0) < 0.5:
                    constraints.format_type = "letter"
                elif abs(w_in - 8.27) < 0.5 and abs(h_in - 11.69) < 0.5:
                    constraints.format_type = "a4"
                else:
                    constraints.format_type = "custom"
            constraints.page_limit = page_count

            document_id = str(uuid.uuid4())

            return CanvasBundle(
                document_id=document_id,
                nodes=nodes,
                constraints=constraints,
                metadata=metadata,
                source_format="pdf",
                source_agent=self.display_name,
            )
        finally:
            doc.close()

    # ── Atomize ───────────────────────────────────────────────────────

    async def atomize(self, bundle: CanvasBundle) -> list[AtomGroup]:
        """
        Break a CanvasBundle into semantic AtomGroups.

        Grouping strategy:
        1. If headings exist, group by heading hierarchy — each heading
           starts a new atom that includes all content until the next
           heading of equal or higher level.
        2. If no headings exist, use page_break nodes as boundaries,
           creating one atom per page.
        3. If neither headings nor page breaks exist, return the entire
           bundle as a single atom.
        """
        nodes = bundle.nodes
        if not nodes:
            return []

        # Check if we have any headings
        has_headings = any(n.type == "heading" for n in nodes)

        if has_headings:
            return self._atomize_by_headings(nodes)

        # Fall back to page breaks
        has_page_breaks = any(n.type == "page_break" for n in nodes)
        if has_page_breaks:
            return self._atomize_by_pages(nodes)

        # No structure — single atom for entire document
        return [
            AtomGroup(
                nodes=list(nodes),
                heading_text=None,
                suggested_category="body",
                suggested_tags=["full_document"],
                confidence=0.5,
            )
        ]

    def _atomize_by_headings(self, nodes: list[CanvasNode]) -> list[AtomGroup]:
        """Group nodes into atoms by heading hierarchy."""
        atoms: list[AtomGroup] = []
        current_nodes: list[CanvasNode] = []
        current_heading: Optional[str] = None

        for node in nodes:
            if node.type == "heading":
                # Every heading starts a new atom
                if current_nodes:
                    atoms.append(self._make_heading_atom(
                        current_nodes, current_heading
                    ))
                    current_nodes = []

                current_heading = node.content.get("text", "")

            current_nodes.append(node)

        # Flush remaining nodes
        if current_nodes:
            atoms.append(self._make_heading_atom(
                current_nodes, current_heading
            ))

        return atoms

    def _make_heading_atom(
        self, nodes: list[CanvasNode], heading_text: Optional[str]
    ) -> AtomGroup:
        """Create an AtomGroup from a heading-delimited section."""
        # Guess category from heading text
        category = "body"
        tags: list[str] = []
        if heading_text:
            lower = heading_text.lower()
            if any(kw in lower for kw in ("introduction", "overview", "background")):
                category = "introduction"
                tags.append("intro")
            elif any(kw in lower for kw in ("method", "approach", "technical")):
                category = "technical_approach"
                tags.append("technical")
            elif any(kw in lower for kw in ("manage", "schedule", "timeline")):
                category = "management"
                tags.append("management")
            elif any(kw in lower for kw in ("cost", "price", "budget")):
                category = "cost"
                tags.append("cost")
            elif any(kw in lower for kw in ("conclusion", "summary")):
                category = "conclusion"
                tags.append("summary")
            elif any(kw in lower for kw in ("reference", "citation", "bibliography")):
                category = "references"
                tags.append("references")
            elif any(kw in lower for kw in ("appendix", "attachment", "annex")):
                category = "appendix"
                tags.append("appendix")

        # Estimate character length from content
        char_length = sum(
            len(str(n.content.get("text", "")))
            for n in nodes
        )

        return AtomGroup(
            nodes=list(nodes),
            heading_text=heading_text,
            suggested_category=category,
            suggested_tags=tags,
            confidence=0.7,
            char_length=char_length,
        )

    def _atomize_by_pages(self, nodes: list[CanvasNode]) -> list[AtomGroup]:
        """Group nodes into atoms by page_break boundaries."""
        atoms: list[AtomGroup] = []
        current_nodes: list[CanvasNode] = []
        page_num = 1

        for node in nodes:
            if node.type == "page_break":
                if current_nodes:
                    atoms.append(AtomGroup(
                        nodes=list(current_nodes),
                        heading_text=None,
                        suggested_category="body",
                        suggested_tags=[f"page_{page_num}"],
                        confidence=0.5,
                        source_page=page_num,
                    ))
                    current_nodes = []
                    page_num += 1
                # Skip the page_break node itself
                continue

            current_nodes.append(node)

        # Flush remaining nodes
        if current_nodes:
            atoms.append(AtomGroup(
                nodes=list(current_nodes),
                heading_text=None,
                suggested_category="body",
                suggested_tags=[f"page_{page_num}"],
                confidence=0.5,
                source_page=page_num,
            ))

        return atoms

    # ── Export ─────────────────────────────────────────────────────────

    async def export(self, bundle: CanvasBundle) -> ExportResult:
        """
        PDF agent cannot export to native format.

        PDF writing is not supported because the agent has no WRITE_NATIVE
        capability. To produce PDF output from canvas content:

            1. Hand off the bundle to a DOCX agent:
               result = await pdf_agent.hand_off_to(bundle, docx_agent)
            2. Then convert to PDF:
               pdf_result = await docx_agent.export_pdf(bundle)

        Or use the dispatcher with target_format:
            result = await dispatch(..., stage="export", target_format="docx")
        """
        raise NotImplementedError(
            "PdfAgent cannot write PDF natively. "
            "Use hand_off_to() to pass the CanvasBundle to a DOCX or PPTX "
            "agent for rendering, then call that agent's export_pdf() method. "
            "Example: await pdf_agent.hand_off_to(bundle, docx_agent)"
        )

    async def export_pdf(self, bundle: CanvasBundle) -> ExportResult:
        """
        PDF agent cannot render to PDF because it cannot write any format.

        The correct pipeline for PDF-in, PDF-out is:
            1. pdf_agent.ingest(file_bytes, filename) -> bundle
            2. Edit the bundle on the canvas
            3. docx_agent.export(bundle) -> DOCX ExportResult
            4. docx_agent.export_pdf(bundle) -> PDF ExportResult
        """
        raise NotImplementedError(
            "PdfAgent cannot render to PDF — it has no write capability. "
            "To produce PDF output, hand off the bundle to a DOCX agent "
            "and use its export_pdf() method. "
            "Example: await docx_agent.export_pdf(bundle)"
        )
