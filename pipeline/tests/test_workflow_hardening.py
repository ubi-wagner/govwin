"""P1-workflow (#140, launch-readiness): workflow-engine hardening.

Covers, with a mix of a live-DB drive-test and cheap static/definition locks:

  HIGH-3  managed engine is continue-on-INDEPENDENT-failure, not fail-fast — a raised
          ACTION no longer `break`s the instance; independent downstream steps still run.
          (Drive-tested against the sandbox process_instances table.)
  HIGH-2  OnRfpUploaded.notify_curator is INDEPENDENT (no depends_on) so the RFP admin is
          alerted even when shred/extract fails (the failure they most need to hear about).
  MED-4   the managed engine (the only executor) parks at a TODO human gate as well as
          HITL_WAIT, and the dispatcher treats a stray TODO as a safe skip, never an
          "unknown_type" no-op. (The fire-and-forget path this originally guarded has since
          been removed entirely — see test_engine_single_path.)
  MED-6   tenantId is a HITL correlation key — a resume event for tenant B can't wake a
          parked instance for tenant A.
  LOW-10  OnProposalCreated.notify_admin_review reads payload.title (the real end-event key),
          not payload.proposalTitle (which resolved to None → blank email title).
  validate() guards: reject system:workflow.* triggers, unmapped AI_INVOKE actions,
          depends_on cycles, and input_map step.<name> refs to non-ancestor / unknown steps.
"""
from __future__ import annotations

import inspect
import json
import os
import uuid

import asyncpg
import pytest

from workflows.base import EventTrigger, Step, StepType, Workflow
from workflows.manager import WorkflowManager

DATABASE_URL = os.getenv("DATABASE_URL")


# ────────────────────────────────────────────────────────────────────────────
# HIGH-3 — continue-on-independent-failure (LIVE DRIVE-TEST)
# ────────────────────────────────────────────────────────────────────────────

_UNIQUE = uuid.uuid4().hex[:12]
_NOTIFY_TEMPLATE = f"hardening_probe_{_UNIQUE}"


class _FailThenNotify(Workflow):
    """A step that RAISES, followed by an INDEPENDENT notify (no depends_on).

    Pre-fix (fail-fast `break`): the notify never runs. Post-fix: the failed step
    skips only its dependents; the independent notify still fires.
    """

    description = "drive-test: independent notify survives an upstream failure"
    trigger = EventTrigger(namespace="finder", type="hardening.probe", phase="end")
    steps = [
        Step(name="will_fail", action="probe.always_raises", step_type=StepType.ACTION),
        # A DEPENDENT of the failed step — must be skipped (cascade).
        Step(
            name="dependent_skipped",
            action="probe.noop",
            step_type=StepType.ACTION,
            depends_on="will_fail",
        ),
        # INDEPENDENT notify — must still run.
        Step(
            name="independent_notify",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={"channel": '"email"', "template": f'"{_NOTIFY_TEMPLATE}"'},
        ),
    ]


@pytest.mark.asyncio
@pytest.mark.skipif(not DATABASE_URL, reason="requires sandbox DATABASE_URL")
async def test_managed_engine_continues_past_independent_failure(monkeypatch):
    """A raised ACTION must NOT abort the instance: dependents skip, independents run."""
    import workflows.processor as proc

    async def _boom(conn, action, inputs):
        raise RuntimeError("deliberate probe failure")

    # Only ACTION steps route through _execute_action; NOTIFY uses the real _execute_notify,
    # so the notification event is genuinely emitted (proving the step actually ran).
    monkeypatch.setattr(proc, "_execute_action", _boom)

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        instance_id = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO process_instances (id, workflow_name, status, payload, source)
            VALUES ($1, $2, 'pending', $3::jsonb, 'pipeline')
            """,
            uuid.UUID(instance_id),
            "_FailThenNotify",
            json.dumps({"probe": _UNIQUE}),
        )

        mgr = WorkflowManager(source="pipeline")
        result = await mgr.execute_instance(conn, instance_id, _FailThenNotify, {"probe": _UNIQUE})

        # Instance is still marked failed (a step failed) — audit + retry affordance intact.
        assert result["status"] == "failed", result

        row = await conn.fetchrow(
            "SELECT status, step_status FROM process_instances WHERE id = $1",
            uuid.UUID(instance_id),
        )
        assert row["status"] == "failed"
        step_status = row["step_status"]
        if isinstance(step_status, str):
            step_status = json.loads(step_status)

        assert step_status.get("will_fail") == "failed", step_status
        # The DEPENDENT step must be skipped (failure cascades along depends_on)...
        assert step_status.get("dependent_skipped") == "skipped", step_status
        # ...but the INDEPENDENT notify must still have COMPLETED (the whole point).
        assert step_status.get("independent_notify") == "completed", step_status

        # And the notification event was really emitted — the curator/customer is alerted.
        notified = await conn.fetchval(
            """
            SELECT count(*) FROM system_events
            WHERE namespace = 'system' AND type = 'notification.requested'
              AND payload->>'template' = $1
            """,
            _NOTIFY_TEMPLATE,
        )
        assert notified >= 1, "independent NOTIFY step did not emit — engine still fail-fast?"
    finally:
        # Clean up probe rows so repeated runs stay isolated.
        await conn.execute(
            "DELETE FROM system_events WHERE payload->>'template' = $1", _NOTIFY_TEMPLATE
        )
        await conn.execute(
            "DELETE FROM process_instances WHERE workflow_name = '_FailThenNotify' AND payload->>'probe' = $1",
            _UNIQUE,
        )
        await conn.close()


def test_managed_engine_has_no_failfast_break():
    """Static lock: the step-failure branch must NOT `break` (continue-on-independent-failure)."""
    src = inspect.getsource(WorkflowManager.execute_instance)
    # The failure branch sets final_status='failed' then falls through — the old fail-fast
    # `break` that skipped independent steps must be gone from that branch.
    assert "NO break — fall through" in src, "HIGH-3 continue-on-failure comment missing"
    # The only remaining breaks are the two cancellation checks; assert we didn't reintroduce
    # a break immediately after setting final_status='failed'.
    assert 'final_status = "failed"\n                break' not in src


# ────────────────────────────────────────────────────────────────────────────
# HIGH-2 / LOW-10 — workflow definition locks
# ────────────────────────────────────────────────────────────────────────────

def test_notify_curator_is_independent():
    """OnRfpUploaded.notify_curator must have NO depends_on (alert fires even on shred fail)."""
    from workflows.on_rfp_uploaded import OnRfpUploaded

    notify = next(s for s in OnRfpUploaded.steps if s.name == "notify_curator")
    assert notify.step_type == StepType.NOTIFY
    assert notify.depends_on is None, (
        "notify_curator must be independent — depending on extract_compliance dropped the "
        "curator alert on the shred/extract failure the admin most needs to hear about"
    )


def test_proposal_created_notify_uses_title_not_proposalTitle():
    """LOW-10: notify_admin_review must map proposal_title from payload.title (the real key)."""
    from workflows.on_proposal_created import OnProposalCreated

    notify = next(s for s in OnProposalCreated.steps if s.name == "notify_admin_review")
    assert notify.input_map.get("proposal_title") == "payload.title", notify.input_map
    assert notify.input_map.get("proposal_title") != "payload.proposalTitle"


# ────────────────────────────────────────────────────────────────────────────
# MED-4 — TODO human gate (fire-and-forget stop + dispatcher safe-skip)
# ────────────────────────────────────────────────────────────────────────────

def test_managed_engine_parks_at_todo_gate():
    """The managed engine (the ONLY executor) must park at a TODO gate, not skip it.

    (The fire-and-forget path that MED-4 originally guarded has since been removed
    entirely — 'no fire-and-forget ever' — so the guarantee now lives in the managed
    engine, which handles TODO alongside HITL_WAIT by parking + writing a tasks row.)"""
    from workflows.manager import WorkflowManager

    src = inspect.getsource(WorkflowManager.execute_instance)
    assert "StepType.TODO, StepType.HITL_WAIT" in src or "StepType.HITL_WAIT, StepType.TODO" in src, (
        "managed engine must intercept TODO as a human gate (park), not dispatch it"
    )
    assert "_create_task" in src  # a TODO also writes to the unified tasks ledger


@pytest.mark.asyncio
async def test_todo_dispatch_is_safe_skip_not_unknown():
    """A stray TODO reaching the dispatcher returns a distinct safe-skip, never unknown_type."""
    from workflows.processor import _execute_step

    todo = Step(
        name="gate",
        step_type=StepType.TODO,
        action="noop",
        task_type="admin_approval",
        assignee_role="rfp_admin",
    )
    out = await _execute_step(conn=None, step=todo, inputs={})
    assert out["skipped"] is True
    assert out["reason"] == "todo_gate", out


# ────────────────────────────────────────────────────────────────────────────
# MED-6 — tenantId correlation key
# ────────────────────────────────────────────────────────────────────────────

def test_tenantId_is_a_correlation_key():
    assert "tenantId" in WorkflowManager._CORRELATION_KEYS


def test_event_correlates_tightens_on_tenant():
    """A resume event for tenant B must NOT correlate with an instance parked for tenant A."""
    a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    # Same entity-less event but different tenant → must not match.
    assert WorkflowManager._event_correlates({"tenantId": a}, {"tenantId": a}) is True
    assert WorkflowManager._event_correlates({"tenantId": b}, {"tenantId": a}) is False
    # No shared key at all → still falls back to True (only ever tightens).
    assert WorkflowManager._event_correlates({}, {"tenantId": a}) is True


# ────────────────────────────────────────────────────────────────────────────
# validate() guards
# ────────────────────────────────────────────────────────────────────────────

def test_validate_rejects_system_workflow_trigger():
    class _W(Workflow):
        trigger = EventTrigger(namespace="system", type="workflow.started", phase="end")
        steps = [Step(name="a", action="x.y")]

    assert any("would never fire" in e for e in _W.validate())


def test_validate_rejects_unmapped_ai_invoke():
    class _W(Workflow):
        trigger = EventTrigger(namespace="finder", type="foo", phase="end")
        steps = [Step(name="a", action="tool.nope.nope", step_type=StepType.AI_INVOKE)]

    assert any("TOOL_ACTION_TO_ARCHETYPE" in e for e in _W.validate())


def test_validate_detects_depends_on_cycle():
    class _W(Workflow):
        trigger = EventTrigger(namespace="finder", type="foo", phase="end")
        steps = [
            Step(name="a", action="x.y", depends_on="b"),
            Step(name="b", action="x.y", depends_on="a"),
        ]

    assert any("cycle" in e for e in _W.validate())


def test_validate_rejects_unknown_and_nonancestor_step_refs():
    class _Unknown(Workflow):
        trigger = EventTrigger(namespace="finder", type="foo", phase="end")
        steps = [
            Step(name="a", action="x.y"),
            Step(name="b", action="x.y", input_map={"v": "step.ghost.result.x"}),
        ]

    assert any("unknown step" in e for e in _Unknown.validate())

    class _NonAncestor(Workflow):
        trigger = EventTrigger(namespace="finder", type="foo", phase="end")
        steps = [
            # 'a' refers to 'b' but does not depend on it → undefined order.
            Step(name="a", action="x.y", input_map={"v": "step.b.result.x"}),
            Step(name="b", action="x.y"),
        ]

    assert any("not a (transitive)" in e for e in _NonAncestor.validate())


def test_validate_accepts_all_real_workflows():
    """No real registered workflow may be rejected by the new guards."""
    from workflows.base import discover_workflows, all_registered_workflows

    discover_workflows()
    for w in all_registered_workflows():
        assert w.validate() == [], f"{w.__name__} rejected: {w.validate()}"
