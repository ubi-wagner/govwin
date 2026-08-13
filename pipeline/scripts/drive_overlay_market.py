"""Live proof (OVERLAY-2): request_advisory_overlay threads a real market section so
market_analyst's pre_augment anchors on it instead of erroring.
    cd pipeline && PYTHONPATH=src ANTHROPIC_BASE_URL=http://127.0.0.1:8787 \
      ANTHROPIC_API_KEY=emulated-claude .venv/bin/python scripts/drive_overlay_market.py
"""
import asyncio
import json
import os
import sys

os.environ.setdefault("ANTHROPIC_BASE_URL", "http://127.0.0.1:8787")
os.environ.setdefault("ANTHROPIC_API_KEY", "emulated-claude")

import asyncpg  # noqa: E402
from workflows.actions.advisory_actions import request_advisory_overlay, _resolve_market_section  # noqa: E402
from workflows.processor import _execute_ai_invoke  # noqa: E402
from agents.fabric import AgentFabric  # noqa: E402
from agents.archetypes.market_analyst import MarketAnalystArchetype  # noqa: E402

DB = os.environ.get("DATABASE_URL", "postgresql://govtech:changeme@localhost:5432/govtech_intel")
TENANT = "17780cad-76c0-4cef-95ec-2a536bcf5c8f"
PROP = "bbd6a058-3299-4b98-96e0-1e07e43aa1c4"  # TVSF proposal (has "1. Market Opportunity")

ok = True


def A(label, cond, extra=""):
    global ok
    print(f"{'✓' if cond else '✗'} {label}{f' — {extra}' if extra else ''}")
    ok = ok and bool(cond)


async def main():
    print("\n── OVERLAY-2 · market_analyst anchored via a threaded section ──\n")
    conn = await asyncpg.connect(DB)

    # 1. The resolver picks the market-relevant section.
    sid = await _resolve_market_section(conn, PROP)
    title = await conn.fetchval("SELECT title FROM proposal_sections WHERE id = $1::uuid", sid) if sid else None
    A("resolver picked a market-relevant section", bool(sid) and ("market" in (title or "").lower()
        or "related" in (title or "").lower() or "commercial" in (title or "").lower()), f"{title!r}")

    # 2. request_advisory_overlay emits the overlay trigger WITH that section_id.
    ev0 = await conn.fetchval(
        "SELECT count(*) FROM system_events WHERE type='proposal.advisory_overlay_requested'")
    res = await request_advisory_overlay(conn, adversarial=True, proposal_id=PROP, tenant_id=TENANT, policy="auto")
    A("request_advisory_overlay requested (adversarial gate)", res.get("requested") is True, json.dumps(res))
    row = await conn.fetchrow(
        "SELECT payload FROM system_events WHERE type='proposal.advisory_overlay_requested' "
        "AND payload->>'proposal_id' = $1 ORDER BY created_at DESC LIMIT 1", PROP)
    emitted = json.loads(row["payload"]) if row and isinstance(row["payload"], str) else (row["payload"] if row else {})
    A("emitted overlay payload carries section_id", emitted.get("section_id") == sid, str(emitted.get("section_id")))
    A("a new overlay event was written", (await conn.fetchval(
        "SELECT count(*) FROM system_events WHERE type='proposal.advisory_overlay_requested'")) > ev0)

    # 3. THE FIX: market_analyst.get_section_context now SUCCEEDS with the threaded section (was erroring).
    ctx = await MarketAnalystArchetype()._get_section_context(conn, {"section_id": sid}, TENANT)
    A("get_section_context returns the section (no 'section_id required' error)",
      "error" not in ctx, json.dumps({k: ctx.get(k) for k in ("title", "section_number", "agency", "program_type")})[:160])

    # 4. Guardrail: without the section it fails-closed (proves the fix is what unblocks it).
    ctx_none = await MarketAnalystArchetype()._get_section_context(conn, {"section_id": None}, TENANT)
    A("without a section it still errors (fix is necessary, not incidental)", "error" in ctx_none, str(ctx_none.get("error")))

    # 5. Full market_analyst runs via the overlay's AI_INVOKE action on the emulator.
    fabric = AgentFabric()
    out = await _execute_ai_invoke(conn, "tool.market.analyze_sota",
                                   {"proposal_id": PROP, "tenant_id": TENANT, "section_id": sid}, fabric)
    r = out.get("result") or {}
    A("overlay AI_INVOKE ran market_analyst (advisory)", r.get("archetype") == "market_analyst"
      and r.get("status") in ("completed", "ok", "success"), f"status={r.get('status')} guardrail={(r.get('guardrail') or {}).get('decision')}")

    await conn.close()
    print(f"\n{'✅ ALL PASS — the overlay now runs market_analyst section-anchored' if ok else '❌ failures above'}\n")
    return ok


sys.exit(0 if asyncio.run(main()) else 1)
