"""
Pipeline Worker — Long-running process that listens for jobs and executes them.

Architecture:
  LISTEN pipeline_worker  →  dequeue_job()  →  execute  →  update result
  Cron ticker reads pipeline_schedules and inserts pipeline_jobs on schedule.

No HTTP server. Stays alive via the LISTEN loop.
Railway runs this as a worker service (no PORT).
"""

import asyncio
import json
import logging
import os
import signal
import sys
from datetime import datetime, timezone

import asyncpg
from croniter import croniter

from ingest.sam_gov import SamGovIngester
from scoring.engine import ScoringEngine
from workers.reminder import ReminderDeadlineWorker

# ── Config ──────────────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "")
WORKER_ID = f"worker-{os.getpid()}"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("pipeline")

# ── Graceful shutdown ───────────────────────────────────────────────
shutdown_event = asyncio.Event()


def handle_signal(sig, frame):
    log.info(f"Received signal {sig}, shutting down...")
    shutdown_event.set()


signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)


# ── Cron ticker ────────────────────────────────────────────────────
async def tick_schedules(conn) -> int:
    """
    Read pipeline_schedules, check which are due, insert pipeline_jobs.

    Uses next_run_at for each schedule:
      - If next_run_at is NULL or in the past → job is due
      - After inserting a job, advance next_run_at to the next cron fire time
      - Skip if a pending/running job already exists for this source

    Returns the number of jobs inserted.
    """
    now = datetime.now(timezone.utc)
    inserted = 0

    try:
        schedules = await conn.fetch(
            """
            SELECT id, source, display_name, run_type, cron_expression,
                   timezone, enabled, priority, timeout_minutes,
                   last_run_at, next_run_at
            FROM pipeline_schedules
            WHERE enabled = TRUE
            ORDER BY priority ASC
            """
        )
    except Exception as e:
        log.error(f"[cron_ticker] Failed to read schedules: {e}")
        return 0

    for sched in schedules:
        try:
            source = sched["source"]
            cron_expr = sched["cron_expression"]
            next_run = sched["next_run_at"]

            # Compute next_run_at if not set
            if next_run is None:
                cron = croniter(cron_expr, now)
                next_run = cron.get_prev(datetime).replace(tzinfo=timezone.utc)

            # Not due yet
            if next_run > now:
                continue

            # Skip if a pending or running job already exists for this source
            existing = await conn.fetchval(
                """
                SELECT id FROM pipeline_jobs
                WHERE source = $1 AND status IN ('pending', 'running')
                LIMIT 1
                """,
                source,
            )
            if existing:
                log.info(f"[cron_ticker] Skipping {source}: job {existing} already pending/running")
                # Still advance next_run_at so we don't re-check every tick
                cron = croniter(cron_expr, now)
                next_fire = cron.get_next(datetime).replace(tzinfo=timezone.utc)
                await conn.execute(
                    "UPDATE pipeline_schedules SET next_run_at = $1 WHERE id = $2",
                    next_fire, sched["id"],
                )
                continue

            # Insert the job
            await conn.execute(
                """
                INSERT INTO pipeline_jobs
                    (source, run_type, status, triggered_by, priority)
                VALUES ($1, $2, 'pending', 'cron_ticker', $3)
                """,
                source, sched["run_type"], sched["priority"],
            )

            # Advance next_run_at
            cron = croniter(cron_expr, now)
            next_fire = cron.get_next(datetime).replace(tzinfo=timezone.utc)
            await conn.execute(
                """
                UPDATE pipeline_schedules
                SET next_run_at = $1, last_run_at = $2, updated_at = $2
                WHERE id = $3
                """,
                next_fire, now, sched["id"],
            )

            inserted += 1
            log.info(
                f"[cron_ticker] Inserted job: {source}/{sched['run_type']} "
                f"(next run: {next_fire.isoformat()})"
            )

            # Notify the pipeline_worker channel so the job loop wakes up
            await conn.execute("SELECT pg_notify('pipeline_worker', $1)", source)

        except Exception as e:
            log.error(f"[cron_ticker] Error processing schedule {sched.get('source', '?')}: {e}")

    return inserted


# ── Job execution ───────────────────────────────────────────────────
async def execute_job(conn, job: dict) -> dict:
    """Execute a pipeline job based on its source and run_type."""
    source = job["source"]
    run_type = job["run_type"]
    params = job.get("parameters") or {}

    log.info(f"Executing job {job['id']}: source={source} type={run_type}")

    result = {
        "opportunities_fetched": 0,
        "opportunities_new": 0,
        "opportunities_updated": 0,
        "tenants_scored": 0,
        "documents_downloaded": 0,
        "llm_calls_made": 0,
        "llm_cost_usd": None,
        "amendments_detected": 0,
        "nudges_sent": 0,
        "notifications_delivered": 0,
        "errors": [],
    }

    try:
        if source == "sam_gov" and run_type in ("full", "incremental"):
            ingester = SamGovIngester(conn)
            ingest_result = await ingester.run(params)
            result.update(ingest_result)

        if run_type in ("full", "score") or source == "scoring":
            engine = ScoringEngine(conn)
            score_result = await engine.score_all_tenants()
            result["tenants_scored"] = score_result.get("tenants_scored", 0)

        # Deadline nudges — run the reminder worker's check_deadlines()
        if source == "reminder_nudges" or (source == "digest" and run_type == "notify"):
            worker = ReminderDeadlineWorker(conn)
            nudge_result = await worker.check_deadlines()
            result["nudges_sent"] = nudge_result.get("nudges_sent", 0)

        # Email delivery — flush notifications_queue
        if source in ("digest", "email_delivery") or run_type == "notify":
            try:
                from workers.emailer import deliver_pending_notifications
                email_result = await deliver_pending_notifications(conn)
                result["notifications_delivered"] = email_result.get("delivered", 0)
            except ImportError:
                log.warning("[execute_job] emailer module not available, skipping delivery")
            except Exception as e:
                log.error(f"[execute_job] Email delivery error: {e}")
                result["errors"].append(f"email_delivery: {e}")

    except Exception as e:
        log.error(f"Job {job['id']} error: {e}", exc_info=True)
        result["errors"].append(str(e))

    return result


async def dequeue_and_run(conn):
    """Atomically dequeue one job and execute it."""
    row = await conn.fetchrow(
        "SELECT * FROM dequeue_job($1)", WORKER_ID
    )
    # dequeue_job returns a composite row with all NULLs when no job is pending
    if not row or row["id"] is None:
        return False

    job = dict(row)
    job_id = job["id"]
    started_at = datetime.now(timezone.utc)

    try:
        result = await execute_job(conn, job)

        status = "completed" if not result["errors"] else "failed"
        error_msg = "; ".join(result["errors"]) if result["errors"] else None

        await conn.execute(
            """
            UPDATE pipeline_jobs
            SET status = $1, completed_at = NOW(), result = $2::jsonb, error_message = $3
            WHERE id = $4
            """,
            status, json.dumps(result), error_msg, job_id,
        )

        # Record pipeline run
        await conn.execute(
            """
            INSERT INTO pipeline_runs (
                job_id, source, run_type, started_at, completed_at, status,
                opportunities_fetched, opportunities_new, opportunities_updated,
                tenants_scored, documents_downloaded, llm_calls_made, llm_cost_usd,
                amendments_detected, errors
            ) VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
            """,
            job_id, job["source"], job["run_type"], started_at, status,
            result["opportunities_fetched"], result["opportunities_new"],
            result["opportunities_updated"], result["tenants_scored"],
            result["documents_downloaded"], result["llm_calls_made"],
            result.get("llm_cost_usd"), result["amendments_detected"],
            json.dumps(result["errors"]),
        )

        # Update source health
        if status == "completed":
            await conn.execute(
                """
                UPDATE source_health
                SET status = 'healthy', last_success_at = NOW(), consecutive_failures = 0,
                    updated_at = NOW()
                WHERE source = $1
                """,
                job["source"],
            )
        else:
            await conn.execute(
                """
                UPDATE source_health
                SET status = CASE WHEN consecutive_failures >= 3 THEN 'error' ELSE 'degraded' END,
                    last_error_at = NOW(), last_error_message = $1,
                    consecutive_failures = consecutive_failures + 1, updated_at = NOW()
                WHERE source = $2
                """,
                error_msg, job["source"],
            )

        log.info(f"Job {job_id} finished: {status}")

    except Exception as e:
        log.error(f"Job {job_id} failed hard: {e}", exc_info=True)
        try:
            await conn.execute(
                "UPDATE pipeline_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2",
                str(e)[:500], job_id,
            )
        except Exception as db_err:
            log.error(f"Failed to update job {job_id} status: {db_err}")

    return True


# ── Main loop ───────────────────────────────────────────────────────
async def main():
    if not DATABASE_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    log.info(f"Pipeline worker starting (id={WORKER_ID})")

    conn = await asyncpg.connect(DATABASE_URL)

    # Run cron ticker on startup to catch any due schedules
    try:
        inserted = await tick_schedules(conn)
        if inserted > 0:
            log.info(f"Cron ticker inserted {inserted} job(s) on startup")
    except Exception as e:
        log.error(f"Cron ticker startup error: {e}")

    # Process any pending jobs first
    while await dequeue_and_run(conn):
        pass

    log.info("Listening for new jobs on 'pipeline_worker' channel...")

    # LISTEN for notifications
    await conn.add_listener("pipeline_worker", lambda *args: None)

    # Track last cron tick time — tick every 60 seconds
    last_cron_tick = datetime.now(timezone.utc)

    try:
        while not shutdown_event.is_set():
            # Poll for notifications
            try:
                msg = await asyncio.wait_for(
                    _wait_for_notify(conn),
                    timeout=30,
                )
                if msg:
                    log.info(f"Received notification: {msg}")
            except asyncio.TimeoutError:
                pass
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError):
                log.warning("Connection lost, reconnecting...")
                try:
                    await conn.close()
                except Exception:
                    pass
                await asyncio.sleep(5)
                try:
                    conn = await asyncpg.connect(DATABASE_URL)
                    await conn.add_listener("pipeline_worker", lambda *args: None)
                except Exception as reconn_err:
                    log.error(f"Reconnect failed: {reconn_err}")
                    await asyncio.sleep(10)
                    continue

            if shutdown_event.is_set():
                break

            # Cron ticker — check schedules every 60 seconds
            now = datetime.now(timezone.utc)
            if (now - last_cron_tick).total_seconds() >= 60:
                try:
                    inserted = await tick_schedules(conn)
                    if inserted > 0:
                        log.info(f"Cron ticker inserted {inserted} job(s)")
                except Exception as e:
                    log.error(f"Cron ticker error: {e}")
                last_cron_tick = now

            # Process all pending jobs
            while await dequeue_and_run(conn):
                if shutdown_event.is_set():
                    break

    finally:
        await conn.close()
        log.info("Pipeline worker stopped")


async def _wait_for_notify(conn):
    """Wait for a notification on the pipeline_worker channel. Returns the payload."""
    future = asyncio.get_event_loop().create_future()

    def callback(conn_ref, pid, channel, payload):
        if not future.done():
            future.set_result(payload)

    await conn.add_listener("pipeline_worker", callback)
    try:
        return await future
    finally:
        try:
            await conn.remove_listener("pipeline_worker", callback)
        except Exception:
            pass  # Connection may already be closed


if __name__ == "__main__":
    asyncio.run(main())
