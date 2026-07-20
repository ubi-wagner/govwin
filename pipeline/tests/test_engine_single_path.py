"""Single execution path — "No fire-and-forget ever" (escalation of INC-5 gap 5).

The managed engine (process_instances + process_instance_transitions) is the ONLY
way a workflow executes. The old fire-and-forget fallback — which ran steps with no
instance record, no transition audit, and no recoverability when process_instances was
absent — has been REMOVED. When the engine is unavailable the processor now REFUSES to
run and emits an AUDITED signal instead of executing un-audited work.

Everything is audit- and process-driven, even failures and timeouts: step_failed events
+ last_error persist failures; the paused-deadline sweep audits timeouts
(workflow.wait_timed_out); and a missing engine is itself audited
(workflow.engine_unavailable / workflow.execution_refused). These guards lock that the
un-audited path can never return.
"""
import inspect

import workflows.manager as mgr
import workflows.processor as proc


def test_no_fire_and_forget_executor_exists():
    """The un-audited executor and its retry helper must be GONE from the module."""
    assert not hasattr(proc, "_run_workflow"), "_run_workflow (fire-and-forget) must be removed"
    assert not hasattr(proc, "_execute_step_with_retry"), (
        "_execute_step_with_retry (fire-and-forget only) must be removed"
    )


def test_processor_refuses_and_audits_when_engine_unavailable():
    """With no managed engine, the poll loop must emit an AUDITED refusal, never execute."""
    src = inspect.getsource(proc.run_workflow_processor)
    # boot: a missing process_instances is loud + audited, not a silent degrade
    assert "workflow.engine_unavailable" in src
    # poll: each triggering event that can't be run is audited as refused
    assert "workflow.execution_refused" in src
    assert "managed_engine_unavailable" in src
    # and there is no call to the deleted fire-and-forget executor
    assert "_run_workflow(" not in src


def test_managed_engine_is_the_only_executor_and_parks_at_hitl():
    src = inspect.getsource(mgr.WorkflowManager.execute_instance)
    # the real engine parks at a HITL_WAIT/TODO gate (status='paused')
    assert "HITL_WAIT" in src
    assert "paused" in src


def test_managed_engine_audits_failures_and_timeouts():
    """Failures and timeouts are recorded, not swallowed — everything is process-driven."""
    src = inspect.getsource(mgr.WorkflowManager)
    assert "workflow.step_failed" in src        # failures audited
    assert "last_error" in src                    # + persisted on the instance
    assert "workflow.wait_timed_out" in src       # parked-gate timeouts audited by the sweep


def test_never_an_action_without_an_outcome():
    """Every step terminates in a recorded outcome, and every instance in a terminal status —
    including ACCEPTED failures (status='failed' recorded, workflow still continues) and
    FORCED advancements. No action is left without an outcome."""
    src = inspect.getsource(mgr.WorkflowManager.execute_instance)
    # the four terminal per-step outcomes are all written to step_status
    for outcome in ('"completed"', '"failed"', '"skipped"', '"waiting"'):
        assert f"step_status[step_name] = {outcome}" in src, f"step outcome {outcome} never recorded"
    # every step's status is persisted (no silent step)
    assert "_persist_step_status" in src
    # the instance ALWAYS writes a terminal status at the end (completed/failed/cancelled)
    assert "SET status = $2, completed_at = now()" in src


def test_forced_advancement_records_an_outcome():
    """A forced advancement (admin resolves a parked gate) is itself an audited outcome:
    the core resumes the instance (status='retrying') AND emits process.force_advanced.

    Guards the frontend shared core so the 'no action without an outcome' rule holds on the
    human-override path too. Skipped if the frontend tree isn't checked out alongside."""
    import os

    here = os.path.dirname(__file__)
    fa = os.path.abspath(os.path.join(here, "..", "..", "frontend", "lib", "process", "force-advance.ts"))
    if not os.path.exists(fa):
        import pytest

        pytest.skip("frontend/lib/process/force-advance.ts not present")
    body = open(fa, encoding="utf-8").read()
    assert "status = 'retrying'" in body        # the parked instance resumes (outcome)
    assert "process.force_advanced" in body       # and the override is audited
