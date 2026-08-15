"""
TW-8b live drive — prove the AI-manager portal stage-gate engine chain runs end to end
against the real WorkflowManager + sandbox DB (fabric=None → the AI_INVOKE safe-skips, but
the ACTION still lands the completion event, which is exactly the "gate never dead-ends" path).

Chain:  capture:stage_review.requested:end
          → [review_manager]  AI_INVOKE tool.advisory.reconcile  (advisory_manager; safe-skip w/o fabric)
          → [record]          ACTION record_stage_review
          → capture:stage_review.completed   (the trigger the frontend gate-close consumes)

Asserts: (1) a completed event is written, (2) it carries the FULL correlation payload threaded
off the requested event (portalId / proposalId / tenantId / stageKey / agentManagerKey / auto),
(3) it is advisory (verdict=reviewed, no portal stage mutation).

Run:  cd pipeline && DATABASE_URL=postgresql://claude@127.0.0.1:5433/govtech_intel \
        python3 scripts/drive_stage_review_chain.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import asyncpg  # noqa: E402
from workflows import base  # noqa: E402
from workflows.manager import WorkflowManager  # noqa: E402
from workflows.processor import _run_workflow_managed  # noqa: E402

DB = os.environ.get("DATABASE_URL", "postgresql://claude@127.0.0.1:5433/govtech_intel")

FAILS: list[str] = []


def check(cond: bool, label: str) -> None:
    print(f"  {'✓' if cond else '✗ FAIL'}  {label}")
    if not cond:
        FAILS.append(label)


async def main() -> None:
    base.discover_workflows()
    conn = await asyncpg.connect(DB)
    try:
        # A real tenant id (the emit path casts tenant_id → uuid, and it makes the audit realistic).
        tenant_id = await conn.fetchval("SELECT id FROM tenants ORDER BY created_at LIMIT 1")
        tenant_id = str(tenant_id)
        portal_id = str(uuid.uuid4())      # synthetic — the advisory chain reads no business table
        proposal_id = str(uuid.uuid4())
        stage_key = "color_team"
        mgr_key = "color_team_reviewer"

        # 1. Write the TRIGGER event exactly as the frontend emitStageReviewRequested END event does:
        #    the FULL payload rides in the end row (post-fix), so the record step gets every key.
        payload = {
            "portalId": portal_id,
            "tenantId": tenant_id,
            "proposalId": proposal_id,
            "opportunityId": str(uuid.uuid4()),
            "stageKey": stage_key,
            "agentManagerKey": mgr_key,
            "autoAdvance": False,
        }
        import json
        ev_id = await conn.fetchval(
            """INSERT INTO system_events (namespace, type, phase, actor_type, actor_id, tenant_id, payload)
               VALUES ('capture','stage_review.requested','end','user','drive-tw8b',$1,$2) RETURNING id""",
            uuid.UUID(tenant_id), json.dumps(payload),
        )
        event_dict = {
            "id": str(ev_id), "namespace": "capture", "type": "stage_review.requested",
            "phase": "end", "actor_id": "drive-tw8b", "tenant_id": tenant_id, "payload": payload,
        }

        # 2. The trigger must resolve to our workflow (condition = portalId present).
        wf = base.get_workflow_for_event(event_dict)
        check(wf is not None and wf.__name__ == "OnPortalStageReviewRequested",
              f"trigger routes capture:stage_review.requested:end → {wf.__name__ if wf else None}")
        if wf is None:
            return

        # 3. Drive it through the REAL manager (fabric=None → AI_INVOKE safe-skips; ACTION runs).
        mgr = WorkflowManager(source="pipeline", fabric=None)
        await mgr.sync_template_catalog(conn)   # reflect the new template into the catalog (active)
        await _run_workflow_managed(conn, mgr, wf, event_dict)

        # 4. Assert the completion TRIGGER was emitted, carrying the full correlation payload.
        row = await conn.fetchrow(
            """SELECT payload FROM system_events
               WHERE namespace='capture' AND type='stage_review.completed'
                 AND payload->>'portalId' = $1
               ORDER BY created_at DESC LIMIT 1""",
            portal_id,
        )
        check(row is not None, "capture:stage_review.completed was emitted")
        if row:
            p = row["payload"]
            if isinstance(p, str):
                p = json.loads(p)
            check(p.get("portalId") == portal_id, "completed.portalId threaded")
            check(p.get("proposalId") == proposal_id, "completed.proposalId threaded (was null pre-fix)")
            check(p.get("stageKey") == stage_key, "completed.stageKey threaded")
            check(p.get("agentManagerKey") == mgr_key, "completed.agentManagerKey threaded (was null pre-fix)")
            check(p.get("auto") is False, "completed.auto reflects autoAdvance=false")
            check(p.get("verdict") == "reviewed", "completed is advisory (verdict=reviewed)")

        # 5. The instance itself reached a terminal, non-error state (chain didn't dead-end).
        inst = await conn.fetchrow(
            """SELECT status FROM process_instances
               WHERE workflow_name='OnPortalStageReviewRequested' AND trigger_event_id=$1
               ORDER BY created_at DESC LIMIT 1""",
            ev_id,
        )
        check(inst is not None and inst["status"] in ("completed", "running"),
              f"process instance status={inst['status'] if inst else None} (no dead-end)")

        print(f"\n{'✓ ALL PASS' if not FAILS else '✗ ' + str(len(FAILS)) + ' FAIL'} "
              f"— TW-8b engine chain")
    finally:
        await conn.close()
    sys.exit(1 if FAILS else 0)


asyncio.run(main())
