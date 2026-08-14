"""Prove the already-wired agents FIRE live (onboarding_agent · outcome_analyst · the ingest
cohort). Each is producer-wired (accept route → OnApplicationAccepted; outcome route →
OnProposalOutcomeRecorded; rfp-upload → OnRfpUploaded) but was not on the proven-live list.
This drives each agent's mapped action through the processor's exact AI_INVOKE path
(_execute_ai_invoke → fabric.invoke_agent) against the emulator — the runtime the workflow step
runs — verifying it resolves to the right archetype, runs advisory (guardrail), and is audited.
    cd pipeline && PYTHONPATH=src ANTHROPIC_BASE_URL=http://127.0.0.1:8787 \
      ANTHROPIC_API_KEY=emulated-claude .venv/bin/python scripts/drive_prove_agents.py
"""
import asyncio
import os
import sys

os.environ.setdefault("ANTHROPIC_BASE_URL", "http://127.0.0.1:8787")
os.environ.setdefault("ANTHROPIC_API_KEY", "emulated-claude")

import asyncpg
from workflows.processor import _execute_ai_invoke, TOOL_ACTION_TO_ARCHETYPE
from agents.fabric import AgentFabric

DB = os.environ.get("DATABASE_URL", "postgresql://govtech:changeme@localhost:5432/govtech_intel")
FOUNDATION = "17780cad-76c0-4cef-95ec-2a536bcf5c8f"
PROP = "c3db60b1-2f0e-4bc8-903c-1ec098906c58"
CURATED_SOL = "10a1f21d-7e7e-5330-8d86-b0bb19337dfe"

# (action, archetype, inputs, scope) — the exact input keys each workflow step passes.
CASES = [
    ("tool.onboarding.concierge", "onboarding_agent",
     {"tenant_id": FOUNDATION, "user_id": None, "company_name": "Foundation 3DP", "website": "foundation3dp.com"}, "tenant"),
    ("tool.outcome.analyze", "outcome_analyst",
     {"tenant_id": FOUNDATION, "proposal_id": PROP, "outcome": "lost", "notes": "Strong tech; lost on price."}, "tenant"),
    ("tool.solicitation.ingest", "ingest_analyst", {"solicitation_id": CURATED_SOL}, "platform"),
    ("tool.matrix.stage", "matrix_stager", {"solicitation_id": CURATED_SOL}, "platform"),
    ("tool.skeleton.build", "skeleton_architect", {"solicitation_id": CURATED_SOL}, "platform"),
]

ok = True


def A(label, cond, extra=""):
    global ok
    print(f"{'✓' if cond else '✗'} {label}{f' — {extra}' if extra else ''}")
    ok = ok and bool(cond)


async def main():
    print("\n── Prove already-wired agents fire live ──\n")
    conn = await asyncpg.connect(DB)
    fabric = AgentFabric()
    for action, arch, inputs, scope in CASES:
        A(f"{arch}: action mapped ({action})", TOOL_ACTION_TO_ARCHETYPE.get(action) == arch)
        ev0 = await conn.fetchval(
            "SELECT count(*) FROM system_events WHERE type='agent.invoked' AND payload::text LIKE $1", f"%{arch}%")
        out = await _execute_ai_invoke(conn, action, inputs, fabric)
        r = out.get("result") or {}
        ran = r.get("archetype") == arch and not out.get("skipped") and r.get("status") in ("completed", "ok", "success")
        A(f"  → {arch} RAN on the emulator (advisory)",
          ran, f"status={r.get('status')} guardrail={(r.get('guardrail') or {}).get('decision')} scope={'tenant' if r.get('tenantId') else 'platform'}")
        ev1 = await conn.fetchval(
            "SELECT count(*) FROM system_events WHERE type='agent.invoked' AND payload::text LIKE $1", f"%{arch}%")
        A(f"  → {arch} agent.invoked audited", ev1 > ev0, f"{ev0} → {ev1}")
    await conn.close()
    print(f"\n{'✅ ALL PASS — onboarding_agent, outcome_analyst, and the ingest cohort fire live' if ok else '❌ failures above'}\n")
    return ok


sys.exit(0 if asyncio.run(main()) else 1)
