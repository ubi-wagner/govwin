"""Email sender identity resolution — abstraction + config (no provisioning).

resolve_sender picks the From address by (explicit hint -> namespace -> template
heuristic) and FAILS SAFE to the caller's default, so an unmapped message never
changes sender unexpectedly.
"""
import pytest

from src.sender_identity import resolve_sender


@pytest.fixture(autouse=True)
def _clean_sender_env(monkeypatch):
    # Deterministic addresses regardless of the ambient environment.
    monkeypatch.delenv("GOOGLE_WORKSPACE_EMAIL", raising=False)
    monkeypatch.setenv("SENDER_AUTOMATION_EMAIL", "automation@rfppipeline.com")
    monkeypatch.setenv("SENDER_ENGAGEMENT_EMAIL", "eric@rfppipeline.com")
    monkeypatch.setenv("SENDER_CMS_SERVICE_EMAIL", "cms_gmail_service@rfppipeline.com")
    yield


def test_explicit_identity_wins():
    assert resolve_sender(identity="engagement") == "eric@rfppipeline.com"
    assert resolve_sender(identity="automation") == "automation@rfppipeline.com"
    assert resolve_sender(identity="cms_service") == "cms_gmail_service@rfppipeline.com"


def test_explicit_identity_overrides_namespace_and_template():
    # hint beats everything else
    assert resolve_sender(
        identity="automation", namespace="capture", template="welcome_accepted"
    ) == "automation@rfppipeline.com"


def test_unknown_identity_falls_through_to_default():
    assert resolve_sender(identity="bogus", default="x@y.com") == "x@y.com"


def test_namespace_maps_customer_facing_to_engagement():
    assert resolve_sender(namespace="capture") == "eric@rfppipeline.com"
    assert resolve_sender(namespace="identity") == "eric@rfppipeline.com"


def test_namespace_maps_system_to_automation():
    assert resolve_sender(namespace="finder") == "automation@rfppipeline.com"
    assert resolve_sender(namespace="system") == "automation@rfppipeline.com"


def test_template_heuristic_engagement():
    assert resolve_sender(template="welcome_accepted") == "eric@rfppipeline.com"
    assert resolve_sender(template="lead_outreach") == "eric@rfppipeline.com"


def test_automation_template_preserves_caller_default():
    # An automation-y template with no namespace must NOT be reassigned — the
    # caller's current sender (default) is preserved (fail-safe, no regression).
    assert resolve_sender(
        template="rfp_ready_for_curation", default="platform@rfppipeline.com"
    ) == "platform@rfppipeline.com"


def test_failsafe_returns_default():
    assert resolve_sender(default="platform@rfppipeline.com") == "platform@rfppipeline.com"


def test_failsafe_automation_floor_when_no_default():
    assert resolve_sender() == "automation@rfppipeline.com"


def test_env_override():
    import os
    os.environ["SENDER_ENGAGEMENT_EMAIL"] = "heather@rfppipeline.com"
    try:
        assert resolve_sender(identity="engagement") == "heather@rfppipeline.com"
    finally:
        os.environ["SENDER_ENGAGEMENT_EMAIL"] = "eric@rfppipeline.com"
