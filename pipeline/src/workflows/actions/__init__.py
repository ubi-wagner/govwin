"""
================================================================================
Workflow Actions Package (__init__.py)
================================================================================

WHO:    Called by the workflow processor when a step references an action
        function via its dotted import path.

WHAT:   Re-exports all workflow action functions for discoverability and
        testing. Each function in this package is an async callable with
        the signature: async def action(conn: asyncpg.Connection, **kwargs)
        -> dict[str, Any].

        The workflow processor dynamically imports the module and calls the
        function with (conn, **inputs). This __init__.py provides convenient
        re-exports for direct import in tests and documentation.

INPUTS: Each action function accepts:
        - conn: asyncpg.Connection (first positional arg)
        - **kwargs: keyword args matching the step's input_map keys

OUTPUTS: Each action returns a dict that becomes the step's `result`,
         available to downstream steps via step.<name>.result.<key>.

ERROR HANDLING:
    - Each action handles its own internal errors (per-item try/catch)
    - Unhandled exceptions propagate to the processor, which records
      them as step failures and emits workflow.step_failed events

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: re-exports for all
                           action functions
    PR #xxx (2026-05-22) — Added comprehensive documentation header
================================================================================
"""

# Re-export action functions so they can be discovered via dotted import paths.
# The workflow processor uses importlib to resolve "pipeline.shredder.shred" ->
# this package is NOT on that path. Instead, these re-exports support direct
# import for testing and documentation.

from workflows.actions.shred import shred, extract_compliance
from workflows.actions.score_tenants import match_tenants
from workflows.actions.generate_preview import generate_preview
from workflows.actions.create_drafts_from_scout import create_drafts_from_scout
from workflows.actions.cms_content import draft_content, publish_content
from workflows.actions.publish_section_draft import publish_section_draft

__all__ = [
    "shred",
    "extract_compliance",
    "match_tenants",
    "generate_preview",
    "create_drafts_from_scout",
    "draft_content",
    "publish_content",
    "publish_section_draft",
]
