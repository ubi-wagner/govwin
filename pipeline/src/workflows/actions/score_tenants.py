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
import uuid
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
    sol_uuid = uuid.UUID(solicitation_id)

    # 1. Fetch the solicitation + opportunity metadata
    #    Note: opportunities table has no 'keywords' column; use
    #    tech_focus_areas (added in migration 013) instead.
    sol = await conn.fetchrow(
        """SELECT cs.id, cs.opportunity_id, o.naics_codes, o.agency,
                  o.program_type, o.set_aside_type, o.close_date,
                  o.title, o.tech_focus_areas, o.description
           FROM curated_solicitations cs
           JOIN opportunities o ON o.id = cs.opportunity_id
           WHERE cs.id = $1""",
        sol_uuid,
    )
    if sol is None:
        return {"status": "skipped", "reason": "solicitation_not_found"}

    opportunity_id = sol["opportunity_id"]

    # 2. Fetch all eligible tenants with profiles
    profiles = await conn.fetch(
        """SELECT t.id AS tenant_id, t.slug, t.subscription_status,
                  tp.naics_codes, tp.keywords, tp.agency_priorities,
                  tp.set_aside_types, tp.technology_focus,
                  tp.research_areas, tp.target_agencies, tp.min_surface_score
           FROM tenants t
           JOIN tenant_profiles tp ON tp.tenant_id = t.id
           WHERE t.status = 'active'
             AND t.subscription_status IN ('active', 'trialing')"""
    )

    if not profiles:
        return {
            "tenantIds": [],
            "tenantsScored": 0,
            "tenantsNotified": 0,
            "avgScore": 0,
        }

    # 3. Score each tenant and upsert pipeline items
    notification_threshold = 50
    tenant_ids_above_threshold: list[str] = []
    total_score_sum = 0
    tenants_scored = 0

    for profile in profiles:
        scores = _calculate_match_scores(sol, profile)
        total_score = scores["total_score"]

        # Skip tenants below their configured minimum surface score
        min_score = profile["min_surface_score"] or 40
        if total_score < min_score:
            continue

        tenants_scored += 1
        total_score_sum += total_score

        # Upsert into tenant_pipeline_items
        await conn.execute(
            """INSERT INTO tenant_pipeline_items
                 (tenant_id, opportunity_id, total_score,
                  naics_score, keyword_score, agency_score,
                  set_aside_score, type_score, timeline_score,
                  matched_keywords, pursuit_status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'unreviewed')
               ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
                 total_score = $3,
                 naics_score = $4,
                 keyword_score = $5,
                 agency_score = $6,
                 set_aside_score = $7,
                 type_score = $8,
                 timeline_score = $9,
                 matched_keywords = $10,
                 updated_at = now()""",
            profile["tenant_id"],
            opportunity_id,
            scores["total_score"],
            scores["naics_score"],
            scores["keyword_score"],
            scores["agency_score"],
            scores["set_aside_score"],
            scores["type_score"],
            scores["timeline_score"],
            scores["matched_keywords"],
        )

        if total_score >= notification_threshold:
            tenant_ids_above_threshold.append(str(profile["tenant_id"]))

    avg_score = round(total_score_sum / tenants_scored, 2) if tenants_scored else 0

    return {
        "tenantIds": tenant_ids_above_threshold,
        "tenantsScored": tenants_scored,
        "tenantsNotified": len(tenant_ids_above_threshold),
        "avgScore": avg_score,
    }


def _calculate_match_scores(sol: Any, profile: Any) -> dict[str, Any]:
    """Compute multi-factor match score between a solicitation and tenant profile.

    Scoring factors (total max 100):
      - NAICS overlap:       0-30 points
      - Keyword overlap:     0-25 points
      - Agency preference:   0-20 points
      - Set-aside match:     0-10 points
      - Program type match:  0-10 points
      - Timeline proximity:  0-5  points

    Returns dict with individual scores, total, and matched keywords.
    """
    # NAICS overlap (max 30 points)
    sol_naics = set(sol["naics_codes"] or [])
    profile_naics = set(profile["naics_codes"] or [])
    naics_overlap = sol_naics & profile_naics
    if sol_naics and profile_naics:
        naics_score = min(int(len(naics_overlap) / max(len(sol_naics), 1) * 30), 30)
    else:
        naics_score = 0

    # Keyword / tech focus overlap (max 25 points)
    #   - opportunities has tech_focus_areas (TEXT[]) not keywords
    #   - tenant_profiles has keywords (TEXT[]), technology_focus (TEXT),
    #     research_areas (TEXT[])
    sol_tech_areas = set(t.lower() for t in (sol.get("tech_focus_areas") or []))
    sol_description_lower = (sol.get("description") or "").lower()
    profile_keywords = set(k.lower() for k in (profile["keywords"] or []))
    tech_focus = (profile["technology_focus"] or "").lower()
    research_areas = set(r.lower() for r in (profile["research_areas"] or []))

    matched_kw: list[str] = []
    # Check sol tech focus areas against profile keywords/focus
    for area in sol_tech_areas:
        if area in profile_keywords or area in tech_focus or area in research_areas:
            matched_kw.append(area)
    # Check profile keywords against sol title and description
    sol_title_lower = (sol["title"] or "").lower()
    for kw in profile_keywords:
        if kw not in matched_kw and (kw in sol_title_lower or kw in sol_description_lower):
            matched_kw.append(kw)

    keyword_score = min(len(matched_kw) * 5, 25)

    # Agency preference (max 20 points)
    sol_agency = (sol["agency"] or "").strip()
    profile_agencies = set(a.strip() for a in (profile["agency_priorities"] or []))
    profile_target_agencies = set(a.strip() for a in (profile["target_agencies"] or []))
    all_preferred = profile_agencies | profile_target_agencies
    agency_score = 20 if sol_agency and sol_agency in all_preferred else 0

    # Set-aside match (max 10 points)
    sol_set_aside = (sol["set_aside_type"] or "").strip()
    profile_set_asides = set(s.strip() for s in (profile["set_aside_types"] or []))
    set_aside_score = 10 if sol_set_aside and sol_set_aside in profile_set_asides else 0

    # Program type match (max 10 points)
    # No program_preferences column exists in tenant_profiles yet,
    # so no comparison is possible — award 0 until profile data exists.
    type_score = 0

    # Timeline proximity (max 5 points) — closer deadlines score higher
    timeline_score = 0
    if sol["close_date"]:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        close_date = sol["close_date"]
        if hasattr(close_date, 'tzinfo') and close_date.tzinfo is None:
            close_date = close_date.replace(tzinfo=timezone.utc)
        days_until_close = (close_date - now).days
        if 0 < days_until_close <= 30:
            timeline_score = 5
        elif 30 < days_until_close <= 60:
            timeline_score = 3
        elif 60 < days_until_close <= 90:
            timeline_score = 1

    total_score = min(
        naics_score + keyword_score + agency_score
        + set_aside_score + type_score + timeline_score,
        100,
    )

    return {
        "total_score": total_score,
        "naics_score": naics_score,
        "keyword_score": keyword_score,
        "agency_score": agency_score,
        "set_aside_score": set_aside_score,
        "type_score": type_score,
        "timeline_score": timeline_score,
        "matched_keywords": matched_kw[:20],  # cap array size
    }
