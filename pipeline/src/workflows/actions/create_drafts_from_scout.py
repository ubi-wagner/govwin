"""
Workflow ACTION target for creating draft solicitations from Source Scout.

Called by OnSourceChangeDetected workflow when the Source Scout worker
detects meaningful changes on a monitored website. Parses the scout's
region results and creates draft curated_solicitations rows for admin
review.

Trigger chain:
  scout detects changes → finder:source.change_detected:single
  → OnSourceChangeDetected.create_draft_solicitations → this function
  → OnSourceChangeDetected.notify_rfp_admin (uses draftsCreated count)
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

import asyncpg

log = logging.getLogger("pipeline.workflows.actions.create_drafts_from_scout")


async def create_drafts_from_scout(
    conn: asyncpg.Connection,
    *,
    source_id: str,
    source_name: Optional[str] = None,
    region_results: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Create draft curated_solicitations from Source Scout region results.

    For each region result that contains extractable opportunity data:
      1. Check if a matching opportunity already exists (by title/URL dedup)
      2. If new, create an opportunity row and a curated_solicitations row
         with status='draft' for admin review
      3. If existing, check if the content has changed and flag for re-review

    Args:
        conn: Active asyncpg connection.
        source_id: source_profiles.id (UUID string) of the monitored source.
        source_name: Human-readable name of the source (for logging/events).
        region_results: List of dicts from the scout worker, each containing:
            - region_id: source_regions.id
            - region_name: label for the monitored region
            - content_hash: hash of current content
            - previous_hash: hash of previous content (None if first scan)
            - extracted_text: raw text from the region
            - opportunities: list of extracted opportunity dicts with:
                - title, agency, description, url, close_date (optional)

    Returns:
        {
            "draftsCreated": 3,
            "draftsUpdated": 1,
            "duplicatesSkipped": 2,
            "sourceId": "uuid",
            "sourceName": "Air Force CSO Portal",
        }
    """
    # TODO: Implement draft solicitation creation from scout data
    #
    # Implementation steps:
    # 1. Validate inputs — region_results must be a non-empty list
    #
    # 2. For each region_result:
    #    a. For each opportunity in region_result["opportunities"]:
    #       i.  Check for existing opportunity by title + agency dedup:
    #             SELECT id FROM opportunities
    #             WHERE title = $1 AND agency = $2
    #             LIMIT 1
    #
    #       ii. If not found, INSERT into opportunities:
    #             INSERT INTO opportunities (
    #                 id, source, source_id, title, agency, description,
    #                 program_type, is_active, created_at, updated_at
    #             ) VALUES (...)
    #             Source should be 'source_scout'
    #
    #       iii. CREATE curated_solicitations row:
    #             INSERT INTO curated_solicitations (
    #                 id, opportunity_id, namespace, status,
    #                 full_text, created_at, updated_at
    #             ) VALUES (..., 'draft', ...)
    #
    # 3. Track counts: created, updated (content changed), skipped (duplicate)
    #
    # 4. Return summary dict

    raise NotImplementedError(
        "create_drafts_from_scout() action not yet implemented — see inline TODO"
    )
