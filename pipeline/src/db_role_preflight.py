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

#: Roles RLS is known not to apply to for this table. The owner is exempt unless the table is FORCEd
#: (it is not — see pg_class.relforcerowsecurity), and a BYPASSRLS role is exempt outright.
_SAFE_REASONS = ("table owner", "BYPASSRLS")


async def check_workflow_write_role(conn) -> bool:
    """True when this connection can insert a TENANT-scoped process_instances row.

    Never raises: a preflight that crashes the worker is worse than the condition it reports.
    """
    try:
        row = await conn.fetchrow(
            """
            SELECT current_user                              AS role,
                   c.relrowsecurity                          AS rls_on,
                   c.relforcerowsecurity                     AS rls_forced,
                   pg_get_userbyid(c.relowner) = current_user AS is_owner,
                   (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses
              FROM pg_class c
             WHERE c.relname = 'process_instances'
            """
        )
    except Exception as exc:  # pragma: no cover — a broken catalog read must not stop the worker
        log.warning("workflow-write preflight could not run: %s", exc)
        return True

    if row is None:
        log.warning("workflow-write preflight: process_instances not found — skipping check")
        return True

    if not row["rls_on"]:
        log.info("workflow-write preflight: RLS off on process_instances (role=%s)", row["role"])
        return True

    # The owner is exempt only while the table is not FORCEd; FORCE applies policies to the owner too.
    owner_exempt = bool(row["is_owner"]) and not bool(row["rls_forced"])
    if owner_exempt or row["bypasses"]:
        why = "table owner" if owner_exempt else "BYPASSRLS"
        log.info("workflow-write preflight: OK — role=%s (%s)", row["role"], why)
        return True

    log.error(
        "WORKFLOW WRITES WILL FAIL. Connected as '%s', which row-level security applies to, and the "
        "worker sets no app.tenant_id. Platform-scope workflows (tenant_id IS NULL) will run "
        "normally; every TENANT-scoped one will fail with 'new row violates row-level security "
        "policy for table \"process_instances\"' — so no build workflow will start, and nothing "
        "else will say so. Start the worker with DATABASE_URL pointed at the owner role "
        "(DATABASE_URL_OWNER in scripts/sandbox-env.sh) or grant BYPASSRLS. See docs/RLS_CUTOVER.md.",
        row["role"],
    )
    return False
