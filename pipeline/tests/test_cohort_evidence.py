"""B17 — "reviewed" must be DERIVED from evidence the cohort ran, never asserted.

Three things are locked here:

  1. `cohort_verdict` reads the engine's own step record correctly, and keeps "did not run"
     distinct from "cannot tell".
  2. `record_stage_review` emits a verdict that follows the evidence — and, on the dangerous
     path, says outright in the human summary that the review did not happen.
  3. The engine actually DELIVERS the record: an ACTION that declares `_ai_step_status` gets it,
     one that does not is untouched, and a `**kwargs` catch-all does NOT count as declaring it
     (which would let the signal vanish silently — the same class of quiet failure as the bug).

Pure logic: fake conn, patched emitter, no DB and no LLM.
"""
import asyncio
import sys
import types

import pytest

sys.path.insert(0, "src")

from workflows.actions import portal_stage_actions  # noqa: E402
from workflows.actions.cohort_evidence import (  # noqa: E402
    NOT_REVIEWED,
    REVIEWED,
    UNVERIFIED,
    cohort_verdict,
)
from workflows.processor import _declares_step_status  # noqa: E402

PORTAL = "11111111-1111-1111-1111-111111111111"


def _run(coro):
    """Fresh loop per call — `asyncio.run`, never `get_event_loop().run_until_complete`.

    The same note as `test_ingest_actions._run`: the latter passes alone and fails inside the
    full suite once another test has closed the loop, which is exactly how this file first went
    red (3 of 17, only in the full run).
    """
    return asyncio.run(coro)


class FakeConn:
    """No advisory notes on the proposal — the case that used to read as a clean pass."""

    async def fetch(self, q, *args):
        return []

    async def execute(self, q, *args):
        return "OK"


@pytest.fixture()
def emitted(monkeypatch):
    calls: list[dict] = []

    async def fake_emit(conn, **kw):
        calls.append(kw)
        return f"evt-{len(calls)}"

    mod = types.ModuleType("events")
    mod.emit_event = fake_emit
    monkeypatch.setitem(sys.modules, "events", mod)
    return calls


# ── 1. the verdict function ────────────────────────────────────────────────────

def test_one_completed_step_is_evidence():
    verdict, ran, why = cohort_verdict({"refute_0": "completed", "refute_1": "skipped"})
    assert (verdict, ran) == (REVIEWED, True)
    assert "refute_0" in why


def test_all_skipped_is_not_reviewed():
    verdict, ran, why = cohort_verdict({"review_manager": "skipped"})
    assert (verdict, ran) == (NOT_REVIEWED, False)
    assert "review_manager=skipped" in why


def test_all_failed_is_not_reviewed():
    """A cohort that ERRORED did not review anything either — failure is not a pass."""
    verdict, ran, _ = cohort_verdict({"a": "failed", "b": "failed"})
    assert (verdict, ran) == (NOT_REVIEWED, False)


def test_pending_is_not_reviewed():
    """A record step declared BEFORE its cohort sees 'pending' and must not invent a pass."""
    verdict, ran, _ = cohort_verdict({"review_manager": "pending"})
    assert (verdict, ran) == (NOT_REVIEWED, False)


@pytest.mark.parametrize("bad", [None, "nonsense", 42, {}])
def test_no_readable_record_is_unverified_not_reviewed(bad):
    """UNVERIFIED stays distinct from NOT_REVIEWED — collapsing them rebuilds the bug smaller.
    Neither is a pass: `ran` is False for both."""
    verdict, ran, _ = cohort_verdict(bad)
    assert verdict == UNVERIFIED
    assert ran is False


# ── 2. the portal stage gate ───────────────────────────────────────────────────

def test_stage_review_reports_reviewed_when_the_manager_RAN(emitted):
    out = _run(portal_stage_actions.record_stage_review(
        FakeConn(), portal_id=PORTAL, stage_key="draft",
        _ai_step_status={"review_manager": "completed"},
    ))
    assert out["verdict"] == REVIEWED
    assert out["cohortRan"] is True
    assert emitted[0]["payload"]["verdict"] == REVIEWED
    assert emitted[0]["payload"]["cohortRan"] is True


def test_stage_review_reports_NOT_reviewed_when_the_manager_SAFE_SKIPPED(emitted):
    """The bug, in one test.

    Zero advisory notes + a safe-skipped manager used to emit verdict='reviewed', and the auto
    gate reads zero notes as clean. That combination advanced a customer's portal stage on work
    nothing had reviewed."""
    out = _run(portal_stage_actions.record_stage_review(
        FakeConn(), portal_id=PORTAL, stage_key="draft", auto=True,
        _ai_step_status={"review_manager": "skipped"},
    ))
    assert out["verdict"] == NOT_REVIEWED
    assert out["cohortRan"] is False
    payload = emitted[0]["payload"]
    assert payload["verdict"] == NOT_REVIEWED
    assert payload["cohortRan"] is False
    # The human at the gate must be TOLD, not left to infer it from a count of zero.
    assert "did NOT run" in payload["summary"]


def test_stage_review_still_emits_and_never_dead_ends(emitted):
    """Advisory contract intact: whatever the evidence, the completion event lands so the gate can
    be closed by a person. A missing review must park the gate, never strand the workflow."""
    out = _run(portal_stage_actions.record_stage_review(
        FakeConn(), portal_id=PORTAL, stage_key="draft",
    ))
    assert out["completed"] is True
    assert emitted[0]["type"] == "stage_review.completed"
    assert emitted[0]["payload"]["verdict"] == UNVERIFIED


# ── 3. the engine actually delivers it ─────────────────────────────────────────

def test_the_two_record_actions_declare_the_signal():
    """If either stops declaring `_ai_step_status`, the engine stops injecting it and both
    verdicts quietly go back to 'unverified' forever. That is a silent regression, so it is a
    test rather than a comment."""
    from workflows.actions import ingest_actions

    assert _declares_step_status(portal_stage_actions.record_stage_review)
    assert _declares_step_status(ingest_actions.record_ingest_review)


def test_a_catch_all_kwargs_does_not_count_as_declaring_it():
    """Nearly every action here ends in `**_ignored`. Injecting into a catch-all would mean the
    signal is 'delivered' to actions that never read it — wired-looking and inert."""
    def catch_all(conn, **_ignored):
        return None

    def explicit(conn, _ai_step_status=None, **_ignored):
        return None

    def plain(conn, x=None):
        return None

    assert _declares_step_status(catch_all) is False
    assert _declares_step_status(plain) is False
    assert _declares_step_status(explicit) is True


def test_execute_action_injects_only_into_a_declaring_action():
    """End of the delivery chain: the processor's ACTION dispatch."""
    from workflows import processor

    seen: dict = {}

    async def declaring(conn, portal_id=None, _ai_step_status=None, **_ignored):
        seen["declaring"] = _ai_step_status
        return {"ok": True}

    async def not_declaring(conn, portal_id=None, **_ignored):
        seen["not_declaring"] = _ignored
        return {"ok": True}

    mod = types.ModuleType("fake_actions_mod")
    mod.declaring = declaring
    mod.not_declaring = not_declaring
    sys.modules["fake_actions_mod"] = mod
    try:
        _run(processor._execute_action(
            None, "fake_actions_mod.declaring", {"portal_id": PORTAL},
            ai_step_status={"m": "completed"},
        ))
        _run(processor._execute_action(
            None, "fake_actions_mod.not_declaring", {"portal_id": PORTAL},
            ai_step_status={"m": "completed"},
        ))
    finally:
        del sys.modules["fake_actions_mod"]

    assert seen["declaring"] == {"m": "completed"}
    assert "_ai_step_status" not in seen["not_declaring"]


def test_a_SAFE_SKIP_recorded_as_completed_is_reported_as_skipped():
    """The deep half of B17, and the one the unit tests could not have found.

    The engine writes 'completed' for any step whose executor RETURNED something — and a safe-skip
    returns `{"result": None, "skipped": True}`, a perfectly good value. So `step_status` says an
    agent that never ran completed. Deriving the verdict from that string alone would have shipped
    the same lie in evidence-shaped packaging. Caught by driving the real engine
    (`scripts/drive_b17_evidence.py`), which is why that script exists alongside these tests.
    """
    from workflows.manager import _effective_step_status

    status = {"review_manager": "completed"}
    skipped = {"review_manager": {"result": None, "skipped": True, "reason": "no_fabric"}}
    ran = {"review_manager": {"result": {"reconciled": True}}}

    assert _effective_step_status("review_manager", status, skipped) == "skipped"
    assert _effective_step_status("review_manager", status, ran) == "completed"
    # And a step that genuinely failed or has not run keeps its own status untouched.
    assert _effective_step_status("review_manager", {"review_manager": "failed"}, {}) == "failed"
    assert _effective_step_status("absent", {}, {}) == "pending"


def test_the_engine_computes_the_cohort_from_AI_INVOKE_steps_only():
    """The manager derives the cohort from the workflow's own declaration, so no action has to
    name a step by hand (a literal that a rename would silently break)."""
    from workflows.base import StepType
    from workflows.on_portal_stage_review import OnPortalStageReviewRequested as W

    ai = [s.name for s in W.step_execution_order() if s.step_type == StepType.AI_INVOKE]
    # There IS a cohort to have evidence about — an empty set would make every verdict
    # 'unverified' forever, which is the failure mode this assertion exists to catch.
    assert ai == ["review_manager"]


def test_the_ingest_review_phase_has_a_cohort_too():
    from workflows.base import StepType
    from workflows.on_ingest_phase_requested import OnIngestPhaseRequestedReview as W

    ai = [s.name for s in W.step_execution_order() if s.step_type == StepType.AI_INVOKE]
    assert "reconcile" in ai
    assert any(n.startswith("refute_") for n in ai)
