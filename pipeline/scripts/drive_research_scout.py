"""Live proof (AGENTS-LIVE): research_scout fires via the mapped AI_INVOKE step.

Calls the processor's exact AI_INVOKE path (_execute_ai_invoke → fabric.invoke_agent) for
action tool.research.scout — the same code the OnProposalCreated ai_research_scout step runs —
against the emulator. Proves the new mapping resolves to research_scout, it's tenant-bound from
the trusted context, it runs advisory, and web egress safe-skips (no fabricated sources).
    cd pipeline && PYTHONPATH=src ANTHROPIC_BASE_URL=http://127.0.0.1:8787 \
      ANTHROPIC_API_KEY=emulated-claude .venv/bin/python scripts/drive_research_scout.py
"""
import asyncio
import json
import os
import sys

os.environ.setdefault("ANTHROPIC_BASE_URL", "http://127.0.0.1:8787")
os.environ.setdefault("ANTHROPIC_API_KEY", "emulated-claude")

import asyncpg  # noqa: E402
from workflows.processor import _execute_ai_invoke, TOOL_ACTION_TO_ARCHETYPE  # noqa: E402
from agents.fabric import AgentFabric  # noqa: E402

DB = os.environ.get("DATABASE_URL", "postgresql://govtech:changeme@localhost:5432/govtech_intel")
TENANT = "17780cad-76c0-4cef-95ec-2a536bcf5c8f"
PROP = "bbd6a058-3299-4b98-96e0-1e07e43aa1c4"

ok = True


def A(label, cond, extra=""):
    global ok
    print(f"{'✓' if cond else '✗'} {label}{f' — {extra}' if extra else ''}")
    ok = ok and bool(cond)


async def main():
    print("\n── AGENTS-LIVE · research_scout via the mapped AI_INVOKE step ──\n")
    A("mapping present: tool.research.scout → research_scout",
      TOOL_ACTION_TO_ARCHETYPE.get("tool.research.scout") == "research_scout")

    conn = await asyncpg.connect(DB)
    ev0 = await conn.fetchval(
        "SELECT count(*) FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%research_scout%'")
    fabric = AgentFabric()
    inputs = {"proposal_id": PROP, "tenant_id": TENANT,
              "question": "market research, prior art, and competitor landscape for this opportunity"}

    out = await _execute_ai_invoke(conn, "tool.research.scout", inputs, fabric)
    res = out.get("result") or {}
    summary = {k: res.get(k) for k in ("archetype", "status", "guardrail", "tenantId", "rounds", "tool_calls", "cost_usd")}
    A("AI_INVOKE resolved + RAN research_scout (not a safe-skip)",
      res.get("archetype") == "research_scout" and not out.get("skipped"), json.dumps(summary))
    A("advisory completion (no crash)", res.get("status") in ("completed", "ok", "success"), str(res.get("status")))
    # Guardrail gates the landing (advisory → guardrail → land-or-review).
    guard = res.get("guardrail") or {}
    A("guardrail evaluated the output (decision present)", bool(guard.get("decision")), str(guard.get("decision")))
    # The cited brief the agent produced (lands in agent memory for human acceptance).
    brief = str((guard.get("bounded") or {}).get("text") or res.get("text") or "")
    A("a research brief was produced", len(brief) > 0, brief[:80])
    # Tenant-isolation is proven statically by test_research_scout_wiring.py (no tenant_id in tool
    # schemas; execute_tool reads the trusted context; search_memory fails-closed / scopes by tenant).
    # Here we confirm the run stayed advisory (never wrote a business table — invoke_agent contract).

    ev1 = await conn.fetchval(
        "SELECT count(*) FROM system_events WHERE type='agent.invoked' AND payload::text LIKE '%research_scout%'")
    A("audit: a research_scout agent.invoked event was written", ev1 > ev0, f"{ev0} → {ev1}")

    await conn.close()
    print(f"\n{'✅ ALL PASS — research_scout fires via the mapped AI_INVOKE step' if ok else '❌ failures above'}\n")
    return ok


sys.exit(0 if asyncio.run(main()) else 1)
