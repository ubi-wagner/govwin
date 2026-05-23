"""
RFP Pipeline — Main Worker Process (v2.1)

Runs the ingester cron dispatcher + job consumer loop. Polls
pipeline_schedules every 60 seconds for due jobs, inserts
pipeline_jobs rows, and consumes them by dispatching to the
appropriate ingester class (SamGovIngester, SbirGovIngester,
GrantsGovIngester).

Migrations are applied via the GitHub Actions workflow at
.github/workflows/migrate.yml, NOT by this worker. See
docs/DECISIONS.md D-Phase1-01 for why.
"""
import asyncio
import logging
import signal
import os
import sys

# Force line-buffered stdout/stderr so every print() lands in Railway
# deploy logs immediately. Python defaults to BLOCK-buffered stdout
# when attached to a pipe (Docker), which means prints get swallowed
# by the buffer and never appear until the process exits — which this
# worker never does.
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Configure structured logging before any module-level loggers fire
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("pipeline")

from config import DATABASE_URL

shutdown_event = asyncio.Event()


def handle_signal(sig: signal.Signals) -> None:
    log.info("Received %s, shutting down...", sig.name)
    shutdown_event.set()


async def main() -> None:
    env = os.getenv("RAILWAY_ENVIRONMENT_NAME", "local")
    sha = os.getenv("RAILWAY_GIT_COMMIT_SHA", "dev")[:7]
    log.info("RFP Pipeline worker starting... (env=%s, version=%s)", env, sha)

    # Bootstrap seed: ensure a master_admin user exists so the
    # platform has a working login immediately after deploy.
    try:
        from seeds.master_admin import seed_master_admin
        await seed_master_admin(DATABASE_URL)
    except Exception as exc:
        log.error("master_admin seed failed (non-fatal): %s", exc)

    # Import here so the logging config above is already set
    from ingest.dispatcher import run_consumer_loop
    from workflows.processor import run_workflow_processor
    from health import run_health_server
    from lifecycle_scheduler import run_lifecycle_scheduler

    # Run the ingester consumer loop, workflow processor, health
    # server, and lifecycle scheduler concurrently. All manage their
    # own resources and respect shutdown_event.
    await asyncio.gather(
        run_consumer_loop(
            database_url=DATABASE_URL,
            shutdown_event=shutdown_event,
            tick_interval=60,
        ),
        run_workflow_processor(
            database_url=DATABASE_URL,
            shutdown_event=shutdown_event,
            poll_interval=10,
        ),
        run_health_server(
            shutdown_event=shutdown_event,
        ),
        run_lifecycle_scheduler(
            database_url=DATABASE_URL,
            shutdown_event=shutdown_event,
        ),
    )

    log.info("Pipeline worker stopped.")


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda s=sig: handle_signal(s))
    loop.run_until_complete(main())
