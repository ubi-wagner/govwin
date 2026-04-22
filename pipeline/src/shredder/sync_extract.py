"""Synchronous compliance-extract variant — Phase 1 §D8.

Used by the §E `compliance.extract_from_text` tool. The curation
workspace UI highlights a chunk of text, passes it to this function,
and shows the returned suggestions in a sidebar for one-click approval.

Contrast with `runner.shred_solicitation`:
  - runner: full pipeline — fetch docs, section extraction, per-section
    compliance extraction, DB writes, event emission. Runs as a worker
    job via the dispatcher.
  - sync_extract: single Claude call with the compliance prompt against
    a caller-supplied text chunk. No DB writes. No event emission. Pure
    input → output. Caller owns the persistence decision.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from shredder.runner import (
    DEFAULT_MODEL,
    _call_claude,
    _load_prompt,
    _split_system_and_examples,
)

log = logging.getLogger("pipeline.shredder.sync_extract")

# Hard cap on input fragment size — the curator should be highlighting
# a single section, not pasting the whole document. Above this size the
# caller should be using the full shredder run, not this tool.
MAX_FRAGMENT_CHARS = 40_000


class SyncExtractError(ValueError):
    """Raised for caller errors (empty input, oversized fragment, etc.)."""


async def extract_compliance_from_text(
    text_fragment: str,
    master_variables: list[dict[str, str]],
    anthropic_client: Any,
    model: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Extract compliance suggestions from a single text fragment.

    Args:
        text_fragment: The text selection. Must be non-empty and <= 40K chars.
        master_variables: List of {name, data_type, label} dicts from the
            compliance_variables table. Required so the prompt can tell
            Claude which variables are in scope.
        anthropic_client: an `anthropic.AsyncAnthropic` instance (or mock).
        model: override the model name. Defaults to SHREDDER_MODEL env var
            or the runner's DEFAULT_MODEL.

    Returns:
        List of match dicts as returned by Claude, e.g.:
            [{
                "variable_name": "page_limit_technical",
                "value": 15,
                "source_excerpt": "The Technical Volume shall not exceed 15 pages.",
                "page": null,
                "confidence": 1.0,
            }, ...]

        The caller is responsible for filtering / persisting / surfacing
        these as needed.

    Raises:
        SyncExtractError: on empty or oversized input.
    """
    if not text_fragment or not text_fragment.strip():
        raise SyncExtractError("text_fragment must be non-empty")
    if len(text_fragment) > MAX_FRAGMENT_CHARS:
        raise SyncExtractError(
            f"text_fragment length {len(text_fragment)} exceeds {MAX_FRAGMENT_CHARS}; "
            "use the full shredder run for whole-document extraction"
        )

    prompt_file = _load_prompt("compliance_extraction")
    system_prompt, user_template = _split_system_and_examples(prompt_file)

    master_list = "\n".join(
        f"- {v['name']} ({v.get('data_type', 'text')}) — {v.get('label', v['name'])}"
        for v in master_variables
    )

    user_message = (
        f"{user_template}\n\n"
        f"MASTER VARIABLES:\n{master_list}\n\n"
        f"SECTION: (user selection)\n{text_fragment}"
    )

    model_name = model or os.environ.get("SHREDDER_MODEL", DEFAULT_MODEL)
    result, _in_tokens, _out_tokens = await _call_claude(
        anthropic_client,
        system_prompt=system_prompt,
        user_message=user_message,
        model=model_name,
    )

    matches = result.get("matches", [])
    if not isinstance(matches, list):
        raise SyncExtractError(
            f"Claude returned non-list matches field: {type(matches).__name__}"
        )
    return matches
