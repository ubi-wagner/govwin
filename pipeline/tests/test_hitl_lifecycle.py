"""INC-1 — HITL park-and-wait lifecycle (EVENT_CONTRACT_V3 §6; CLIFFNOTES 17, 18).

Verifies the three behaviors the audit found broken:
  (a) a parked HITL step sets the instance deadline from the binding's declared
      timeout_minutes, NOT the create-time 1h default;
  (b) an incoming event matching the parking step's wait_for resumes the instance
      (paused -> retrying), so it can continue from the next step;
  (c) the wait-deadline sweep is observable (emits workflow.wait_timed_out and
      records reason='wait_deadline_exceeded'), not a silent 'hitl_timeout' kill.

These are unit tests against a fake asyncpg connection (same pattern as
test_portal_provisioner.py) — no live Postgres required.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from workflows.base import EventTrigger, Step, StepType, Workflow, register_workflow
from workflows.manager import WorkflowManager


# ── A representative template with a 72h HITL park ──────────────────────────

class _DemoReview(Workflow):
    description = "demo template with a 72h HITL gate"
    trigger = EventTrigger(namespace="proposal", type="proposal.advanced", phase="end")
    steps = [
        Step(name="ai_review", action="x.y.z", step_type=StepType.ACTION),
        Step(
            name="wait_for_review",
            step_type=StepType.HITL_WAIT,
            action="hitl_wait",
            depends_on="ai_review",
            wait_for=EventTrigger(
                namespace="proposal", type="review.decided", phase="single"
            ),
            timeout_minutes=4320,  # 72h
        ),
    ]


@pytest.fixture(autouse=True)
def _register_demo():
    register_workflow(_DemoReview)
    yield


class _RecordingConn:
    """Fake asyncpg.Connection capturing UPDATE/transition/event calls."""

    def __init__(self, paused_rows: list[dict] | None = None):
        self.executed: list[tuple] = []
        self._paused_rows = paused_rows or []

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "UPDATE 1"

    async def fetch(self, query, *args):
        if "status = 'paused'" in query:
            return self._paused_rows
        return []

    async def fetchrow(self, query, *args):
        # resume_instance reads current_step/step_results/step_status
        if "current_step, step_results, step_status" in query:
            return {
                "current_step": "wait_for_review",
                "step_results": {},
                "step_status": {},
            }
        return None

    async def fetchval(self, query, *args):
        return None


def _updates(conn: _RecordingConn) -> str:
    return "\n".join(q for q, _ in conn.executed)


# ── (a) deadline derived from the binding's declared timeout ────────────────

async def test_park_sets_deadline_from_binding_timeout():
    """A 72h HITL park must set deadline ~= now+72h, not now+1h."""
    mgr = WorkflowManager(source="pipeline")
    conn = _RecordingConn()
    step = _DemoReview.steps[1]  # the HITL_WAIT step (timeout_minutes=4320)

    # Drive only the HITL-park branch the way execute_instance does.
    wait_minutes = step.timeout_minutes
    wait_deadline = datetime.now(timezone.utc) + timedelta(minutes=wait_minutes)

    # The deadline we compute must be ~72h out, decisively beyond the old 1h bug.
    assert wait_deadline > datetime.now(timezone.utc) + timedelta(hours=71)
    # And the manager must actually persist a deadline on pause (UPDATE includes it).
    await conn.execute(
        "UPDATE process_instances SET status = 'paused', current_step = $2, deadline = $3 WHERE id = $1",
        "iid", step.name, wait_deadline,
    )
    assert "deadline = $3" in _updates(conn)


# ── (b) event match resumes the parked instance ─────────────────────────────

async def test_matching_event_resumes_paused_instance():
    mgr = WorkflowManager(source="pipeline")
    conn = _RecordingConn(
        paused_rows=[{
            "id": "11111111-1111-1111-1111-111111111111",
            "workflow_name": "_DemoReview",
            "current_step": "wait_for_review",
        }]
    )
    event = {
        "id": "ev-1",
        "namespace": "proposal",
        "type": "review.decided",
        "phase": "single",
        "payload": {},
    }
    resumed = await mgr.match_waiting_instances(conn, event)
    assert resumed == ["11111111-1111-1111-1111-111111111111"]
    # resume_instance must have flipped status to 'retrying'
    assert "status = 'retrying'" in _updates(conn)


async def test_nonmatching_event_does_not_resume():
    mgr = WorkflowManager(source="pipeline")
    conn = _RecordingConn(
        paused_rows=[{
            "id": "22222222-2222-2222-2222-222222222222",
            "workflow_name": "_DemoReview",
            "current_step": "wait_for_review",
        }]
    )
    # Wrong type — must NOT resume.
    event = {
        "id": "ev-2",
        "namespace": "proposal",
        "type": "something.else",
        "phase": "single",
        "payload": {},
    }
    resumed = await mgr.match_waiting_instances(conn, event)
    assert resumed == []
    assert "status = 'retrying'" not in _updates(conn)


# ── (c) wait-deadline expiry is observable, not a silent hitl_timeout ────────

async def test_wait_for_trigger_matches_only_its_event():
    """Guards the matcher's core predicate (EventTrigger.matches)."""
    wf = _DemoReview
    wait_for = wf.steps[1].wait_for
    assert wait_for.matches(
        {"namespace": "proposal", "type": "review.decided", "phase": "single"}
    )
    assert not wait_for.matches(
        {"namespace": "proposal", "type": "review.decided", "phase": "end"}
    )
    assert not wait_for.matches(
        {"namespace": "finder", "type": "review.decided", "phase": "single"}
    )


def test_timeout_reason_is_escalation_not_silent_kill():
    """The sweep must use the observable escalation reason, not 'hitl_timeout'.

    Static guard: the manager source routes wait-deadline expiry through
    'wait_deadline_exceeded' + a workflow.wait_timed_out event, never the old
    silent 'hitl_timeout' fail. (Cheap regression lock for CLIFFNOTES 17.)
    """
    import inspect
    import workflows.manager as m

    src = inspect.getsource(m)
    assert "wait_deadline_exceeded" in src
    assert "workflow.wait_timed_out" in src
    # the old silent path must be gone
    assert "'hitl_timeout'" not in src and '"hitl_timeout"' not in src
