#!/usr/bin/env python3
"""Does an abandoned agent task ever come back? — verify_stale_task_reaper.py

── THE ABSENCE THIS PROVES CLOSED ──────────────────────────────────────────────────────────────
`agent_task_queue` moves a row to 'running' with a worker_id and a picked_at, and NOTHING ever
moved it back. Searching the whole pipeline for a reset, a requeue or a staleness check found
nothing. So a worker that dies mid-task leaves the row 'running' forever: no error, no retry, and
that piece of work simply never finishes.

Not hypothetical. Restarting Postgres under a running worker wedged all three consumer loops for
four minutes (commit fcc646ee) — that fix made the WORKER recover, but a row it had already claimed
and abandoned stayed exactly where it was.

── WHY `failed` AND NOT `pending` ──────────────────────────────────────────────────────────────
An agent invocation costs money and may have had side effects before the worker died. Silently
re-queueing would bill twice and could land two drafts. `failed` with a stated reason is honest and
leaves re-running to a person — and it keeps the spend ledger and the runaway bounds truthful,
which a row stuck in 'running' quietly corrupts.

── WHAT IT ASSERTS, AND THE PAIRING THAT MATTERS ───────────────────────────────────────────────
  1 a task abandoned past the ceiling is reaped, with a reason naming the dead worker
  2 a task abandoned INSIDE the ceiling is LEFT ALONE
  3 a 'pending' task is untouched — the reaper must not eat the queue it protects
  4 the reap is AUDITED — one `tool:agent.task_abandoned` per row, not a log line

(2) is what stops this being a guard that eats live work: without it, a reaper with the comparison
inverted — or a ceiling of zero — would pass (1) and (3) while killing every task in flight. A guard
that refuses everything passes a refusal-only test.

    source scripts/sandbox-env.sh
    cd pipeline && python3 tests/verify_stale_task_reaper.py

Exit 0 proven · 1 a check failed · 2 could not run.  ⚠ Creates and removes its own rows.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

BAD = 0


def ok(msg: str, detail: str = "") -> None:
    print(f"  ✓ {msg}" + (f" — {detail}" if detail else ""))


def no(msg: str, detail: str = "") -> None:
    global BAD
    BAD += 1
    print(f"  ✗ {msg}" + (f" — {detail}" if detail else ""))


def cannot(why: str) -> None:
    print("CANNOT RUN")
    print(f"  {why}")
    sys.exit(2)


async def main() -> None:
    try:
        import asyncpg
    except ImportError:
        cannot("asyncpg is not importable — run with python3 -m, not the uv `pytest` on PATH")

    dsn = os.environ.get("DATABASE_URL_OWNER") or os.environ.get("DATABASE_URL")
    if not dsn:
        cannot("DATABASE_URL_OWNER is unset — source scripts/sandbox-env.sh")

    try:
        from agents.fabric import STALE_TASK_MINUTES
    except Exception as exc:  # noqa: BLE001
        cannot(f"could not import STALE_TASK_MINUTES from agents.fabric: {exc}")

    conn = await asyncpg.connect(dsn)
    made: list[uuid.UUID] = []

    # A tenant to hang the rows on — agent_task_queue.tenant_id is a real FK.
    tenant = await conn.fetchval(
        "SELECT id FROM tenants WHERE archived_at IS NULL ORDER BY created_at LIMIT 1"
    )
    if tenant is None:
        await conn.close()
        cannot("no tenant fixture")

    async def make(status: str, picked_minutes_ago: int | None) -> uuid.UUID:
        picked = (
            None
            if picked_minutes_ago is None
            else f"now() - make_interval(mins => {int(picked_minutes_ago)})"
        )
        row = await conn.fetchrow(
            f"""
            INSERT INTO agent_task_queue
                (tenant_id, agent_role, task_type, input, status, worker_id, picked_at)
            VALUES ($1, 'section_drafter', 'reaper_fixture', '{{}}'::jsonb, $2,
                    'fabric-deadbeef', {picked or 'NULL'})
            RETURNING id
            """,
            tenant,
            status,
        )
        made.append(row["id"])
        return row["id"]

    try:
        print(f"── stale agent-task reaper · ceiling = {STALE_TASK_MINUTES}m\n")

        stale_id = await make("running", STALE_TASK_MINUTES + 10)
        fresh_id = await make("running", max(1, STALE_TASK_MINUTES // 3))
        pending_id = await make("pending", None)

        # Drive the REAL consumer, not a copy of its SQL. A test that re-typed the reap query would
        # pass against a fabric that never calls it — the exact shape of a check that measures
        # itself. `process_task_queue` reaps first, then claims.
        from agents.fabric import AgentFabric

        fabric = AgentFabric()
        await fabric.process_task_queue(conn)

        after = {
            r["id"]: (r["status"], r["error"])
            for r in await conn.fetch(
                "SELECT id, status, error FROM agent_task_queue WHERE id = ANY($1::uuid[])",
                made,
            )
        }

        print("══ 1 · an abandoned task is reaped")
        st, err = after.get(stale_id, ("?", None))
        if st == "failed":
            ok("a task past the ceiling is marked failed", f"{STALE_TASK_MINUTES + 10}m old")
        else:
            no("the abandoned task is STILL running", f"status={st}")
            print("    This is the pre-fix behaviour: nothing ever moved a 'running' row back,")
            print("    so a worker that died mid-task left it there forever.")
        if err and "abandoned" in err and "fabric-deadbeef" in err:
            ok("and the reason names the dead worker", err[:72])
        else:
            no("the failure carries no usable reason", str(err)[:60])

        print("\n══ 2 · a task still INSIDE the ceiling is left alone")
        st2, _ = after.get(fresh_id, ("?", None))
        if st2 == "running":
            ok("a recently-picked task is untouched", "the reaper does not eat live work")
        else:
            no("a LIVE task was reaped", f"status={st2}")
            print("    A guard that refuses everything passes a refusal-only test. This is the")
            print("    pairing that separates a working reaper from one that kills the queue.")

        print("\n══ 3 · the reap is audited, not just logged")
        # A log line is not an audit trail: it never reaches system_events, so neither
        # /admin/events nor a customer's own history ever learns their agent work was abandoned.
        # The first version of this reaper only called logger.warning, and the only trace was a
        # Railway log nobody tails — the same invisibility the reaper exists to remove.
        ev = await conn.fetchval(
            """
            SELECT count(*) FROM system_events
             WHERE namespace = 'tool' AND type = 'agent.task_abandoned'
               AND payload->>'taskId' = $1
            """,
            str(stale_id),
        )
        if ev and int(ev) > 0:
            ok("`tool:agent.task_abandoned` was emitted for the reaped task")
        else:
            no("the reap is SILENT — nothing in system_events", "a log line is not an audit trail")

        print("\n══ 4 · a pending task is untouched")
        st3, _ = after.get(pending_id, ("?", None))
        # `pending` is claimable, so process_task_queue may legitimately have picked it up and run
        # it. What must NOT happen is that the reaper failed it.
        if st3 != "failed":
            ok("the reaper did not touch the pending queue", f"status={st3}")
        else:
            no("a pending task was failed by the reaper", "it must only ever act on 'running'")
    finally:
        if made:
            # Children FIRST. The `pending` fixture is genuinely claimable, so the consumer may
            # have run it and written an `agent_task_results` row — and that FK blocks the delete,
            # which surfaced as a ForeignKeyViolation in the teardown and buried the actual
            # findings under a stack trace.
            await conn.execute(
                "DELETE FROM agent_task_results WHERE task_id = ANY($1::uuid[])", made
            )
            await conn.execute(
                "DELETE FROM system_events WHERE payload->>'taskId' = ANY($1::text[])",
                [str(x) for x in made],
            )
            await conn.execute(
                "DELETE FROM agent_task_queue WHERE id = ANY($1::uuid[])", made
            )
            print(f"\n  MUTATED, then removed: {len(made)} queue row(s)")
        await conn.close()

    print()
    if BAD == 0:
        print("✓ an abandoned agent task is reaped; a live one is not.")
    else:
        print(f"✗ {BAD} check(s) failed.")
    sys.exit(0 if BAD == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
