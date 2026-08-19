"""Live proof (B17): a "reviewed" verdict now follows the evidence, through the real engine.

Runs the ACTUAL managed workflow engine against the real database, twice, over the real
`OnPortalStageReviewRequested` template:

  RUN 1 — no fabric, so `review_manager` (AI_INVOKE) safe-skips exactly as it does in a
          deployment with no ANTHROPIC_API_KEY. The gate must land `verdict='not_reviewed'`.
  RUN 2 — a stub fabric that returns a result, so the manager completes. The gate must land
          `verdict='reviewed'`.

Both runs assert the workflow still COMPLETES — the whole point of the independent record step is
that a dead agent never dead-ends a customer's workflow, and the fix must not have changed that.

Why a live drive and not just the unit tests: the unit tests call the action directly with a
hand-written step map. This proves the ENGINE actually computes that map from the workflow's own
declaration and delivers it — the half that, if it silently broke, would leave every verdict
'unverified' forever with every unit test still green.

    python3 scripts/drive_b17_evidence.py
"""
import asyncio
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import asyncpg  # noqa: E402

PASS, FAIL = "✓", "✗"
_failures: list[str] = []


def A(label, ok, detail=""):
    print(f"  {PASS if ok else FAIL} {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        _failures.append(label)


class StubFabric:
    """A fabric that answers — the 'the key is configured' half of the experiment."""

    async def invoke(self, *a, **kw):
        return {"result": {"reconciled": True}, "archetype": "advisory_manager"}

    async def dispatch(self, *a, **kw):
        return {"result": {"reconciled": True}}

    def __getattr__(self, _name):
        async def _any(*a, **kw):
            return {"result": {"reconciled": True}}
        return _any


async def run_once(conn, manager_cls, fabric, portal_id, stage_key):
    """Drive one real instance of OnPortalStageReviewRequested and return its landed payload."""
    from workflows.on_portal_stage_review import OnPortalStageReviewRequested

    mgr = manager_cls(fabric=fabric)
    payload = {
        "portalId": str(portal_id),
        "stageKey": stage_key,
        "agentManagerKey": "advisory_manager",
        "autoAdvance": True,
    }
    instance_id = await mgr.create_instance(
        conn, OnPortalStageReviewRequested.__name__, None, payload, tenant_id=None,
    )
    out = await mgr.execute_instance(
        conn, instance_id, OnPortalStageReviewRequested, payload,
    )

    row = await conn.fetchrow(
        """SELECT e.payload AS landed, p.step_status AS step_status
           FROM system_events e
           JOIN process_instances p ON p.id = $1::uuid
           WHERE e.namespace = 'capture' AND e.type = 'stage_review.completed'
             AND e.payload ->> 'portalId' = $2 AND e.payload ->> 'stageKey' = $3
           ORDER BY e.created_at DESC LIMIT 1""",
        instance_id, str(portal_id), stage_key,
    )
    landed = row["landed"] if row else None
    if isinstance(landed, str):
        landed = json.loads(landed)
    steps = row["step_status"] if row else None
    if isinstance(steps, str):
        steps = json.loads(steps)
    return out, landed, steps


async def main():
    # Connect the way the PIPELINE connects, not the way the frontend does.
    #
    # The workflow engine's instances are PLATFORM scope (`tenant_id IS NULL`) and the tenant
    # policies are tenant-EQUALITY, so NULL never matches: under `govtech_app` the engine cannot
    # even claim its own instance ("Instance not claimable" — proven while writing this script).
    # The deployed worker runs as the owner role because `rfp_agent` is still deploy-gated
    # (docs/RLS_CUTOVER.md:6). Driving as `govtech_app` here would prove nothing about the engine
    # and everything about a role that never runs it.
    dsn = os.environ.get("DATABASE_URL_OWNER") or os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL_OWNER not set — source /tmp/govwin-sandbox/env.sh")
        return 2
    conn = await asyncpg.connect(dsn.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        from workflows.manager import WorkflowManager

        # Two distinct stage keys so the two runs cannot read each other's completion event.
        portal_id = uuid.uuid4()
        print("\nRUN 1 — no fabric: the manager safe-skips, exactly as with no API key")
        out1, landed1, steps1 = await run_once(conn, WorkflowManager, None, portal_id, "b17_noskey")
        A("the workflow still COMPLETED (a dead agent never dead-ends)",
          out1.get("status") == "completed", str(out1.get("status")))
        # The conflation this fix has to see through, pinned so it stays visible: the engine's RAW
        # step record says 'completed' for a step that never called an agent, because a safe-skip
        # returns a value and any returned value is recorded as completed. The derived evidence
        # below disagrees with it, correctly. (Logged separately — changing the raw record would
        # cascade `depends_on` skips through workflows that currently run.)
        A("the RAW step record still says 'completed' for the safe-skipped step (the conflation)",
          (steps1 or {}).get("review_manager") == "completed", json.dumps(steps1))
        A("the gate landed verdict='not_reviewed'",
          (landed1 or {}).get("verdict") == "not_reviewed", (landed1 or {}).get("verdict"))
        A("cohortRan is False", (landed1 or {}).get("cohortRan") is False)
        A("the human summary SAYS the review did not run",
          "did NOT run" in ((landed1 or {}).get("summary") or ""), (landed1 or {}).get("summary"))

        print("\nRUN 2 — fabric present: the manager runs")
        out2, landed2, steps2 = await run_once(conn, WorkflowManager, StubFabric(), portal_id, "b17_withkey")
        A("the workflow COMPLETED", out2.get("status") == "completed", str(out2.get("status")))
        A("the engine recorded review_manager as completed",
          (steps2 or {}).get("review_manager") == "completed", json.dumps(steps2))
        A("the gate landed verdict='reviewed'",
          (landed2 or {}).get("verdict") == "reviewed", (landed2 or {}).get("verdict"))
        A("cohortRan is True", (landed2 or {}).get("cohortRan") is True)
        A("the evidence names the step that ran",
          "review_manager" in ((landed2 or {}).get("evidence") or ""), (landed2 or {}).get("evidence"))

        print("\nTHE POINT — the same workflow, the same record step, two different verdicts,")
        print("and the difference is whether anything actually reviewed the stage.")

        # Leave the sandbox as we found it: these two instances and their events are scaffolding.
        await conn.execute(
            "DELETE FROM system_events WHERE namespace = 'capture'"
            " AND payload ->> 'portalId' = $1", str(portal_id))
        await conn.execute(
            "DELETE FROM process_instance_transitions WHERE instance_id IN ("
            " SELECT id FROM process_instances WHERE payload ->> 'portalId' = $1)", str(portal_id))
        await conn.execute(
            "DELETE FROM process_instances WHERE payload ->> 'portalId' = $1", str(portal_id))
    finally:
        await conn.close()

    print()
    if _failures:
        print(f"{FAIL} {len(_failures)} assertion(s) failed:")
        for f in _failures:
            print(f"   · {f}")
        return 1
    print(f"{PASS} B17 proven live through the real engine.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
