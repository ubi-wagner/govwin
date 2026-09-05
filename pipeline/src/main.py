# Deploy checkpoint 2026-08-05 — full redeploy checkpoint (all 3 services + both DBs). Touches the pipeline service build/deploy. No behavior change.
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
from typing import Callable

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

            # WHY the inner loop leaves has to be distinguishable. The `break` after it means
            # "shutdown requested" and exits the consumer for good; a break for a dead connection
            # must fall through to the OUTER loop's reconnect instead. Without this flag the fix
            # for a lost connection would have shut the consumer down permanently — a worse
            # failure than the one being fixed, and a silent one.
            reconnect = False
            while not shutdown_event.is_set():
                # BREAK OUT TO THE RECONNECT, don't spin on a dead connection.
                #
                # The outer loop already knows how to reconnect — but nothing ever reached it.
                # `process_task_queue` catches its own claim failure and returns [], so the
                # `except` below never fires, and the inner loop polled a closed connection every
                # interval forever, logging "[process_task_queue] claim failed: connection is
                # closed" and processing nothing. Observed for four minutes straight after the
                # database was restarted under a running worker.
                #
                # Checking the connection is what makes this independent of which layer swallows
                # the error, and of which asyncpg class it was.
                if conn is None or conn.is_closed():
                    log.warning("agent task queue: connection is closed — reconnecting")
                    reconnect = True
                    break
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

            if reconnect:
                try:
                    if conn is not None and not conn.is_closed():
                        await conn.close()
                except Exception:
                    pass
                conn = None
                continue  # outer loop reconnects
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

    # Preflight: can this role write a TENANT-scoped workflow instance? On a role RLS applies to it
    # cannot, and the failure is silent — platform workflows keep draining while every build
    # workflow dies one log line at a time. Report it in the first seconds instead.
    try:
        import asyncpg as _pg

        from db_role_preflight import check_workflow_write_role
        _c = await _pg.connect(DATABASE_URL)
        try:
            await check_workflow_write_role(_c)
        finally:
            await _c.close()
    except Exception as exc:
        log.warning("workflow-write preflight skipped: %s", exc)

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

    # Instantiate the AgentFabric so all 36 archetypes are registered
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

    # HTTP POKERS — the pipeline calling a FRONTEND cron endpoint on a timer.
    #
    # Both sweeps below mutate business tables, which the pipeline is not allowed to do (the engine
    # advances workflows; the frontend owns the domain). So the schedule lives here and the WORK
    # lives there, reached over HTTP with the shared CRON_SECRET bearer.
    #
    # Each is gated on its own URL variable and is INERT when unset — it logs once and returns, so a
    # deploy that has not configured it ships dark rather than erroring every interval.
    async def _run_poker(
        name: str, url_var: str, interval: int, report: Callable[[dict], str | None],
    ) -> None:
        import os

        import httpx
        url = os.environ.get(url_var)
        if not url:
            log.info("%s: %s unset — inert", name, url_var)
            return
        secret = os.environ.get("CRON_SECRET", "")
        headers = {"Authorization": f"Bearer {secret}"} if secret else {}
        log.info("%s started (interval=%ds)", name, interval)
        while not shutdown_event.is_set():
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    r = await client.post(url, headers=headers)
                if r.status_code == 200:
                    # Report only when something HAPPENED. A healthy sweep is silent, so a line in
                    # the log means work was done — otherwise an hourly no-op buries everything else.
                    line = report((r.json().get("data") or {}))
                    if line:
                        log.info("%s: %s", name, line)
                else:
                    log.warning("%s poke HTTP %s", name, r.status_code)
            except Exception as exc:  # never let a poker crash the worker
                log.warning("%s poke failed (non-fatal): %s", name, exc)
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=interval)
                break
            except asyncio.TimeoutError:
                pass
        log.info("%s stopped", name)

    # TW-8 AI-manager auto-advance — an AI-manager stage marked autoAdvance clears itself the moment
    # its cohort review lands, so this runs often.
    def _gate_report(d: dict) -> str | None:
        adv = d.get("advanced", 0)
        return f"auto-advanced {adv} portal(s)" if adv else None

    # CARD RECONCILE — heal every active tenant's opportunity mirror to the bridge head.
    #
    # The bridge is forward-only: a push fans a card to each active tenant, and a tenant that MISSES
    # one (created after the push, an apply that failed, a fan-out that raced) stays behind forever
    # unless something catches it up. The customer feed read-repairs on GET /cards — but only for a
    # tenant that VISITS. A tenant who never opens their feed keeps a stale mirror, and everything
    # computed off that mirror is quietly wrong: the weekly discovery digest they receive by email,
    # the admin rollups, the bucket scores.
    #
    # reconcileActiveTenants exists for exactly this and its own docstring calls it "the
    # scheduled/manual sweep" — but only the manual half was ever wired. /api/admin/reconcile-cards
    # was even built with a headless-cron bearer path for a caller that did not exist. This is that
    # caller. Idempotent: each tenant only advances the cards it is behind on.
    #
    # HOURLY, not per-minute like the gate sweep: this is healing for tenants who are not looking,
    # not a latency path for one who is. The feed's own read-repair already covers the active case.
    def _reconcile_report(d: dict) -> str | None:
        applied = d.get("totalApplied", 0)
        if not applied:
            return None
        behind = sum(1 for t in (d.get("perTenant") or []) if t.get("applied"))
        return f"caught up {applied} card(s) across {behind} tenant(s)"

    # SPACE-PRESENCE SWEEP — close abandoned "somebody is in your workspace" brackets.
    #
    # An rfp_admin shadowing a customer, or a partner-manager descended into a client company, opens
    # a bracket in `space_presence` (mig 246). Pressing exit closes it; so does turning up on the
    # platform console, or inside a different company. None of those happen when the tab is simply
    # CLOSED — and that is the case the customer's audit trail suffers most from, because it goes on
    # asserting somebody is in their workspace forever. This is the only closer that does not need
    # the person to still be there.
    #
    # Hourly, like the card reconcile and for the same reason: it is a backstop for the sessions
    # nobody is driving, not a latency path for one somebody is. The route bounds `idleMinutes`
    # itself (default 45), so an eviction can never be so eager that it writes a departure into a
    # customer's trail while the admin is merely reading.
    def _presence_report(d: dict) -> str | None:
        closed = d.get("closed", 0)
        return f"closed {closed} abandoned space presence(s)" if closed else None

    # ABANDONED ToDo CLAIMS. A claim (mig 249) records that somebody started a ToDo; this returns
    # one to the queue when they did not finish. It is the half that makes claiming safe to do at
    # all — and it is NOT optional decoration on the session work, it is the consequence of it: the
    # absolute cap and the descent gate GUARANTEE people are signed out mid-task, which is their
    # whole point. Without this sweep a security improvement becomes a stalled queue, with the queue
    # asserting work is under way that nobody is doing.
    #
    # Half-hourly rather than hourly: the default staleness is 90 minutes, so a claim is released
    # within ~30 minutes of going stale instead of drifting toward two hours.
    def _claims_report(d: dict) -> str | None:
        released = d.get("released", 0)
        return f"returned {released} abandoned ToDo claim(s) to the queue" if released else None

    # Run the ingester consumer loop, workflow processor, health
    # server, lifecycle scheduler, and agent task queue consumer
    # concurrently. All manage their own resources and respect shutdown_event.
    await asyncio.gather(
        _run_poker('agent-gate auto-advance poker', 'AGENT_GATE_SWEEP_URL', 60, _gate_report),
        _run_poker('card reconcile sweep', 'CARD_RECONCILE_URL', 3600, _reconcile_report),
        _run_poker('space presence sweep', 'SPACE_PRESENCE_SWEEP_URL', 3600, _presence_report),
        _run_poker('stale ToDo claim sweep', 'TASK_CLAIM_SWEEP_URL', 1800, _claims_report),
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
