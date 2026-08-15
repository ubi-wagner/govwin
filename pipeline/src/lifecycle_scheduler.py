"""
================================================================================
Lifecycle Scheduler — Runs Memory Maintenance on Documented Schedules
================================================================================

WHO:    Started as a concurrent asyncio task alongside the ingester consumer
        and workflow processor in main.py.

WHAT:   Runs memory lifecycle and learning modules on their documented schedules:
        - Daily (3 AM UTC): MemoryDecay, PreferenceExtractor
        - Weekly (Monday 4 AM UTC): MemoryGC, PatternPromoter, DiscoveryDigest
        - Monthly (1st Monday 5 AM UTC): MemoryCompactor, ContradictionResolver, Calibrator

WHY:    Without lifecycle management:
        - Memory tables grow unbounded (episodic_memories accumulates forever)
        - Old irrelevant memories compete with fresh ones during retrieval
        - The learning flywheel never turns (preferences never extracted,
          patterns never promoted to semantic knowledge)
        - Agent output quality stagnates instead of improving

HOW:    Runs an hourly check loop. At each check, determines which jobs are
        due based on UTC hour and day-of-week. Each job runs in its own
        try/except so one failure doesn't block others. Results are logged
        and emitted as system events.

SCHEDULE:
    Daily (3 AM UTC):
        - MemoryDecay: Reduces decay_factor on old, unaccessed memories
        - PreferenceExtractor: Scans episodic memories for recurring patterns

    Weekly (Monday 4 AM UTC):
        - MemoryGC: Hard-deletes expired archived memories
        - PatternPromoter: Promotes confirmed episodic patterns to semantic
        - DiscoveryDigest: emits the "your new matches" digest (spotlight_new_topics)
          for tenants with fresh opportunity cards → CMS sends the opt-in email

    Monthly (1st Monday 5 AM UTC):
        - MemoryCompactor: Clusters similar old memories into summaries
        - ContradictionResolver: Detects and resolves conflicting semantics
        - Calibrator: Recalibrates agent performance metrics

CHANGE LOG:
    PR #xxx (2026-05-22) — Initial implementation
================================================================================
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

import asyncpg

from events import emit_event

logger = logging.getLogger("pipeline.lifecycle")


def _seconds_until_next_hour() -> float:
    """Return seconds until the start of the next UTC hour."""
    now = datetime.now(timezone.utc)
    # seconds remaining in this hour
    remaining = 3600 - (now.minute * 60 + now.second + now.microsecond / 1e6)
    return max(remaining, 1.0)


async def run_lifecycle_scheduler(
    database_url: str,
    shutdown_event: asyncio.Event,
) -> None:
    """Main lifecycle scheduler loop. Runs hourly, checks what's due.

    Tracks last run dates to prevent duplicate execution when the loop
    fires multiple times in the same hour (timing drift prevention).
    Reconnects automatically if the DB connection drops.
    """

    logger.info("lifecycle scheduler started")
    conn: asyncpg.Connection | None = None

    # Track last execution dates to prevent duplicates (P2-#17, P1-#3)
    last_daily_run: date | None = None
    last_weekly_run: date | None = None
    last_monthly_run: date | None = None

    # Outer supervise loop: connect, then run the scheduling loop. On a dropped
    # connection, back off and let this outer loop RECONNECT and RESUME
    # scheduling. Iterative (never recursive), so repeated outages cannot
    # overflow the stack (PIPE-01). last_*_run live outside the loop, so the
    # de-dup state survives reconnects.
    backoff = 30
    while not shutdown_event.is_set():
        conn = None
        try:
            conn = await asyncpg.connect(database_url)
            backoff = 30  # reset after a healthy connect
            logger.info("lifecycle scheduler connected to database")

            while not shutdown_event.is_set():
                now = datetime.now(timezone.utc)
                today = now.date()
                hour = now.hour
                weekday = now.weekday()  # 0 = Monday
                day_of_month = now.day

                # Daily jobs (3 AM UTC) — once per calendar day
                if hour >= 3 and last_daily_run != today:
                    await _run_daily_jobs(conn)
                    last_daily_run = today

                # Weekly jobs (Monday 4 AM UTC) — once per calendar week
                if hour >= 4 and weekday == 0 and last_weekly_run != today:
                    await _run_weekly_jobs(conn)
                    last_weekly_run = today

                # Monthly jobs (1st Monday 5 AM UTC) — once per month
                if hour >= 5 and weekday == 0 and day_of_month <= 7 and last_monthly_run != today:
                    await _run_monthly_jobs(conn)
                    last_monthly_run = today

                # Sleep until next hour boundary to prevent timing drift
                sleep_seconds = _seconds_until_next_hour()
                try:
                    await asyncio.wait_for(
                        shutdown_event.wait(),
                        timeout=sleep_seconds,
                    )
                    break  # shutdown_event was set
                except asyncio.TimeoutError:
                    pass  # Normal — hour boundary reached, loop again

            break  # inner loop exited → shutdown requested

        except asyncio.CancelledError:
            logger.info("lifecycle scheduler cancelled")
            break
        except (asyncpg.PostgresConnectionError, OSError) as conn_err:
            # Connection dropped. Back off (bounded), then the OUTER loop
            # reconnects and resumes scheduling — no recursion, retries until
            # the DB returns or shutdown is requested.
            logger.error(
                "lifecycle scheduler connection lost: %s; reconnecting in %ds",
                conn_err, backoff,
            )
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=backoff)
                break  # shutdown requested during backoff
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 480)
        except Exception as e:
            logger.error("lifecycle scheduler fatal: %s", e)
            break
        finally:
            if conn:
                try:
                    await conn.close()
                except Exception:
                    pass

    logger.info("lifecycle scheduler stopped")


async def _run_daily_jobs(conn: asyncpg.Connection) -> None:
    """Run daily maintenance: memory decay + preference extraction."""
    logger.info("=== Daily lifecycle jobs starting ===")

    # 1. Memory Decay
    try:
        from agents.lifecycle.decay import MemoryDecay
        result = await MemoryDecay().run_decay(conn)
        logger.info("memory decay complete: %s", result)
    except Exception as e:
        logger.error("memory decay failed: %s", e)

    # 2. Preference Extraction
    try:
        from agents.learning.preference_extractor import PreferenceExtractor
        # Run for all active tenants
        tenants = await conn.fetch(
            "SELECT id FROM tenants WHERE status = 'active' LIMIT 100"
        )
        for t in tenants:
            try:
                result = await PreferenceExtractor().extract_for_tenant(conn, str(t["id"]))
                if result:
                    logger.info("preference extraction for tenant %s: %d patterns", t["id"], len(result))
            except Exception as te:
                logger.error("preference extraction failed for tenant %s: %s", t["id"], te)
    except Exception as e:
        logger.error("preference extraction setup failed: %s", e)

    # 3. Spotlight bucket rescore — refresh scores daily so the timeline signal (close-date decay)
    #    doesn't go stale between card arrivals / bucket edits (docs/BUCKET_LOCKDOWN.md T3). Emit one
    #    capture:buckets.updated per tenant that has active buckets; OnBucketsUpdated does the rescore.
    try:
        rows = await conn.fetch(
            "SELECT DISTINCT tenant_id::text AS tid FROM tenant_spotlight_buckets WHERE is_active"
        )
        for r in rows:
            tid = r["tid"]
            try:
                await emit_event(
                    conn,
                    namespace="capture",
                    type="buckets.updated",
                    phase="single",
                    actor_type="system",
                    actor_id="lifecycle_scheduler",
                    tenant_id=tid,
                    payload={"tenantId": tid, "action": "daily_rescore"},
                )
            except Exception as te:
                logger.error("daily bucket rescore emit failed for tenant %s: %s", tid, te)
        logger.info("daily bucket rescore: emitted for %d tenants", len(rows))
    except Exception as e:
        logger.error("daily bucket rescore setup failed: %s", e)

    logger.info("=== Daily lifecycle jobs complete ===")


async def _run_weekly_jobs(conn: asyncpg.Connection) -> None:
    """Run weekly maintenance: GC + pattern promotion."""
    logger.info("=== Weekly lifecycle jobs starting ===")

    # 1. Memory GC
    try:
        from agents.lifecycle.gc import MemoryGC
        result = await MemoryGC().run_gc(conn)
        logger.info("memory GC complete: %s", result)
    except Exception as e:
        logger.error("memory GC failed: %s", e)

    # 2. Pattern Promotion
    try:
        from agents.learning.pattern_promoter import PatternPromoter
        tenants = await conn.fetch(
            "SELECT id FROM tenants WHERE status = 'active' LIMIT 100"
        )
        for t in tenants:
            try:
                result = await PatternPromoter().promote_for_tenant(conn, str(t["id"]))
                if result:
                    logger.info("pattern promotion for tenant %s: %d promoted", t["id"], len(result))
            except Exception as te:
                logger.error("pattern promotion failed for tenant %s: %s", t["id"], te)
    except Exception as e:
        logger.error("pattern promotion setup failed: %s", e)

    # 3. Discovery digest — the weekly "your new matches" re-engagement email (per-tenant, opt-in).
    await _run_discovery_digest(conn)

    logger.info("=== Weekly lifecycle jobs complete ===")


async def _run_discovery_digest(conn: asyncpg.Connection) -> None:
    """Weekly "your new matches" digest.

    Emits ONE ``system:notification.requested`` event carrying the tenants that gained NEW,
    unpinned, non-dismissed opportunity cards this week (ranked by their spotlight-bucket score).
    The CMS event listener fans it out per tenant as the ``spotlight_new_topics`` email, gated by
    each tenant's ``notify_on_new_priority_opp`` preference — the exact same delivery path the
    admin solicitation-push uses, now on a recurring cadence (the missing re-engagement pull).

    Best-effort: never raises into the scheduler loop; a no-op when nothing is new (no email).
    """
    try:
        rows = await conn.fetch(
            """
            SELECT c.tenant_id::text AS tenant_id,
                   count(*)::int AS n,
                   (array_agg(c.card->>'title' ORDER BY bs.top_score DESC NULLS LAST))[1:3] AS titles
            FROM tenant_opportunity_cards c
            LEFT JOIN LATERAL (
              SELECT max(s.score) AS top_score FROM tenant_bucket_scores s
              WHERE s.tenant_id = c.tenant_id AND s.opportunity_id = c.opportunity_id
            ) bs ON true
            WHERE c.created_at >= now() - interval '7 days'
              AND c.lifecycle_status = 'open'
              AND c.is_pinned = false
              AND c.pursuit_status <> 'passed'
              AND c.archived_at IS NULL
            GROUP BY c.tenant_id
            HAVING count(*) > 0
            """
        )
        if not rows:
            logger.info("discovery digest: no new matches this week")
            return
        tenant_ids = [r["tenant_id"] for r in rows]
        digest = {
            r["tenant_id"]: {"count": r["n"], "titles": [t for t in (r["titles"] or []) if t]}
            for r in rows
        }
        await emit_event(
            conn,
            namespace="system",
            type="notification.requested",
            phase="single",
            actor_type="system",
            actor_id="lifecycle_scheduler",
            tenant_id=None,  # multi-tenant digest → recipients live in payload.tenant_ids
            payload={
                "channel": "email",
                "template": "spotlight_new_topics",
                "tenant_ids": tenant_ids,
                "tenant_pref": "notify_on_new_priority_opp",
                "window_days": 7,
                "digest": digest,
            },
        )
        logger.info("discovery digest: emitted for %d tenant(s)", len(tenant_ids))
    except Exception as e:
        logger.error("discovery digest failed: %s", e)


async def _run_monthly_jobs(conn: asyncpg.Connection) -> None:
    """Run monthly maintenance: compaction + contradiction resolution + calibration."""
    logger.info("=== Monthly lifecycle jobs starting ===")

    tenants_rows: list = []
    try:
        tenants_rows = await conn.fetch(
            "SELECT id FROM tenants WHERE status = 'active' LIMIT 100"
        )
    except Exception as e:
        logger.error("monthly jobs tenant query failed: %s", e)
        return

    # 1. Memory Compaction
    try:
        from agents.lifecycle.compactor import MemoryCompactor
        for t in tenants_rows:
            try:
                result = await MemoryCompactor().compact_for_tenant(conn, str(t["id"]))
                logger.info("compaction for tenant %s: %s", t["id"], result)
            except Exception as te:
                logger.error("compaction failed for tenant %s: %s", t["id"], te)
    except Exception as e:
        logger.error("compaction setup failed: %s", e)

    # 2. Contradiction Resolution
    try:
        from agents.lifecycle.contradiction_resolver import ContradictionResolver
        for t in tenants_rows:
            try:
                result = await ContradictionResolver().resolve_for_tenant(conn, str(t["id"]))
                logger.info("contradiction resolution for tenant %s: %s", t["id"], result)
            except Exception as te:
                logger.error("contradiction resolution failed for tenant %s: %s", t["id"], te)
    except Exception as e:
        logger.error("contradiction resolution setup failed: %s", e)

    # 3. Calibration
    try:
        from agents.learning.calibrator import Calibrator
        for t in tenants_rows:
            try:
                result = await Calibrator().calibrate_for_tenant(conn, str(t["id"]))
                logger.info("calibration for tenant %s: %s", t["id"], result)
            except Exception as te:
                logger.error("calibration failed for tenant %s: %s", t["id"], te)
    except Exception as e:
        logger.error("calibration setup failed: %s", e)

    logger.info("=== Monthly lifecycle jobs complete ===")
