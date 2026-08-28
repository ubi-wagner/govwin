"""Do the spend guardrails actually ENGAGE? — red-first, against the emulator.

── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
The caps were built and had never fired. 287 invocations, guardrail verdict `apply` every
time, zero refusals ever recorded. The LOGIC ran on every call; the REFUSAL had never been
observed. A brake you have never felt engage is a brake you are trusting on faith, and here the
failure mode is a bill.

So every case below proves BOTH directions: the cap engages when it should, and — just as
important — does not engage when it should not. A guard that always refuses is as broken as one
that never does, and only the pair distinguishes them.

── THE RESTORE IS THE DANGEROUS PART, NOT THE TEST ──────────────────────────────────────────
This mutates live spend configuration. The first version of it saved the tenant row and then
crashed restoring `agent_monthly_budget_ceiling_usd` to NULL — a NOT NULL column — leaving a
tenant on a budget of $9999 and the framework ceiling at $0.39. The values it had overwritten
were never recoverable, because the save happened for one table and not the other.

Two rules fall out, and both are structural rather than careful:
  1. Snapshot EVERY table this touches, before touching any of them.
  2. Restore in a `finally`, so a failed assertion cannot skip it — and restore to the SAVED
     value, never to a guessed default.

    cd pipeline && DATABASE_URL_OWNER=... PYTHONPATH=src python3 tests/verify_spend_guardrails.py
Exit 0 when every guard engages and releases correctly; 1 on a finding; 2 on a harness defect.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
import asyncpg  # noqa: E402
from agents.fabric import AgentFabric  # noqa: E402

DB = os.environ.get('DATABASE_URL_OWNER') or os.environ.get('DATABASE_URL')
if not DB:
    print('HARNESS DEFECT: DATABASE_URL_OWNER required — this reads and WRITES spend config.')
    sys.exit(2)

ok = 0
fail = 0


def check(cond, label, extra=''):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ✓ {label}" + (f" — {extra}" if extra else ''))
    else:
        fail += 1
        print(f"  ✗ {label}" + (f" — {extra}" if extra else ''))


async def main():
    conn = await asyncpg.connect(DB)
    fab = AgentFabric()

    tid = await conn.fetchval("SELECT id FROM tenants WHERE slug='foundation'")
    if tid is None:
        print('HARNESS DEFECT: no `foundation` tenant to measure against.')
        sys.exit(2)

    # ── SNAPSHOT EVERYTHING FIRST ────────────────────────────────────────────────────────
    saved_tenant = await conn.fetchrow(
        "SELECT monthly_budget, rate_limit_per_hour FROM tenant_agent_config WHERE tenant_id=$1", tid)
    saved_plat = await conn.fetchrow(
        "SELECT ai_enabled, platform_monthly_cap FROM platform_agent_config LIMIT 1")
    saved_ceiling = await conn.fetchval(
        "SELECT agent_monthly_budget_ceiling_usd FROM automation_framework WHERE id=1")

    spend = float(await conn.fetchval(
        "SELECT COALESCE(SUM(cost_usd),0) FROM agent_task_log WHERE tenant_id=$1 "
        "AND created_at >= date_trunc('month', now())", tid))
    plat_spend = float(await conn.fetchval(
        "SELECT COALESCE(SUM(cost_usd),0) FROM agent_task_log "
        "WHERE created_at >= date_trunc('month', now())"))
    recent = await conn.fetchval(
        "SELECT count(*) FROM agent_task_log WHERE tenant_id=$1 "
        "AND created_at > now() - interval '1 hour'", tid)
    print(f"\nbaseline · foundation ${spend:.4f} this month, {recent} call(s) this hour "
          f"· platform ${plat_spend:.4f}")

    async def set_tenant(budget, rate):
        await conn.execute(
            """INSERT INTO tenant_agent_config (tenant_id, monthly_budget, rate_limit_per_hour)
               VALUES ($1,$2,$3)
               ON CONFLICT (tenant_id) DO UPDATE
                 SET monthly_budget = EXCLUDED.monthly_budget,
                     rate_limit_per_hour = EXCLUDED.rate_limit_per_hour""",
            tid, budget, rate)

    roomy = round(spend + 100, 2)

    try:
        print("\n── 1 · the tenant's monthly budget ──")
        await set_tenant(round(spend - 0.01, 4), None)
        check(await fab._check_budget(conn, str(tid)) is False,
              "REFUSES once the month's spend passes the tenant budget",
              f"spent ${spend:.4f} of ${spend - 0.01:.4f}")
        await set_tenant(roomy, None)
        check(await fab._check_budget(conn, str(tid)) is True,
              "ALLOWS with headroom — the guard is not simply always-on", f"budget ${roomy:.2f}")

        print("\n── 2 · a zero budget disables AI for that tenant ──")
        await set_tenant(0, None)
        check(await fab._check_budget(conn, str(tid)) is False,
              "REFUSES on an explicit monthly_budget = 0")

        print("\n── 3 · the platform cap, across every tenant at once ──")
        await set_tenant(roomy, None)
        await conn.execute("UPDATE platform_agent_config SET platform_monthly_cap=$1",
                           round(plat_spend - 0.01, 4))
        check(await fab._check_budget(conn, str(tid)) is False,
              "REFUSES on the platform cap even when the TENANT has headroom",
              f"platform ${plat_spend:.4f} of ${plat_spend - 0.01:.4f}")
        await conn.execute("UPDATE platform_agent_config SET platform_monthly_cap=NULL")
        check(await fab._check_budget(conn, str(tid)) is True, "ALLOWS once the cap is lifted")

        print("\n── 4 · the platform kill switch ──")
        await conn.execute("UPDATE platform_agent_config SET ai_enabled=false")
        check(await fab._check_budget(conn, str(tid)) is False,
              "REFUSES everywhere when ai_enabled = false")
        await conn.execute("UPDATE platform_agent_config SET ai_enabled=true")

        print("\n── 5 · the hourly rate limit ──")
        await set_tenant(roomy, max(recent, 0))
        check(await fab._check_rate_limit(conn, str(tid)) is False,
              "REFUSES once calls in the last hour reach the limit",
              f"{recent} call(s), limit {max(recent, 0)}")
        await set_tenant(roomy, recent + 5)
        check(await fab._check_rate_limit(conn, str(tid)) is True,
              "ALLOWS below the limit", f"limit {recent + 5}")

        print("\n── 6 · a tenant cannot raise its own budget past the framework ceiling ──")
        await conn.execute(
            "UPDATE automation_framework SET agent_monthly_budget_ceiling_usd=$1 WHERE id=1",
            round(spend - 0.01, 4))
        await set_tenant(9999, recent + 5)
        check(await fab._check_budget(conn, str(tid)) is False,
              "the ceiling wins over the tenant's own figure",
              f"asked $9999, ceiling ${spend - 0.01:.4f}, spent ${spend:.4f}")
    finally:
        # ── RESTORE, in a finally, to the SAVED values ───────────────────────────────────
        await conn.execute(
            "UPDATE automation_framework SET agent_monthly_budget_ceiling_usd=$1 WHERE id=1",
            saved_ceiling)
        if saved_tenant is None:
            await conn.execute("DELETE FROM tenant_agent_config WHERE tenant_id=$1", tid)
        else:
            await set_tenant(saved_tenant['monthly_budget'], saved_tenant['rate_limit_per_hour'])
        if saved_plat is not None:
            await conn.execute(
                "UPDATE platform_agent_config SET ai_enabled=$1, platform_monthly_cap=$2",
                saved_plat['ai_enabled'], saved_plat['platform_monthly_cap'])

    now_tenant = await conn.fetchrow(
        "SELECT monthly_budget, rate_limit_per_hour FROM tenant_agent_config WHERE tenant_id=$1", tid)
    now_ceiling = await conn.fetchval(
        "SELECT agent_monthly_budget_ceiling_usd FROM automation_framework WHERE id=1")
    print("\n── restore ──")
    check(now_ceiling == saved_ceiling, "framework ceiling is back", f"${now_ceiling}")
    check((saved_tenant is None and now_tenant is None)
          or (saved_tenant is not None and now_tenant is not None
              and now_tenant['monthly_budget'] == saved_tenant['monthly_budget']
              and now_tenant['rate_limit_per_hour'] == saved_tenant['rate_limit_per_hour']),
          "tenant config is back exactly as found")

    print(f"\n{ok} passed · {fail} failed")
    await conn.close()
    sys.exit(1 if fail else 0)


asyncio.run(main())
