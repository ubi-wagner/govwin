"""
Document agent registry — dispatch by format or file extension.

Usage:
    from document import get_agent, dispatch

    agent = get_agent("docx")
    bundle = await agent.ingest(file_bytes, "proposal.docx")
    atoms = await agent.atomize(bundle)
    result = await agent.export(bundle)

    # Cross-format handoff: DOCX content → PPTX slides
    docx_agent = get_agent("docx")
    pptx_agent = get_agent("pptx")
    bundle = await docx_agent.ingest(file_bytes, "content.docx")
    result = await docx_agent.hand_off_to(bundle, pptx_agent)
"""

from __future__ import annotations

from typing import Optional

from .base import DocumentAgent, CanvasBundle, ExportResult

_agents: dict[str, DocumentAgent] = {}
_ext_map: dict[str, str] = {}


def register(agent: DocumentAgent) -> None:
    """Register a document agent by its format_id and file extensions."""
    _agents[agent.format_id] = agent
    for ext in agent.file_extensions:
        _ext_map[ext.lower()] = agent.format_id


def get_agent(format_or_ext: str) -> DocumentAgent:
    """
    Get the agent for a format ID ('docx') or file extension ('docx', '.docx').
    Raises KeyError if no agent is registered for the format.
    """
    key = format_or_ext.lower().lstrip(".")
    fmt = _ext_map.get(key, key)
    if fmt not in _agents:
        raise KeyError(f"No document agent registered for '{format_or_ext}'")
    return _agents[fmt]


def get_agent_for_file(filename: str) -> DocumentAgent:
    """Get the agent for a filename based on its extension."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return get_agent(ext)


def list_agents() -> list[DocumentAgent]:
    """Return all registered agents."""
    return list(_agents.values())


async def dispatch(
    file_bytes: bytes,
    filename: str,
    stage: str = "ingest",
    bundle: Optional[CanvasBundle] = None,
    target_format: Optional[str] = None,
    **kwargs,
) -> CanvasBundle | ExportResult | list:
    """
    High-level dispatch: run a lifecycle stage on the appropriate agent.

    For export with a different target format, handles the cross-agent
    handoff automatically.
    """
    agent = get_agent_for_file(filename) if not bundle else get_agent(
        bundle.source_format or filename.rsplit(".", 1)[-1]
    )

    if stage == "ingest":
        return await agent.ingest(file_bytes, filename)

    if bundle is None:
        raise ValueError(f"Stage '{stage}' requires a CanvasBundle")

    if stage == "atomize":
        return await agent.atomize(bundle)

    if stage == "export":
        if target_format and target_format != agent.format_id:
            target_agent = get_agent(target_format)
            return await agent.hand_off_to(bundle, target_agent)
        return await agent.export(bundle)

    if stage == "export_pdf":
        return await agent.export_pdf(bundle)

    if stage == "advance":
        return await agent.advance(
            bundle,
            kwargs.get("from_stage", ""),
            kwargs.get("to_stage", ""),
        )

    raise ValueError(f"Unknown stage: {stage}")


def _auto_register() -> None:
    """Register all built-in agents. Called on first import."""
    try:
        from .docx_agent import DocxAgent
        register(DocxAgent())
    except ImportError:
        pass

    try:
        from .pptx_agent import PptxAgent
        register(PptxAgent())
    except ImportError:
        pass

    try:
        from .xlsx_agent import XlsxAgent
        register(XlsxAgent())
    except ImportError:
        pass

    try:
        from .pdf_agent import PdfAgent
        register(PdfAgent())
    except ImportError:
        pass


_auto_register()
