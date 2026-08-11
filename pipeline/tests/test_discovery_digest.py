"""Weekly discovery-digest job (lifecycle_scheduler._run_discovery_digest).

Proves the recurring "your new matches" re-engagement email: a tenant that gained a NEW, open,
unpinned, non-dismissed opportunity card this week is emitted in a single
``system:notification.requested`` event (channel=email, template=spotlight_new_topics, gated by
notify_on_new_priority_opp) that the CMS fans out per tenant. DB-integration — the conftest
auto-skips this module when no Postgres is reachable (it imports asyncpg).
"""
import json
import os
import sys
import uuid

import asyncpg  # noqa: F401 — presence makes conftest skip this module without a DB
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from lifecycle_scheduler import _run_discovery_digest  # noqa: E402

DATABASE_URL = os.environ.get("DATABASE_URL", "")


@pytest.mark.asyncio
async def test_discovery_digest_emits_for_tenant_with_new_matches():
    conn = await asyncpg.connect(DATABASE_URL)
    tid = await conn.fetchval("SELECT id FROM tenants LIMIT 1")
    assert tid is not None
    oppid = uuid.uuid4()
    emitted_id = None
    try:
        # A guaranteed-new, open, unpinned, unreviewed card → the tenant must appear in the digest.
        await conn.execute(
            """
            INSERT INTO tenant_opportunity_cards
              (tenant_id, opportunity_id, card, lifecycle_status, is_pinned, pursuit_status, created_at)
            VALUES ($1, $2, '{"title":"ZZTEST digest opportunity"}'::jsonb, 'open', false, 'unreviewed', now())
            """,
            tid, oppid,
        )
        await _run_discovery_digest(conn)

        row = await conn.fetchrow(
            """
            SELECT id, payload FROM system_events
            WHERE namespace='system' AND type='notification.requested'
              AND payload->>'template'='spotlight_new_topics'
            ORDER BY created_at DESC LIMIT 1
            """
        )
        assert row is not None, "digest emitted no notification.requested event"
        emitted_id = row["id"]
        p = json.loads(row["payload"])
        assert p["channel"] == "email"
        assert p["template"] == "spotlight_new_topics"
        assert p["tenant_pref"] == "notify_on_new_priority_opp"
        assert isinstance(p["tenant_ids"], list) and str(tid) in p["tenant_ids"]
        # the per-tenant digest carries a count + the new title
        entry = p.get("digest", {}).get(str(tid))
        assert entry and entry["count"] >= 1
        assert any("ZZTEST digest opportunity" in t for t in entry.get("titles", []))
    finally:
        if emitted_id is not None:
            await conn.execute("DELETE FROM system_events WHERE id=$1", emitted_id)
        await conn.execute("DELETE FROM tenant_opportunity_cards WHERE opportunity_id=$1", oppid)
        await conn.close()


@pytest.mark.asyncio
async def test_discovery_digest_no_new_matches_emits_nothing():
    """When a tenant context has no fresh cards, the job is a clean no-op (no email spam)."""
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        # Age every card out of the 7-day window inside a rolled-back tx, then assert no emit.
        tr = conn.transaction()
        await tr.start()
        try:
            await conn.execute("UPDATE tenant_opportunity_cards SET created_at = now() - interval '30 days'")
            before = await conn.fetchval(
                "SELECT count(*) FROM system_events WHERE type='notification.requested' AND payload->>'template'='spotlight_new_topics'"
            )
            await _run_discovery_digest(conn)
            after = await conn.fetchval(
                "SELECT count(*) FROM system_events WHERE type='notification.requested' AND payload->>'template'='spotlight_new_topics'"
            )
            assert after == before, "digest emitted despite no new matches"
        finally:
            await tr.rollback()  # never persist the aged timestamps
    finally:
        await conn.close()
