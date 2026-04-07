"""
RFP Pipeline — Main Worker Process
Listens for job notifications, executes ingestion, scoring, agent tasks.
Auto-migrates the database on startup.
"""
import asyncio
import signal
import os
import glob
import asyncpg


shutdown_event = asyncio.Event()
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://govtech:changeme@localhost:5432/govtech_intel")


def handle_signal(sig: signal.Signals) -> None:
    print(f"Received {sig.name}, shutting down...")
    shutdown_event.set()


async def run_migrations() -> None:
    """Run all SQL migrations in order. Idempotent — safe to run on every boot.

    The 000_drop_all.sql file wipes the entire schema before rebuilding.
    It only runs when ALLOW_SCHEMA_RESET=true (set this on Railway during V1
    pre-launch). Once you have real customer data, unset this env var.
    """
    migrations_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'db', 'migrations')
    migrations_dir = os.path.abspath(migrations_dir)

    allow_reset = os.getenv("ALLOW_SCHEMA_RESET", "false").lower() == "true"

    sql_files = sorted(glob.glob(os.path.join(migrations_dir, '*.sql')))
    if not sql_files:
        print("[migrate] No migration files found, skipping")
        return

    # Filter out the drop-all migration unless explicitly allowed
    if not allow_reset:
        sql_files = [f for f in sql_files if '000_drop_all' not in os.path.basename(f)]
        print("[migrate] ALLOW_SCHEMA_RESET=false — skipping schema reset")
    else:
        print("[migrate] ALLOW_SCHEMA_RESET=true — will drop and recreate schema")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        for filepath in sql_files:
            filename = os.path.basename(filepath)
            print(f"[migrate] Running {filename}...")
            with open(filepath, 'r') as f:
                sql = f.read()
            try:
                await conn.execute(sql)
                print(f"[migrate] {filename} ✓")
            except Exception as e:
                # IF NOT EXISTS / ON CONFLICT DO NOTHING make most statements idempotent
                # Log but don't crash on duplicate object errors
                err_msg = str(e)
                if 'already exists' in err_msg or 'duplicate key' in err_msg:
                    print(f"[migrate] {filename} — already applied, skipping")
                else:
                    print(f"[migrate] {filename} FAILED: {e}")
                    raise
        print("[migrate] All migrations complete")
    finally:
        await conn.close()


async def main() -> None:
    print("RFP Pipeline worker starting...")

    # Auto-migrate on boot
    try:
        await run_migrations()
    except Exception as e:
        print(f"[migrate] Migration failed: {e}")
        print("[migrate] Continuing startup — DB may need manual intervention")

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
