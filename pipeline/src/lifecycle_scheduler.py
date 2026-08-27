"""
================================================================================
Lifecycle Scheduler — Runs Memory Maintenance on Documented Schedules
================================================================================

WHO:    Started as a concurrent asyncio task alongside the ingester consumer
        and workflow processor in main.py.

WHAT:   Runs memory lifecycle and learning modules on their documented schedules:
        - Daily (3 AM UTC): MemoryDecay, PreferenceExtractor
        - Weekly (Monday 4 AM UTC): MemoryGC, PatternPromoter, DiscoveryDigest
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
        - DiscoveryDigest: emits the "your new matches" digest (spotlight_new_topics)
          for tenants with fresh opportunity cards → CMS sends the opt-in email

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
import time
from datetime import date, datetime, timezone

import asyncpg

from events import emit_event

logger = logging.getLogger("pipeline.lifecycle")


def _seconds_until_next_hour() -> float:
    """Return seconds until the start of the next UTC hour."""
    now = datetime.now(timezone.utc)
    # seconds remaining in this hour
    remaining = 3600 - (now.minute * 60 + now.second + now.microsecond / 1e6)
    return max(remaining, 1.0)


async def run_lifecycle_scheduler(
    database_url: str,
    shutdown_event: asyncio.Event,
) -> None:
    """Main lifecycle scheduler loop. Runs hourly, checks what's due.

    Tracks last run dates to prevent duplicate execution when the loop
    fires multiple times in the same hour (timing drift prevention).
    Reconnects automatically if the DB connection drops.
    """

    logger.info("lifecycle scheduler started")
    conn: asyncpg.Connection | None = None

    # Track last execution dates to prevent duplicates (P2-#17, P1-#3)
    last_daily_run: date | None = None
    last_weekly_run: date | None = None
    last_monthly_run: date | None = None

    # Outer supervise loop: connect, then run the scheduling loop. On a dropped
    # connection, back off and let this outer loop RECONNECT and RESUME
    # scheduling. Iterative (never recursive), so repeated outages cannot
    # overflow the stack (PIPE-01). last_*_run live outside the loop, so the
    # de-dup state survives reconnects.
    backoff = 30
    while not shutdown_event.is_set():
        conn = None
        try:
            conn = await asyncpg.connect(database_url)
            backoff = 30  # reset after a healthy connect
            logger.info("lifecycle scheduler connected to database")

            while not shutdown_event.is_set():
                now = datetime.now(timezone.utc)
                today = now.date()
                hour = now.hour
                weekday = now.weekday()  # 0 = Monday
                day_of_month = now.day

                # Daily jobs (3 AM UTC) — once per calendar day
                if hour >= 3 and last_daily_run != today:
                    await _run_daily_jobs(conn)
                    last_daily_run = today

                # Weekly jobs (Monday 4 AM UTC) — once per calendar week
                if hour >= 4 and weekday == 0 and last_weekly_run != today:
                    await _run_weekly_jobs(conn)
                    last_weekly_run = today

                # Monthly jobs (1st Monday 5 AM UTC) — once per month
                if hour >= 5 and weekday == 0 and day_of_month <= 7 and last_monthly_run != today:
                    await _run_monthly_jobs(conn)
                    last_monthly_run = today

                # Sleep until next hour boundary to prevent timing drift
                sleep_seconds = _seconds_until_next_hour()
                try:
                    await asyncio.wait_for(
                        shutdown_event.wait(),
                        timeout=sleep_seconds,
                    )
                    break  # shutdown_event was set
                except asyncio.TimeoutError:
                    pass  # Normal — hour boundary reached, loop again

            break  # inner loop exited → shutdown requested

        except asyncio.CancelledError:
            logger.info("lifecycle scheduler cancelled")
            break
        except (asyncpg.PostgresConnectionError, OSError) as conn_err:
            # Connection dropped. Back off (bounded), then the OUTER loop
            # reconnects and resumes scheduling — no recursion, retries until
            # the DB returns or shutdown is requested.
            logger.error(
                "lifecycle scheduler connection lost: %s; reconnecting in %ds",
                conn_err, backoff,
            )
            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=backoff)
                break  # shutdown requested during backoff
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, 480)
        except Exception as e:
            logger.error("lifecycle scheduler fatal: %s", e)
            break
        finally:
            if conn:
                try:
                    await conn.close()
                except Exception:
                    pass

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

    # 3. Spotlight bucket rescore — refresh scores daily so the timeline signal (close-date decay)
    #    doesn't go stale between card arrivals / bucket edits (docs/BUCKET_LOCKDOWN.md T3). Emit one
    #    capture:buckets.updated per tenant that has active buckets; OnBucketsUpdated does the rescore.
    # Bracket the batch start/end (the per-tenant capture:buckets.updated each triggers an
    # OnBucketsUpdated WORKFLOW instance — itself a managed process; this brackets the emitter sweep).
    dr_start = ""
    try:
        dr_start = await emit_event(
            conn, namespace="finder", type="daily_rescore.completed", phase="start",
            actor_type="system", actor_id="lifecycle_scheduler", payload={},
        )
    except Exception as exc:
        logger.error("daily rescore: start emit failed: %s", exc)
    dr_tenants = 0
    try:
        rows = await conn.fetch(
            "SELECT DISTINCT tenant_id::text AS tid FROM tenant_spotlight_buckets WHERE is_active"
        )
        for r in rows:
            tid = r["tid"]
            try:
                await emit_event(
                    conn,
                    namespace="capture",
                    type="buckets.updated",
                    phase="single",
                    actor_type="system",
                    actor_id="lifecycle_scheduler",
                    tenant_id=tid,
                    parent_event_id=dr_start or None,
                    payload={"tenantId": tid, "action": "daily_rescore"},
                )
                dr_tenants += 1
            except Exception as te:
                logger.error("daily bucket rescore emit failed for tenant %s: %s", tid, te)
        logger.info("daily bucket rescore: emitted for %d tenants", dr_tenants)
    except Exception as e:
        logger.error("daily bucket rescore setup failed: %s", e)
    finally:
        try:
            await emit_event(
                conn, namespace="finder", type="daily_rescore.completed", phase="end",
                parent_event_id=dr_start or None, actor_type="system", actor_id="lifecycle_scheduler",
                payload={"tenantsRescored": dr_tenants},
            )
        except Exception as exc:
            logger.error("daily rescore: end emit failed: %s", exc)

    # 4. Pre-purchase START nudges (RANK-9) — nudge a customer to start a proposal on a hot,
    #    unpursued, soon-closing card. In-app + email, hard-bounded per card.
    try:
        await _run_start_nudges(conn)
    except Exception as e:
        logger.error("start nudges setup failed: %s", e)

    # 5. Project milestone + task nudges — the only automation in the Projects capability. A dated
    #    checklist that never tells anyone it is due is a spreadsheet with extra steps.
    try:
        await _run_project_nudges(conn)
    except Exception as e:
        logger.error("project nudges setup failed: %s", e)

    logger.info("=== Daily lifecycle jobs complete ===")


async def _run_start_nudges(conn: asyncpg.Connection) -> None:
    """Pre-purchase START nudge (RANK-9).

    A HOT (best bucket score >= threshold), UNPURSUED, SOON-CLOSING mirror card nudges the customer to
    start a proposal — in-app (capture:opportunity.start_recommended, per card → the notification bell +
    Command Center) AND email (one grouped system:notification.requested, template `start_nudge`, gated
    per tenant by their notify_on_new_priority_opp preference — the same delivery path as the digest).

    Hard-bounded so it can never spam: at most `max_nudges_per_gate` (mig 126, default 3) per card
    (mig 181 start_nudges_sent watermark) and re-nudged at most once every few days (start_nudged_at).
    Skips cards already purchased (a proposal_portals row exists). Best-effort — never raises into the loop.
    The scheduler connects as the owner, so these cross-tenant reads/writes need no per-tenant RLS context.
    """
    THRESHOLD = 50   # matches the digest's NOTIFICATION_THRESHOLD — a "priority" match
    WINDOW_DAYS = 21  # only nudge when there's still time to actually start + submit
    SPACING_DAYS = 3  # never re-nudge the same card more often than this
    try:
        max_nudges = await conn.fetchval("SELECT max_nudges_per_gate FROM automation_framework WHERE id = 1")
        max_nudges = int(max_nudges) if max_nudges else 3
    except Exception:
        max_nudges = 3

    # The sweep is an automation PROCESS → bracket it start/end (parent-linked) with the outcome counts,
    # exactly like score_tenants.py's scoring.completed. The `finally` guarantees the :end even on an
    # early return / exception, so there is never an orphan start (event-contract invariant).
    start_ms = time.monotonic()
    start_id = ""
    try:
        start_id = await emit_event(
            conn, namespace="finder", type="nudge_sweep.completed", phase="start",
            actor_type="system", actor_id="lifecycle_scheduler", payload={},
        )
    except Exception as exc:
        logger.error("start nudge sweep: start emit failed: %s", exc)

    nudged = 0
    tenant_ids: list[str] = []
    try:
        rows = await conn.fetch(
            """
            SELECT c.tenant_id::text AS tenant_id, c.opportunity_id::text AS opportunity_id,
                   c.card->>'title' AS title, bs.top_score::int AS top_score,
                   GREATEST(0, EXTRACT(DAY FROM (o.close_date - now()))::int) AS days_to_close
            FROM tenant_opportunity_cards c
            JOIN opportunities o ON o.id = c.opportunity_id
            LEFT JOIN LATERAL (
              SELECT max(s.score) AS top_score FROM tenant_bucket_scores s
              WHERE s.tenant_id = c.tenant_id AND s.opportunity_id = c.opportunity_id
            ) bs ON true
            WHERE c.lifecycle_status = 'open'
              AND c.archived_at IS NULL
              AND c.is_pinned = false
              AND c.pursuit_status NOT IN ('pursuing', 'passed')
              AND o.close_date IS NOT NULL
              AND o.close_date > now()
              AND o.close_date <= now() + make_interval(days => $1)
              AND bs.top_score >= $2
              AND c.start_nudges_sent < $3
              AND (c.start_nudged_at IS NULL OR c.start_nudged_at < now() - make_interval(days => $4))
              AND NOT EXISTS (
                SELECT 1 FROM proposal_portals pp
                WHERE pp.tenant_id = c.tenant_id AND pp.opportunity_id = c.opportunity_id
              )
            ORDER BY bs.top_score DESC
            LIMIT 500
            """,
            WINDOW_DAYS, THRESHOLD, max_nudges, SPACING_DAYS,
        )
        if rows:
            from collections import defaultdict
            per_tenant: dict[str, list] = defaultdict(list)
            for r in rows:
                tid, opp = r["tenant_id"], r["opportunity_id"]
                try:
                    await emit_event(
                        conn, namespace="capture", type="opportunity.start_recommended", phase="single",
                        actor_type="system", actor_id="lifecycle_scheduler", tenant_id=tid,
                        parent_event_id=start_id or None,
                        payload={"tenantId": tid, "opportunityId": opp, "title": r["title"],
                                 "topScore": r["top_score"], "daysToClose": r["days_to_close"]},
                    )
                    await conn.execute(
                        "UPDATE tenant_opportunity_cards SET start_nudges_sent = start_nudges_sent + 1, "
                        "start_nudged_at = now() WHERE tenant_id = $1 AND opportunity_id = $2", tid, opp,
                    )
                    per_tenant[tid].append({"title": r["title"], "daysToClose": r["days_to_close"], "score": r["top_score"]})
                    nudged += 1
                except Exception as ce:
                    logger.error("start nudge emit/update failed for %s/%s: %s", tid, opp, ce)
            tenant_ids = list(per_tenant.keys())
            if tenant_ids:
                try:
                    await emit_event(
                        conn, namespace="system", type="notification.requested", phase="single",
                        actor_type="system", actor_id="lifecycle_scheduler", tenant_id=None,
                        parent_event_id=start_id or None,
                        payload={"channel": "email", "template": "start_nudge", "tenant_ids": tenant_ids,
                                 "tenant_pref": "notify_on_new_priority_opp",
                                 "digest": {tid: per_tenant[tid] for tid in tenant_ids}},
                    )
                except Exception as ee:
                    logger.error("start nudge email emit failed: %s", ee)
            logger.info("start nudges: nudged %d card(s) across %d tenant(s)", nudged, len(tenant_ids))
        else:
            logger.info("start nudges: nothing hot + closing-soon + unpursued")
    except Exception as e:
        logger.error("start nudges failed: %s", e)
    finally:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="finder", type="nudge_sweep.completed", phase="end",
                parent_event_id=start_id or None, actor_type="system", actor_id="lifecycle_scheduler",
                payload={"cardsNudged": nudged, "tenantsNotified": len(tenant_ids), "durationMs": duration_ms},
            )
        except Exception as exc:
            logger.error("start nudge sweep: end emit failed: %s", exc)


async def _run_project_nudges(conn: asyncpg.Connection) -> None:
    """Project milestones and tasks approaching — or past — their date.

    THE AUTOMATION THAT MAKES A MILESTONE MORE THAN A ROW. A dated segment of work with a checklist
    is only project management if something tells the owner it is coming due and keeps telling them
    when it is late. Everything else in the Projects capability is HITL; this is the one part that
    runs on its own.

    Two populations, one sweep:

      MILESTONES  status='pending' with a forecast_date inside the window, or already past it
                  → project:milestone.due_soon / project:milestone.overdue
      TASKS       status='open' with a due_date inside the window, or past it
                  → project:task.due_soon / project:task.overdue

    HARD-BOUNDED, for the same reason the start nudge is (RANK-9). At most `max_nudges_per_gate`
    per row (mig 218 `nudges_sent`) and never more often than SPACING_DAYS (`last_nudged_at`). A
    nudge that can repeat without limit is a nudge people filter, and a filtered nudge is worse than
    none because the sender believes it landed.

    One grouped `system:notification.requested` per sweep carries the email, gated by the tenant's
    own preference — the same delivery path as the digest and the start nudge, so there is one mail
    seam and not three.

    Best-effort: it never raises into the scheduler loop. The scheduler connects as the owner, so
    these cross-tenant reads and writes need no per-tenant RLS context.
    """
    WINDOW_DAYS = 7   # "due soon" means this week — a month's warning is noise
    SPACING_DAYS = 3  # never re-nudge the same row more often than this
    try:
        max_nudges = await conn.fetchval("SELECT max_nudges_per_gate FROM automation_framework WHERE id = 1")
        max_nudges = int(max_nudges) if max_nudges else 3
    except Exception:
        max_nudges = 3

    start_ms = time.monotonic()
    start_id = ""
    try:
        start_id = await emit_event(
            conn, namespace="project", type="nudge_sweep.completed", phase="start",
            actor_type="system", actor_id="lifecycle_scheduler", payload={},
        )
    except Exception as exc:
        logger.error("project nudge sweep: start emit failed: %s", exc)

    nudged = 0
    per_tenant: dict[str, list] = {}
    try:
        # ── milestones ────────────────────────────────────────────────────────────────────────
        # `forecast_date` is the CURRENT plan, not the baseline: a nudge is about what we now
        # expect, and nudging against a frozen promise would shout about every rebaselined date.
        milestones = await conn.fetch(
            """
            SELECT m.id::text AS id, m.tenant_id::text AS tenant_id, m.project_id::text AS project_id,
                   m.title, m.forecast_date,
                   (m.forecast_date - CURRENT_DATE)::int AS days_out,
                   p.name AS project_name
              FROM project_milestones m
              JOIN projects p ON p.id = m.project_id
             WHERE m.status = 'pending'
               AND m.forecast_date IS NOT NULL
               AND m.forecast_date <= CURRENT_DATE + $1::int
               AND m.nudges_sent < $2::int
               AND (m.last_nudged_at IS NULL OR m.last_nudged_at < now() - ($3::int || ' days')::interval)
               -- `projects` has no archived_at (mig 216 predates the archive contract for this
               -- table); a project that is finished carries status='closed'. Nudging a closed
               -- project is the fastest way to teach someone to filter this sender.
               AND p.status <> 'closed'
             ORDER BY m.forecast_date
             LIMIT 500
            """,
            WINDOW_DAYS, max_nudges, SPACING_DAYS,
        )
        for r in milestones:
            overdue = r["days_out"] < 0
            try:
                await emit_event(
                    conn, namespace="project",
                    type="milestone.overdue" if overdue else "milestone.due_soon",
                    phase="single", actor_type="system", actor_id="lifecycle_scheduler",
                    tenant_id=r["tenant_id"], parent_event_id=start_id or None,
                    payload={
                        "projectId": r["project_id"], "milestoneId": r["id"], "title": r["title"],
                        "project": r["project_name"],
                        "dueOn": r["forecast_date"].isoformat() if r["forecast_date"] else None,
                        **({"daysLate": -r["days_out"]} if overdue else {"daysOut": r["days_out"]}),
                    },
                )
                await conn.execute(
                    "UPDATE project_milestones SET nudges_sent = nudges_sent + 1, last_nudged_at = now() "
                    "WHERE id = $1::uuid", r["id"],
                )
                per_tenant.setdefault(r["tenant_id"], []).append({
                    "kind": "milestone", "title": r["title"], "project": r["project_name"],
                    "dueOn": r["forecast_date"].isoformat() if r["forecast_date"] else None,
                    "overdue": overdue,
                })
                nudged += 1
            except Exception as ce:
                logger.error("milestone nudge failed for %s: %s", r["id"], ce)

        # ── tasks ─────────────────────────────────────────────────────────────────────────────
        # A blocked task is NOT nudged. Somebody already said why it cannot move, and telling them
        # again weekly is how a nudge stream becomes noise nobody reads.
        tasks = await conn.fetch(
            """
            SELECT t.id::text AS id, t.tenant_id::text AS tenant_id, t.project_id::text AS project_id,
                   t.milestone_id::text AS milestone_id, t.title, t.due_date,
                   (t.due_date - CURRENT_DATE)::int AS days_out,
                   t.assignee_user_id::text AS assignee_user_id, p.name AS project_name
              FROM project_milestone_tasks t
              JOIN projects p ON p.id = t.project_id
             WHERE t.status = 'open'
               -- ASSIGNED work is nudged by the PLATFORM ToDo it was projected onto
               -- (`lib/projects/todos.ts` → `tasks.nudge_schedule`), the same sweeper that chases
               -- every other kind of work in the product. Nudging it here as well would send two
               -- reminders for one task, which teaches people to filter both. What is left here is
               -- work nobody has taken: it has no queue to sit in, so the date is all there is.
               AND t.assignee_user_id IS NULL AND t.assignee_role IS NULL
               AND t.due_date IS NOT NULL
               AND t.due_date <= CURRENT_DATE + $1::int
               AND t.nudges_sent < $2::int
               AND (t.last_nudged_at IS NULL OR t.last_nudged_at < now() - ($3::int || ' days')::interval)
               -- `projects` has no archived_at (mig 216 predates the archive contract for this
               -- table); a project that is finished carries status='closed'. Nudging a closed
               -- project is the fastest way to teach someone to filter this sender.
               AND p.status <> 'closed'
             ORDER BY t.due_date
             LIMIT 500
            """,
            WINDOW_DAYS, max_nudges, SPACING_DAYS,
        )
        for r in tasks:
            overdue = r["days_out"] < 0
            try:
                await emit_event(
                    conn, namespace="project",
                    type="task.overdue" if overdue else "task.due_soon",
                    phase="single", actor_type="system", actor_id="lifecycle_scheduler",
                    tenant_id=r["tenant_id"], parent_event_id=start_id or None,
                    payload={
                        "projectId": r["project_id"], "milestoneId": r["milestone_id"],
                        "taskId": r["id"], "title": r["title"], "project": r["project_name"],
                        "assigneeUserId": r["assignee_user_id"],
                        "dueOn": r["due_date"].isoformat() if r["due_date"] else None,
                        **({"daysLate": -r["days_out"]} if overdue else {"daysOut": r["days_out"]}),
                    },
                )
                await conn.execute(
                    "UPDATE project_milestone_tasks SET nudges_sent = nudges_sent + 1, "
                    "last_nudged_at = now() WHERE id = $1::uuid", r["id"],
                )
                per_tenant.setdefault(r["tenant_id"], []).append({
                    "kind": "task", "title": r["title"], "project": r["project_name"],
                    "dueOn": r["due_date"].isoformat() if r["due_date"] else None,
                    "overdue": overdue,
                })
                nudged += 1
            except Exception as ce:
                logger.error("task nudge failed for %s: %s", r["id"], ce)

        if per_tenant:
            try:
                await emit_event(
                    conn, namespace="system", type="notification.requested", phase="single",
                    actor_type="system", actor_id="lifecycle_scheduler", tenant_id=None,
                    parent_event_id=start_id or None,
                    payload={"channel": "email", "template": "project_nudge",
                             "tenant_ids": list(per_tenant.keys()),
                             "tenant_pref": "notify_on_new_priority_opp",
                             "digest": per_tenant},
                )
            except Exception as ee:
                logger.error("project nudge email emit failed: %s", ee)
        logger.info("project nudges: %d row(s) across %d tenant(s)", nudged, len(per_tenant))
    except Exception as e:
        logger.error("project nudges failed: %s", e)
    finally:
        duration_ms = int((time.monotonic() - start_ms) * 1000)
        try:
            await emit_event(
                conn, namespace="project", type="nudge_sweep.completed", phase="end",
                parent_event_id=start_id or None, actor_type="system", actor_id="lifecycle_scheduler",
                payload={"rowsNudged": nudged, "tenantsNotified": len(per_tenant),
                         "durationMs": duration_ms},
            )
        except Exception as exc:
            logger.error("project nudge sweep: end emit failed: %s", exc)


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

    # 3. Discovery digest — the weekly "your new matches" re-engagement email (per-tenant, opt-in).
    await _run_discovery_digest(conn)

    logger.info("=== Weekly lifecycle jobs complete ===")


async def _run_discovery_digest(conn: asyncpg.Connection) -> None:
    """Weekly "your new matches" digest.

    Emits ONE ``system:notification.requested`` event carrying the tenants that gained NEW,
    unpinned, non-dismissed opportunity cards this week (ranked by their spotlight-bucket score).
    The CMS event listener fans it out per tenant as the ``spotlight_new_topics`` email, gated by
    each tenant's ``notify_on_new_priority_opp`` preference — the exact same delivery path the
    admin solicitation-push uses, now on a recurring cadence (the missing re-engagement pull).

    Best-effort: never raises into the scheduler loop; a no-op when nothing is new (no email).
    """
    try:
        rows = await conn.fetch(
            """
            SELECT c.tenant_id::text AS tenant_id,
                   count(*)::int AS n,
                   (array_agg(c.card->>'title' ORDER BY bs.top_score DESC NULLS LAST))[1:3] AS titles
            FROM tenant_opportunity_cards c
            LEFT JOIN LATERAL (
              SELECT max(s.score) AS top_score FROM tenant_bucket_scores s
              WHERE s.tenant_id = c.tenant_id AND s.opportunity_id = c.opportunity_id
            ) bs ON true
            WHERE c.created_at >= now() - interval '7 days'
              AND c.lifecycle_status = 'open'
              AND c.is_pinned = false
              AND c.pursuit_status <> 'passed'
              AND c.archived_at IS NULL
            GROUP BY c.tenant_id
            HAVING count(*) > 0
            """
        )
        if not rows:
            logger.info("discovery digest: no new matches this week")
            return
        tenant_ids = [r["tenant_id"] for r in rows]
        digest = {
            r["tenant_id"]: {"count": r["n"], "titles": [t for t in (r["titles"] or []) if t]}
            for r in rows
        }
        await emit_event(
            conn,
            namespace="system",
            type="notification.requested",
            phase="single",
            actor_type="system",
            actor_id="lifecycle_scheduler",
            tenant_id=None,  # multi-tenant digest → recipients live in payload.tenant_ids
            payload={
                "channel": "email",
                "template": "spotlight_new_topics",
                "tenant_ids": tenant_ids,
                "tenant_pref": "notify_on_new_priority_opp",
                "window_days": 7,
                "digest": digest,
            },
        )
        logger.info("discovery digest: emitted for %d tenant(s)", len(tenant_ids))
    except Exception as e:
        logger.error("discovery digest failed: %s", e)


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
