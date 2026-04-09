"""
RFP Pipeline — Main Worker Process
Listens for job notifications, executes ingestion, scoring, agent tasks.

Migrations are applied via the GitHub Actions workflow at
.github/workflows/migrate.yml, which calls db/migrations/run.sh
against the Railway Postgres using the DATABASE_URL repo secret.
This worker does NOT run migrations — previous versions had a
`run_migrations()` helper here that was dead code because the
pipeline Dockerfile only copies `src/` (not `db/`), so the function
could never find the .sql files at /db/migrations inside the
container. It silently logged "No migration files found, skipping"
on every boot. Removed in the post-audit cleanup pass.
"""
import asyncio
import signal
import os
import sys

import asyncpg  # noqa: F401  # kept for future job-queue dequeue logic


# Force line-buffered stdout/stderr so every print() lands in Railway
# deploy logs immediately. Python defaults to BLOCK-buffered stdout
# when attached to a pipe (Docker), which means prints get swallowed
# by the buffer and never appear until the process exits — which this
# worker never does. This one line is the difference between silent
# darkness and useful runtime logs.
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)


shutdown_event = asyncio.Event()
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://govtech:changeme@localhost:5432/govtech_intel",
)


def handle_signal(sig: signal.Signals) -> None:
    print(f"Received {sig.name}, shutting down...")
    shutdown_event.set()


async def main() -> None:
    print("RFP Pipeline worker starting...")

    # TODO: Initialize database connection pool
    # TODO: Register event handlers
    # TODO: Start cron ticker for pipeline_schedules
    # TODO: Listen for pipeline_worker notifications
    # TODO: Main loop: dequeue and execute jobs

    while not shutdown_event.is_set():
        await asyncio.sleep(1)

    print("Pipeline worker stopped.")


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda s=sig: handle_signal(s))
    loop.run_until_complete(main())
