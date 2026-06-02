"""Email sender identity resolution — abstraction + config (no provisioning).

resolve_sender picks the From address by (explicit hint -> namespace -> template
heuristic) and FAILS SAFE to the caller's default, so an unmapped message never
changes sender unexpectedly.
"""
import pytest

from src.sender_identity import resolve_sender


@pytest.fixture(autouse=True)
def _clean_sender_env(monkeypatch):
    # Deterministic baseline: clear every sender env var and the DB cache so each
    # test exercises a known precedence layer. The hardcoded defaults equal the
    # canonical addresses, so cleared-env tests still resolve to them.
    import src.sender_identity as si

    monkeypatch.setattr(si, "_CACHE", None)
    for var in (
        "GOOGLE_WORKSPACE_EMAIL",
        "SENDER_AUTOMATION_EMAIL",
        "SENDER_ENGAGEMENT_EMAIL",
        "SENDER_CMS_SERVICE_EMAIL",
    ):
        monkeypatch.delenv(var, raising=False)
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


def test_env_override(monkeypatch):
    monkeypatch.setenv("SENDER_ENGAGEMENT_EMAIL", "heather@rfppipeline.com")
    assert resolve_sender(identity="engagement") == "heather@rfppipeline.com"


# ── DB-backed identities (migration 009 sender_identities) ──────────────────


async def test_load_sender_identities_populates_cache_and_applies():
    import src.sender_identity as si

    class _Pool:
        async def fetch(self, q, *a):
            return [
                {"key": "automation", "address": "ops@rfppipeline.com"},
                {"key": "newsroom", "address": "news@rfppipeline.com"},
            ]

    n = await si.load_sender_identities(_Pool())
    assert n == 2
    # DB address applies when no env override is set (autouse cleared env)
    assert resolve_sender(identity="automation") == "ops@rfppipeline.com"
    # a custom DB-only identity is resolvable too
    assert resolve_sender(identity="newsroom") == "news@rfppipeline.com"


async def test_env_overrides_db(monkeypatch):
    import src.sender_identity as si

    monkeypatch.setattr(si, "_CACHE", {"automation": "ops@rfppipeline.com"})
    monkeypatch.setenv("SENDER_AUTOMATION_EMAIL", "forced@rfppipeline.com")
    # explicit env var is the ops override — wins over the DB row
    assert resolve_sender(identity="automation") == "forced@rfppipeline.com"


async def test_db_overrides_default(monkeypatch):
    import src.sender_identity as si

    monkeypatch.setattr(si, "_CACHE", {"engagement": "heather@rfppipeline.com"})
    # no env override -> the DB row wins over the hardcoded default
    assert resolve_sender(identity="engagement") == "heather@rfppipeline.com"


async def test_load_sender_identities_best_effort_on_error():
    import src.sender_identity as si

    class _BoomPool:
        async def fetch(self, q, *a):
            raise RuntimeError("relation sender_identities does not exist")

    n = await si.load_sender_identities(_BoomPool())
    assert n == 0
    # resolution still works via defaults
    assert resolve_sender(identity="engagement") == "eric@rfppipeline.com"


async def test_load_sender_identities_none_pool():
    import src.sender_identity as si

    assert await si.load_sender_identities(None) == 0
