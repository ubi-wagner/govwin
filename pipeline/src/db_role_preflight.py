"""Refuse to start the worker on a database role that cannot write a tenant workflow.

WHAT THIS CATCHES. `process_instances` has RLS enabled with a tenant-equality INSERT policy:

    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid OR tenant_id IS NULL)

The worker never sets `app.tenant_id` — it is not acting for one tenant, it is the engine. So on a
role that RLS applies to, a PLATFORM-scope instance (tenant_id IS NULL) inserts fine and a
TENANT-scope one is rejected. The worker must therefore run as a role RLS does not apply to: the
table owner, or a BYPASSRLS role (docs/RLS_CUTOVER.md — `rfp_agent` is still deploy-gated).

WHY IT NEEDS A PREFLIGHT rather than a comment. The failure is silent and asymmetric. The worker
starts, connects, logs nothing unusual, and drains platform workflows perfectly — ingest, curation,
the solicitation push all keep working. Only the tenant-scoped half dies, one line per event, deep
in a log nobody is tailing:

    workflow execution failed for event <uuid>:
    new row violates row-level security policy for table "process_instances"

Every build workflow stops starting. A proposal provisions, its portal launches, the buyer sees
their sections — and no workflow ever runs against it. Nothing surfaces that.

It is easy to land in. scripts/sandbox-up.sh starts the worker with
`DATABASE_URL="$DATABASE_URL_OWNER"` precisely because of this, and a restart typed by hand without
that override runs as the app role instead. That is exactly how it happened here: 18 events failed
over the following half hour and the only symptom anyone saw was a build workflow that "didn't
start".

WHAT IT DOES. One query at startup. If the role is safe, log it and continue. If not, log an ERROR
naming the role, the fix, and what will silently break — then keep running, because a worker that
drains platform work is still worth more than no worker, and hard-failing here would take down
ingest to protect builds. The point is that the operator finds out in the first line of the log
instead of in a drive result an hour later.
"""
from __future__ import annotations

import logging

log = logging.getLogger("pipeline.db_role_preflight")

#: Tables the worker writes that are tenant-scoped. Used only to RANK the report — the check itself
#: enumerates the catalog, so a table added later is covered whether or not it appears here.
_WORKER_WRITES = (
    "process_instances",
    "process_instance_transitions",
    "tasks",
    "proposals",
    "proposal_sections",
    "canvas_versions",
    "proposal_comments",
    "tenant_opportunity_cards",
    "tenant_bucket_scores",
    "agent_task_queue",
    "agent_task_results",
    "library_seed_jobs",
    "episodic_memories",
)


async def check_workflow_write_role(conn) -> bool:
    """True when row-level security does not apply to this connection anywhere it writes.

    Never raises: a preflight that crashes the worker is worse than the condition it reports.

    WHY THIS ASKS THE CATALOG INSTEAD OF PROBING ONE TABLE. This used to read exactly one row —
    `process_instances` — and report a verdict about "workflow writes" in general. That is the same
    shape of mistake the thing it guards against: a measurement narrower than the claim made from
    it. `process_instances` is ENABLE-not-FORCE, so for a non-superuser OWNER the old check took the
    `owner_exempt` branch and logged "OK — table owner" — while mig 212 FORCEs seven proposal-spine
    tables, and FORCE applies policies to the owner too. On such a deployment the worker would start
    green and then fail every `INSERT INTO canvas_versions` in publish_section_draft, silently
    killing AI section drafting with a preflight that had just said the role was fine.

    So the question is asked in its general form: list every table row-level security actually
    applies to for THIS role. A table FORCEd by a future migration is then covered on the day it
    lands, with no list here to keep in sync — the failure mode of a hardcoded set is that it is
    correct exactly until someone adds a table and does not think of this file.
    """
    try:
        rows = await conn.fetch(
            """
            SELECT current_user AS role,
                   c.relname    AS table_name,
                   (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user) AS super,
                   (SELECT rolbypassrls  FROM pg_roles WHERE rolname = current_user) AS bypasses
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind = 'r'
               AND c.relrowsecurity
               -- RLS applies to a non-owner whenever it is enabled, and to the owner only when the
               -- table is FORCEd. Superuser and BYPASSRLS are handled outside this predicate
               -- because they are properties of the ROLE, not of any one table.
               AND (pg_get_userbyid(c.relowner) <> current_user OR c.relforcerowsecurity)
             ORDER BY c.relname
            """
        )
    except Exception as exc:  # pragma: no cover — a broken catalog read must not stop the worker
        log.warning("workflow-write preflight could not run: %s", exc)
        return True

    if not rows:
        log.info("workflow-write preflight: OK — row-level security applies to no table for this role")
        return True

    role = rows[0]["role"]
    if rows[0]["super"] or rows[0]["bypasses"]:
        why = "superuser" if rows[0]["super"] else "BYPASSRLS"
        log.info("workflow-write preflight: OK — role=%s (%s)", role, why)
        return True

    exposed = [r["table_name"] for r in rows]
    # Lead with the tables the worker is known to write: those are the ones that will actually fail,
    # and burying them in an alphabetical list of everything is how a real warning gets skimmed.
    writes = [t for t in _WORKER_WRITES if t in exposed]
    others = len(exposed) - len(writes)

    log.error(
        "WORKFLOW WRITES WILL FAIL. Connected as '%s', which row-level security applies to on %d "
        "table(s), and the worker sets no app.tenant_id. Tables the worker writes that are exposed: "
        "%s%s. Platform-scope work (tenant_id IS NULL) will keep running normally; every "
        "TENANT-scoped write will fail with 'new row violates row-level security policy' — so no "
        "build workflow will start, no section draft will publish, and nothing else will say so. "
        "Start the worker with DATABASE_URL pointed at the owner role (DATABASE_URL_OWNER in "
        "scripts/sandbox-env.sh) or grant BYPASSRLS. See docs/RLS_CUTOVER.md.",
        role,
        len(exposed),
        ", ".join(writes) if writes else "(none by name)",
        f" — and {others} more" if others else "",
    )
    return False
