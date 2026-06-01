"""Process Template Catalog (migration 054) — activation + audit over code templates.

The template DEFINITION stays in code (a Workflow subclass discovered at boot);
the process_templates row is its on/off switch + audit (active / inactive_date /
inactivated_by / memo). Revision control lives in filenames. These unit tests
(fake-conn house style, no live Postgres) lock:
  (a) all_registered_workflows() flattens the registry to distinct classes;
  (b) sync_template_catalog upserts one row per template and NEVER overwrites the
      admin-owned active/inactive/memo columns; it skips cleanly if 054 is absent;
  (c) the launch gate refuses to create an instance for an inactive template
      (returns None + emits system:workflow.skipped_inactive, no INSERT);
  (d) the gate FAILS OPEN — a missing row / missing table / query error launches.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from workflows.base import (
    EventTrigger,
    Step,
    StepType,
    Workflow,
    all_registered_workflows,
    register_workflow,
)
from workflows.manager import WorkflowManager


class _CatalogDemo(Workflow):
    description = "catalog demo template"
    trigger = EventTrigger(namespace="library", type="content.requested", phase="single")
    steps = [Step(name="noop", action="x.y.z", step_type=StepType.ACTION)]


@pytest.fixture(autouse=True)
def _register():
    register_workflow(_CatalogDemo)
    yield


# ── (a) registry flattening ─────────────────────────────────────────────────

def test_all_registered_workflows_dedups_by_class():
    names = [c.__name__ for c in all_registered_workflows()]
    assert "_CatalogDemo" in names
    assert len(names) == len(set(names))  # no duplicate classes


# ── (b) sync upserts one row per template, preserving admin-owned fields ─────

class _SyncConn:
    def __init__(self, table_exists: bool = True):
        self.table_exists = table_exists
        self.upserts: list[tuple] = []

    async def fetchval(self, q, *a):
        if "to_regclass" in q:
            return self.table_exists
        return None

    async def execute(self, q, *a):
        if "INSERT INTO process_templates" in q:
            self.upserts.append(a)
        return "INSERT 0 1"


async def test_sync_upserts_each_template_with_trigger_key():
    mgr = WorkflowManager(source="pipeline")
    conn = _SyncConn(table_exists=True)
    n = await mgr.sync_template_catalog(conn)
    assert n >= 1
    rows = {a[0]: a for a in conn.upserts}
    assert "_CatalogDemo" in rows
    # arg order: workflow_name, description, trigger_key, source
    assert rows["_CatalogDemo"][2] == "library:content.requested:single"
    assert rows["_CatalogDemo"][3] == "pipeline"


def test_sync_sql_never_overwrites_activation_fields():
    """Structural guard: the ON CONFLICT clause must refresh only metadata, never
    the admin-owned activation columns — a re-deploy must not silently re-activate
    a template an admin retired."""
    import inspect

    src = inspect.getsource(WorkflowManager.sync_template_catalog)
    assert "ON CONFLICT (workflow_name) DO UPDATE" in src
    for forbidden in ("active =", "inactive_date =", "inactivated_by =", "memo ="):
        assert forbidden not in src, f"sync must not overwrite {forbidden}"


async def test_sync_skips_when_table_absent():
    mgr = WorkflowManager(source="pipeline")
    conn = _SyncConn(table_exists=False)
    n = await mgr.sync_template_catalog(conn)
    assert n == 0
    assert conn.upserts == []


# ── (c)+(d) launch gate ─────────────────────────────────────────────────────

class _GateConn:
    """create_instance reads the gate via fetchrow("SELECT active ...").

    active_value: True/False simulates the catalog row; None = no row;
    "raise" = simulate a missing table / query error.
    """

    def __init__(self, active_value):
        self.active_value = active_value
        self.inserted = False

    async def fetchrow(self, q, *a):
        if "SELECT active FROM process_templates" in q:
            if self.active_value == "raise":
                raise RuntimeError("relation process_templates does not exist")
            if self.active_value is None:
                return None
            return {"active": self.active_value}
        if "INSERT INTO process_instances" in q:
            self.inserted = True
            return {"id": a[0]}  # RETURNING id (non-None => not a duplicate)
        return None

    async def execute(self, q, *a):
        return "INSERT 0 1"

    async def fetchval(self, q, *a):
        return None


async def test_gate_refuses_inactive_template():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    conn = _GateConn(active_value=False)

    out = await mgr.create_instance(conn, "_CatalogDemo", None, {"k": "v"})

    assert out is None
    assert conn.inserted is False                      # no instance row written
    mgr._emit_event.assert_awaited()
    assert "workflow.skipped_inactive" in mgr._emit_event.await_args.args


async def test_gate_launches_active_template():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    mgr._record_transition = AsyncMock()
    conn = _GateConn(active_value=True)

    out = await mgr.create_instance(conn, "_CatalogDemo", None, {"k": "v"})

    assert out is not None
    assert conn.inserted is True


async def test_gate_fails_open_on_missing_row():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    mgr._record_transition = AsyncMock()
    conn = _GateConn(active_value=None)  # template not in catalog yet

    out = await mgr.create_instance(conn, "_CatalogDemo", None, {})

    assert out is not None
    assert conn.inserted is True


async def test_gate_fails_open_on_query_error():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    mgr._record_transition = AsyncMock()
    conn = _GateConn(active_value="raise")  # table missing / query error

    out = await mgr.create_instance(conn, "_CatalogDemo", None, {})

    assert out is not None
    assert conn.inserted is True
