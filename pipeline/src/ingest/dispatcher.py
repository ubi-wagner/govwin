"""Cron dispatcher and job consumer for the ingester framework.

Reads pipeline_schedules for due jobs, inserts pipeline_jobs rows,
and consumes them by dispatching to the appropriate ingester class.

See docs/phase-1/C-python-ingester-framework.md §C6 for the spec.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg

# The platform runs on UTC end-to-end — schedules, cron computation, and audit timestamps
# are all UTC (one canonical clock; audit is exact to the microsecond). Each admin (RFP or
# tenant) picks a DISPLAY timezone preference (users.timezone) that the UI renders times in;
# a schedule an admin sets in their local time is converted to a UTC cron on save.

from ingest.sam_gov import SamGovIngester
from ingest.sbir_gov import SbirGovIngester
from ingest.grants_gov import GrantsGovIngester
from ingest.dsip import DsipIngester

log = logging.getLogger("pipeline.dispatcher")

# Map source names to ingester classes
INGESTERS = {
    "sam_gov": SamGovIngester,
    "sbir_gov": SbirGovIngester,
    "grants_gov": GrantsGovIngester,
    "dsip": DsipIngester,
}


def compute_next_run(
    cron_expression: Optional[str], run_type: Optional[str], now: datetime
) -> datetime:
    """Next scheduled time from a standard 5-field cron (min hour dom month dow),
    for the fixed-time patterns we actually schedule: daily ``M H * * *``, weekly
    ``M H * * D`` (cron dow, Sunday=0), and every-N-hours ``M */N * * *``. Any other
    expression (including day-of-month) falls back to a run_type step (weekly=168h
    else 24h) **with a warning** — so an unsupported cron is never SILENTLY
    mis-scheduled (the previous behaviour ignored cron_expression entirely).
    """
    step = timedelta(hours=168 if run_type == "weekly" else 24)
    if not cron_expression:
        return now + step
    parts = cron_expression.split()
    if len(parts) != 5:
        log.warning("cron_expression %r is not 5 fields — using %s step",
                    cron_expression, run_type or "daily")
        return now + step
    minute, hour, dom, month, dow = parts
    try:
        # every-N-hours: "<m> */<n> * * *"
        if hour.startswith("*/") and dom == "*" and month == "*" and dow == "*":
            n = int(hour[2:])
            if n >= 1:
                return now + timedelta(hours=n)
        if minute.isdigit() and hour.isdigit() and month == "*":
            mm, hh = int(minute), int(hour)
            # UTC canonical: cron hour/minute are UTC (an admin's local schedule is converted
            # to a UTC cron on save; the UI renders back in the admin's display timezone).
            # daily "<m> <h> * * *"
            if dom == "*" and dow == "*":
                nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
                return nxt if nxt > now else nxt + timedelta(days=1)
            # weekly "<m> <h> * * <d>" (cron Sunday=0/7 → python weekday Mon=0..Sun=6)
            if dom == "*" and dow.isdigit():
                py_target = (int(dow) + 6) % 7
                nxt = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
                days_ahead = (py_target - nxt.weekday()) % 7
                if days_ahead == 0 and nxt <= now:
                    days_ahead = 7
                return nxt + timedelta(days=days_ahead)
    except (ValueError, TypeError) as e:
        log.warning("cron_expression %r parse error (%s) — using %s step",
                    cron_expression, e, run_type or "daily")
        return now + step
    log.warning("cron_expression %r unsupported — using %s step",
                cron_expression, run_type or "daily")
    return now + step


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

        # Event-emitting schedules (run_type='event', source='namespace:type') bridge the
        # SHARED cron to the workflow processor: emit the system_event on its cadence, and the
        # normal event→workflow→agent path takes over. This is how our-org scheduled work
        # (ops digest, solicitation update-scan, content resurface, social scheduling) runs on
        # the same cron + processor as everything else — no bespoke scheduler. Audit timestamp
        # is the DB clock (now(), one system time, microsecond precision).
        if sched["run_type"] == "event" and ":" in source:
            try:
                ns, etype = source.split(":", 1)
                next_run = compute_next_run(sched["cron_expression"], sched["run_type"], now)
                # CAS: atomically CLAIM the tick by advancing next_run_at BEFORE emitting.
                # The WHERE re-checks the schedule is still due, so a crash between claim and
                # emit (at-most-once — a missed digest is fine, a double is not) and a second
                # replica racing the same tick both resolve safely: only the UPDATE that still
                # sees the row due wins (RETURNING id); the loser gets NULL and does nothing.
                claimed = await conn.fetchval(
                    """
                    UPDATE pipeline_schedules
                    SET next_run_at = $1, last_run_at = now()
                    WHERE id = $2 AND (next_run_at IS NULL OR next_run_at <= $3)
                    RETURNING id
                    """,
                    next_run, sched["id"], now,
                )
                if claimed is None:
                    continue  # another worker/tick already claimed this schedule
                await conn.execute(
                    """
                    INSERT INTO system_events
                        (id, namespace, type, phase, actor_type, actor_id, payload, created_at)
                    VALUES (gen_random_uuid(), $1, $2, 'single', 'system', 'cron', $3::jsonb, now())
                    """,
                    ns, etype, json.dumps({"triggeredBy": "cron", "schedule": source}),
                )
                inserted += 1
                log.info("cron emitted event %s (next %s)", source, next_run.isoformat())
            except Exception as e:
                log.error("failed to emit cron event for %s: %s", source, e)
            continue

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
                json.dumps({"run_type": sched["run_type"], "triggered_by": "cron"}),
            )
            inserted += 1

            # Advance next_run_at from the cron_expression (honours the schedule's
            # actual cadence + time-of-day; warns + falls back to a run_type step for
            # anything it can't parse, so a cron is never silently mis-scheduled).
            next_run = compute_next_run(sched["cron_expression"], sched["run_type"], now)
            await conn.execute(
                """
                UPDATE pipeline_schedules
                SET next_run_at = $1, last_run_at = now()
                WHERE id = $2
                """,
                next_run,
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
      - 'scout_source'        → source scout (single source or all due)
      - 'expand_topics'       → ingest.topic_expander.expand_solicitation_topics

    For shred jobs, metadata must contain 'solicitation_id' (UUID str).
    For scout jobs, metadata may contain 'source_id' (UUID str); if
    absent, scouts all sources where auto_crawl is enabled and due.
    For expand_topics jobs, metadata must contain 'solicitation_id'; it
    may also carry 'source_profile_id', 'topic_numbers', and
    'solicitation_number'.
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
        elif kind == "scout_source":
            await _run_scout_job(conn, job_id, metadata)
        elif kind == "expand_topics":
            await _run_expand_topics_job(conn, job_id, metadata)
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

    # Emit the finder.rfp.shredded lifecycle event so downstream systems
    # (scoring, spotlight, customer notifications) can react.
    if result.get("status") == "ai_analyzed":
        import uuid as _uuid
        try:
            await conn.execute(
                """
                INSERT INTO system_events
                  (id, namespace, type, phase, actor_type, actor_id,
                   payload, created_at)
                VALUES ($1, 'finder', 'rfp.shredded', 'single',
                        'pipeline', 'dispatcher',
                        $2::jsonb, now())
                """,
                _uuid.uuid4(),
                json.dumps({
                    "solicitation_id": solicitation_id,
                    "job_id": str(job_id),
                    "status": result.get("status"),
                    "sections": result.get("sections", 0),
                    "compliance_matches": result.get("compliance_matches", 0),
                    "namespace": result.get("namespace"),
                }),
            )
        except Exception as e:
            log.error("failed to emit rfp.shredded event for job %s: %s", job_id, e)


async def _run_expand_topics_job(
    conn: asyncpg.Connection,
    job_id: Any,
    metadata: dict,
) -> None:
    """Execute an expand_topics job.

    On-demand topic expansion: fetch + parse + upsert every topic of a
    solicitation from its source (DSIP public API or per-topic URLs).

    Expects metadata.solicitation_id (UUID str). May also carry
    'source_profile_id', 'topic_numbers' (list), and 'solicitation_number'.
    The expander itself emits the finder:topics.expanded rollup; here we
    mark the job done and emit a job-level lifecycle event.
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
            json.dumps({"error": "expand_topics job missing metadata.solicitation_id"}),
        )
        log.warning("expand_topics job %s missing solicitation_id — marking failed", job_id)
        return

    # Lazy import so the dispatcher module can be imported without the
    # topic expander (and its httpx/parsing deps) being fully wired.
    from ingest.topic_expander import expand_solicitation_topics

    result = await expand_solicitation_topics(
        conn,
        solicitation_id=metadata["solicitation_id"],
        source_profile_id=metadata.get("source_profile_id"),
        topic_numbers=metadata.get("topic_numbers"),
        solicitation_number=metadata.get("solicitation_number"),
    )

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
    log.info("expand_topics job %s completed: %s", job_id, result.get("status"))
    # The finder:topics.expanded rollup event is emitted by topic_expander
    # itself (_emit_topics_expanded). No duplicate emit here.


async def _run_scout_job(
    conn: asyncpg.Connection,
    job_id: Any,
    metadata: dict,
) -> None:
    """Execute a scout_source job.

    If metadata contains 'source_id', scouts that single source.
    Otherwise, scouts all sources where auto_crawl is enabled and due.
    """
    # Lazy import so the dispatcher can be imported without the scout
    # worker and its httpx/anthropic dependencies being fully wired.
    from workers.source_scout import scout_source, scout_all_due

    source_id = metadata.get("source_id")

    if source_id:
        result = await scout_source(conn, source_id)
    else:
        result = await scout_all_due(conn)

    status = "failed" if result.get("error") else "completed"

    await conn.execute(
        """
        UPDATE pipeline_jobs
        SET status = $2,
            completed_at = now(),
            result = $3::jsonb
        WHERE id = $1
        """,
        job_id,
        status,
        json.dumps(result),
    )
    log.info("scout job %s %s: %s", job_id, status, {
        k: v for k, v in result.items() if k != "results"
    })


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
