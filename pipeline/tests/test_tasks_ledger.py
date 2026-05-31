"""Tasks epic keystone — StepType.TODO + the unified `tasks` ledger.

A ToDo is a parameterized template step: static code declares "this is a human
task"; the per-instance payload supplies the assignee, nudge cadence, due date,
and the UUID of the thing to act on. The engine writes a task row and parks the
instance (exactly like HITL_WAIT); completing the task resumes it.

These are unit tests against a fake asyncpg connection (house style); they lock:
  (a) a TODO step resolves its task_* fields from the payload and inserts a task;
  (b) validate() rejects a TODO missing task_type / assignee;
  (c) complete_task closes the task and resumes the parked instance;
  (d) the nudge sweep fires due nudges once each (idempotent via nudges_sent).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from workflows.base import EventTrigger, Step, StepType, Workflow
from workflows.manager import WorkflowManager

_IID = "11111111-1111-1111-1111-111111111111"


# ── A template with a parameterized TODO gate ───────────────────────────────

class _ApprovalFlow(Workflow):
    description = "content approval via a parameterized ToDo"
    trigger = EventTrigger(namespace="library", type="content.processed", phase="end")
    steps = [
        Step(
            name="approve_content",
            action="todo",
            step_type=StepType.TODO,
            task_type="admin_approval",
            task_title='"Approve pipeline content"',
            assignee_role="payload.approverRole",
            entity_type='"content_pipeline"',
            entity_ref="payload.contentPipelineId",
            nudge_days="payload.nudgeDays",
            due_in_minutes="payload.dueMinutes",
        ),
    ]


# ── validation ──────────────────────────────────────────────────────────────

def test_validate_accepts_well_formed_todo():
    assert _ApprovalFlow.validate() == []


def test_validate_rejects_todo_without_task_type_or_assignee():
    class _Bad(Workflow):
        trigger = EventTrigger(namespace="x", type="y", phase="end")
        steps = [Step(name="t", action="todo", step_type=StepType.TODO)]

    errors = _Bad.validate()
    assert any("task_type" in e for e in errors), errors
    assert any("assignee" in e for e in errors), errors


# ── (a) TODO step writes a task row with resolved params ────────────────────

class _CreateConn:
    """Captures the tasks INSERT and its args."""

    def __init__(self):
        self.task_insert_args = None

    async def fetchval(self, q, *a):
        if "SELECT tenant_id FROM process_instances" in q:
            return uuid.UUID("22222222-2222-2222-2222-222222222222")
        return None

    async def execute(self, q, *a):
        if "INSERT INTO tasks" in q:
            self.task_insert_args = a
        return "INSERT 0 1"

    async def fetchrow(self, q, *a):
        return None


async def test_todo_creates_task_with_resolved_payload_params():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    conn = _CreateConn()
    step = _ApprovalFlow.steps[0]
    payload = {
        "approverRole": "rfp_admin",
        "contentPipelineId": "33333333-3333-3333-3333-333333333333",
        "nudgeDays": [1, 3, 5],
        "dueMinutes": 7200,  # 5 days
    }

    task_id = await mgr._create_task(conn, step, _IID, payload, {})

    assert task_id is not None
    a = conn.task_insert_args
    # arg order: id, tenant_id, assignee_role, assignee_user, task_type, title,
    #            entity_type, entity_id, process_instance_id, step_name, due_at,
    #            nudge_schedule(json), params(json)
    assert a[2] == "rfp_admin"                       # assignee_role from payload
    assert a[4] == "admin_approval"                  # task_type
    assert a[5] == "Approve pipeline content"        # resolved literal title
    assert a[6] == "content_pipeline"                # entity_type literal
    assert str(a[7]) == "33333333-3333-3333-3333-333333333333"  # entity_id from payload
    assert str(a[8]) == _IID                         # process_instance_id
    assert a[9] == "approve_content"                 # step_name
    assert json.loads(a[11]) == [1, 3, 5]            # nudge_schedule from payload
    # due_at ~ now + 5 days (7200 min)
    assert a[10] > datetime.now(timezone.utc) + timedelta(days=4)
    mgr._emit_event.assert_awaited()  # task.created emitted


async def test_create_task_failure_does_not_raise():
    """A task-write failure must not crash the park (instance already paused)."""
    class _BoomConn:
        async def fetchval(self, q, *a):
            return None
        async def execute(self, q, *a):
            raise RuntimeError("db down")
        async def fetchrow(self, q, *a):
            return None

    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    out = await mgr._create_task(_BoomConn(), _ApprovalFlow.steps[0], _IID, {}, {})
    assert out is None  # swallowed


# ── (c) complete_task closes the task and resumes the instance ──────────────

class _CompleteConn:
    def __init__(self, status="open"):
        self.status = status
        self.updates: list[str] = []

    async def fetchrow(self, q, *a):
        if "SELECT process_instance_id, step_name, status" in q:
            return {
                "process_instance_id": uuid.UUID(_IID),
                "step_name": "approve_content",
                "status": self.status,
            }
        return None

    async def execute(self, q, *a):
        self.updates.append(q)
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        return None


async def test_complete_task_resumes_instance():
    mgr = WorkflowManager(source="pipeline")
    mgr.resume_instance = AsyncMock(return_value=True)
    conn = _CompleteConn(status="open")

    ok = await mgr.complete_task(
        conn, "44444444-4444-4444-4444-444444444444",
        result={"approved": True}, actor="ops@gov", actor_id=None,
    )

    assert ok is True
    assert any("status = 'completed'" in q for q in conn.updates)
    mgr.resume_instance.assert_awaited_once()
    # the human's decision is passed into the resume payload
    _, kw = mgr.resume_instance.await_args
    assert kw["resume_data"]["approved"] is True
    assert kw["reason"] == "task_completed"


async def test_complete_task_noop_when_already_closed():
    mgr = WorkflowManager(source="pipeline")
    mgr.resume_instance = AsyncMock()
    conn = _CompleteConn(status="completed")
    ok = await mgr.complete_task(conn, "44444444-4444-4444-4444-444444444444")
    assert ok is False
    mgr.resume_instance.assert_not_awaited()


# ── (d) nudge sweep fires due nudges once each ──────────────────────────────

class _NudgeConn:
    def __init__(self, rows):
        self._rows = rows
        self.nudge_updates = 0

    async def fetch(self, q, *a):
        if "FROM tasks" in q:
            return self._rows
        return []

    async def execute(self, q, *a):
        if "nudges_sent" in q:
            self.nudge_updates += 1
        return "UPDATE 1"


async def test_nudge_sweep_fires_due_and_is_idempotent():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    now = datetime.now(timezone.utc)
    # due in 2 days; schedule [1,3,5] -> the 3-day and 5-day thresholds are
    # already past (fire), the 1-day is not yet (hold).
    rows = [{
        "id": uuid.uuid4(),
        "tenant_id": None,
        "assignee_role": "rfp_admin",
        "title": "Approve",
        "due_at": now + timedelta(days=2),
        "nudge_schedule": [1, 3, 5],
        "nudges_sent": [],
    }]
    conn = _NudgeConn(rows)

    fired = await mgr._sweep_task_nudges(conn)
    assert fired == 2  # 3-day and 5-day thresholds crossed
    assert mgr._emit_event.await_count == 2


async def test_nudge_sweep_skips_already_sent():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    now = datetime.now(timezone.utc)
    rows = [{
        "id": uuid.uuid4(),
        "tenant_id": None,
        "assignee_role": "rfp_admin",
        "title": "Approve",
        "due_at": now + timedelta(days=2),
        "nudge_schedule": [3, 5],
        "nudges_sent": [3, 5],  # both already fired
    }]
    fired = await mgr._sweep_task_nudges(_NudgeConn(rows))
    assert fired == 0
    mgr._emit_event.assert_not_awaited()
