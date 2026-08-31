"""The nudge sweeps, after the verdict/transfer split (mig 240).

── WHAT THESE ENCODE ────────────────────────────────────────────────────────────────────────────
Both sweeps carried ``AND c.is_pinned = false`` — mechanically ``docs_copied = false`` after the
rename — so the one population that had explicitly raised its hand was the one population that
could never be reminded. The two conditions that legitimately silence a nudge were already there
separately (``pursuing``/``passed``, and an existing portal), which made the third one pure loss.

Three properties, each with the half that makes it mean something:

  1. an up-voted card is now ELIGIBLE (and a passed one still is not — or "eligible" would just
     mean "we nudge everybody")
  2. an explicit verdict BYPASSES the score threshold, because a customer saying "this one" is a
     stronger signal than an algorithm scoring 43
  3. the weekly digest surfaces what is NEW TO YOU — ``unreviewed`` — rather than what you have not
     copied. A digest re-announcing something you already judged is noise dressed as discovery.

DB-integration; conftest auto-skips the module when no Postgres is reachable.
"""
import os
import sys
import uuid

import asyncpg  # noqa: F401 — presence makes conftest skip this module without a DB
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from lifecycle_scheduler import _run_start_nudges, _run_discovery_digest  # noqa: E402

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# The sweep's own constants. A low score keeps the card BELOW the threshold, so anything that makes
# it eligible can only have come from the verdict.
LOW_SCORE = 5


async def _seed(conn, tid, verdict, *, score=LOW_SCORE, days=9, docs_copied=False):
    """One open card closing soon, scored below the threshold, with the given verdict."""
    oppid = uuid.uuid4()
    await conn.execute(
        """
        INSERT INTO opportunities (id, source, source_id, title, close_date, lifecycle_status, is_active)
        VALUES ($1, 'test', $3, 'ZZTEST nudge verdict',
                now() + make_interval(days => $2), 'open', true)
        """,
        oppid, days, str(oppid),
    )
    await conn.execute(
        """
        INSERT INTO tenant_opportunity_cards
          (tenant_id, opportunity_id, card, lifecycle_status, docs_copied, pursuit_status,
           pursuit_set_at, start_nudges_sent, created_at)
        VALUES ($1, $2, '{"title":"ZZTEST nudge verdict"}'::jsonb, 'open', $3, $4,
                CASE WHEN $4 = 'unreviewed' THEN NULL ELSE now() END, 0, now())
        """,
        tid, oppid, docs_copied, verdict,
    )
    if score is not None:
        bucket = await conn.fetchval(
            "SELECT id FROM tenant_spotlight_buckets WHERE tenant_id=$1 AND is_active LIMIT 1", tid)
        if bucket:
            await conn.execute(
                """INSERT INTO tenant_bucket_scores (tenant_id, bucket_id, opportunity_id, score, factors)
                   VALUES ($1,$2,$3,$4,'{}'::jsonb)
                   ON CONFLICT (tenant_id, bucket_id, opportunity_id) DO UPDATE SET score=EXCLUDED.score""",
                tid, bucket, oppid, score)
    return oppid


async def _cleanup(conn, oppids):
    for oppid in oppids:
        await conn.execute("DELETE FROM tenant_bucket_scores WHERE opportunity_id=$1", oppid)
        await conn.execute("DELETE FROM tenant_opportunity_cards WHERE opportunity_id=$1", oppid)
        await conn.execute("DELETE FROM opportunities WHERE id=$1", oppid)
    await conn.execute("DELETE FROM system_events WHERE payload->>'title' = 'ZZTEST nudge verdict'")


@pytest.mark.asyncio
async def test_up_vote_earns_a_nudge_and_a_down_vote_does_not():
    conn = await asyncpg.connect(DATABASE_URL)
    tid = await conn.fetchval("SELECT id FROM tenants LIMIT 1")
    up = down = None
    try:
        # Both score BELOW the threshold, so eligibility can only come from the verdict — and the
        # down-voted twin is what stops "eligible" from meaning "we nudge everyone".
        up = await _seed(conn, tid, "monitoring")
        down = await _seed(conn, tid, "passed")
        await _run_start_nudges(conn)

        nudged = {
            r["opportunity_id"]
            for r in await conn.fetch(
                """SELECT payload->>'opportunityId' AS opportunity_id FROM system_events
                   WHERE namespace='capture' AND type='opportunity.start_recommended'
                     AND created_at > now() - interval '2 minutes'"""
            )
        }
        assert str(up) in nudged, "an up-voted card closing in 9 days was not nudged"
        assert str(down) not in nudged, "a passed card was nudged — the down-vote is not being honoured"
    finally:
        await _cleanup(conn, [x for x in (up, down) if x])
        await conn.close()


@pytest.mark.asyncio
async def test_holding_the_documents_no_longer_silences_the_nudge():
    """The exact clause that was inverted. Two identical up-voted cards, one holding a local copy."""
    conn = await asyncpg.connect(DATABASE_URL)
    tid = await conn.fetchval("SELECT id FROM tenants LIMIT 1")
    copied = plain = None
    try:
        copied = await _seed(conn, tid, "monitoring", docs_copied=True)
        plain = await _seed(conn, tid, "monitoring", docs_copied=False)
        await _run_start_nudges(conn)
        nudged = {
            r["opportunity_id"]
            for r in await conn.fetch(
                """SELECT payload->>'opportunityId' AS opportunity_id FROM system_events
                   WHERE namespace='capture' AND type='opportunity.start_recommended'
                     AND created_at > now() - interval '2 minutes'"""
            )
        }
        # Before the fix the first assertion failed and the second passed — which is precisely the
        # shape of the bug: reading the documents bought you silence.
        assert str(copied) in nudged, "a card whose documents were copied was silenced"
        assert str(plain) in nudged
    finally:
        await _cleanup(conn, [x for x in (copied, plain) if x])
        await conn.close()


@pytest.mark.asyncio
async def test_digest_is_what_is_new_to_you_not_what_you_have_not_copied():
    conn = await asyncpg.connect(DATABASE_URL)
    tid = await conn.fetchval("SELECT id FROM tenants LIMIT 1")
    fresh = judged = None
    emitted = None
    try:
        fresh = await _seed(conn, tid, "unreviewed", score=None)
        # Already judged, and NOT copied — under the old predicate this sailed into the digest as a
        # discovery, because it had no local copy. It is not a discovery; they already looked.
        judged = await _seed(conn, tid, "monitoring", score=None, docs_copied=False)
        await _run_discovery_digest(conn)

        row = await conn.fetchrow(
            """SELECT id, payload FROM system_events
               WHERE namespace='system' AND type='notification.requested'
                 AND payload->>'template'='spotlight_new_topics'
               ORDER BY created_at DESC LIMIT 1"""
        )
        assert row is not None
        emitted = row["id"]
        titles_ct = await conn.fetchval(
            """SELECT count(*)::int FROM tenant_opportunity_cards
               WHERE tenant_id=$1 AND created_at >= now() - interval '7 days'
                 AND lifecycle_status='open' AND archived_at IS NULL
                 AND pursuit_status='unreviewed'""", tid)
        import json
        entry = json.loads(row["payload"]).get("digest", {}).get(str(tid))
        assert entry is not None
        # The digest's count IS the unreviewed set — the judged card is excluded by construction.
        assert entry["count"] == titles_ct, f'digest counted {entry["count"]}, unreviewed set is {titles_ct}'
    finally:
        if emitted is not None:
            await conn.execute("DELETE FROM system_events WHERE id=$1", emitted)
        await _cleanup(conn, [x for x in (fresh, judged) if x])
        await conn.close()
