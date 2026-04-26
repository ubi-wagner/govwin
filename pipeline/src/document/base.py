"""
Base document agent — the contract every format-specific agent implements.

The lifecycle stages are:
  INGEST    → Read native format, extract raw structure
  ATOMIZE   → Break into semantic units (heading groups, slides, sheets)
  CANVAS    → Convert atoms to CanvasNode[] for WYSIWYG editing
  EDIT      → Apply tracked changes, comments, annotations in native format
  COLLABORATE → Merge edits from multiple actors, resolve conflicts
  ACCEPT    → Lock accepted atoms, update library eligibility
  ADVANCE   → Move content through review stages (pink → red → gold → final)
  EXPORT    → Render CanvasNode[] back to native format with full fidelity

The CanvasBundle is the universal interchange between agents. It carries
the canvas nodes, compliance constraints, provenance chain, and metadata
needed for any agent to render the content in its format.
"""

from __future__ import annotations

import abc
import enum
from dataclasses import dataclass, field
from typing import Any, Optional


class LifecycleStage(str, enum.Enum):
    INGEST = "ingest"
    ATOMIZE = "atomize"
    CANVAS = "canvas"
    EDIT = "edit"
    COLLABORATE = "collaborate"
    ACCEPT = "accept"
    ADVANCE = "advance"
    EXPORT = "export"


class AgentCapability(str, enum.Enum):
    READ_NATIVE = "read_native"
    WRITE_NATIVE = "write_native"
    TRACKED_CHANGES = "tracked_changes"
    COMMENTS = "comments"
    HEADERS_FOOTERS = "headers_footers"
    PAGE_NUMBERS = "page_numbers"
    TABLE_OF_CONTENTS = "table_of_contents"
    FORMULAS = "formulas"
    CHARTS = "charts"
    IMAGES = "images"
    SLIDE_MASTERS = "slide_masters"
    SPEAKER_NOTES = "speaker_notes"
    ANIMATIONS = "animations"
    CONDITIONAL_FORMATTING = "conditional_formatting"
    NAMED_RANGES = "named_ranges"
    PIVOT_TABLES = "pivot_tables"
    WATERMARKS = "watermarks"
    PDF_RENDER = "pdf_render"
    MERGE_FIELDS = "merge_fields"


@dataclass
class CanvasNode:
    """Minimal Python mirror of the frontend CanvasNode type."""
    id: str
    type: str
    content: dict[str, Any]
    style: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    library_eligible: bool = True
    library_tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "content": self.content,
            "style": self.style,
            "provenance": self.provenance,
            "history": self.history,
            "library_eligible": self.library_eligible,
            "library_tags": self.library_tags,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CanvasNode:
        return cls(
            id=d["id"],
            type=d["type"],
            content=d.get("content", {}),
            style=d.get("style", {}),
            provenance=d.get("provenance", {}),
            history=d.get("history", []),
            library_eligible=d.get("library_eligible", True),
            library_tags=d.get("library_tags", []),
        )


@dataclass
class ComplianceConstraints:
    """Rendering constraints from the RFP/volume requirements."""
    page_limit: Optional[int] = None
    font_family: Optional[str] = None
    font_size: Optional[float] = None
    line_spacing: Optional[float] = None
    margins: Optional[dict[str, float]] = None  # top, right, bottom, left in points
    header_template: Optional[str] = None
    footer_template: Optional[str] = None
    watermark: Optional[str] = None
    format_type: str = "letter"  # letter, slide_16_9, slide_4_3, custom


@dataclass
class CanvasBundle:
    """
    The universal interchange format between document agents.

    Carries everything a target agent needs to render the content
    in its native format without losing fidelity or provenance.
    """
    document_id: str
    nodes: list[CanvasNode]
    constraints: ComplianceConstraints
    metadata: dict[str, Any] = field(default_factory=dict)
    # Source provenance — which agent created this bundle
    source_format: str = ""
    source_agent: str = ""
    # Template reference (if rendering from a template)
    template_key: Optional[str] = None
    # Variables for header/footer/merge field interpolation
    variables: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "nodes": [n.to_dict() for n in self.nodes],
            "constraints": {
                "page_limit": self.constraints.page_limit,
                "font_family": self.constraints.font_family,
                "font_size": self.constraints.font_size,
                "line_spacing": self.constraints.line_spacing,
                "margins": self.constraints.margins,
                "header_template": self.constraints.header_template,
                "footer_template": self.constraints.footer_template,
                "watermark": self.constraints.watermark,
                "format_type": self.constraints.format_type,
            },
            "metadata": self.metadata,
            "source_format": self.source_format,
            "source_agent": self.source_agent,
            "template_key": self.template_key,
            "variables": self.variables,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> CanvasBundle:
        c = d.get("constraints", {})
        return cls(
            document_id=d["document_id"],
            nodes=[CanvasNode.from_dict(n) for n in d.get("nodes", [])],
            constraints=ComplianceConstraints(
                page_limit=c.get("page_limit"),
                font_family=c.get("font_family"),
                font_size=c.get("font_size"),
                line_spacing=c.get("line_spacing"),
                margins=c.get("margins"),
                header_template=c.get("header_template"),
                footer_template=c.get("footer_template"),
                watermark=c.get("watermark"),
                format_type=c.get("format_type", "letter"),
            ),
            metadata=d.get("metadata", {}),
            source_format=d.get("source_format", ""),
            source_agent=d.get("source_agent", ""),
            template_key=d.get("template_key"),
            variables=d.get("variables", {}),
        )


@dataclass
class AtomGroup:
    """A semantic unit extracted during atomization."""
    nodes: list[CanvasNode]
    heading_text: Optional[str]
    suggested_category: str
    suggested_tags: list[str]
    confidence: float
    char_offset: int = 0
    char_length: int = 0
    source_page: Optional[int] = None
    source_slide: Optional[int] = None
    source_sheet: Optional[str] = None


@dataclass
class EditOperation:
    """A tracked edit to apply to content."""
    node_id: str
    actor_id: str
    actor_name: str
    action: str  # insert, delete, replace, comment, accept, reject
    content: Optional[dict[str, Any]] = None
    comment: Optional[str] = None
    timestamp: Optional[str] = None


@dataclass
class ExportResult:
    """Result of exporting a CanvasBundle to a native format."""
    file_bytes: bytes
    content_type: str
    filename: str
    format: str
    page_count: Optional[int] = None
    warnings: list[str] = field(default_factory=list)


class DocumentAgent(abc.ABC):
    """
    Base class for format-specific document agents.

    Each subclass declares its capabilities and implements the lifecycle
    methods it supports. Not every agent supports every stage — PDF agents
    can't write native format, XLSX agents don't have page numbers, etc.
    """

    @property
    @abc.abstractmethod
    def format_id(self) -> str:
        """Short identifier: 'docx', 'pptx', 'xlsx', 'pdf'."""
        ...

    @property
    @abc.abstractmethod
    def display_name(self) -> str:
        """Human-readable name for UI/logs."""
        ...

    @property
    @abc.abstractmethod
    def file_extensions(self) -> list[str]:
        """File extensions this agent handles (without dots)."""
        ...

    @property
    @abc.abstractmethod
    def capabilities(self) -> set[AgentCapability]:
        """What this agent can do."""
        ...

    @property
    def supported_stages(self) -> set[LifecycleStage]:
        """Which lifecycle stages this agent implements."""
        stages = {LifecycleStage.INGEST, LifecycleStage.ATOMIZE, LifecycleStage.CANVAS}
        if AgentCapability.WRITE_NATIVE in self.capabilities:
            stages |= {
                LifecycleStage.EDIT,
                LifecycleStage.COLLABORATE,
                LifecycleStage.ACCEPT,
                LifecycleStage.ADVANCE,
                LifecycleStage.EXPORT,
            }
        return stages

    # ── Lifecycle methods ──────────────────────────────────────────────

    @abc.abstractmethod
    async def ingest(self, file_bytes: bytes, filename: str) -> CanvasBundle:
        """Read a native file and produce a CanvasBundle."""
        ...

    @abc.abstractmethod
    async def atomize(self, bundle: CanvasBundle) -> list[AtomGroup]:
        """Break a CanvasBundle into semantic atom groups."""
        ...

    async def apply_edits(
        self, bundle: CanvasBundle, edits: list[EditOperation]
    ) -> CanvasBundle:
        """Apply tracked edits to the bundle. Default: in-memory only."""
        for edit in edits:
            bundle = self._apply_single_edit(bundle, edit)
        return bundle

    async def merge(
        self, base: CanvasBundle, theirs: CanvasBundle, actor_id: str
    ) -> CanvasBundle:
        """Merge two versions of a bundle. Default: theirs wins."""
        return theirs

    async def advance(
        self, bundle: CanvasBundle, from_stage: str, to_stage: str
    ) -> CanvasBundle:
        """Advance content through review stages. Update metadata."""
        bundle.metadata["stage"] = to_stage
        bundle.metadata["previous_stage"] = from_stage
        return bundle

    @abc.abstractmethod
    async def export(self, bundle: CanvasBundle) -> ExportResult:
        """Render a CanvasBundle to native format bytes."""
        ...

    async def export_pdf(self, bundle: CanvasBundle) -> ExportResult:
        """Render to PDF. Default: export to native then convert via soffice."""
        if AgentCapability.PDF_RENDER not in self.capabilities:
            raise NotImplementedError(f"{self.format_id} agent cannot render PDF")
        native = await self.export(bundle)
        return await self._convert_to_pdf(native)

    # ── Handoff ────────────────────────────────────────────────────────

    async def hand_off_to(
        self, bundle: CanvasBundle, target_agent: DocumentAgent
    ) -> ExportResult:
        """
        Pass the canvas bundle to another agent for export.

        The source agent stamps its provenance on the bundle, then the
        target agent renders it in its own format.
        """
        bundle.source_format = self.format_id
        bundle.source_agent = self.display_name
        return await target_agent.export(bundle)

    # ── Internal helpers ───────────────────────────────────────────────

    def _apply_single_edit(
        self, bundle: CanvasBundle, edit: EditOperation
    ) -> CanvasBundle:
        """Apply one edit operation to the in-memory bundle."""
        import datetime

        ts = edit.timestamp or datetime.datetime.now(datetime.timezone.utc).isoformat()
        history_entry = {
            "actor_id": edit.actor_id,
            "actor_name": edit.actor_name,
            "action": edit.action,
            "timestamp": ts,
            "comment": edit.comment,
        }

        for i, node in enumerate(bundle.nodes):
            if node.id == edit.node_id:
                if edit.action == "replace" and edit.content is not None:
                    history_entry["previous_content"] = str(node.content)
                    node.content = edit.content
                    node.history.append(history_entry)
                elif edit.action == "delete":
                    bundle.nodes.pop(i)
                elif edit.action == "comment":
                    if "comments" not in node.content:
                        node.content["comments"] = []
                    node.content["comments"].append({
                        "id": edit.node_id + "_c" + str(len(node.content["comments"])),
                        "actor_id": edit.actor_id,
                        "actor_name": edit.actor_name,
                        "text": edit.comment or "",
                        "timestamp": ts,
                    })
                    node.history.append(history_entry)
                elif edit.action in ("accept", "reject"):
                    node.history.append(history_entry)
                break

        if edit.action == "insert" and edit.content is not None:
            import uuid
            new_node = CanvasNode(
                id=str(uuid.uuid4()),
                type=edit.content.get("type", "text_block"),
                content=edit.content.get("content", {}),
                provenance={
                    "source": "manual",
                    "drafted_by": edit.actor_id,
                    "drafted_at": ts,
                },
                history=[history_entry],
            )
            bundle.nodes.append(new_node)

        return bundle

    async def _convert_to_pdf(self, native_result: ExportResult) -> ExportResult:
        """Convert a native export to PDF via LibreOffice headless."""
        from .converter import convert_to_pdf
        try:
            pdf_bytes = await convert_to_pdf(
                native_result.file_bytes,
                native_result.format,
            )
        except Exception as exc:
            raise RuntimeError(
                f"{self.display_name}: PDF conversion failed for '{native_result.filename}'"
            ) from exc
        return ExportResult(
            file_bytes=pdf_bytes,
            content_type="application/pdf",
            filename=native_result.filename.rsplit(".", 1)[0] + ".pdf",
            format="pdf",
            warnings=native_result.warnings,
        )
