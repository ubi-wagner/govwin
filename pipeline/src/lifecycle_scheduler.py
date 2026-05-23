"""
================================================================================
Lifecycle Scheduler — Runs Memory Maintenance on Documented Schedules
================================================================================

WHO:    Started as a concurrent asyncio task alongside the ingester consumer
        and workflow processor in main.py.

WHAT:   Runs memory lifecycle and learning modules on their documented schedules:
        - Daily (3 AM UTC): MemoryDecay, PreferenceExtractor
        - Weekly (Monday 4 AM UTC): MemoryGC, PatternPromoter
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
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger("pipeline.lifecycle")


async def run_lifecycle_scheduler(
    database_url: str,
    shutdown_event: asyncio.Event,
) -> None:
    """Main lifecycle scheduler loop. Runs hourly, checks what's due."""

    logger.info("lifecycle scheduler started")
    conn: asyncpg.Connection | None = None

    try:
        conn = await asyncpg.connect(database_url)
        logger.info("lifecycle scheduler connected to database")

        while not shutdown_event.is_set():
            now = datetime.now(timezone.utc)
            hour = now.hour
            weekday = now.weekday()  # 0 = Monday
            day_of_month = now.day

            # Daily jobs (3 AM UTC)
            if hour == 3:
                await _run_daily_jobs(conn)

            # Weekly jobs (Monday 4 AM UTC)
            if hour == 4 and weekday == 0:
                await _run_weekly_jobs(conn)

            # Monthly jobs (1st Monday 5 AM UTC)
            if hour == 5 and weekday == 0 and day_of_month <= 7:
                await _run_monthly_jobs(conn)

            # Sleep for 1 hour (check at each hour boundary)
            try:
                await asyncio.wait_for(
                    shutdown_event.wait(),
                    timeout=3600,
                )
                break  # shutdown_event was set
            except asyncio.TimeoutError:
                pass  # Normal — hour elapsed, loop again

    except asyncio.CancelledError:
        logger.info("lifecycle scheduler cancelled")
    except Exception as e:
        logger.error("lifecycle scheduler fatal: %s", e)
    finally:
        if conn:
            await conn.close()
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

    logger.info("=== Weekly lifecycle jobs complete ===")


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
