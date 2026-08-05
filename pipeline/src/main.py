# Deploy baseline 2026-06-14 — touch to exercise the pipeline service build/deploy
# (also ships the content_pages AI repoint). No behavior change.
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


# ---------------------------------------------------------------------------
# PIPE-14: Agent task queue consumer
# ---------------------------------------------------------------------------

async def run_agent_task_consumer(
    database_url: str,
    fabric,  # AgentFabric | None
    shutdown_event: asyncio.Event,
    poll_interval: int = 20,
) -> None:
    """Poll agent_task_queue for pending tasks and process them via fabric.

    Mirrors the lifecycle_scheduler's outer-supervise reconnect loop:
    on a dropped DB connection, backs off and reconnects. Respects
    shutdown_event.

    If fabric is None (AgentFabric failed to initialise), logs a warning
    and exits immediately — tasks remain pending for the next deploy.
    """
    import asyncpg as _asyncpg

    if fabric is None:
        log.warning(
            "run_agent_task_consumer: fabric is None — task queue consumer disabled"
        )
        await shutdown_event.wait()
        return

    log.info("agent task queue consumer started (poll_interval=%ds)", poll_interval)
    backoff = 30

    while not shutdown_event.is_set():
        conn = None
        try:
            conn = await _asyncpg.connect(database_url)
            backoff = 30  # reset after a healthy connect
            log.info("agent task queue consumer connected to database")

            while not shutdown_event.is_set():
                try:
                    results = await fabric.process_task_queue(conn)
                    if results:
                        log.info(
                            "agent task queue: processed %d task(s)", len(results)
                        )
                except Exception as exc:
                    log.error("agent task queue processing error: %s", exc)

                # Sleep poll_interval seconds (or until shutdown)
                try:
                    await asyncio.wait_for(
                        shutdown_event.wait(), timeout=poll_interval
                    )
                    break  # shutdown_event was set
                except asyncio.TimeoutError:
                    pass  # Normal — poll interval elapsed

            break  # inner loop exited → shutdown requested

        except asyncio.CancelledError:
            log.info("agent task queue consumer cancelled")
            break
        except (_asyncpg.PostgresConnectionError, OSError) as conn_err:
            log.error(
                "agent task queue consumer lost DB connection: %s; reconnecting in %ds",
                conn_err, backoff,
            )
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=backoff)
                break  # shutdown requested during backoff
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 480)
        except Exception as exc:
            log.error("agent task queue consumer fatal: %s", exc)
            break
        finally:
            if conn:
                try:
                    await conn.close()
                except Exception:
                    pass

    log.info("agent task queue consumer stopped")


def handle_signal(sig: signal.Signals) -> None:
    log.info("Received %s, shutting down...", sig.name)
    shutdown_event.set()


async def main() -> None:
    env = os.getenv("RAILWAY_ENVIRONMENT_NAME", "local")
    sha = os.getenv("RAILWAY_GIT_COMMIT_SHA", "dev")[:7]
    # Coordinated cross-service release tag — derived from the deployed build (see
    # deploy-verify.yml); nothing to hand-edit. APP_RELEASE overrides if set.
    release = os.getenv("APP_RELEASE") or sha
    log.info("RFP Pipeline worker starting... (release=%s, env=%s, version=%s)", release, env, sha)

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

    # Instantiate the AgentFabric so all 10 archetypes are registered
    # and ready for invocation by the workflow processor (AI_INVOKE
    # steps) and the agent_task_queue consumer.
    fabric = None
    try:
        from agents import AgentFabric
        fabric = AgentFabric()
        log.info(
            "AgentFabric initialised with %d archetypes",
            len(fabric._archetypes),
        )
    except Exception as exc:
        log.error("AgentFabric initialisation failed (non-fatal): %s", exc)

    # Run the ingester consumer loop, workflow processor, health
    # server, lifecycle scheduler, and agent task queue consumer
    # concurrently. All manage their own resources and respect shutdown_event.
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
            fabric=fabric,
        ),
        run_health_server(
            shutdown_event=shutdown_event,
        ),
        run_lifecycle_scheduler(
            database_url=DATABASE_URL,
            shutdown_event=shutdown_event,
        ),
        run_agent_task_consumer(
            database_url=DATABASE_URL,
            fabric=fabric,
            shutdown_event=shutdown_event,
        ),
        # NOTE: scheduled (cron) triggers are handled by the SHARED cron manager
        # (ingest.dispatcher.tick_schedules, run inside run_consumer_loop above) — one
        # pipeline_schedules table, one processor, Eastern-baselined. Our-org scheduled
        # work (ops digest, solicitation update-scan, content resurface, social scheduling)
        # is seeded there as run_type='event' rows; no bespoke scheduler loop.
    )

    log.info("Pipeline worker stopped.")


if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda s=sig: handle_signal(s))
    loop.run_until_complete(main())
