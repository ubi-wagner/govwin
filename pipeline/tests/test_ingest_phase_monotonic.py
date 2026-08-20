"""The phase guard's SQL, against Postgres.

test_ingest_actions.py models the rule with a fake conn, which pins the ACTION's behaviour but
cannot prove the predicate that enforces it. The rule lives in a WHERE clause —

    AND array_position($3::text[], COALESCE(ingest_phase, 'not_started'))
      < array_position($3::text[], $1::text)

— and `array_position` returning NULL for an unknown value, or NULL sorting the wrong way in a
comparison, would silently disable the guard while every fake-conn test kept passing. So this runs
the real statement against the real table across every ordered pair of phases.

The bug it locks out, measured on a live drive of the DoD X25.5 CSO: the admin clicked "run all",
the chain parked at the land gate, the admin reviewed the blocker and landed by hand, built the
molds — and the worker's in-flight hops then walked ingest_phase back from 'complete' to 'review'.
"""
from __future__ import annotations

import os
import uuid

import asyncpg
import pytest

from workflows.actions.ingest_actions import PHASE_ORDER, _advance_to

DSN = os.environ.get("DATABASE_URL_OWNER") or os.environ.get("DATABASE_URL", "")


@pytest.fixture()
async def sol(request):
    """A throwaway curated_solicitations row (with the opportunity it requires), dropped after."""
    conn = await asyncpg.connect(DSN)
    oid, sid = uuid.uuid4(), uuid.uuid4()
    await conn.execute(
        "INSERT INTO opportunities (id, source, source_id, title) VALUES ($1, 'test', $2, $3)",
        oid, f"monotonic-{oid}", "phase-guard fixture",
    )
    await conn.execute(
        "INSERT INTO curated_solicitations (id, opportunity_id, namespace, status, ingest_phase) "
        "VALUES ($1, $2, 'test-monotonic', 'new', 'not_started')",
        sid, oid,
    )
    try:
        yield conn, sid
    finally:
        await conn.execute("DELETE FROM curated_solicitations WHERE id = $1", sid)
        await conn.execute("DELETE FROM opportunities WHERE id = $1", oid)
        await conn.close()


async def _phase(conn, sid):
    return await conn.fetchval("SELECT ingest_phase FROM curated_solicitations WHERE id = $1", sid)


async def test_forward_moves_apply(sol):
    conn, sid = sol
    for nxt in PHASE_ORDER[1:]:
        assert await _advance_to(conn, sid, nxt) == nxt
        assert await _phase(conn, sid) == nxt


async def test_backward_moves_are_refused_from_every_state(sol):
    conn, sid = sol
    for i, held in enumerate(PHASE_ORDER):
        await conn.execute("UPDATE curated_solicitations SET ingest_phase = $1 WHERE id = $2", held, sid)
        for behind in PHASE_ORDER[:i]:
            got = await _advance_to(conn, sid, behind)
            assert got == held, f"a hop to '{behind}' rewound a solicitation at '{held}'"
            assert await _phase(conn, sid) == held


async def test_the_exact_live_failure(sol):
    """complete → the three late hops that actually landed on the CSO."""
    conn, sid = sol
    await conn.execute("UPDATE curated_solicitations SET ingest_phase = 'complete' WHERE id = $1", sid)
    for late in ("matrix", "review", "review"):
        assert await _advance_to(conn, sid, late) == "complete"
    assert await _phase(conn, sid) == "complete"


async def test_re_advancing_to_the_current_phase_is_a_no_op_not_a_rewind(sol):
    """An at-least-once redelivery lands on the phase already in effect. The write does not apply
    (nothing to change), and the caller must still be told 'review', not something older."""
    conn, sid = sol
    await conn.execute("UPDATE curated_solicitations SET ingest_phase = 'review' WHERE id = $1", sid)
    assert await _advance_to(conn, sid, "review") == "review"
    assert await _phase(conn, sid) == "review"


async def test_the_column_can_never_be_null_which_is_what_makes_the_guard_total(sol):
    """The predicate's COALESCE is belt; this is the braces, and it is the load-bearing half.

    `array_position(arr, NULL)` is NULL, and `NULL < anything` is NULL — never true — so a NULL
    phase would refuse EVERY advance and strand the solicitation permanently. The COALESCE keeps
    that from being a silent hang, but the reason it cannot arise at all is the column's own NOT
    NULL. If a migration ever relaxes it, this fails and says why.
    """
    conn, sid = sol
    with pytest.raises(asyncpg.exceptions.NotNullViolationError):
        await conn.execute("UPDATE curated_solicitations SET ingest_phase = NULL WHERE id = $1", sid)
    # and the COALESCE still reads correctly for the value the column defaults to
    assert await _phase(conn, sid) == "not_started"
    assert await _advance_to(conn, sid, "extract") == "extract"


async def test_the_order_matches_what_the_column_actually_accepts(sol):
    """Every phase in PHASE_ORDER must be writable — a CHECK the order disagrees with would make
    the guard compare against a value the column can never hold."""
    conn, sid = sol
    for p in PHASE_ORDER:
        await conn.execute("UPDATE curated_solicitations SET ingest_phase = $1 WHERE id = $2", p, sid)
        assert await _phase(conn, sid) == p
