"""INC-5 — one HITL semantic across both execution paths (gap 5).

The managed engine PARKS at HITL_WAIT (status='paused'); the fire-and-forget
fallback used to SKIP human review and proceed — a dangerous bypass. The
fallback now STOPS at the gate instead. These guards lock both semantics so the
two paths can never diverge back into a silent bypass.

(The fallback only runs when the process_instances table is missing — i.e. an
un-migrated deployment — so a source-level lock is proportionate: the path is not
exercised in a migrated/prod environment, but the bypass must never return.)
"""
import inspect

import workflows.manager as mgr
import workflows.processor as proc


def test_fallback_stops_at_hitl_and_does_not_bypass():
    src = inspect.getsource(proc._run_workflow)
    # the old silent skip-and-proceed must be gone
    assert "dependency_hitl_wait" not in src
    assert "hitl_wait_v1" not in src
    # the fallback must STOP at a human gate and surface it
    assert "HITL_WAIT" in src
    assert "workflow.hitl_unsupported" in src


def test_managed_engine_parks_at_hitl():
    src = inspect.getsource(mgr.WorkflowManager.execute_instance)
    # the real engine sets status='paused' at a HITL_WAIT step
    assert "HITL_WAIT" in src
    assert "paused" in src
