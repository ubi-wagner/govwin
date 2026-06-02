"""INC-2 — SCOUT field-name break (EVENT_CONTRACT_V3 gap 3; CLIFFNOTES 19).

create_drafts_from_scout read region["opportunities"], but BOTH scout emitters
(pipeline source_scout.py + frontend source-scout.ts) write "extractedOpportunities".
Result: OnSourceChangeDetected always created 0 drafts. These tests lock the fix:
feeding the canonical key creates drafts; feeding only the legacy key creates none
(proving the consumer reads the key the emitters actually send).

Unit test against a fake asyncpg connection (pattern from test_portal_provisioner.py);
emit_event is patched to a no-op so no live DB / events module is needed.
"""
from __future__ import annotations

import importlib
import uuid
from unittest.mock import patch

import pytest

# Use importlib so we get the real MODULE object — workflows/actions/__init__.py
# re-exports the function under the same dotted name, which would otherwise
# shadow the submodule and break patch.object().
mod = importlib.import_module("workflows.actions.create_drafts_from_scout")
REGION_OPPORTUNITIES_KEY = mod.REGION_OPPORTUNITIES_KEY
create_drafts_from_scout = mod.create_drafts_from_scout


class _FakeConn:
    """No existing opportunity -> every opp becomes a new draft (2 execs each)."""

    def __init__(self):
        self.inserts: list[str] = []

    async def fetchrow(self, query, *args):
        return None  # nothing exists -> create path

    async def fetchval(self, query, *args):
        return None

    async def execute(self, query, *args):
        if "INSERT INTO curated_solicitations" in query:
            self.inserts.append("solicitation")
        elif "INSERT INTO opportunities" in query:
            self.inserts.append("opportunity")
        return "INSERT 0 1"


def _region(opps, *, key=REGION_OPPORTUNITIES_KEY):
    return {
        "region_id": str(uuid.uuid4()),
        "region_name": "Funding Opportunities",
        "content_hash": "abc",
        "previous_hash": "xyz",
        "extracted_text": "...",
        key: opps,
        "changed": True,
    }


_OPPS = [
    {"title": "AF SBIR 25.1 Autonomy", "agency": "USAF", "description": "d1"},
    {"title": "Navy STTR Sensors", "agency": "USN", "description": "d2"},
]


async def test_canonical_key_creates_drafts():
    """extractedOpportunities populated -> drafts created (the fix)."""
    conn = _FakeConn()
    with patch.object(mod, "emit_event", side_effect=_noop_emit):
        result = await create_drafts_from_scout(
            conn, source_id=str(uuid.uuid4()), source_name="Test Source",
            region_results=[_region(_OPPS)],
        )
    assert result["draftsCreated"] == 2
    assert conn.inserts.count("solicitation") == 2


async def test_legacy_key_creates_nothing():
    """Regression lock: the OLD 'opportunities' key must yield 0 drafts now.

    If this ever creates drafts again, someone reintroduced the legacy-key read
    and the consumer/emitter contract has diverged.
    """
    conn = _FakeConn()
    with patch.object(mod, "emit_event", side_effect=_noop_emit):
        result = await create_drafts_from_scout(
            conn, source_id=str(uuid.uuid4()), source_name="Test Source",
            region_results=[_region(_OPPS, key="opportunities")],
        )
    assert result["draftsCreated"] == 0
    assert conn.inserts == []


async def test_empty_regions_returns_zero():
    conn = _FakeConn()
    with patch.object(mod, "emit_event", side_effect=_noop_emit):
        result = await create_drafts_from_scout(
            conn, source_id=str(uuid.uuid4()), source_name="Test Source",
            region_results=[],
        )
    assert result["draftsCreated"] == 0
    assert result["reason"] == "no_region_results"


async def _noop_emit(*args, **kwargs):
    return "evt-id"
