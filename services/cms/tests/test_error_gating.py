"""Fix 3 (CMS side) — the automation listener skips errored events.

Source-level lock: the event loop must `continue` past events whose error is
set, so a failed operation never matches an automation_rule. (Launch Review #3.)
"""
import inspect

from src import event_listener as el


def test_listener_error_gates_events():
    src = inspect.getsource(el)
    assert "event.get('error')" in src or 'event.get("error")' in src, (
        "CMS event loop must skip events with error set"
    )
