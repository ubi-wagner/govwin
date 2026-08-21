"""The startup check that says whether tenant workflows can be written at all.

The condition it guards is silent by construction: on a role RLS applies to, the worker starts
cleanly, drains every platform workflow, and drops every tenant one. These tests pin both verdicts
against the four catalog shapes that decide it, so a future change to the RLS posture cannot quietly
turn the check into a no-op.
"""
from __future__ import annotations

import pytest

from db_role_preflight import check_workflow_write_role


class _FakeConn:
    """Returns one canned pg_class row, or raises, for the single query the preflight makes."""

    def __init__(self, row, raises: Exception | None = None):
        self._row = row
        self._raises = raises

    async def fetchrow(self, *_args, **_kwargs):
        if self._raises:
            raise self._raises
        return self._row


def _row(*, role="govtech", rls_on=True, rls_forced=False, is_owner=True, bypasses=False):
    return {
        "role": role, "rls_on": rls_on, "rls_forced": rls_forced,
        "is_owner": is_owner, "bypasses": bypasses,
    }


@pytest.mark.asyncio
async def test_owner_on_unforced_table_is_ok():
    """The production posture: RLS on, not FORCEd, worker is the owner."""
    assert await check_workflow_write_role(_FakeConn(_row())) is True


@pytest.mark.asyncio
async def test_app_role_is_rejected():
    """govtech_app is NOBYPASSRLS and not the owner — this is the failure being caught.

    Reproduced live: the worker restarted without sandbox-up.sh's DATABASE_URL_OWNER override,
    and 18 events failed with 'new row violates row-level security policy for
    table "process_instances"' while ingest kept working perfectly.
    """
    conn = _FakeConn(_row(role="govtech_app", is_owner=False, bypasses=False))
    assert await check_workflow_write_role(conn) is False


@pytest.mark.asyncio
async def test_forced_rls_rejects_even_the_owner():
    """FORCE ROW LEVEL SECURITY applies policies to the owner too.

    process_instances is not FORCEd today, but several tables in this schema are, and the check has
    to stay right if that changes — an owner-only test would pass while the worker silently broke.
    """
    conn = _FakeConn(_row(role="govtech", is_owner=True, rls_forced=True, bypasses=False))
    assert await check_workflow_write_role(conn) is False


@pytest.mark.asyncio
async def test_bypassrls_role_is_ok_even_when_forced():
    """BYPASSRLS is exempt outright — the intended posture for rfp_agent once deploy-gated."""
    conn = _FakeConn(_row(role="rfp_agent", is_owner=False, rls_forced=True, bypasses=True))
    assert await check_workflow_write_role(conn) is True


@pytest.mark.asyncio
async def test_rls_disabled_is_ok():
    conn = _FakeConn(_row(role="anyone", rls_on=False, is_owner=False))
    assert await check_workflow_write_role(conn) is True


@pytest.mark.asyncio
async def test_missing_table_does_not_block_startup():
    assert await check_workflow_write_role(_FakeConn(None)) is True


@pytest.mark.asyncio
async def test_catalog_read_failure_does_not_block_startup():
    """A preflight that crashes the worker is worse than the condition it reports."""
    conn = _FakeConn(None, raises=RuntimeError("catalog unreadable"))
    assert await check_workflow_write_role(conn) is True
