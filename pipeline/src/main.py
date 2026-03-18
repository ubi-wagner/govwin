"""
Pipeline Worker — Long-running process that listens for jobs and executes them.

Architecture:
  LISTEN pipeline_worker  →  dequeue_job()  →  execute  →  update result
  Also: cron scheduler ticks and inserts jobs automatically.

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

from ingest.sam_gov import SamGovIngester
from scoring.engine import ScoringEngine

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
        await conn.execute(
            "UPDATE pipeline_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2",
            str(e), job_id,
        )

    return True


# ── Main loop ───────────────────────────────────────────────────────
async def main():
    if not DATABASE_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    log.info(f"Pipeline worker starting (id={WORKER_ID})")

    conn = await asyncpg.connect(DATABASE_URL)

    # Process any pending jobs first
    while await dequeue_and_run(conn):
        pass

    log.info("Listening for new jobs on 'pipeline_worker' channel...")

    # LISTEN for notifications
    await conn.add_listener("pipeline_worker", lambda *args: None)

    try:
        while not shutdown_event.is_set():
            # Poll for notifications
            try:
                # asyncpg delivers notifications via callbacks, but we use
                # a simple poll pattern: check for pending jobs periodically
                # and on notification
                msg = await asyncio.wait_for(
                    _wait_for_notify(conn),
                    timeout=30,
                )
                if msg:
                    log.info(f"Received notification: {msg}")
            except asyncio.TimeoutError:
                pass
            except asyncpg.PostgresConnectionError:
                log.warning("Connection lost, reconnecting...")
                await asyncio.sleep(5)
                conn = await asyncpg.connect(DATABASE_URL)
                await conn.add_listener("pipeline_worker", lambda *args: None)

            if shutdown_event.is_set():
                break

            # Process all pending jobs
            while await dequeue_and_run(conn):
                if shutdown_event.is_set():
                    break

    finally:
        await conn.close()
        log.info("Pipeline worker stopped")


async def _wait_for_notify(conn):
    """Wait for a notification on any channel. Returns the payload."""
    future = asyncio.get_event_loop().create_future()

    def callback(conn, pid, channel, payload):
        if not future.done():
            future.set_result(payload)

    await conn.add_listener("pipeline_worker", callback)
    try:
        return await future
    finally:
        await conn.remove_listener("pipeline_worker", callback)


if __name__ == "__main__":
    asyncio.run(main())
