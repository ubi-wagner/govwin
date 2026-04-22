"""Cron dispatcher and job consumer for the ingester framework.

Reads pipeline_schedules for due jobs, inserts pipeline_jobs rows,
and consumes them by dispatching to the appropriate ingester class.

See docs/phase-1/C-python-ingester-framework.md §C6 for the spec.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from ingest.sam_gov import SamGovIngester
from ingest.sbir_gov import SbirGovIngester
from ingest.grants_gov import GrantsGovIngester

log = logging.getLogger("pipeline.dispatcher")

# Map source names to ingester classes
INGESTERS = {
    "sam_gov": SamGovIngester,
    "sbir_gov": SbirGovIngester,
    "grants_gov": GrantsGovIngester,
}


async def tick_schedules(conn: asyncpg.Connection) -> int:
    """Check pipeline_schedules for due jobs and insert pipeline_jobs rows.

    Called every 60 seconds from the main loop. Returns the number
    of jobs inserted.
    """
    now = datetime.now(timezone.utc)
    inserted = 0

    try:
        schedules = await conn.fetch(
            """
            SELECT id, source, run_type, cron_expression, next_run_at
            FROM pipeline_schedules
            WHERE enabled = true
              AND (next_run_at IS NULL OR next_run_at <= $1)
            ORDER BY source
            """,
            now,
        )
    except Exception as e:
        log.error("failed to read pipeline_schedules: %s", e)
        return 0

    for sched in schedules:
        source = sched["source"]
        if source not in INGESTERS:
            # Skip non-ingester schedules (scoring, memory_decay, etc.)
            continue

        try:
            # Check for an already-pending or running job for this source
            existing = await conn.fetchval(
                """
                SELECT 1 FROM pipeline_jobs
                WHERE source = $1 AND status IN ('pending', 'running')
                LIMIT 1
                """,
                source,
            )
            if existing:
                log.debug("skipping %s — already has a pending/running job", source)
                continue

            # Insert a new job
            await conn.execute(
                """
                INSERT INTO pipeline_jobs (source, status, priority, metadata)
                VALUES ($1, 'pending', 5, $2::jsonb)
                """,
                source,
                f'{{"run_type": "{sched["run_type"]}", "triggered_by": "cron"}}',
            )
            inserted += 1

            # Advance next_run_at using a simple interval-based approach
            # (a proper croniter implementation is deferred to Phase 1.5;
            # for now we just add 24 hours for daily, 7 days for weekly)
            interval_hours = 168 if "1" in (sched["cron_expression"] or "") else 24
            await conn.execute(
                """
                UPDATE pipeline_schedules
                SET next_run_at = $1, last_run_at = now()
                WHERE id = $2
                """,
                now + __import__("datetime").timedelta(hours=interval_hours),
                sched["id"],
            )

            log.info("scheduled job for %s (run_type=%s)", source, sched["run_type"])

        except Exception as e:
            log.error("failed to schedule job for %s: %s", source, e)

    return inserted


async def consume_one_job(conn: asyncpg.Connection) -> bool:
    """Dequeue and execute one pending pipeline job.

    Returns True if a job was processed, False if the queue was empty.
    Uses an atomic UPDATE ... RETURNING to claim the job (race-safe
    against multiple workers, though Phase 1 runs a single worker).

    Routes by pipeline_jobs.kind:
      - 'ingest'              → ingester (sam_gov, sbir_gov, grants_gov)
      - 'shred_solicitation'  → shredder.runner.shred_solicitation

    For shred jobs, metadata must contain 'solicitation_id' (UUID str).
    """
    # Atomically claim the next pending job
    job = await conn.fetchrow(
        """
        UPDATE pipeline_jobs
        SET status = 'running', started_at = now()
        WHERE id = (
            SELECT id FROM pipeline_jobs
            WHERE status = 'pending'
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, source, kind, metadata
        """
    )

    if not job:
        return False

    job_id = job["id"]
    source = job["source"]
    kind = job["kind"]
    # asyncpg returns JSONB as a string unless a codec is registered.
    # Parse defensively so the dispatcher works without codec setup.
    raw_metadata = job["metadata"]
    if isinstance(raw_metadata, str):
        try:
            metadata = json.loads(raw_metadata) if raw_metadata else {}
        except json.JSONDecodeError:
            metadata = {}
    else:
        metadata = raw_metadata or {}

    log.info("claimed job %s (kind=%s, source=%s)", job_id, kind, source)

    try:
        if kind == "shred_solicitation":
            await _run_shred_job(conn, job_id, metadata)
        else:  # default: 'ingest'
            await _run_ingest_job(conn, job_id, source, metadata)
    except Exception as e:
        log.error("job %s failed: %s", job_id, e)
        await conn.execute(
            """
            UPDATE pipeline_jobs
            SET status = 'failed',
                completed_at = now(),
                result = $2::jsonb
            WHERE id = $1
            """,
            job_id,
            json.dumps({"error": str(e)[:500]}),
        )

    return True


async def _run_ingest_job(
    conn: asyncpg.Connection,
    job_id: Any,
    source: str,
    metadata: dict,
) -> None:
    """Execute an ingest job by routing to the right ingester class."""
    run_type = metadata.get("run_type", "incremental")

    ingester_cls = INGESTERS.get(source)
    if not ingester_cls:
        log.warning("unknown source %s for job %s — marking failed", source, job_id)
        await conn.execute(
            "UPDATE pipeline_jobs SET status = 'failed', completed_at = now() WHERE id = $1",
            job_id,
        )
        return

    ingester = ingester_cls()
    result = await ingester.run(conn, run_type)

    await conn.execute(
        """
        UPDATE pipeline_jobs
        SET status = 'completed',
            completed_at = now(),
            result = $2::jsonb
        WHERE id = $1
        """,
        job_id,
        json.dumps({
            "inserted": result.inserted,
            "updated": result.updated,
            "skipped": result.skipped,
            "failed": result.failed,
            "pages_fetched": result.pages_fetched,
            "duration_ms": result.duration_ms,
            "errors": result.errors[:5],
        }),
    )
    log.info(
        "job %s completed: inserted=%d updated=%d skipped=%d failed=%d",
        job_id, result.inserted, result.updated, result.skipped, result.failed,
    )


async def _run_shred_job(
    conn: asyncpg.Connection,
    job_id: Any,
    metadata: dict,
) -> None:
    """Execute a shred_solicitation job.

    Expects metadata.solicitation_id. Instantiates an anthropic client
    lazily so test harnesses can inject a mock via the `ANTHROPIC_CLIENT`
    attribute on shredder.runner (see test_ingest_e2e.py).
    """
    solicitation_id = metadata.get("solicitation_id")
    if not solicitation_id:
        await conn.execute(
            """
            UPDATE pipeline_jobs
            SET status = 'failed',
                completed_at = now(),
                result = $2::jsonb
            WHERE id = $1
            """,
            job_id,
            json.dumps({"error": "shred_solicitation job missing metadata.solicitation_id"}),
        )
        log.warning("shred job %s missing solicitation_id — marking failed", job_id)
        return

    # Lazy imports so the dispatcher module can be imported without
    # the shredder (and its anthropic/pymupdf deps) being fully wired.
    from shredder import runner as shredder_runner

    # Tests override this attribute to inject a mock client.
    client = getattr(shredder_runner, "ANTHROPIC_CLIENT", None)
    if client is None:
        import anthropic  # lazy — pulls in the SDK only when actually used
        client = anthropic.AsyncAnthropic()

    result = await shredder_runner.shred_solicitation(conn, solicitation_id, client)

    await conn.execute(
        """
        UPDATE pipeline_jobs
        SET status = 'completed',
            completed_at = now(),
            result = $2::jsonb
        WHERE id = $1
        """,
        job_id,
        json.dumps(result),
    )
    log.info("shred job %s completed: %s", job_id, result.get("status"))


async def run_consumer_loop(
    database_url: str,
    shutdown_event: asyncio.Event,
    tick_interval: int = 60,
) -> None:
    """Main worker loop: tick schedules every 60s, consume jobs continuously.

    Runs until shutdown_event is set (SIGINT/SIGTERM).
    """
    conn: Optional[asyncpg.Connection] = None
    try:
        conn = await asyncpg.connect(database_url)
        log.info("consumer loop started")

        last_tick = 0.0
        while not shutdown_event.is_set():
            now = asyncio.get_event_loop().time()

            # Tick schedules periodically
            if now - last_tick >= tick_interval:
                try:
                    scheduled = await tick_schedules(conn)
                    if scheduled > 0:
                        log.info("tick_schedules inserted %d jobs", scheduled)
                except Exception as e:
                    log.error("tick_schedules error: %s", e)
                last_tick = now

            # Try to consume one job
            try:
                processed = await consume_one_job(conn)
                if not processed:
                    # No pending jobs — sleep briefly before next check
                    await asyncio.sleep(5)
            except Exception as e:
                log.error("consume_one_job error: %s", e)
                await asyncio.sleep(10)

    except Exception as e:
        log.error("consumer loop fatal: %s", e)
    finally:
        if conn:
            await conn.close()
        log.info("consumer loop stopped")
