"""Scoring engine — scores opportunities against tenant profiles.

Provides batch scoring for all active tenants against solicitations
in the pipeline. Delegates per-solicitation scoring to the
match_tenants workflow action.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger("pipeline.scoring.engine")


class ScoringEngine:
    """Multi-factor scoring with optional LLM adjustment."""

    async def score_all_tenants(self, conn: Any) -> dict[str, Any]:
        """Score all active tenants against solicitations that are approved or pushed.

        Iterates through solicitations in scorable statuses and delegates
        to the match_tenants workflow action for per-solicitation scoring.

        Args:
            conn: asyncpg connection.

        Returns:
            Summary dict with total tenants scored and solicitations processed.
        """
        from workflows.actions.score_tenants import match_tenants

        # Get solicitations that are ready for scoring
        solicitations = await conn.fetch(
            """SELECT id FROM curated_solicitations
               WHERE status IN ('approved', 'pushed_to_pipeline')
               ORDER BY created_at DESC"""
        )

        total_matched = 0
        total_processed = 0
        errors = 0

        for sol in solicitations:
            sol_id = str(sol["id"])
            try:
                result = await match_tenants(
                    conn,
                    solicitation_id=sol_id,
                )
                total_matched += result.get("tenantsScored", 0)
                total_processed += 1
            except Exception as e:
                log.error("score_all_tenants: failed for %s: %s", sol_id, e)
                errors += 1

        return {
            "tenants_scored": total_matched,
            "solicitations_processed": total_processed,
            "errors": errors,
        }
