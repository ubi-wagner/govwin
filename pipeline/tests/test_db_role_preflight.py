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
    """Returns canned pg_class rows, or raises, for the single query the preflight makes.

    COUNTS ITS CALLS, and that is not incidental. This fake used to implement `fetchrow`; when the
    check was widened to enumerate every table it switched to `fetch`, the fake did not have it,
    the resulting AttributeError was swallowed by the preflight's deliberate fail-open catch — and
    the check returned True. A safety check reporting OK because its own catalog read was broken is
    the worst of both: two tests caught it only because they assert False, and the four that assert
    True would have passed forever on a preflight that was measuring nothing.

    So `calls` is asserted below. A future rename of the query method fails loudly instead of
    quietly turning this whole file into a test of the fail-open branch.
    """

    def __init__(self, rows, raises: Exception | None = None):
        self._rows = rows
        self._raises = raises
        self.calls = 0

    async def fetch(self, *_args, **_kwargs):
        self.calls += 1
        if self._raises:
            raise self._raises
        return self._rows


def _row(*, role="govtech", table_name="process_instances", rls_forced=False,
         is_owner=True, bypasses=False, super_=False):
    """One row of the catalog read: a single RLS-enabled table, plus the role's own flags."""
    return {
        "role": role, "table_name": table_name, "rls_forced": rls_forced,
        "is_owner": is_owner, "bypasses": bypasses, "super": super_,
    }


def _conn(*rows, raises: Exception | None = None) -> _FakeConn:
    return _FakeConn(list(rows), raises=raises)


@pytest.mark.asyncio
async def test_the_check_actually_reads_the_catalog():
    """THE GUARD ON EVERY OTHER TEST HERE.

    The preflight fails OPEN by design, so any breakage in how it queries — a renamed method, a
    changed signature — turns into `return True` with a warning nobody reads, and every
    assert-True test below keeps passing while measuring nothing. This asserts the read happened.
    """
    conn = _conn(_row())
    await check_workflow_write_role(conn)
    assert conn.calls == 1, "the preflight did not query the catalog — it is measuring nothing"


@pytest.mark.asyncio
async def test_owner_on_unforced_table_is_ok():
    """The production posture: RLS on, not FORCEd, worker is the owner."""
    assert await check_workflow_write_role(_conn(_row())) is True


@pytest.mark.asyncio
async def test_app_role_is_rejected():
    """govtech_app is NOBYPASSRLS and not the owner — this is the failure being caught.

    Reproduced live: the worker restarted without sandbox-up.sh's DATABASE_URL_OWNER override,
    and 18 events failed with 'new row violates row-level security policy for
    table "process_instances"' while ingest kept working perfectly.
    """
    conn = _conn(_row(role="govtech_app", is_owner=False, bypasses=False))
    assert await check_workflow_write_role(conn) is False


@pytest.mark.asyncio
async def test_forced_rls_rejects_even_the_owner():
    """FORCE ROW LEVEL SECURITY applies policies to the owner too."""
    conn = _conn(_row(role="govtech", is_owner=True, rls_forced=True, bypasses=False))
    assert await check_workflow_write_role(conn) is False


@pytest.mark.asyncio
async def test_one_forced_table_among_many_unforced_is_still_a_rejection():
    """WHY THIS CHECK WAS WIDENED, pinned as a test.

    It used to read ONE table — process_instances, which is ENABLE-not-FORCE — and report a verdict
    about "workflow writes" in general. For a non-superuser owner that took the owner-exempt branch
    and logged OK, while migs 212/213 FORCE eleven proposal-spine tables that the same owner is NOT
    exempt from. Such a worker starts green and then fails every INSERT INTO canvas_versions,
    silently killing AI section drafting. One exposed table among many safe ones must still refuse.
    """
    conn = _conn(
        _row(table_name="process_instances", is_owner=True, rls_forced=False),
        _row(table_name="tasks", is_owner=True, rls_forced=False),
        _row(table_name="canvas_versions", is_owner=True, rls_forced=True),
    )
    assert await check_workflow_write_role(conn) is False


@pytest.mark.asyncio
async def test_superuser_is_ok_even_when_every_table_is_forced():
    """Superuser bypasses RLS outright — the posture sandbox-up.sh starts the worker in."""
    conn = _conn(_row(role="govtech", is_owner=True, rls_forced=True, super_=True))
    assert await check_workflow_write_role(conn) is True


@pytest.mark.asyncio
async def test_bypassrls_role_is_ok_even_when_forced():
    """BYPASSRLS is exempt outright — the intended posture for rfp_agent once deploy-gated."""
    conn = _conn(_row(role="rfp_agent", is_owner=False, rls_forced=True, bypasses=True))
    assert await check_workflow_write_role(conn) is True


@pytest.mark.asyncio
async def test_no_rls_tables_at_all_is_ok():
    """Nothing has RLS enabled — nothing to be exposed by."""
    assert await check_workflow_write_role(_conn()) is True


@pytest.mark.asyncio
async def test_catalog_read_failure_does_not_block_startup():
    """A preflight that crashes the worker is worse than the condition it reports."""
    conn = _conn(raises=RuntimeError("catalog unreadable"))
    assert await check_workflow_write_role(conn) is True
