"""INC-6 — on_timeout / on_failure are live bindings (EVENT_CONTRACT_V3 gap 6).

These fields were declared on steps but read nowhere: a dead-end. Now:
  - validate() rejects an on_timeout/on_failure that names a non-existent step;
  - the park-deadline sweep runs a parked step's on_timeout (via _run_on_timeout)
    before failing, emitting workflow.escalation_ran;
  - the real templates no longer carry dangling escalation refs.
"""
from __future__ import annotations

import importlib
from unittest.mock import AsyncMock

import pytest

from workflows.base import EventTrigger, Step, StepType, Workflow, register_workflow
from workflows.manager import WorkflowManager


class _WfDangling(Workflow):
    description = "dangling on_timeout"
    trigger = EventTrigger(namespace="t", type="t.x", phase="single")
    steps = [Step(name="a", action="x", step_type=StepType.ACTION, on_timeout="ghost")]


class _WfValid(Workflow):
    description = "resolving on_timeout"
    trigger = EventTrigger(namespace="t", type="t.y", phase="single")
    steps = [
        Step(
            name="wait", action="hitl_wait", step_type=StepType.HITL_WAIT,
            wait_for=EventTrigger(namespace="t", type="t.done", phase="single"),
            on_timeout="renotify", timeout_minutes=60,
        ),
        Step(name="renotify", action="system.notify", step_type=StepType.NOTIFY),
    ]


# ── validation ──────────────────────────────────────────────────────────────

def test_validate_rejects_dangling_on_timeout():
    errors = _WfDangling.validate()
    assert any("on_timeout" in e and "ghost" in e for e in errors), errors


def test_validate_accepts_resolving_on_timeout():
    assert _WfValid.validate() == []


# ── execution ───────────────────────────────────────────────────────────────

async def test_run_on_timeout_executes_target_and_emits():
    register_workflow(_WfValid)
    mgr = WorkflowManager(source="pipeline")
    mgr._execute_step = AsyncMock(return_value={"ok": True})
    mgr._emit_event = AsyncMock()

    ran = await mgr._run_on_timeout(object(), "_WfValid", "wait", {"p": 1}, None, "iid-1")

    assert ran == "renotify"
    assert mgr._execute_step.await_count == 1
    assert mgr._execute_step.await_args.args[1].name == "renotify"
    assert mgr._emit_event.await_count == 1
    assert mgr._emit_event.await_args.args[2] == "workflow.escalation_ran"


async def test_run_on_timeout_noop_without_on_timeout():
    register_workflow(_WfValid)
    mgr = WorkflowManager(source="pipeline")
    mgr._execute_step = AsyncMock()
    mgr._emit_event = AsyncMock()

    # the 'renotify' step itself declares no on_timeout
    ran = await mgr._run_on_timeout(object(), "_WfValid", "renotify", {}, None, "iid")

    assert ran is None
    assert mgr._execute_step.await_count == 0


async def test_run_on_timeout_swallows_execution_errors():
    register_workflow(_WfValid)
    mgr = WorkflowManager(source="pipeline")
    mgr._execute_step = AsyncMock(side_effect=RuntimeError("boom"))
    mgr._emit_event = AsyncMock()

    # must not raise — the sweep still needs to fail the instance cleanly
    ran = await mgr._run_on_timeout(object(), "_WfValid", "wait", {}, None, "iid")
    assert ran is None


# ── real templates carry no dangling escalation ─────────────────────────────

@pytest.mark.parametrize("modname,clsname", [
    ("workflows.on_source_change_detected", "OnSourceChangeDetected"),
    ("workflows.on_proposal_advanced", "OnProposalAdvancedToReview"),
    ("workflows.on_application_accepted", "OnApplicationAccepted"),
])
def test_real_templates_have_no_dangling_escalation(modname, clsname):
    try:
        mod = importlib.import_module(modname)
    except Exception as e:  # heavy action deps may be absent in the sandbox
        pytest.skip(f"cannot import {modname}: {e}")
    cls = getattr(mod, clsname)
    bad = [e for e in cls.validate() if "on_timeout" in e or "on_failure" in e]
    assert bad == [], bad
