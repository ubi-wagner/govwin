"""R3.1 — the generic ProjectCollaboration reaction template.

Structural guards (no DB): the ONE generic project/opportunity HITL reaction must
validate, trigger on the launchable single-phase event, and carry a fully
overlay-parameterized human gate (assignee/title/entity/nudges/due all from the
payload, NOT hard-coded) so one static template serves every project gate. Also
guards the create_instance spine-keying logic (opportunity_id + scope from the
overlay, with a bad scope degrading to null) against a fake connection.
"""
from __future__ import annotations

import pytest

from workflows.base import StepType
from workflows.manager import WorkflowManager
from workflows.project_collaboration import ProjectCollaboration


def _step(cls, name):
    return next(s for s in cls.steps if s.name == name)


# ── template shape ──────────────────────────────────────────────────────────

def test_validates():
    # TODO needs task_type + an assignee; depends_on must resolve; etc.
    assert ProjectCollaboration.validate() == []


def test_trigger_is_launchable_single_phase():
    t = ProjectCollaboration.trigger
    assert (t.namespace, t.type, t.phase) == (
        "proposal", "project.collaboration_requested", "single",
    )
    # launchable only when the overlay names something to act on
    assert t.condition({"proposalId": "x"}) is True
    assert t.condition({"opportunityId": "x"}) is True
    assert t.condition({}) is False


def test_collaborate_gate_is_fully_overlay_parameterized():
    s = _step(ProjectCollaboration, "collaborate")
    assert s.step_type == StepType.TODO
    # every gate specific resolves from the payload — nothing hard-coded
    assert s.task_type == "payload.taskType"
    assert s.task_title == "payload.taskTitle"
    assert s.assignee_role == "payload.assigneeRole"
    assert s.assignee_user == "payload.assigneeUser"
    assert s.entity_type == "payload.entityType"
    assert s.entity_ref == "payload.entityRef"
    assert s.nudge_days == "payload.nudgeDays"
    assert s.due_in_minutes == "payload.dueMinutes"


def test_notify_depends_on_the_gate():
    n = _step(ProjectCollaboration, "notify_done")
    assert n.step_type == StepType.NOTIFY
    assert n.depends_on == "collaborate"
    # template selected per-overlay; absent ⇒ system.notify degrades to no-email
    assert n.input_map["template"] == "payload.completeTemplate"


def test_scope_is_not_a_misleading_class_attr():
    # scope is per-launch (overlay-driven), so the template must NOT declare a
    # decorative class default that the engine never reads.
    assert not hasattr(ProjectCollaboration, "scope")


# ── create_instance spine-keying (fake conn) ────────────────────────────────

class _FakeConn:
    """Captures the create_instance INSERT args; template-active + no-conflict."""

    def __init__(self):
        self.insert_args: tuple | None = None

    async def fetchrow(self, query, *args):
        if "SELECT active FROM process_templates" in query:
            return {"active": True}
        if "INSERT INTO process_instances" in query:
            self.insert_args = args
            return {"id": args[0]}  # the generated instance id ⇒ no ON CONFLICT path
        return None

    async def fetchval(self, query, *args):
        return None

    async def execute(self, query, *args):
        return "INSERT 0 1"


def _insert_kwargs(conn: _FakeConn) -> dict:
    """Map the positional INSERT args to names (column order in create_instance)."""
    a = conn.insert_args
    # id, workflow_name, trigger_event_id, payload_json, tenant_id, actor_id,
    # actor_email, source, deadline, opportunity_id, scope
    return {"opportunity_id": a[9], "scope": a[10], "source": a[7]}


async def test_create_instance_keys_the_opportunity_and_scope():
    mgr = WorkflowManager(source="pipeline")
    conn = _FakeConn()
    opp = "33333333-3333-3333-3333-333333333333"
    await mgr.create_instance(
        conn, "ProjectCollaboration", None,
        {"opportunityId": opp, "scope": "project", "taskType": "admin_review"},
        tenant_id=None,
    )
    kw = _insert_kwargs(conn)
    assert str(kw["opportunity_id"]) == opp
    assert kw["scope"] == "project"


async def test_create_instance_rejects_a_bad_scope_to_null():
    mgr = WorkflowManager(source="pipeline")
    conn = _FakeConn()
    await mgr.create_instance(
        conn, "ProjectCollaboration", None,
        {"opportunityId": "44444444-4444-4444-4444-444444444444", "scope": "bogus"},
        tenant_id=None,
    )
    assert _insert_kwargs(conn)["scope"] is None


async def test_create_instance_tolerates_missing_spine_fields():
    mgr = WorkflowManager(source="pipeline")
    conn = _FakeConn()
    # an existing bespoke workflow's payload omits opportunityId/scope entirely
    await mgr.create_instance(conn, "ProjectCollaboration", None, {"foo": "bar"}, tenant_id=None)
    kw = _insert_kwargs(conn)
    assert kw["opportunity_id"] is None and kw["scope"] is None


# ── _create_task literal-fallback guard (P2 fix) ────────────────────────────

class _TaskConn:
    """Captures the `INSERT INTO tasks` positional args from _create_task."""

    def __init__(self):
        self.task_args: tuple | None = None

    async def fetchval(self, query, *args):
        return None  # tenant_id lookup

    async def execute(self, query, *args):
        if "INSERT INTO tasks" in query:
            self.task_args = args
        return "INSERT 0 1"


def _task_fields(conn: _TaskConn) -> dict:
    # id, tenant_id, assignee_role, assignee_user, task_type, title, entity_type, ...
    a = conn.task_args
    return {"assignee_role": a[2], "task_type": a[4], "title": a[5], "entity_type": a[6]}


async def test_create_task_missing_overlay_degrades_to_safe_defaults_not_literal_paths():
    """A launch whose overlay omits the gate fields must NOT write a task typed
    'payload.taskType' / assigned to phantom role 'payload.assigneeRole'."""
    mgr = WorkflowManager(source="pipeline")
    conn = _TaskConn()
    step = _step(ProjectCollaboration, "collaborate")
    iid = "55555555-5555-5555-5555-555555555555"
    await mgr._create_task(conn, step, iid, {}, {})  # empty overlay
    f = _task_fields(conn)
    assert f["task_type"] == "task", f"got {f['task_type']!r}"          # not 'payload.taskType'
    assert f["assignee_role"] is None, f"got {f['assignee_role']!r}"    # not 'payload.assigneeRole'
    assert f["entity_type"] is None, f"got {f['entity_type']!r}"        # not 'payload.entityType'


async def test_create_task_resolves_a_full_overlay():
    mgr = WorkflowManager(source="pipeline")
    conn = _TaskConn()
    step = _step(ProjectCollaboration, "collaborate")
    iid = "66666666-6666-6666-6666-666666666666"
    overlay = {
        "taskType": "admin_review", "taskTitle": "Review & unlock",
        "assigneeRole": "rfp_admin", "entityType": "proposal",
    }
    await mgr._create_task(conn, step, iid, overlay, {})
    f = _task_fields(conn)
    assert f["task_type"] == "admin_review"
    assert f["assignee_role"] == "rfp_admin"
    assert f["title"] == "Review & unlock"
    assert f["entity_type"] == "proposal"
