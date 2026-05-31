"""Fix 3 — failed operations must not trigger automation (Launch Review #3).

A failed op still emits a terminal phase='end' event (error set, empty payload).
EventTrigger.matches() now rejects any event with a truthy error, so workflow
triggers and HITL wait_for resumes never fire on a failure.
"""
from workflows.base import EventTrigger


def _trig():
    return EventTrigger(namespace="finder", type="rfp.uploaded", phase="end")


def test_matches_rejects_errored_event():
    good = {"namespace": "finder", "type": "rfp.uploaded", "phase": "end", "payload": {}}
    assert _trig().matches(good) is True
    errored = {**good, "error": {"message": "S3 failed", "code": "STORAGE_ERROR"}}
    assert _trig().matches(errored) is False


def test_matches_ignores_falsy_error():
    base = {"namespace": "finder", "type": "rfp.uploaded", "phase": "end", "payload": {}}
    assert _trig().matches({**base, "error": None}) is True
    assert _trig().matches({**base, "error": ""}) is True
