"""
Document Agent System — format-specific skilled agents that own the
full document lifecycle: ingest → atomize → canvas → edit → collaborate →
accept → advance → export.

Each agent deeply understands its format's native structure (OOXML, ODP,
PDF internals) and maps bidirectionally to the universal CanvasNode[]
interchange format.

When the final artifact's format matches the source, the same agent
exports. When it differs (e.g., DOCX content → PPTX slides), the
canvas bundle is passed to the target format's agent for rendering.
"""

from .base import DocumentAgent, CanvasBundle, AgentCapability, LifecycleStage
from .registry import get_agent, list_agents, dispatch

__all__ = [
    "DocumentAgent",
    "CanvasBundle",
    "AgentCapability",
    "LifecycleStage",
    "get_agent",
    "list_agents",
    "dispatch",
]
