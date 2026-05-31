"""Force-advance HITL — manual operator override of a paused process.

An authorized operator (rfp_admin now, tenant_admin later) can advance a parked
HITL step as though they were the human the workflow was waiting for. The engine
contract: resume_instance marks the parked step 'completed' + status 'retrying'
(recording WHO), and execute_instance skips completed steps so it continues from
the next step. The frontend lib/process/force-advance.ts mirrors this exact
transition; these tests lock the engine half of that contract.
"""
import inspect
import json
import uuid
from unittest.mock import AsyncMock

import pytest

from workflows.manager import WorkflowManager

_IID = "11111111-1111-1111-1111-111111111111"


class _ResumeConn:
    """Fake conn for resume_instance: returns a paused row, captures the UPDATE."""

    def __init__(self, current_step, step_status, paused=True):
        self._current_step = current_step
        self._step_status = step_status
        self._paused = paused
        self.update_step_status = None

    async def fetchrow(self, q, *a):
        if not self._paused:
            return None
        return {
            "current_step": self._current_step,
            "step_results": {},
            "step_status": self._step_status,
        }

    async def execute(self, q, *a):
        if "status = 'retrying'" in q:
            self.update_step_status = json.loads(a[1])  # $2 = json.dumps(step_status)
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        return None


async def test_force_resume_marks_step_records_actor_and_emits_forced():
    mgr = WorkflowManager(source="pipeline")
    mgr._record_transition = AsyncMock()
    mgr._emit_event = AsyncMock()
    conn = _ResumeConn("wait_for_review", {"wait_for_review": "waiting"})

    ok = await mgr.resume_instance(
        conn, _IID, resume_data={"forcedBy": "ops@gov.example"},
        actor="ops@gov.example", reason="hitl_forced",
    )

    assert ok is True
    # parked step marked completed in the persisted state
    assert conn.update_step_status["wait_for_review"] == "completed"
    # transition recorded the human operator + forced reason
    _, tk = mgr._record_transition.await_args
    assert tk.get("actor") == "ops@gov.example"
    assert tk.get("reason") == "hitl_forced"
    # audit event marks it forced
    ea, _ = mgr._emit_event.await_args
    assert ea[2] == "workflow.resumed"
    assert ea[4]["forced"] is True
    assert ea[4]["actor"] == "ops@gov.example"


async def test_event_driven_resume_is_not_forced():
    mgr = WorkflowManager(source="pipeline")
    mgr._record_transition = AsyncMock()
    mgr._emit_event = AsyncMock()
    conn = _ResumeConn("wait", {"wait": "waiting"})

    ok = await mgr.resume_instance(conn, _IID, resume_data={"resumed_by_event": "e1"})

    assert ok is True
    ea, _ = mgr._emit_event.await_args
    assert ea[4]["forced"] is False  # default reason = hitl_resumed


async def test_resume_noop_when_not_paused():
    mgr = WorkflowManager(source="pipeline")
    mgr._record_transition = AsyncMock()
    mgr._emit_event = AsyncMock()
    conn = _ResumeConn(None, {}, paused=False)

    ok = await mgr.resume_instance(conn, _IID, actor="ops@gov.example", reason="hitl_forced")

    assert ok is False
    mgr._record_transition.assert_not_awaited()
    mgr._emit_event.assert_not_awaited()


def test_execute_instance_skips_completed_steps_contract():
    """The force-advance relies on this: a completed step is skipped on re-drive."""
    src = inspect.getsource(WorkflowManager.execute_instance)
    assert 'step_status.get(step_name) == "completed"' in src
