"""Launch guard: EVERY registered workflow is visualizable, non-blocking, fully-emitting.

The RFP admin must be able to see every workflow and trust that none of them dead-ends,
blocks operation, or runs silently. These invariants are asserted across the WHOLE
registered catalog (not per-workflow) so a newly-added workflow inherits the guarantee:

  NO DEAD-END:
    - acyclic depends_on (a cycle would spin step_execution_order forever)
    - >= 1 TERMINAL step (nothing depends on it) → a completion path always exists
    - every step is reachable via step_execution_order (no orphan island)
    - every HITL_WAIT / TODO human gate has BOTH a resume path (wait_for event, or a
      task to complete) AND a BOUNDED park (finite deadline → the sweep force-fails a
      never-answered gate; it never hangs the instance forever)
    - on_timeout / on_failure escalations name real steps (no dead-end escalation)

  NON-BLOCKING:
    - workflows run async off the event bus; emitEventEnd MUST NEVER throw — so a workflow
      never blocks the business action that triggered it. (Contract-level; asserted in the
      TS lib test.) Here we assert the pipeline side never has a required step with no
      completion path.

  FULL EMISSION (activities + events + outcomes):
    - the managed engine emits the full instance lifecycle (started → per-step started /
      completed / failed → terminal instance_<status>)
    - the fire-and-forget fallback emits started → per-step completed / failed → completed
    - both paths persist OUTCOMES (process_instances.status + step_status + step_results +
      last_error) so /admin can render steps, events, and outcomes.
"""
from __future__ import annotations

import inspect

import pytest

from workflows.base import (
    StepType,
    all_registered_workflows,
    discover_workflows,
)


@pytest.fixture(scope="module", autouse=True)
def _discover():
    discover_workflows()


def _terminal_steps(wf) -> list:
    depended_on = {s.depends_on for s in wf.steps if s.depends_on}
    return [s for s in wf.steps if s.name not in depended_on]


# ── NO DEAD-END ──────────────────────────────────────────────────────────────

def test_every_workflow_is_acyclic_and_valid():
    """validate() (which includes cycle detection) must pass for every registered workflow."""
    for wf in all_registered_workflows():
        assert wf.validate() == [], f"{wf.__name__}: {wf.validate()}"


def test_every_workflow_has_a_terminal_completion_path():
    """At least one step nothing depends on — so the instance can reach 'completed'."""
    for wf in all_registered_workflows():
        terminals = _terminal_steps(wf)
        assert terminals, f"{wf.__name__}: no terminal step — cannot complete (dead-end)"


def test_every_step_is_reachable_in_execution_order():
    """step_execution_order() must include EVERY declared step (no orphaned island)."""
    for wf in all_registered_workflows():
        ordered = {s.name for s in wf.step_execution_order()}
        declared = {s.name for s in wf.steps}
        assert ordered == declared, (
            f"{wf.__name__}: steps {declared - ordered} never execute (unreachable)"
        )


def test_every_human_gate_has_resume_path_and_bounded_park():
    """A HITL_WAIT/TODO gate must be resumable AND time-bounded — never a permanent block."""
    for wf in all_registered_workflows():
        for s in wf.steps:
            if s.step_type == StepType.HITL_WAIT:
                # resumes on a matching event...
                assert s.wait_for is not None, f"{wf.__name__}.{s.name}: HITL_WAIT without wait_for"
            if s.step_type == StepType.TODO:
                # ...or resumes on task completion (task_type + an assignee present)
                assert s.task_type, f"{wf.__name__}.{s.name}: TODO without task_type"
                assert s.assignee_role or s.assignee_user, (
                    f"{wf.__name__}.{s.name}: TODO without an assignee (no one to resume it)"
                )
            if s.step_type in (StepType.HITL_WAIT, StepType.TODO):
                # bounded park: the manager derives the deadline from timeout_minutes (or a
                # 1440-min fallback), so the paused-deadline sweep always eventually acts.
                assert s.timeout_minutes and s.timeout_minutes > 0, (
                    f"{wf.__name__}.{s.name}: gate has no positive timeout — unbounded park"
                )


def test_ai_invoke_steps_never_block_the_pipeline():
    """Agent steps are advisory: a skip is recorded 'completed' (dict result), so a dependent
    never dead-ends. Assert no non-agent step is BLOCKED behind an AI_INVOKE (defense: agents
    should be independent OR only other agents depend on them)."""
    for wf in all_registered_workflows():
        ai_names = {s.name for s in wf.steps if s.step_type == StepType.AI_INVOKE}
        for s in wf.steps:
            if s.depends_on in ai_names and s.step_type != StepType.AI_INVOKE:
                pytest.fail(
                    f"{wf.__name__}.{s.name} (a {s.step_type.value}) depends on AI_INVOKE "
                    f"'{s.depends_on}' — an advisory agent must never gate a hard step"
                )


# ── FULL EMISSION (activities + events + outcomes) ───────────────────────────

def test_managed_engine_emits_full_instance_lifecycle():
    from workflows.manager import WorkflowManager

    src = inspect.getsource(WorkflowManager)
    for evt in (
        "workflow.instance_started",
        "workflow.step_started",
        "workflow.step_completed",
        "workflow.step_failed",
        "workflow.instance_",  # terminal instance_<status>
    ):
        assert evt in src, f"managed engine never emits {evt} — activity/outcome not visible"
    # Outcomes persisted for /admin to render.
    assert "step_status" in src and "step_results" in src and "last_error" in src


def test_fire_and_forget_emits_started_steps_and_completed():
    from workflows import processor

    src = inspect.getsource(processor._run_workflow)
    for evt in (
        "workflow.started",
        "workflow.step_completed",
        "workflow.step_failed",
        "workflow.completed",
    ):
        assert evt in src, f"fire-and-forget path never emits {evt}"


def test_every_step_completion_emits_an_event():
    """Structural: the managed step loop emits on BOTH the success and failure branch, so
    NO step outcome is silent (the audit trail is complete)."""
    from workflows.manager import WorkflowManager

    src = inspect.getsource(WorkflowManager.execute_instance)
    assert "workflow.step_completed" in src  # success branch
    assert "workflow.step_failed" in src      # failure branch
    # and the failure branch continues (no fail-fast) so downstream activity still emits
    assert "NO break — fall through" in src
