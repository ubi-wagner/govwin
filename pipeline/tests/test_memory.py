"""Unit tests for MemoryStore (pipeline/src/agents/memory.py).

MemoryStore is a thin DB-backed store — almost all public methods issue SQL
via asyncpg.  The tests here split into two groups:

1. PURE / near-pure tests (run without a DB):
   - _ZERO_VECTOR structure (1536 dims, correct format)
   - archive_memories() early-return on empty list (conn never touched)
   - update_decay() clamping logic (verified by inspecting the source;
     tested via a mock conn that allows us to spy on clamped value)

2. DB-required tests (skip-guarded with reason):
   - store(), recall(), search(), write_episodic(), write_semantic(),
     write_procedural(), promote_to_semantic(), get_memories_for_lifecycle()
     all issue SQL via asyncpg.  No live DB is available in CI.
"""
from __future__ import annotations

import sys
import unittest.mock

import pytest

# ── Ensure 'anthropic' mock is in place (memory.py imports events which is
#    fine, but agents/__init__.py imports fabric which imports anthropic).
if "anthropic" not in sys.modules:
    sys.modules["anthropic"] = unittest.mock.MagicMock()

from agents.memory import MemoryStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TENANT_ID = "12345678-1234-5678-1234-567812345678"
AGENT_NAME = "capture_strategist"


# ---------------------------------------------------------------------------
# Pure: _ZERO_VECTOR structure
# ---------------------------------------------------------------------------

class TestZeroVector:
    def setup_method(self):
        self.ms = MemoryStore()

    def test_zero_vector_has_1536_dimensions(self):
        """Embedding placeholder must be 1536 dims (text-embedding-3-small compat)."""
        dims = self.ms._ZERO_VECTOR.count(",") + 1
        assert dims == 1536

    def test_zero_vector_bracketed(self):
        v = self.ms._ZERO_VECTOR
        assert v.startswith("[")
        assert v.endswith("]")

    def test_zero_vector_contains_only_floats(self):
        inner = self.ms._ZERO_VECTOR[1:-1]  # strip brackets
        values = [float(x) for x in inner.split(",")]
        assert all(v == 0.0 for v in values)


# ---------------------------------------------------------------------------
# Pure: archive_memories early-return for empty list
# ---------------------------------------------------------------------------

class TestArchiveMemoriesEmptyList:
    def setup_method(self):
        self.ms = MemoryStore()

    @pytest.mark.asyncio
    async def test_empty_list_returns_zero_without_touching_conn(self):
        """archive_memories([], ...) must short-circuit and never call conn."""
        mock_conn = unittest.mock.AsyncMock()
        result = await self.ms.archive_memories(mock_conn, [], TENANT_ID)
        assert result == 0
        mock_conn.execute.assert_not_called()


# ---------------------------------------------------------------------------
# Near-pure: update_decay clamp logic
# ---------------------------------------------------------------------------

class TestUpdateDecayClamping:
    """update_decay() clamps new_decay to [0.01, 1.0] before writing to DB.

    We verify the clamping by providing a mock conn whose execute() is an
    AsyncMock, then checking we get back True (success path) without errors.
    We also check that extreme values don't raise.
    """

    def setup_method(self):
        self.ms = MemoryStore()

    def _make_conn(self):
        conn = unittest.mock.AsyncMock()
        conn.execute = unittest.mock.AsyncMock(return_value=None)
        return conn

    @pytest.mark.asyncio
    async def test_normal_decay_value_succeeds(self):
        conn = self._make_conn()
        result = await self.ms.update_decay(conn, "00000000-0000-0000-0000-000000000001", 0.75, TENANT_ID)
        assert result is True
        conn.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_decay_below_minimum_clamped_to_0_01(self):
        """Values below 0.01 must be clamped; execute should still be called."""
        conn = self._make_conn()
        result = await self.ms.update_decay(conn, "00000000-0000-0000-0000-000000000002", -5.0, TENANT_ID)
        assert result is True
        # Verify execute was called (clamped value, not skipped)
        conn.execute.assert_awaited_once()
        # Extract the clamped value from the call args
        call_args = conn.execute.call_args[0]  # positional args: (sql, clamped, uuid, uuid)
        clamped_value = call_args[1]
        assert clamped_value == pytest.approx(0.01)

    @pytest.mark.asyncio
    async def test_decay_above_maximum_clamped_to_1_0(self):
        """Values above 1.0 must be clamped to 1.0."""
        conn = self._make_conn()
        result = await self.ms.update_decay(conn, "00000000-0000-0000-0000-000000000003", 999.0, TENANT_ID)
        assert result is True
        call_args = conn.execute.call_args[0]
        clamped_value = call_args[1]
        assert clamped_value == pytest.approx(1.0)

    @pytest.mark.asyncio
    async def test_db_error_returns_false(self):
        """If conn.execute raises, update_decay must catch and return False."""
        conn = unittest.mock.AsyncMock()
        conn.execute = unittest.mock.AsyncMock(side_effect=Exception("conn error"))
        result = await self.ms.update_decay(conn, "00000000-0000-0000-0000-000000000004", 0.5, TENANT_ID)
        assert result is False


# ---------------------------------------------------------------------------
# Near-pure: archive_memories with one item — conn called, parse result
# ---------------------------------------------------------------------------

class TestArchiveMemoriesWithItems:
    def setup_method(self):
        self.ms = MemoryStore()

    @pytest.mark.asyncio
    async def test_successful_archive_increments_count(self):
        """archive_memories with a valid UUID and a conn that returns 'UPDATE 1'."""
        conn = unittest.mock.AsyncMock()
        conn.execute = unittest.mock.AsyncMock(return_value="UPDATE 1")
        memory_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        count = await self.ms.archive_memories(conn, [memory_id], TENANT_ID)
        assert count == 1
        conn.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_archive_with_zero_rows_updated_does_not_count(self):
        """If execute returns 'UPDATE 0' the row was already archived or not found."""
        conn = unittest.mock.AsyncMock()
        conn.execute = unittest.mock.AsyncMock(return_value="UPDATE 0")
        memory_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        count = await self.ms.archive_memories(conn, [memory_id], TENANT_ID)
        assert count == 0


# ---------------------------------------------------------------------------
# DB-required — skip-guarded
# ---------------------------------------------------------------------------

@pytest.mark.skip(
    reason=(
        "MemoryStore.store() requires an asyncpg connection to INSERT into "
        "episodic_memories and emit system_events rows.  No live test DB is "
        "available in this environment.  Run integration tests with "
        "'make test-integration' against a real PostgreSQL instance."
    )
)
async def test_store_requires_live_db():
    ms = MemoryStore()
    mem_id = await ms.store(None, TENANT_ID, AGENT_NAME, {"input_summary": "x"})
    assert mem_id  # UUID string


@pytest.mark.skip(
    reason=(
        "MemoryStore.recall() issues a SELECT against episodic_memories and "
        "subsequent access-tracking UPDATEs — all require a live DB connection."
    )
)
async def test_recall_requires_live_db():
    ms = MemoryStore()
    memories = await ms.recall(None, TENANT_ID, AGENT_NAME, limit=5)
    assert isinstance(memories, list)


@pytest.mark.skip(
    reason=(
        "MemoryStore.write_semantic() and write_procedural() require a live DB "
        "with the pgvector extension installed (for the ::vector cast)."
    )
)
async def test_write_semantic_requires_live_db():
    ms = MemoryStore()
    mem_id = await ms.write_semantic(None, TENANT_ID, AGENT_NAME, "content", "category")
    assert mem_id


@pytest.mark.skip(
    reason=(
        "MemoryStore.promote_to_semantic() INSERTs into semantic_memories with "
        "a ::vector cast and requires a live DB with pgvector."
    )
)
async def test_promote_to_semantic_requires_live_db():
    ms = MemoryStore()
    mid = await ms.promote_to_semantic(
        None, TENANT_ID, ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
        "summary", "agency_knowledge",
    )
    assert mid
