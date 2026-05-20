"""
Workflow ACTION targets for the shredder pipeline.

These thin wrappers adapt the existing shredder runner to the interface
expected by the workflow processor: async function(conn, **input_map_kwargs).

Called by:
  - OnRfpUploaded.step("shred_document")   → shred()
  - OnRfpUploaded.step("extract_compliance") → extract_compliance()

See pipeline/src/shredder/runner.py for the full shredder implementation.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

import asyncpg

log = logging.getLogger("pipeline.workflows.actions.shred")


async def shred(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
    document_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Shred a solicitation's documents — extract text, call Claude, persist results.

    This is the workflow-callable wrapper around shredder.runner.shred_solicitation.
    It handles Anthropic client instantiation so the runner stays testable with
    injected mocks.

    Args:
        conn: Active asyncpg connection (from workflow processor).
        solicitation_id: curated_solicitations.id (UUID string).
        document_ids: Optional list of solicitation_documents.id to shred.
            If None, the runner processes all linked documents.

    Returns:
        Dict with status, section count, compliance match count, token usage.
    """
    # TODO: Implement — instantiate Anthropic client and delegate to runner
    #
    # Implementation steps:
    # 1. Import and instantiate the Anthropic async client:
    #      from anthropic import AsyncAnthropic
    #      client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    #    Or use the module-level override: shredder.runner.ANTHROPIC_CLIENT
    #
    # 2. Call the runner:
    #      from shredder.runner import shred_solicitation
    #      result = await shred_solicitation(
    #          conn=conn,
    #          solicitation_id=solicitation_id,
    #          anthropic_client=client,
    #      )
    #
    # 3. Return the result dict (already in the right shape).
    #
    # 4. Handle ShredderBudgetError — let it propagate so the processor
    #    records the step as failed.

    raise NotImplementedError(
        "shred() action not yet implemented — see inline TODO for steps"
    )


async def extract_compliance(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
) -> dict[str, Any]:
    """Re-run compliance extraction on an already-shredded solicitation.

    Used when an admin edits solicitation text and wants to re-extract
    compliance variables without re-running the full shredder pipeline.

    The shredder runner already does compliance extraction inline during
    shred_solicitation(). This standalone function extracts from the
    existing ai_extracted.sections data.

    Args:
        conn: Active asyncpg connection.
        solicitation_id: curated_solicitations.id (UUID string).

    Returns:
        Dict with compliance match counts and any errors.
    """
    # TODO: Implement — re-extract compliance from existing shredded data
    #
    # Implementation steps:
    # 1. Fetch ai_extracted JSONB from curated_solicitations
    # 2. Extract sections from ai_extracted["sections"]
    # 3. For each section, run compliance extraction prompt via Claude
    # 4. Call split_matches() from shredder.compliance_mapping
    # 5. Upsert solicitation_compliance row
    # 6. Return summary dict

    raise NotImplementedError(
        "extract_compliance() action not yet implemented — see inline TODO for steps"
    )
