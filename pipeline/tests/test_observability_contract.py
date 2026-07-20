"""#149 — the cross-board "stateless-but-observable" contract, enforced as one test.

Every operation across the platform is observable from the DB with zero in-memory state:
namespaced events (valid namespace, dotted entity.action type), managed execution, and a
durable audit lifecycle. This locks the contract so a future workflow/agent/automation
change can't silently regress it.

  - Every registered workflow trigger uses a VALID namespace + dotted type.
  - No pipeline emit_event uses a FORBIDDEN namespace (admin/cms/spotlight/pipeline).
  - Every emit_event(namespace=, type=) pair in the pipeline uses a valid namespace and a
    dotted (entity.action) type — catches the `proposal:v0_completed` malformed-type class.
  - The audit tables carry a lifecycle (automation_log status widened; agent_task_log
    status/started_at/completed_at/guardrail_decision) so a crashed/in-flight op has a row.
"""
from __future__ import annotations

import os
import pathlib
import re

import pytest

VALID = {"finder", "capture", "identity", "proposal", "library", "system", "tool"}
FORBIDDEN = {"admin", "cms", "spotlight", "pipeline"}

_SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
# emit_event(...namespace="X", type="Y"...) — namespace then type, allowing whitespace/newlines.
_PAIR = re.compile(r'namespace\s*=\s*["\'](\w+)["\']\s*,\s*(?:event_)?type\s*=\s*["\']([\w.]+)["\']')


def _pipeline_py() -> list[pathlib.Path]:
    return [p for p in _SRC.rglob("*.py") if "__pycache__" not in str(p)]


def test_all_workflow_triggers_valid_namespace_and_dotted_type():
    import sys
    sys.path.insert(0, str(_SRC))
    from workflows.base import discover_workflows, all_registered_workflows

    discover_workflows()
    for w in all_registered_workflows():
        ns = w.trigger.namespace
        ty = w.trigger.type
        assert ns in VALID, f"{w.__name__}: trigger namespace '{ns}' not valid"
        assert ns not in FORBIDDEN, f"{w.__name__}: forbidden trigger namespace '{ns}'"
        assert "." in ty, f"{w.__name__}: trigger type '{ty}' is not dotted entity.action form"


def test_no_forbidden_namespace_in_pipeline_emits():
    offenders = []
    for p in _pipeline_py():
        text = p.read_text(encoding="utf-8")
        for ns, ty in _PAIR.findall(text):
            if ns in FORBIDDEN:
                offenders.append(f"{p.name}: namespace='{ns}' type='{ty}'")
    assert not offenders, f"forbidden namespaces in emits: {offenders}"


def test_all_emitted_namespaces_valid_and_types_dotted():
    """Every emit_event(namespace=, type=) literal pair uses a valid namespace + dotted type.
    Catches the proposal:v0_completed malformed-type class the workflow audit found."""
    bad_ns, bad_type = [], []
    for p in _pipeline_py():
        text = p.read_text(encoding="utf-8")
        for ns, ty in _PAIR.findall(text):
            if ns not in VALID:
                bad_ns.append(f"{p.name}: '{ns}'")
            if "." not in ty:
                bad_type.append(f"{p.name}: '{ns}:{ty}'")
    assert not bad_ns, f"invalid emit namespaces: {bad_ns}"
    assert not bad_type, f"malformed (non-dotted) emit types: {bad_type}"


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="requires sandbox DATABASE_URL")
@pytest.mark.asyncio
async def test_audit_tables_have_durable_lifecycle():
    import asyncpg

    conn = await asyncpg.connect(os.getenv("DATABASE_URL"))
    try:
        # automation_log: status vocabulary widened (the P0 fix — 'deferred'/'error'/'running').
        chk = await conn.fetchval(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='automation_log_status_check'")
        for s in ("running", "deferred", "error"):
            assert s in chk, f"automation_log status CHECK missing '{s}'"
        # agent_task_log: the lifecycle columns.
        cols = {r["column_name"] for r in await conn.fetch(
            "SELECT column_name FROM information_schema.columns WHERE table_name='agent_task_log'")}
        for c in ("status", "started_at", "completed_at", "guardrail_decision"):
            assert c in cols, f"agent_task_log missing lifecycle column '{c}'"
    finally:
        await conn.close()
