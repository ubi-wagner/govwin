"""CMS content vertical (keystone proof) — OnCmsContentRequested + its actions.

Proves the smallest real content chain the keystone targets:
  launch-with-overlay -> draft (pending cms_content) -> review ToDo (ledger task)
  -> publish (row goes live) -> notify.

Unit tests in the house fake-conn style (no live Postgres). They lock:
  (a) the template is valid and wired draft -> review(TODO) -> publish -> notify;
  (b) draft_content writes a PENDING row from the overlay (off-list content_type
      falls back safely) and returns contentId + slug for downstream steps;
  (c) the review ToDo writes a content_publish task for rfp_admin against the
      drafted content id, with the overlay's nudge cadence;
  (d) publish_content flips a pending row live and emits library:content.published;
      a missing/already-published row is a no-op, not an error.
"""
from __future__ import annotations

import uuid

import pytest
from unittest.mock import AsyncMock

from workflows.base import StepType
from workflows.manager import WorkflowManager
from workflows.on_cms_content_requested import OnCmsContentRequested
from workflows.actions import cms_content


_CID = "c0000000-0000-0000-0000-000000000001"


# ── (a) template validity + topology ────────────────────────────────────────

def test_workflow_validates():
    assert OnCmsContentRequested.validate() == []


def test_chain_topology_draft_review_publish_notify():
    by_name = {s.name: s for s in OnCmsContentRequested.steps}
    assert set(by_name) == {"draft_content", "review", "publish_content", "notify_author"}
    assert by_name["draft_content"].step_type == StepType.ACTION
    assert by_name["review"].step_type == StepType.TODO
    assert by_name["publish_content"].step_type == StepType.ACTION
    assert by_name["notify_author"].step_type == StepType.NOTIFY
    # ordering via depends_on: draft -> review -> publish -> notify
    assert by_name["review"].depends_on == "draft_content"
    assert by_name["publish_content"].depends_on == "review"
    assert by_name["notify_author"].depends_on == "publish_content"
    # the review gate carries the drafted content id and a fixed rfp_admin reviewer
    assert by_name["review"].entity_ref == "step.draft_content.result.contentId"
    assert by_name["review"].assignee_role == '"rfp_admin"'


def test_trigger_requires_a_title():
    trig = OnCmsContentRequested.trigger
    assert trig.matches({"namespace": "library", "type": "content.requested",
                         "phase": "single", "payload": {"title": "Hi"}})
    assert not trig.matches({"namespace": "library", "type": "content.requested",
                             "phase": "single", "payload": {}})


# ── (b) draft_content writes a PENDING row ──────────────────────────────────

class _DraftConn:
    def __init__(self):
        self.insert_sql = None
        self.insert_args = None

    async def fetchrow(self, q, *a):
        if "INSERT INTO cms_content" in q:
            self.insert_sql = q
            self.insert_args = a
            return {"id": _CID}
        return None

    async def execute(self, q, *a):
        return "INSERT 0 1"


async def test_draft_content_inserts_pending_row(monkeypatch):
    monkeypatch.setattr(cms_content, "emit_event", AsyncMock())
    conn = _DraftConn()
    out = await cms_content.draft_content(
        conn, title="Why SBIR", brief="An intro to SBIR.",
        content_type="blog_post", slug="why-sbir", tags=["sbir", "intro"],
    )
    assert out["contentId"] == _CID
    assert out["slug"] == "why-sbir"
    assert out["status"] == "pending"
    # row is written PENDING + not published (locked in the SQL, not after the fact)
    assert "'pending'" in conn.insert_sql
    assert "false" in conn.insert_sql
    # arg order: id, slug, title, content_type, body, excerpt, author, tags, created_by
    a = conn.insert_args
    assert a[1] == "why-sbir"
    assert a[2] == "Why SBIR"
    assert a[3] == "blog_post"
    assert a[4] == "An intro to SBIR."
    assert a[7] == ["sbir", "intro"]


async def test_draft_content_falls_back_on_offlist_type(monkeypatch):
    monkeypatch.setattr(cms_content, "emit_event", AsyncMock())
    conn = _DraftConn()
    out = await cms_content.draft_content(
        conn, title="X", content_type="totally_invalid", slug="x",
    )
    assert out["contentType"] == "blog_post"          # safe default
    assert conn.insert_args[3] == "blog_post"


async def test_draft_content_slugifies_when_slug_omitted(monkeypatch):
    monkeypatch.setattr(cms_content, "emit_event", AsyncMock())
    conn = _DraftConn()
    out = await cms_content.draft_content(conn, title="Hello, World!")
    assert out["slug"] == "hello-world"


# ── (c) review ToDo writes a content_publish task for the drafted content ────

class _TaskConn:
    def __init__(self):
        self.task_insert_args = None

    async def fetchval(self, q, *a):
        if "SELECT tenant_id FROM process_instances" in q:
            return None  # admin/system task (tenant_id NULL)
        return None

    async def execute(self, q, *a):
        if "INSERT INTO tasks" in q:
            self.task_insert_args = a
        return "INSERT 0 1"

    async def fetchrow(self, q, *a):
        return None


async def test_review_todo_writes_content_publish_task():
    mgr = WorkflowManager(source="pipeline")
    mgr._emit_event = AsyncMock()
    conn = _TaskConn()
    review_step = next(s for s in OnCmsContentRequested.steps if s.name == "review")
    # draft_content already ran: its result carries the content id the gate acts on
    step_results = {"draft_content": {"result": {"contentId": _CID, "slug": "why-sbir"}}}
    overlay = {"nudgeDays": [1, 3], "reviewDueMinutes": 4320, "title": "Why SBIR"}

    task_id = await mgr._create_task(conn, review_step, _CID, overlay, step_results)

    assert task_id is not None
    a = conn.task_insert_args
    # arg order: id, tenant_id, assignee_role, assignee_user, task_type, title,
    #            entity_type, entity_id, process_instance_id, step_name, due_at,
    #            nudge_schedule(json), params(json)
    assert a[2] == "rfp_admin"                  # fixed reviewer role
    assert a[4] == "content_publish"            # task_type
    assert a[6] == "cms_content"                # entity_type
    assert str(a[7]) == _CID                    # entity_id = the drafted content id
    assert a[9] == "review"                     # step_name
    import json
    assert json.loads(a[11]) == [1, 3]          # nudge cadence from the overlay


# ── (d) publish_content publishes a pending row + emits the event ───────────

class _PublishConn:
    def __init__(self, found=True):
        self.found = found
        self.update_sql = None

    async def fetchrow(self, q, *a):
        if "UPDATE cms_content" in q:
            self.update_sql = q
            return {"id": _CID, "slug": "why-sbir"} if self.found else None
        return None

    async def execute(self, q, *a):
        return "UPDATE 1"


async def test_publish_content_publishes_and_emits(monkeypatch):
    emit = AsyncMock()
    monkeypatch.setattr(cms_content, "emit_event", emit)
    conn = _PublishConn(found=True)
    out = await cms_content.publish_content(conn, content_id=_CID, slug="why-sbir")
    assert out["published"] is True
    assert out["slug"] == "why-sbir"
    # the UPDATE only touches still-pending/draft rows and flips them live
    assert "status = 'published'" in conn.update_sql
    assert "status IN ('pending', 'draft')" in conn.update_sql
    emit.assert_awaited()
    assert "content.published" in emit.await_args.kwargs.get("type", "")


async def test_publish_content_noop_when_not_pending(monkeypatch):
    monkeypatch.setattr(cms_content, "emit_event", AsyncMock())
    conn = _PublishConn(found=False)  # already published or missing
    out = await cms_content.publish_content(conn, content_id=_CID)
    assert out["published"] is False
    assert out["reason"] == "not_pending_or_missing"


async def test_publish_content_rejects_bad_id(monkeypatch):
    monkeypatch.setattr(cms_content, "emit_event", AsyncMock())
    conn = _PublishConn()
    out = await cms_content.publish_content(conn, content_id="not-a-uuid")
    assert out["published"] is False
    assert out["reason"] == "bad_content_id"
