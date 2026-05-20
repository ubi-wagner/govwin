"""
Workflow ACTION target for tenant-opportunity scoring.

Called by OnSolicitationPushed workflow to match a newly pushed solicitation
against all tenants with active subscriptions. Writes scored rows to
tenant_pipeline_items and returns matching tenant IDs for the NOTIFY step.

Trigger chain:
  admin pushes solicitation → finder:solicitation.pushed:single
  → OnSolicitationPushed.find_matching_tenants → this function
  → OnSolicitationPushed.send_spotlight_digest (uses returned tenantIds)

See pipeline/src/scoring/engine.py for the scoring algorithm.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import asyncpg

log = logging.getLogger("pipeline.workflows.actions.score_tenants")


async def match_tenants(
    conn: asyncpg.Connection,
    *,
    solicitation_id: str,
    topic_count: Optional[int] = None,
) -> dict[str, Any]:
    """Score a solicitation against all eligible tenants.

    For each tenant with an active finder subscription:
      1. Load tenant profile (naics_codes, tech_focus_areas, agency_preferences)
      2. Load solicitation metadata (naics_codes, tech_focus_areas, agency)
      3. Compute multi-factor match score (NAICS overlap, tech focus overlap,
         agency preference, close date proximity)
      4. Write/update tenant_pipeline_items row with score
      5. Collect tenant IDs above threshold for notification

    Args:
        conn: Active asyncpg connection.
        solicitation_id: curated_solicitations.id (UUID string) that was just pushed.
        topic_count: Number of topics in this solicitation (informational).

    Returns:
        {
            "tenantIds": ["uuid1", "uuid2", ...],  # tenants above notification threshold
            "tenantsScored": 5,
            "tenantsNotified": 2,
            "avgScore": 0.73,
        }
    """
    # TODO: Implement tenant-opportunity scoring
    #
    # Implementation steps:
    # 1. Fetch the solicitation + opportunity metadata:
    #      SELECT cs.id, o.naics_codes, o.agency, o.program_type,
    #             cs.solicitation_type
    #      FROM curated_solicitations cs
    #      JOIN opportunities o ON o.id = cs.opportunity_id
    #      WHERE cs.id = $1
    #
    # 2. Fetch all eligible tenants:
    #      SELECT t.id, t.slug, tp.naics_codes, tp.tech_focus_areas,
    #             tp.agency_preferences
    #      FROM tenants t
    #      JOIN tenant_profiles tp ON tp.tenant_id = t.id
    #      WHERE t.status = 'active'
    #        AND t.subscription_status IN ('active', 'trialing')
    #
    # 3. For each tenant, compute score using ScoringEngine:
    #      from scoring.engine import ScoringEngine
    #      engine = ScoringEngine()
    #      score = engine.score_opportunity_for_tenant(tenant, solicitation)
    #
    # 4. Upsert tenant_pipeline_items:
    #      INSERT INTO tenant_pipeline_items (tenant_id, opportunity_id, score, ...)
    #      ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET score = ...
    #
    # 5. Collect tenant IDs with score above notification threshold (e.g., 0.5)
    #
    # 6. Return result dict with tenantIds list

    raise NotImplementedError(
        "match_tenants() action not yet implemented — see inline TODO for steps"
    )
