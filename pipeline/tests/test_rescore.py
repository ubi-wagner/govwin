"""#144a: the Python score_card is a faithful port of frontend/lib/bucket-ranking.ts
scoreCard — same signals, same default weights, JS Math.round semantics.

Expected values are computed from the TS logic by hand; the port must match so moving
scoring to the pipeline preserves behavior (the deterministic 'default of the agent').
"""
from __future__ import annotations

from workflows.actions.rescore import score_card, _js_round, _keyword_hit


# Fixed clock so timeline cases are deterministic.
NOW_MS = 1_700_000_000_000.0
DAY = 86_400_000.0


def test_js_round_matches_math_round_not_bankers():
    # Python round(2.5)==2 (banker's); JS Math.round(2.5)==3 → the port must give 3.
    assert _js_round(2.5) == 3
    assert _js_round(0.5) == 1
    assert _js_round(1.5) == 2
    assert _js_round(-0.5) == 0  # Math.round(-0.5) === -0 → 0


def test_empty_scores_zero():
    assert score_card({}, {}, NOW_MS) == {"score": 0, "factors": {}}


def test_keyword_fraction():
    # text = "ai radar"; keywords ai(hit) quantum(miss) → v=0.5, one signal weight 1.
    r = score_card({"title": "AI Radar"}, {"keywords": ["ai", "quantum"]}, NOW_MS)
    assert r["score"] == 50
    assert r["factors"] == {"keyword": 50}


def test_keyword_precision_word_boundary_for_short_tokens():
    # Lock-down: bare short tokens ('ai'/'ml') match only on a word boundary, not substring, so
    # they no longer false-positive on 'email'/'html'. Longer tokens/phrases stay substring.
    assert score_card({"title": "AI radar"}, {"keywords": ["ai"]}, NOW_MS)["score"] == 100
    assert score_card({"title": "Email marketing"}, {"keywords": ["ai", "ml"]}, NOW_MS)["score"] == 0
    assert score_card({"title": "concrete 3d printing"}, {"keywords": ["3d print"]}, NOW_MS)["score"] == 100


def test_naics_and_agency_weighted_average():
    r = score_card(
        {"agency": "DARPA", "naicsCodes": ["541715"]},
        {"naics": ["541715", "518210"], "agencies": ["darpa"]},
        NOW_MS,
    )
    # naics 0.5*1 + agency 1*1 over total weight 2 → 75.
    assert r["score"] == 75
    assert r["factors"] == {"naics": 50, "agency": 100}


def test_spotlight_summary_is_matched_text():
    # The admin spotlightSummary is authoritative matching context.
    r = score_card({"spotlightSummary": "hypersonic propulsion"}, {"keywords": ["hypersonic"]}, NOW_MS)
    assert r["score"] == 100
    assert r["factors"] == {"keyword": 100}


def test_program_type_exact_match():
    hit = score_card({"programType": "sbir_phase_1"}, {"programTypes": ["sbir_phase_1"]}, NOW_MS)
    assert hit["score"] == 100
    miss = score_card({"programType": "sttr"}, {"programTypes": ["sbir_phase_1"]}, NOW_MS)
    assert miss["score"] == 0


def test_accessibility_gated_on_useAccessibility():
    # setAsides present but useAccessibility falsy → NOT scored (no signal).
    off = score_card({"setAsideType": "8(a)"}, {"setAsides": ["8(a)"]}, NOW_MS)
    assert off == {"score": 0, "factors": {}}
    on = score_card({"setAsideType": "8(a) set-aside"}, {"setAsides": ["8(a)"], "useAccessibility": True}, NOW_MS)
    assert on["score"] == 100
    assert on["factors"] == {"accessibility": 100}


def test_unparseable_close_date_skips_timeline():
    # RANK-7 parity: an invalid date skips the timeline signal (no phantom 0.1), same as the frontend.
    r = score_card({"title": "quantum", "closeDate": "not-a-date"}, {"keywords": ["quantum"], "useTimeline": True}, NOW_MS)
    assert r == {"score": 100, "factors": {"keyword": 100}}


def test_short_keyword_with_whitespace_uses_substring():
    # RANK-7 parity: a <=3-char token containing ANY whitespace (tab) takes the substring path,
    # matching the frontend's `!/\s/.test(k)` (previously Python only special-cased a literal space).
    assert _keyword_hit("xa\tby", "a\tb") is True
    assert _keyword_hit("foo bar", "a\tb") is False


def test_timeline_decay_bands():
    def close(days):
        return {"closeDate": _iso(NOW_MS + days * DAY)}
    assert score_card(close(15), {"useTimeline": True}, NOW_MS)["factors"] == {"timeline": 100}
    assert score_card(close(45), {"useTimeline": True}, NOW_MS)["factors"] == {"timeline": 60}
    assert score_card(close(75), {"useTimeline": True}, NOW_MS)["factors"] == {"timeline": 30}
    assert score_card(close(120), {"useTimeline": True}, NOW_MS)["factors"] == {"timeline": 10}
    assert score_card(close(-1), {"useTimeline": True}, NOW_MS)["factors"] == {"timeline": 0}


def test_custom_weights():
    # keyword v=1 weight 3, naics v=0 weight 1 → 100*3/4 = 75.
    r = score_card(
        {"title": "quantum", "naicsCodes": []},
        {"keywords": ["quantum"], "naics": ["541715"], "weights": {"keyword": 3, "naics": 1}},
        NOW_MS,
    )
    assert r["score"] == 75


def test_js_rounding_in_score_and_factor():
    # 1 hit of 40 keywords → v=0.025 → 2.5 → JS-round 3 (banker's would be 2).
    kws = [f"kw{i}" for i in range(40)]
    r = score_card({"title": "kw0 only"}, {"keywords": kws}, NOW_MS)
    assert r["score"] == 3
    assert r["factors"] == {"keyword": 3}


def _iso(ms: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()


# ── Live drive-tests of the tenant-side rescore actions ─────────────────────

import os
import uuid

import asyncpg
import pytest

DATABASE_URL = os.getenv("DATABASE_URL")


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_rescore_tenant_card_writes_scores_matching_score_card():
    """Seed a tenant + a bucket (keyword criteria) + a card; rescore_tenant_card must write
    tenant_bucket_scores whose value equals the pure score_card() for that card+criteria."""
    from workflows.actions.rescore import rescore_tenant_card, score_card

    conn = await asyncpg.connect(DATABASE_URL)
    tag = uuid.uuid4().hex[:8]
    tenant, opp, bucket = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    criteria = {"keywords": ["quantum", "radar"]}
    card = {"title": "Quantum Radar SBIR", "description": "advanced sensing"}
    try:
        await conn.execute("INSERT INTO tenants (id, slug, name, status) VALUES ($1,$2,$3,'active')",
                           tenant, f"t-{tag}", f"T {tag}")
        await conn.execute(
            "INSERT INTO tenant_spotlight_buckets (id, tenant_id, name, criteria, is_active) VALUES ($1,$2,'B',$3::jsonb,true)",
            bucket, tenant, __import__("json").dumps(criteria))
        await conn.execute(
            """INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, lifecycle_status)
               VALUES ($1,$2,$3::jsonb,'open')""",
            tenant, opp, __import__("json").dumps(card))

        result = await rescore_tenant_card(conn, tenant_id=str(tenant), opportunity_id=str(opp))
        assert result["bucketsScored"] == 1, result

        row = await conn.fetchrow(
            "SELECT score, factors FROM tenant_bucket_scores WHERE tenant_id=$1 AND bucket_id=$2 AND opportunity_id=$3",
            tenant, bucket, opp)
        assert row is not None, "no score written"
        # "quantum" hits, "radar" hits → v=1.0 → score 100.
        expected = score_card(card, criteria, __import__("time").time() * 1000.0)
        assert row["score"] == expected["score"] == 100

        # Audited: capture:card.scored emitted.
        n = await conn.fetchval(
            "SELECT count(*) FROM system_events WHERE namespace='capture' AND type='card.scored' AND tenant_id=$1",
            tenant)
        assert n >= 1
    finally:
        await conn.execute("DELETE FROM tenant_bucket_scores WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM tenant_opportunity_cards WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM tenant_spotlight_buckets WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM system_events WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM tenants WHERE id=$1", tenant)
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_rescore_tenant_scores_all_open_cards_x_buckets():
    """rescore_tenant scores every open card × every active bucket (the bucket-edit trigger)."""
    from workflows.actions.rescore import rescore_tenant

    conn = await asyncpg.connect(DATABASE_URL)
    tag = uuid.uuid4().hex[:8]
    tenant = uuid.uuid4()
    b1, b2 = uuid.uuid4(), uuid.uuid4()
    o1, o2 = uuid.uuid4(), uuid.uuid4()
    try:
        await conn.execute("INSERT INTO tenants (id, slug, name, status) VALUES ($1,$2,$3,'active')",
                           tenant, f"t-{tag}", f"T {tag}")
        for b, kw in ((b1, "quantum"), (b2, "radar")):
            await conn.execute(
                "INSERT INTO tenant_spotlight_buckets (id, tenant_id, name, criteria, is_active) VALUES ($1,$2,'B',$3::jsonb,true)",
                b, tenant, __import__("json").dumps({"keywords": [kw]}))
        for o, title in ((o1, "Quantum Radar"), (o2, "Logistics")):
            await conn.execute(
                "INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, lifecycle_status) VALUES ($1,$2,$3::jsonb,'open')",
                tenant, o, __import__("json").dumps({"title": title}))

        result = await rescore_tenant(conn, tenant_id=str(tenant))
        # 2 cards × 2 buckets = 4 pairs written.
        assert result["pairsScored"] == 4, result
        total = await conn.fetchval("SELECT count(*) FROM tenant_bucket_scores WHERE tenant_id=$1", tenant)
        assert total == 4
    finally:
        await conn.execute("DELETE FROM tenant_bucket_scores WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM tenant_opportunity_cards WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM tenant_spotlight_buckets WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM system_events WHERE tenant_id=$1", tenant)
        await conn.execute("DELETE FROM tenants WHERE id=$1", tenant)
        await conn.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_rescore_no_buckets_is_safe_noop():
    """A tenant with no active buckets is a safe no-op — never a dead-end."""
    from workflows.actions.rescore import rescore_tenant_card
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        r = await rescore_tenant_card(conn, tenant_id=str(uuid.uuid4()), opportunity_id=str(uuid.uuid4()))
        assert r["bucketsScored"] == 0
    finally:
        await conn.close()


# ── Wiring locks: the tenant-side event-driven scoring spine ─────────────────

def test_rescore_workflows_registered_on_capture_events():
    from workflows.base import discover_workflows, all_registered_workflows
    discover_workflows()
    byname = {w.__name__: w for w in all_registered_workflows()}
    assert byname["OnCardApplied"].trigger.namespace == "capture"
    assert byname["OnCardApplied"].trigger.type == "card.applied"
    assert byname["OnBucketsUpdated"].trigger.type == "buckets.updated"


def _read_frontend(rel: str):
    import os
    p = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", rel))
    if not os.path.exists(p):
        import pytest
        pytest.skip(f"{rel} not present")
    return open(p, encoding="utf-8").read()


def test_bridge_emits_card_applied_and_no_inline_scoring():
    """The bridge fan-out must announce card.applied (tenant-side scoring hook) and NOT
    score inline anymore (autoScoreCard removed from the admin push path)."""
    src = _read_frontend("lib/opportunity-bridge.ts")
    assert "'card.applied'" in src
    assert "autoScoreCard" not in src, "inline scoring must be gone from the bridge fan-out"


def test_solicitation_push_emits_pushed_after_fanout_for_digest_ordering():
    """solicitation.pushed must be emitted AFTER the bridge fan-out so the OnSolicitationPushed
    digest reads freshly-scored tenant_bucket_scores (card.applied has the earlier created_at)."""
    src = _read_frontend("lib/tools/solicitation-push.ts")
    fanout = src.index("Publish EVERY activated opportunity")
    pushed = src.index("type: 'solicitation.pushed'")
    assert pushed > fanout, "solicitation.pushed must be emitted after the fan-out block"


def test_buckets_routes_emit_buckets_updated_for_tenant_side_rescore():
    """Bucket create/edit/rank must emit capture:buckets.updated so the tenant-side agent path
    (OnBucketsUpdated -> rescore.py + scoring_strategist) ALWAYS fires. That event — not the
    absence of an inline call — is what guarantees "ranking happens inside the tenant space by
    their agents": it catches the real regression (a route that ranks inline but forgets to
    announce the change, so the pipeline never rescores).

    A supplementary, tenant-scoped (withTenant / WHERE tenant_id) inline rankBucket at CREATE is
    ALLOWED and intentional — it makes a brand-new bucket show a ranked list instantly, the same
    immediate "auto-scored on arrival" pattern used at tenant provision (lib/cards/score-tenant.ts).
    It never replaces the event and never crosses tenants, so it does not violate the invariant."""
    for rel in (
        "app/api/portal/[tenantSlug]/buckets/route.ts",
        "app/api/portal/[tenantSlug]/buckets/[bucketId]/route.ts",
    ):
        src = _read_frontend(rel)
        assert "'buckets.updated'" in src, f"{rel} must emit capture:buckets.updated (the tenant-side rescore trigger)"
