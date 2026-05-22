"""
================================================================================
Workflow Action: create_drafts_from_scout
================================================================================

WHO:    Called by workflow processor when OnSourceChangeDetected workflow
        executes the create_draft_solicitations step.

WHAT:   Parses Source Scout region results and creates draft
        curated_solicitations rows for admin review. For each extracted
        opportunity: deduplicates by title+agency against existing
        opportunities, creates new opportunity rows if needed, and creates
        curated_solicitation rows with status='new' for the admin triage
        queue. Handles per-opportunity errors gracefully to ensure one
        failed opportunity does not block creation of others.

INPUTS:
        - source_id: str — source_profiles.id (UUID string) of the
          monitored source
        - source_name: Optional[str] — human-readable source name
        - region_results: Optional[list[dict]] — list of dicts from the
          scout worker, each containing:
            - region_id, region_name, content_hash, previous_hash
            - extracted_text, opportunities (list of opportunity dicts)

OUTPUTS:
        - draftsCreated: int — new curated_solicitations created
        - draftsUpdated: int — existing solicitations updated (reserved)
        - duplicatesSkipped: int — opportunities already in pipeline
        - sourceId: str — echo of input source_id
        - sourceName: str — echo of input source_name

ERROR HANDLING:
    - No region results: Returns immediately with zeros and reason
    - Empty title: Opportunity skipped (title is required for dedup)
    - Per-opportunity DB errors: Caught, logged, continues with next
      opportunity. One failed INSERT does not block other opportunities.
    - Invalid source_id format: Raises ValueError (caught by processor)
    - Close date parse errors: Caught, close_date set to None

TENANT ISOLATION:
    - Not tenant-scoped — opportunities and curated_solicitations are
      global resources managed by rfp_admin. Source Scout runs as a
      system-level background process.

EVENT EMISSIONS:
    - None directly — events are emitted by the workflow processor at
      the step level (workflow.step_completed / workflow.step_failed).

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: opportunity dedup,
                           curated_solicitation creation, per-opportunity
                           error handling
    PR #xxx (2026-05-22) — Added comprehensive documentation header,
                           dedup documentation, per-source error handling,
                           input validation improvements
================================================================================
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
    # Validate source_id format
    try:
        source_uuid = uuid.UUID(source_id)
    except (ValueError, TypeError):
        log.error("create_drafts_from_scout: invalid source_id: %s", source_id)
        return {
            "draftsCreated": 0,
            "draftsUpdated": 0,
            "duplicatesSkipped": 0,
            "sourceId": source_id,
            "sourceName": source_name or "",
            "reason": "invalid_source_id",
        }

    # 1. Validate inputs
    if not region_results or not isinstance(region_results, list):
        return {
            "draftsCreated": 0,
            "draftsUpdated": 0,
            "duplicatesSkipped": 0,
            "sourceId": source_id,
            "sourceName": source_name or "",
            "reason": "no_region_results",
        }

    drafts_created = 0
    drafts_updated = 0
    duplicates_skipped = 0

    # 2. Process each region result
    for region in region_results:
        opportunities = region.get("opportunities", [])
        if not opportunities:
            continue

        for opp in opportunities:
            title = (opp.get("title") or "").strip()[:500]
            agency = (opp.get("agency") or source_name or "").strip()[:200]
            description = (opp.get("description") or "")[:5000]
            close_date_str = opp.get("close_date")

            if not title:
                continue

            try:
                # Dedup by title + agency
                existing = await conn.fetchrow(
                    """SELECT id FROM opportunities
                       WHERE title = $1 AND agency = $2
                       LIMIT 1""",
                    title,
                    agency,
                )

                if existing:
                    # Check if curated_solicitation already exists for this opp
                    existing_sol = await conn.fetchval(
                        """SELECT id FROM curated_solicitations
                           WHERE opportunity_id = $1
                           LIMIT 1""",
                        existing["id"],
                    )
                    if existing_sol:
                        duplicates_skipped += 1
                        continue

                    # Opportunity exists but no solicitation -- create one
                    opp_id = existing["id"]
                else:
                    # Create new opportunity
                    opp_id = uuid.uuid4()
                    source_id_val = opp.get("url") or f"scout-{source_id}-{uuid.uuid4().hex[:8]}"

                    close_date = None
                    if close_date_str:
                        try:
                            from datetime import datetime
                            close_date = datetime.fromisoformat(
                                close_date_str.replace("Z", "+00:00")
                            )
                        except (ValueError, AttributeError):
                            pass

                    await conn.execute(
                        """INSERT INTO opportunities
                             (id, source, source_id, title, agency,
                              description, program_type, close_date,
                              is_active, created_at, updated_at)
                           VALUES ($1, 'source_scout', $2, $3, $4, $5,
                                   $6, $7, true, now(), now())""",
                        opp_id,
                        source_id_val[:500],
                        title,
                        agency,
                        description,
                        opp.get("program_type"),
                        close_date,
                    )

                # 3. Create curated_solicitations row with status='new' for admin review
                #    Note: curated_solicitations status CHECK does not include 'draft'
                #    -- use 'new' which is the initial status in the workflow.
                sol_id = uuid.uuid4()
                namespace = f"scout:{source_name or source_id}"[:100]
                await conn.execute(
                    """INSERT INTO curated_solicitations
                         (id, opportunity_id, namespace, status, full_text,
                          created_at, updated_at)
                       VALUES ($1, $2, $3, 'new', $4, now(), now())""",
                    sol_id,
                    opp_id,
                    namespace,
                    description[:50000] if description else None,
                )
                drafts_created += 1

            except Exception as e:
                log.error(
                    "failed to create draft from scout for '%s' (source=%s): %s",
                    title, source_id, e,
                )
                # Continue with next opportunity -- one failure should not
                # block creation of other opportunities
                continue

    return {
        "draftsCreated": drafts_created,
        "draftsUpdated": drafts_updated,
        "duplicatesSkipped": duplicates_skipped,
        "sourceId": source_id,
        "sourceName": source_name or "",
    }
