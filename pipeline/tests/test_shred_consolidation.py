"""INC-7 — SHRED consolidated to one canonical Job (EVENT_CONTRACT_V3 gap 7).

There were three shred code paths: the canonical workflow Job
(workflows/actions/shred.py), the dispatcher job path
(ingest/dispatcher.py -> shredder.runner.shred_solicitation), and a DEAD
RfpShredderWorker (workers/rfp_shredder.py) with zero callers. The dead wrapper
is removed; these tests lock that consolidation:
  - the canonical Job is importable and exposes shred + extract_compliance;
  - the dead wrapper module is gone;
  - the canonical Job's event surface (finder:shred.executed) is unchanged.
"""
import importlib
import inspect

import pytest


def test_canonical_shred_job_is_importable():
    mod = importlib.import_module("workflows.actions.shred")
    assert hasattr(mod, "shred")
    assert hasattr(mod, "extract_compliance")


def test_dead_rfp_shredder_worker_is_removed():
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("workers.rfp_shredder")


def test_canonical_shred_event_surface_unchanged():
    """Removing the dead wrapper must not change the live event surface."""
    src = inspect.getsource(importlib.import_module("workflows.actions.shred"))
    assert 'type="shred.executed"' in src
    assert 'namespace="finder"' in src
