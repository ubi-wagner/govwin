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


async def test_complete_task_forwards_attribution_for_1n_reconcile():
    """Eric completes the gate → resume must carry Eric's id (completed_by) and
    skip Eric's own row (skip_task_id) so it only closes the SIBLINGS (Bob's)."""
    mgr = WorkflowManager(source="pipeline")
    mgr.resume_instance = AsyncMock(return_value=True)
    conn = _CompleteConn(status="open")
    eric = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    task_id = "44444444-4444-4444-4444-444444444444"

    await mgr.complete_task(conn, task_id, result={"approved": True},
                            actor="eric@gov", actor_id=eric)

    _, kw = mgr.resume_instance.await_args
    assert kw["completed_by"] == eric        # siblings attributed to Eric
    assert kw["skip_task_id"] == task_id      # Eric's own row protected


# ── 1:N sibling reconcile (Eric AND Bob both have the ToDo) ──────────────────

class _ResumeReconcileConn:
    """Paused instance + captures the sibling-reconcile UPDATE."""

    def __init__(self):
        self.reconcile_sql = None
        self.reconcile_args = None

    async def fetchrow(self, q, *a):
        if "current_step, step_results, step_status" in q:
            return {"current_step": "approve", "step_results": {}, "step_status": {}}
        return None

    async def execute(self, q, *a):
        if "UPDATE tasks" in q:
            self.reconcile_sql = q
            self.reconcile_args = a
        return "UPDATE 1"

    async def fetchval(self, q, *a):
        return None


async def test_resume_completes_siblings_attributed_not_cancelled():
    mgr = WorkflowManager(source="pipeline")
    mgr._record_transition = AsyncMock()
    mgr._emit_event = AsyncMock()
    conn = _ResumeReconcileConn()
    eric = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    iid = "11111111-1111-1111-1111-111111111111"
    own = "44444444-4444-4444-4444-444444444444"

    ok = await mgr.resume_instance(
        conn, iid, resume_data={"approved": True},
        actor="eric@gov", reason="task_completed",
        completed_by=eric, skip_task_id=own,
    )
    assert ok is True
    # siblings COMPLETED (work was done, by someone else) — never 'cancelled'
    assert "status = 'completed'" in conn.reconcile_sql
    assert "cancelled" not in conn.reconcile_sql
    assert "COALESCE($2" in conn.reconcile_sql      # attribute to completer
    assert "id <> $3" in conn.reconcile_sql          # but skip the actor's own row
    # args: $1 instance, $2 completed_by=Eric, $3 skip=Eric's row
    assert str(conn.reconcile_args[1]) == eric
    assert str(conn.reconcile_args[2]) == own


async def test_event_resume_completes_all_siblings_no_skip():
    """A wait_for-event resume (no completing actor) still closes every open
    sibling ToDo for the instance — none orphaned. completed_by is NULL."""
    mgr = WorkflowManager(source="pipeline")
    mgr._record_transition = AsyncMock()
    mgr._emit_event = AsyncMock()
    conn = _ResumeReconcileConn()

    ok = await mgr.resume_instance(
        conn, "11111111-1111-1111-1111-111111111111",
        resume_data={"resumed_by_event": "e1"},
    )
    assert ok is True
    assert "status = 'completed'" in conn.reconcile_sql
    assert conn.reconcile_args[1] is None   # no completer -> COALESCE keeps existing
    assert conn.reconcile_args[2] is None   # no skip -> closes ALL siblings


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
    # Count the IN-APP nudge events specifically — this row is a role-bucket admin task,
    # so depending on PORTAL_BASE_URL the sweep may ALSO emit notification.requested emails
    # (asserted separately below); the in-app count is the invariant here.
    nudge_events = [c for c in mgr._emit_event.await_args_list if c.args[2] == "task.nudge"]
    assert len(nudge_events) == 2


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


# ── (d2) role-bucket ADMIN nudge → EMAIL to the RFP-pipeline admin distro ─────
# The 72h curation SLA ToDo is a role-bucket task (assignee_role='rfp_admin', no
# single assignee_user_id). Its nudges must still reach the admins by EMAIL, not
# just in-app: the sweep emits notification.requested with to_role, which the CMS
# resolves to ADMIN_NOTIFICATION_EMAIL (docs/GMAIL_SETUP.md). These lock that the
# admin-cohort email fires for admin roles, and ONLY for admin roles.

def _role_bucket_task(now, role, *, hours_out=48):
    return {
        "id": uuid.uuid4(),
        "tenant_id": uuid.uuid4(),
        "assignee_role": role,
        "assignee_user_id": None,          # role bucket — no single recipient
        "title": "Curate the purchased portal",
        "due_at": now + timedelta(hours=hours_out),
        "nudge_schedule": [2, 1],
        "nudges_sent": [],
        "entity_type": None,
        "entity_id": None,
    }


def _notif_ctxs(mgr):
    return [c.args[4] for c in mgr._emit_event.await_args_list
            if c.args[2] == "notification.requested"]


@pytest.mark.parametrize("role", ["rfp_admin", "master_admin"])
async def test_admin_role_bucket_nudge_emails_admin_cohort(monkeypatch, role):
    monkeypatch.setenv("PORTAL_BASE_URL", "http://localhost:3000")
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    await mgr._emit_task_nudge_email(
        object(), _role_bucket_task(datetime.now(timezone.utc), role), 1, False
    )
    ctxs = _notif_ctxs(mgr)
    assert len(ctxs) == 1                      # exactly one admin-cohort email
    assert ctxs[0]["to_role"] == role          # resolved by role, not a single user
    assert ctxs[0]["template"] == "task_nudge"
    assert ctxs[0]["channel"] == "email"
    assert "user_id" not in ctxs[0]            # NOT a per-user send
    assert "/go?task=" in ctxs[0]["login_url"]


async def test_non_admin_role_bucket_nudge_stays_in_app(monkeypatch):
    # A tenant role-bucket task (no single user, non-admin role) must NOT email the
    # admin distro — its in-app nudge suffices (unchanged legacy behavior).
    monkeypatch.setenv("PORTAL_BASE_URL", "http://localhost:3000")
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    await mgr._emit_task_nudge_email(
        object(), _role_bucket_task(datetime.now(timezone.utc), "tenant_admin"), 1, False
    )
    mgr._emit_event.assert_not_awaited()


async def test_admin_role_bucket_nudge_skips_email_without_base(monkeypatch):
    # No PORTAL_BASE_URL/NEXTAUTH_URL → a relative CTA is a dead link, so skip the
    # EMAIL (the in-app nudge already fired in the sweep). No crash, no emit.
    monkeypatch.delenv("PORTAL_BASE_URL", raising=False)
    monkeypatch.delenv("NEXTAUTH_URL", raising=False)
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    await mgr._emit_task_nudge_email(
        object(), _role_bucket_task(datetime.now(timezone.utc), "rfp_admin"), 1, False
    )
    mgr._emit_event.assert_not_awaited()


async def test_sweep_curation_task_fires_inapp_and_admin_email(monkeypatch):
    # End-to-end through the real sweep: a 48h-out curation ToDo with schedule [2,1]
    # crosses only the 2-day threshold → exactly ONE in-app nudge AND ONE admin email.
    monkeypatch.setenv("PORTAL_BASE_URL", "http://localhost:3000")
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    rows = [_role_bucket_task(datetime.now(timezone.utc), "rfp_admin", hours_out=48)]
    fired = await mgr._sweep_task_nudges(_NudgeConn(rows))
    assert fired == 1
    types = [c.args[2] for c in mgr._emit_event.await_args_list]
    assert types.count("task.nudge") == 1              # in-app push
    assert types.count("notification.requested") == 1  # admin EMAIL push
    assert _notif_ctxs(mgr)[0]["to_role"] == "rfp_admin"


# ── (e) FINAL nudge escalates to the portal's DELEGATED managers ─────────────

def _portal_task(now):
    """A user-assigned portal ToDo whose single nudge threshold is already past,
    so the sweep fires it as the FINAL nudge (is_final)."""
    return {
        "id": uuid.uuid4(),
        "tenant_id": uuid.uuid4(),
        "assignee_role": None,
        "assignee_user_id": uuid.uuid4(),   # user-assigned → the EMAIL path runs
        "title": "Draft every section",
        "due_at": now + timedelta(hours=12),  # 0.5d out
        "nudge_schedule": [1],                # 1d-before threshold already past → is_final
        "nudges_sent": [],
        "entity_type": "portal",
        "entity_id": uuid.uuid4(),
    }


def _manager_emails(calls):
    """user_ids of the task_nudge_manager (final-notice) escalation emails."""
    return [
        c.args[4]["user_id"]
        for c in calls
        if c.args[2] == "notification.requested" and c.args[4].get("template") == "task_nudge_manager"
    ]


async def test_final_nudge_notifies_admin_default_plus_delegated_managers(monkeypatch):
    monkeypatch.setenv("PORTAL_BASE_URL", "http://localhost:3000")
    admin_id, m1, m2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    task = _portal_task(datetime.now(timezone.utc))
    cfg = {"collaborators": [
        {"email": "expert@rfppipeline.com", "role": "manager"},   # our cross-tenant expert
        {"email": "boss@acme.test", "role": "manager"},
        {"email": "helper@acme.test", "role": "collaborator"},    # NOT a manager → excluded
    ]}

    class _Conn:
        async def fetch(self, q, *a):
            if "FROM tasks" in q:
                return [task]
            if "FROM users" in q:  # resolve managers by email
                return [{"id": m1}, {"id": m2}]
            return []
        async def fetchrow(self, q, *a):
            if "guardrail_config FROM proposal_portals" in q:
                return {"guardrail_config": cfg}
            if "role = 'tenant_admin'" in q:
                return {"id": admin_id}   # the default recipient
            return None
        async def execute(self, q, *a):
            return "UPDATE 1"

    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    fired = await mgr._sweep_task_nudges(_Conn())

    assert fired == 1
    # Admin is the default on every portal; the two delegated managers are added on top.
    assert set(_manager_emails(mgr._emit_event.await_args_list)) == {str(admin_id), str(m1), str(m2)}


async def test_final_nudge_is_admin_only_when_no_managers(monkeypatch):
    monkeypatch.setenv("PORTAL_BASE_URL", "http://localhost:3000")
    admin_id = uuid.uuid4()
    task = _portal_task(datetime.now(timezone.utc))

    class _Conn:
        async def fetch(self, q, *a):
            return [task] if "FROM tasks" in q else []
        async def fetchrow(self, q, *a):
            if "guardrail_config FROM proposal_portals" in q:
                return {"guardrail_config": {"collaborators": []}}   # no delegates
            if "role = 'tenant_admin'" in q:
                return {"id": admin_id}
            return None
        async def execute(self, q, *a):
            return "UPDATE 1"

    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    fired = await mgr._sweep_task_nudges(_Conn())

    assert fired == 1
    assert _manager_emails(mgr._emit_event.await_args_list) == [str(admin_id)]
