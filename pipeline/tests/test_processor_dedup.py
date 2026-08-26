"""The dedup record is the only thing between an inclusive poll bound and a duplicate workflow.

THE MECHANISM. run_workflow_processor polls with

    WHERE created_at >= last_processed_at

and then sets `last_processed_at` to the newest event's OWN created_at. So the newest event is
re-selected on every tick, for ever, until a newer one arrives. That is deliberate — system_events
timestamps collide at millisecond granularity and `>` would silently drop an event sharing a
millisecond with the last processed one — which means _track_processed is load-bearing, not a
belt-and-braces nicety.

THE BUG. Eviction used to CLEAR THE WHOLE SET. That forgets the newest ids along with the oldest,
and the newest is precisely what the `>=` bound hands back on the next poll. A clear landing while
an event was still newest let it through a second time and re-triggered its workflow: a duplicate
process_instance from one emission, about once per 50,000 events, with nothing in the log to say so.

These tests pin the eviction ORDER, because that is the whole fix — a test that only checked
"memory stays bounded" passes on the broken version too.
"""
from __future__ import annotations

import pytest

from workflows import processor
from workflows.processor import _track_processed


@pytest.fixture(autouse=True)
def _clean_dedup():
    """Each test starts from an empty record and leaves one behind."""
    processor._processed_event_ids.clear()
    yield
    processor._processed_event_ids.clear()


def test_first_sighting_is_not_a_duplicate():
    assert _track_processed("evt-1") is False


def test_second_sighting_is_a_duplicate():
    _track_processed("evt-1")
    assert _track_processed("evt-1") is True


def test_the_newest_event_stays_remembered_across_an_eviction():
    """THE REGRESSION. The newest id is the one the >= bound re-selects — it must survive.

    Fill to the cap, then add one more to force eviction, then re-present the id that was newest at
    that moment. On the old wipe-everything version this returns False (not a duplicate) and the
    processor re-triggers its workflow.
    """
    cap = processor._MAX_DEDUP_SET_SIZE
    for i in range(cap - 1):
        _track_processed(f"old-{i}")
    newest = "the-newest-event"
    _track_processed(newest)          # last insert before the cap is reached
    _track_processed("tips-it-over")  # triggers eviction

    assert _track_processed(newest) is True, (
        "the newest event was forgotten by eviction — the >= poll bound will re-select it and "
        "the processor will run its workflow a second time"
    )


def test_eviction_drops_the_oldest_not_the_newest():
    cap = processor._MAX_DEDUP_SET_SIZE
    for i in range(cap):
        _track_processed(f"evt-{i}")
    _track_processed("trigger-eviction")

    # Oldest gone…
    assert _track_processed("evt-0") is False
    # …newest kept.
    assert _track_processed(f"evt-{cap - 1}") is True
    assert _track_processed("trigger-eviction") is True


def test_eviction_keeps_memory_bounded():
    """The property the original cap was reaching for — still true, just no longer at the cost
    of correctness."""
    cap = processor._MAX_DEDUP_SET_SIZE
    for i in range(cap + 2_000):
        _track_processed(f"evt-{i}")
    assert len(processor._processed_event_ids) <= cap


def test_eviction_frees_a_real_fraction():
    """Dropping one id per insert past the cap would make every subsequent insert an eviction.
    Half is the point: amortised, not per-call."""
    cap = processor._MAX_DEDUP_SET_SIZE
    for i in range(cap):
        _track_processed(f"evt-{i}")
    _track_processed("trigger-eviction")
    expected = cap - int(cap * processor._DEDUP_EVICT_FRACTION) + 1
    assert len(processor._processed_event_ids) == expected


def test_insertion_order_is_preserved_by_the_backing_store():
    """The eviction is only oldest-first because the store is insertion-ordered. If someone swaps
    the dict back for a set, this fails before the ordering tests do — with a clearer reason."""
    for i in range(5):
        _track_processed(f"evt-{i}")
    assert list(processor._processed_event_ids) == [f"evt-{i}" for i in range(5)]
