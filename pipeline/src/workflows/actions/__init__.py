"""
Workflow ACTION step targets — importable functions called by the workflow processor.

Each function in this package is referenced by a workflow step's `action` field
(e.g., "pipeline.shredder.shred"). The workflow processor dynamically imports
the module and calls the function with (conn, **inputs).

All functions MUST:
  - Accept `conn: asyncpg.Connection` as the first positional arg
  - Accept keyword args matching the step's `input_map` keys
  - Be async (or the processor awaits them if they return a coroutine)
  - Return a dict that becomes the step's `result` (used by downstream steps)

See docs/EVENT_CONTRACT.md §7 for the workflow architecture.
"""

# Re-export action functions so they can be discovered via dotted import paths.
# The workflow processor uses importlib to resolve "pipeline.shredder.shred" →
# this package is NOT on that path. Instead, these re-exports support direct
# import for testing and documentation.

from workflows.actions.shred import shred, extract_compliance
from workflows.actions.score_tenants import match_tenants
from workflows.actions.create_library_defaults import create_default_categories
from workflows.actions.generate_preview import generate_preview
from workflows.actions.create_drafts_from_scout import create_drafts_from_scout

__all__ = [
    "shred",
    "extract_compliance",
    "match_tenants",
    "create_default_categories",
    "generate_preview",
    "create_drafts_from_scout",
]
