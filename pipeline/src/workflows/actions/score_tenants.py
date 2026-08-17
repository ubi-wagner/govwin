"""
================================================================================
Workflow Action: match_tenants (score_tenants.py)
================================================================================

WHO:    Called by the OnSolicitationPushed workflow's find_matching_tenants step.

WHAT:   Resolves WHICH tenants should receive the "new priority opportunity"
        digest for a just-pushed solicitation, by READING the canonical spine —
        it no longer computes or writes scores.

        Scoring is event-driven, tenant-side: the bridge fan-out
        (`lib/opportunity-bridge.ts`) writes a `tenant_opportunity_cards` row per
        tenant and emits `capture:card.applied`, then `OnCardApplied` →
        `rescore.py::rescore_tenant_card` writes per-bucket `tenant_bucket_scores`
        against the tenant's own
        `tenant_spotlight_buckets` criteria — "auto-scored on arrival". By the time
        this workflow runs, those canonical scores already exist.

        This action therefore just reads them: for the solicitation's active
        opportunities, it returns the distinct tenants whose card scores at least
        NOTIFICATION_THRESHOLD in ANY bucket → the digest recipient list.

        (Was: a parallel Python scorer that upserted `tenant_pipeline_items` +
        `spotlight_bucket_scores` — the RETIRED legacy Spotlight/Pipeline tables the
        canonical spine no longer reads. Retired here; the split-brain is closed.)

INPUTS:
        - solicitation_id: str — curated_solicitations.id (UUID string)
        - topic_count: Optional[int] — number of topics (informational only)

OUTPUTS:
        - tenantIds: list[str] — distinct tenants with a card scoring >=
          NOTIFICATION_THRESHOLD in some bucket for one of the solicitation's opps
        - opportunitiesConsidered: int — active opps in the solicitation set
        - tenantsNotified: int — len(tenantIds)

ERROR HANDLING:
        - Missing/invalid solicitation_id: returns status="skipped"
        - DB error: emits scoring.completed:end with error, returns status="error"
        - No canonical cards/scores yet: returns an empty tenantIds list (the digest
          simply has no recipients — never an error, never a dead-end)

EVENT EMISSIONS:
        - finder:scoring.completed:start / :end (linked via parent_event_id) —
          the audit signal that digest matching ran, with counts + durationMs.

CHANGE LOG:
    PR #140 (2026-05-22) — Initial multi-factor scorer (retired tables).
    PR (2026-07)         — P0-3 scoring cutover: retired the Python scorer + its
                           writes to tenant_pipeline_items/spotlight_bucket_scores;
                           match_tenants now READS canonical tenant_bucket_scores to
                           resolve digest recipients. Scoring is the frontend bridge's
                           job (auto-scored on arrival).
================================================================================
"""
from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Optional

import asyncpg

from events import emit_event

log = logging.getLogger("pipeline.workflows.actions.score_tenants")

# A card is a "priority" match for a tenant if it scores at least this (0-100) in
# ANY bucket. Matches the legacy notification threshold so recipient volume is stable.
NOTIFICATION_THRESHOLD = 50


async def match_tenants(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
    topic_count: Optional[int] = None,
) -> dict[str, Any]:
    """Resolve the digest recipients for a pushed solicitation from canonical scores.

    Reads `tenant_opportunity_cards` × `tenant_bucket_scores` for the solicitation's
    active opportunities and returns the distinct tenants whose best bucket score
    clears NOTIFICATION_THRESHOLD. No writes — scoring is owned by the frontend bridge.

    Args:
        conn: Active asyncpg connection.
        solicitation_id: curated_solicitations.id (UUID string) that was just pushed.
        topic_count: Number of topics (informational only).

    Returns:
        {"tenantIds": [...], "opportunitiesConsidered": int, "tenantsNotified": int}
    """
    if not solicitation_id:
        return {"status": "skipped", "reason": "no_solicitation_id"}

    sol_uuid = uuid.UUID(solicitation_id)
    start_ms = time.monotonic()

    start_event_id = ""
    try:
        start_event_id = await emit_event(
            conn, namespace="finder", type="scoring.completed", phase="start",
            payload={"solicitationId": str(sol_uuid)},
        )
    except Exception as exc:
        log.error("match_tenants: failed to emit start event: %s", exc)

    try:
        # The scoring SET (same membership rule as before): every opportunity
        # belonging to the solicitation — its topics (o.solicitation_id = cs.id) plus
        # the landing opp (o.id = cs.opportunity_id) — that is active and not past
        # close. Then: the distinct tenants whose CANONICAL card for one of those opps
        # scores >= threshold in some bucket. lifecycle_status = 'open' is the live
        # visible card state (vs 'closed'/'archived').
        rows = await conn.fetch(
            """
            WITH sol_opps AS (
                SELECT o.id
                FROM curated_solicitations cs
                JOIN opportunities o
                  ON (o.solicitation_id = cs.id OR o.id = cs.opportunity_id)
                WHERE cs.id = $1
                  AND o.is_active = true
                  AND (o.close_date IS NULL OR o.close_date > now())
            )
            SELECT c.tenant_id, max(bs.score) AS best_score
            FROM tenant_opportunity_cards c
            JOIN sol_opps so ON so.id = c.opportunity_id
            JOIN tenant_bucket_scores bs
              ON bs.tenant_id = c.tenant_id AND bs.opportunity_id = c.opportunity_id
            WHERE c.lifecycle_status = 'open'
            GROUP BY c.tenant_id
            HAVING max(bs.score) >= $2
            ORDER BY c.tenant_id
            """,
            sol_uuid,
            NOTIFICATION_THRESHOLD,
        )
        # Opportunity count for the audit payload (independent of whether any tenant
        # cleared threshold).
        opp_count = await conn.fetchval(
            """
            SELECT count(*)::int
            FROM curated_solicitations cs
            JOIN opportunities o
              ON (o.solicitation_id = cs.id OR o.id = cs.opportunity_id)
            WHERE cs.id = $1
              AND o.is_active = true
              AND (o.close_date IS NULL OR o.close_date > now())
            """,
            sol_uuid,
        )
    except Exception as exc:
        log.error("match_tenants: canonical read failed for %s: %s", solicitation_id, exc)
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="scoring.completed", phase="end",
                parent_event_id=start_event_id, payload={
                    "solicitationId": str(sol_uuid), "error": str(exc),
                    "stage": "canonical_read", "durationMs": duration_ms,
                })
        except Exception:
            pass
        return {"status": "error", "reason": f"db_error: {exc}"}

    tenant_ids = [str(r["tenant_id"]) for r in rows]
    opportunities_considered = int(opp_count or 0)
    duration_ms = int((time.monotonic() - start_ms) * 1000)

    try:
        await emit_event(
            conn, namespace="finder", type="scoring.completed", phase="end",
            parent_event_id=start_event_id, payload={
                "solicitationId": str(sol_uuid),
                "opportunitiesConsidered": opportunities_considered,
                "tenantsNotified": len(tenant_ids),
                "durationMs": duration_ms,
            })
    except Exception as exc:
        log.error("match_tenants: failed to emit end event: %s", exc)

    return {
        "tenantIds": tenant_ids,
        "opportunitiesConsidered": opportunities_considered,
        "tenantsNotified": len(tenant_ids),
    }
