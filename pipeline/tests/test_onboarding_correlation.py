"""OnApplicationAccepted onboarding gate — a `user.logged_in` event must resume ONLY
the parked onboarding instance for THAT user.

The gate (on_application_accepted.py) parks a HITL_WAIT for identity:user.logged_in;
resume goes through manager._event_correlates, which keys on payload.userId. The parked
instance carries the new user's id (the accept end-event result), so the login event must
ALSO carry payload.userId — frontend auth.ts now emits it. Without it the two share no
correlation key and _event_correlates fails OPEN, letting any login resume any gate.
"""
from workflows.manager import WorkflowManager

corr = WorkflowManager._event_correlates


def test_login_resumes_only_matching_user():
    onboarding = {"tenantId": "t1", "userId": "user-A"}  # parked instance payload
    # A's login resumes A's gate…
    assert corr({"userId": "user-A", "correlationId": "x"}, onboarding) is True
    # …but B's login must NOT resume A's onboarding gate.
    assert corr({"userId": "user-B", "correlationId": "y"}, onboarding) is False


def test_login_without_userid_fails_open_regression():
    """The bug this guards: a login event WITHOUT payload.userId shares no correlation
    key with the parked instance and falls open. auth.ts now always emits userId, so
    this degenerate case shouldn't occur — the assertion documents WHY it's required."""
    onboarding = {"tenantId": "t1", "userId": "user-A"}
    assert corr({"correlationId": "z"}, onboarding) is True  # fail-open (undesired)


def test_non_entity_wait_still_fails_open_by_design():
    # A gate that genuinely waits on a non-entity event keeps resuming.
    assert corr({"correlationId": "z"}, {"foo": "bar"}) is True


def test_multi_key_requires_all_shared_to_match():
    inst = {"userId": "A", "proposalId": "P1"}
    assert corr({"userId": "A", "proposalId": "P1"}, inst) is True
    assert corr({"userId": "A", "proposalId": "P2"}, inst) is False  # one mismatch blocks resume
