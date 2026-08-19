"""
Ingest Studio phase-advance ACTION — the chain semantics (docs/INGEST_STUDIO_DESIGN.md).

Pure-logic tests over workflows/actions/ingest_actions.py with a fake conn + patched emitter.
These lock the two properties the whole gated design hangs on:

  1. The AUTO chain hops extract → matrix → review and each hop RE-EMITS the trigger with the
     lenses + resolution intact, so the colour team downstream is never dispatched unarmed.
  2. The review phase has NO auto successor — auto or manual, it stops AT the land gate. The
     land is the one write an automation policy may never take past a blocker, so the chain
     must structurally be unable to reach it.
"""
import asyncio
import json
import sys
import types
import uuid

import pytest

sys.path.insert(0, "src")

from workflows.actions import ingest_actions  # noqa: E402


class FakeConn:
    """Captures execute/fetchrow calls; returns a canned row for the draft update."""

    def __init__(self, draft_row=None):
        self.executed: list[tuple[str, tuple]] = []
        self.draft_row = draft_row

    async def execute(self, q, *args):
        self.executed.append((" ".join(q.split()), args))
        return "UPDATE 1"

    async def fetchrow(self, q, *args):
        self.executed.append((" ".join(q.split()), args))
        return self.draft_row


@pytest.fixture()
def emitted(monkeypatch):
    """Patch the events module's emit_event (imported lazily inside the action)."""
    calls: list[dict] = []

    async def fake_emit(conn, **kw):
        calls.append(kw)
        return f"evt-{len(calls)}"

    mod = types.ModuleType("events")
    mod.emit_event = fake_emit
    monkeypatch.setitem(sys.modules, "events", mod)
    return calls


SOL = str(uuid.uuid4())


def _run(coro):
    """Run one coroutine to completion on a fresh loop.

    NOT `asyncio.get_event_loop().run_until_complete(...)`. On Python 3.10/3.11 that call
    auto-created a loop when none was set (with a DeprecationWarning); on 3.12 it raises
    `RuntimeError: There is no current event loop in thread 'MainThread'`. The suite passed
    locally on 3.11 and failed every case in this file on CI's 3.12 — a version split, not a
    behaviour change in the code under test. `asyncio.run` is the supported spelling and owns
    the loop lifecycle, so each test also gets a clean one.
    """
    return asyncio.run(coro)


def test_auto_chain_extract_to_matrix_reemits_with_lenses(emitted):
    conn = FakeConn()
    out = _run(ingest_actions.advance_ingest_phase(
        conn, solicitation_id=SOL, phase="extract", auto=True, draft_id="d1",
    ))
    assert out == {"advanced": True, "next": "matrix", "auto": True}
    # completed audit + the next-phase trigger as a START/END PAIR (full patterning: the END is
    # what the processor matches; the START gives the ledger something to pair it to).
    types_emitted = [c["type"] for c in emitted]
    assert types_emitted == ["ingest.phase_completed", "ingest.phase_requested", "ingest.phase_requested"]
    assert [c["phase"] for c in emitted] == ["single", "start", "end"]
    nxt = emitted[2]
    # the END is parented to the START it pairs with (the fake returns "evt-<n>"; the start
    # was the second emission)
    assert nxt["parent_event_id"] == "evt-2"
    assert nxt["payload"]["phase"] == "matrix"
    assert nxt["payload"]["auto"] is True
    # the colour-team armament survives every hop
    assert nxt["payload"]["lens_0"] == "citation"
    assert nxt["payload"]["lens_2"] == "consistency"
    assert nxt["payload"]["resolution"] == "majority"
    # the phase state advanced
    assert any("SET ingest_phase = $1" in q for q, _ in conn.executed)


def test_auto_chain_matrix_to_review(emitted):
    out = _run(ingest_actions.advance_ingest_phase(
        FakeConn(), solicitation_id=SOL, phase="matrix", auto=True,
    ))
    assert out["next"] == "review"
    assert emitted[2]["payload"]["phase"] == "review"


@pytest.mark.parametrize("auto", [True, False])
def test_review_always_stops_at_the_land_gate(emitted, auto):
    """Auto may never chain past review: the next act is LANDING, and landing is gated."""
    conn = FakeConn()
    out = _run(ingest_actions.advance_ingest_phase(
        conn, solicitation_id=SOL, phase="review", auto=auto,
    ))
    assert out == {"advanced": True, "status": "awaiting_land", "phase": "review"}
    # ONLY the completed audit — no next-phase trigger exists to emit
    assert [c["type"] for c in emitted] == ["ingest.phase_completed"]
    # and the state pins at review so the panel shows the gate
    assert any("ingest_phase = 'review'" in q for q, _ in conn.executed)


def test_molds_auto_completes(emitted):
    out = _run(ingest_actions.advance_ingest_phase(
        FakeConn(), solicitation_id=SOL, phase="molds", auto=True,
    ))
    assert out["next"] == "complete"
    assert emitted[2]["payload"]["phase"] == "complete"


def test_manual_holds_the_gate_without_reemitting(emitted):
    out = _run(ingest_actions.advance_ingest_phase(
        FakeConn(), solicitation_id=SOL, phase="matrix", auto=False,
    ))
    assert out == {"advanced": True, "status": "awaiting_review", "phase": "matrix"}
    assert [c["type"] for c in emitted] == ["ingest.phase_completed"]


@pytest.mark.parametrize("bad", [
    {"solicitation_id": None, "phase": "matrix"},
    {"solicitation_id": SOL, "phase": "landed"},      # not a runnable phase
    {"solicitation_id": SOL, "phase": "bogus"},
    {"solicitation_id": "not-a-uuid", "phase": "matrix"},
])
def test_bad_input_is_a_safe_noop(emitted, bad):
    """A malformed advance must never dead-end the workflow — it reports and returns."""
    out = _run(ingest_actions.advance_ingest_phase(FakeConn(), **bad))
    assert out["advanced"] is False


def test_record_review_marks_the_open_draft_when_the_colour_team_RAN(emitted):
    """The happy path — and it now requires evidence (B17).

    `_ai_step_status` is the engine's own record of what this instance's AI_INVOKE steps did. One
    completed reviewer is evidence, and only then is the draft marked reviewed.
    """
    conn = FakeConn(draft_row={"id": uuid.uuid4(), "status": "reviewed"})
    out = _run(ingest_actions.record_ingest_review(
        conn, solicitation_id=SOL, resolution="majority",
        _ai_step_status={"refute_0": "completed", "refute_1": "skipped", "reconcile": "completed"},
    ))
    assert out["recorded"] is True
    assert out["cohort_ran"] is True
    assert out["verdict"] == "reviewed"
    q, args = conn.executed[-1]
    assert "status = CASE WHEN $3::bool THEN 'reviewed' ELSE status END" in q
    assert "status IN ('staged', 'reviewed')" in q     # never resurrects a superseded/landed draft
    assert args[2] is True                             # the flip is parameterised on the evidence
    verdict = json.loads(args[1])
    assert verdict["cohort_ran"] is True
    assert "refute_0" in verdict["evidence"]


def test_record_review_does_NOT_mark_reviewed_when_the_cohort_SAFE_SKIPPED(emitted):
    """B17 — the bug this action shipped with.

    Every reviewer safe-skips (no key / rate-limited / fabric absent). The record step is
    independent by design, so it still runs — and it used to stamp `status='reviewed'` anyway,
    making a draft nobody read indistinguishable from one a colour team cleared. Now the status is
    left alone and the attempt is recorded honestly.
    """
    conn = FakeConn(draft_row={"id": uuid.uuid4(), "status": "staged"})
    out = _run(ingest_actions.record_ingest_review(
        conn, solicitation_id=SOL, resolution="majority",
        _ai_step_status={"refute_0": "skipped", "refute_1": "skipped", "reconcile": "skipped"},
    ))
    assert out["recorded"] is True          # the attempt IS recorded — silence is not an error
    assert out["cohort_ran"] is False
    assert out["verdict"] == "not_reviewed"
    assert out["status"] == "staged"        # ← the draft did NOT become 'reviewed'
    _, args = conn.executed[-1]
    assert args[2] is False
    assert json.loads(args[1])["cohort_ran"] is False


def test_record_review_reports_unverified_when_the_engine_says_nothing(emitted):
    """Called with no step record at all (a direct call, or an engine that did not supply one).

    'unverified' is deliberately not 'not_reviewed': one says the cohort did not run, the other
    says nobody can tell. Either way the draft is not marked reviewed.
    """
    conn = FakeConn(draft_row={"id": uuid.uuid4(), "status": "staged"})
    out = _run(ingest_actions.record_ingest_review(
        conn, solicitation_id=SOL, resolution="majority",
    ))
    assert out["verdict"] == "unverified"
    assert out["cohort_ran"] is False
    assert out["status"] == "staged"


def test_record_review_without_an_open_draft_reports_not_writes(emitted):
    out = _run(ingest_actions.record_ingest_review(
        FakeConn(draft_row=None), solicitation_id=SOL, resolution="majority",
        _ai_step_status={"reconcile": "completed"},
    ))
    assert out == {"recorded": False, "reason": "no_open_draft"}
