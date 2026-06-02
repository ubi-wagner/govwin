"""INC-3 — phase-aware rule matching (EVENT_CONTRACT_V3 gap 4; CLIFFNOTES 20).

_rule_matches ignored phase, so a rule on rfp.uploaded fired on BOTH the start
and end rows (the (event_id, action_type) dedup can't catch it — start and end
are distinct events). These tests lock the phase guard: a rule fires on terminal
phases only (end / single / unphased), never 'start', and a start/end pair yields
exactly one match. trigger_phase opt-in is also covered.
"""
from src.event_listener import _rule_matches

# Schema variant 1 (migration 019): trigger_namespace + trigger_type
_V1_COLS = {'trigger_namespace', 'trigger_type', 'action_type', 'action_config', 'is_active'}
_RULE = {'trigger_namespace': 'finder', 'trigger_type': 'rfp.uploaded', 'action_type': 'notify_admin'}


def test_matches_end_phase():
    assert _rule_matches(_RULE, _V1_COLS, 'finder', 'rfp.uploaded', 'end') is True


def test_matches_single_phase():
    assert _rule_matches(_RULE, _V1_COLS, 'finder', 'rfp.uploaded', 'single') is True


def test_matches_unphased_event():
    # Events with no phase ('') are point events — should fire.
    assert _rule_matches(_RULE, _V1_COLS, 'finder', 'rfp.uploaded', '') is True


def test_does_not_match_start_phase():
    # The headline fix: 'start' must NOT match (kills the double-fire).
    assert _rule_matches(_RULE, _V1_COLS, 'finder', 'rfp.uploaded', 'start') is False


def test_start_end_pair_matches_exactly_once():
    """The bug, reproduced end-to-end: a single rule across a start/end pair."""
    fires = [
        _rule_matches(_RULE, _V1_COLS, 'finder', 'rfp.uploaded', phase)
        for phase in ('start', 'end')
    ]
    assert fires.count(True) == 1
    assert fires == [False, True]


def test_namespace_or_type_mismatch_never_matches():
    assert _rule_matches(_RULE, _V1_COLS, 'capture', 'rfp.uploaded', 'end') is False
    assert _rule_matches(_RULE, _V1_COLS, 'finder', 'other.event', 'end') is False
    # even on a phase that would otherwise match
    assert _rule_matches(_RULE, _V1_COLS, 'finder', 'other.event', 'single') is False


def test_trigger_phase_explicit_opt_in():
    """A rule may opt into a specific phase via trigger_phase."""
    cols = _V1_COLS | {'trigger_phase'}
    rule_start = {**_RULE, 'trigger_phase': 'start'}
    # Now 'start' matches (explicit opt-in) and 'end' does not.
    assert _rule_matches(rule_start, cols, 'finder', 'rfp.uploaded', 'start') is True
    assert _rule_matches(rule_start, cols, 'finder', 'rfp.uploaded', 'end') is False


def test_variant2_trigger_bus_events_phase_guarded():
    """Schema variant 2 (trigger_bus + trigger_events) is phase-guarded too."""
    cols = {'trigger_bus', 'trigger_events', 'action_type'}
    rule = {'trigger_bus': 'finder', 'trigger_events': ['rfp.uploaded'], 'action_type': 'notify_admin'}
    assert _rule_matches(rule, cols, 'finder', 'rfp.uploaded', 'end') is True
    assert _rule_matches(rule, cols, 'finder', 'rfp.uploaded', 'start') is False
