"""P0-3 scoring cutover: match_tenants reads the CANONICAL spine, not retired tables.

Scoring is owned by the frontend opportunity-bridge (auto-scored on arrival into
tenant_bucket_scores). match_tenants() now READS those canonical scores to resolve the
digest recipients — it no longer computes scores or writes tenant_pipeline_items /
spotlight_bucket_scores (the retired legacy Spotlight/Pipeline tables).

The old file exercised the deleted Python scoring math (_calculate_match_scores /
_calculate_bucket_scores); those were retired with the cutover. This is a live drive-test
of the new canonical read against the sandbox, plus a source-level lock that the retired
tables are gone.
"""
from __future__ import annotations

import inspect
import os
import uuid

import asyncpg
import pytest

DATABASE_URL = os.getenv("DATABASE_URL")


# ── Source-level cutover lock (no DB needed) ────────────────────────────────

def test_score_tenants_no_longer_touches_retired_tables():
    import workflows.actions.score_tenants as st

    src = inspect.getsource(st)
    # No SQL operation against the retired tables (the docstring may still NAME them to
    # explain the retirement — we only forbid actual FROM/INTO usage).
    for retired in ("tenant_pipeline_items", "spotlight_bucket_scores"):
        assert f"INTO {retired}" not in src, f"must not write {retired}"
        assert f"FROM {retired}" not in src, f"must not read {retired}"
        assert f"UPDATE {retired}" not in src, f"must not update {retired}"
    # It now reads the canonical spine.
    assert "tenant_bucket_scores" in src
    assert "tenant_opportunity_cards" in src
    # The dead Python scorer is retired.
    assert not hasattr(st, "_calculate_match_scores")
    assert not hasattr(st, "_calculate_bucket_scores")


# ── Live drive-test of the canonical read ───────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_match_tenants_returns_only_tenants_above_threshold():
    """Seed a solicitation + opp + two tenants' canonical cards/scores (one strong, one
    weak); match_tenants must return ONLY the tenant whose card clears the threshold."""
    from workflows.actions.score_tenants import match_tenants, NOTIFICATION_THRESHOLD

    conn = await asyncpg.connect(DATABASE_URL)
    tag = uuid.uuid4().hex[:8]
    opp = uuid.uuid4()
    sol = uuid.uuid4()
    t_hi, t_lo = uuid.uuid4(), uuid.uuid4()
    b_hi, b_lo = uuid.uuid4(), uuid.uuid4()
    try:
        # Opportunity (landing opp of the solicitation), active + open.
        await conn.execute(
            """INSERT INTO opportunities (id, source, source_id, title, is_active, close_date)
               VALUES ($1, 'test', $2, $3, true, now() + interval '30 days')""",
            opp, f"src-{tag}", f"Scoring probe {tag}",
        )
        # Solicitation whose landing opp is the one above (scoring set = {opp}).
        await conn.execute(
            "INSERT INTO curated_solicitations (id, opportunity_id, namespace) VALUES ($1, $2, 'sbir')",
            sol, opp,
        )
        for tid, slug in ((t_hi, f"hi-{tag}"), (t_lo, f"lo-{tag}")):
            await conn.execute(
                "INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')",
                tid, slug, f"Tenant {slug}",
            )
        # A spotlight bucket per tenant (bucket_id FK target for the score row).
        await conn.execute(
            "INSERT INTO tenant_spotlight_buckets (id, tenant_id, name) VALUES ($1, $2, 'Probe')",
            b_hi, t_hi,
        )
        await conn.execute(
            "INSERT INTO tenant_spotlight_buckets (id, tenant_id, name) VALUES ($1, $2, 'Probe')",
            b_lo, t_lo,
        )
        # Canonical cards (active) for both tenants on the opp.
        for tid in (t_hi, t_lo):
            await conn.execute(
                """INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, lifecycle_status)
                   VALUES ($1, $2, '{}'::jsonb, 'open')""",
                tid, opp,
            )
        # Canonical bucket scores: strong for t_hi, weak for t_lo.
        await conn.execute(
            "INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score) VALUES ($1,$2,$3,$4)",
            t_hi, b_hi, opp, NOTIFICATION_THRESHOLD + 30,
        )
        await conn.execute(
            "INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score) VALUES ($1,$2,$3,$4)",
            t_lo, b_lo, opp, NOTIFICATION_THRESHOLD - 30,
        )

        result = await match_tenants(conn, solicitation_id=str(sol))

        assert result["opportunitiesConsidered"] == 1, result
        assert str(t_hi) in result["tenantIds"], result
        assert str(t_lo) not in result["tenantIds"], "weak card must NOT be a digest recipient"
        assert result["tenantsNotified"] == len(result["tenantIds"])

        # A scoring.completed:end event was emitted (the audit signal).
        emitted = await conn.fetchval(
            """SELECT count(*) FROM system_events
               WHERE namespace='finder' AND type='scoring.completed' AND phase='end'
                 AND payload->>'solicitationId' = $1""",
            str(sol),
        )
        assert emitted >= 1
    finally:
        # Clean up (children first).
        await conn.execute("DELETE FROM tenant_bucket_scores WHERE opportunity_id = $1", opp)
        await conn.execute("DELETE FROM tenant_opportunity_cards WHERE opportunity_id = $1", opp)
        await conn.execute("DELETE FROM tenant_spotlight_buckets WHERE id = ANY($1::uuid[])", [b_hi, b_lo])
        await conn.execute("DELETE FROM system_events WHERE payload->>'solicitationId' = $1", str(sol))
        await conn.execute("DELETE FROM curated_solicitations WHERE id = $1", sol)
        await conn.execute("DELETE FROM opportunities WHERE id = $1", opp)
        await conn.execute("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [t_hi, t_lo])
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_match_tenants_skips_missing_solicitation():
    """Unknown solicitation → no opportunities, empty recipient list (never an error)."""
    from workflows.actions.score_tenants import match_tenants

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        result = await match_tenants(conn, solicitation_id=str(uuid.uuid4()))
        assert result.get("tenantIds") == []
        assert result.get("opportunitiesConsidered") == 0
    finally:
        await conn.close()
