"""Tests for the embeddings provider layer (pipeline/src/agents/embeddings.py).

All four requirement groups:

  (a) Provider mocked-ON → cosine ORDER BY path is taken in:
      - memory.search (MemoryStore and _memory_search tool)
      - _library_search tool
      - ContextAssembler._load_library_atoms

  (b) EMBEDDINGS_PROVIDER unset / 'none' → identical recency/zero-vector
      behavior (assert NO cosine, zero-vector stored).

  (c) embeddings.py degrades to None when the SDK is absent.

  (d) voyage → None + dim-mismatch log.

No real DB, no real API calls. Provider is patched at the instance level
or the module singleton is reset between tests.
"""
from __future__ import annotations

import logging
import os
import sys
import unittest.mock
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── Stub 'anthropic' before pipeline imports ──────────────────────────────
if "anthropic" not in sys.modules:
    sys.modules["anthropic"] = unittest.mock.MagicMock()

# ── Reset embeddings singleton before import so env doesn't leak between runs
import importlib


# ── Fake deterministic 1536-dim vector ────────────────────────────────────
FAKE_VEC: list[float] = [0.001] * 1536   # non-zero so it's distinguishable
FAKE_VEC_STR = "[" + ",".join(str(v) for v in FAKE_VEC) + "]"
ZERO_VEC_STR = "[" + ",".join(["0.0"] * 1536) + "]"

TENANT_ID = str(uuid.uuid4())
TENANT_UUID = uuid.UUID(TENANT_ID)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_embeddings_singleton():
    """Force a fresh EmbeddingProvider on next get_embedding_provider() call."""
    import agents.embeddings as emb_mod
    emb_mod._provider = None


def _make_active_provider() -> MagicMock:
    """Return a mock EmbeddingProvider that reports active and returns FAKE_VEC."""
    prov = MagicMock()
    prov._active = True
    prov.embed = AsyncMock(return_value=FAKE_VEC)
    prov.embed_batch = AsyncMock(return_value=[FAKE_VEC])
    return prov


def _make_inactive_provider() -> MagicMock:
    """Return a mock EmbeddingProvider that reports inactive (returns None)."""
    prov = MagicMock()
    prov._active = False
    prov.embed = AsyncMock(return_value=None)
    prov.embed_batch = AsyncMock(return_value=[None])
    return prov


def _make_conn():
    """Return a minimal fake asyncpg connection that records fetch/execute calls."""
    conn = MagicMock()
    conn._fetch_calls = []
    conn._execute_calls = []
    conn._fetchrow_calls = []

    async def _fetch(sql, *args):
        conn._fetch_calls.append((sql, args))
        return []

    async def _execute(sql, *args):
        conn._execute_calls.append((sql, args))
        return "UPDATE 0"

    async def _fetchrow(sql, *args):
        conn._fetchrow_calls.append((sql, args))
        return None

    conn.fetch = _fetch
    conn.execute = _execute
    conn.fetchrow = _fetchrow
    return conn


def _make_archetype(system_prompt: str = "You are a helpful agent.") -> MagicMock:
    arch = MagicMock()
    arch.system_prompt = system_prompt
    arch.role_name = "test_role"
    arch.get_tools.return_value = []
    arch.build_messages.return_value = [{"role": "user", "content": "test"}]
    return arch


# ---------------------------------------------------------------------------
# (a) Provider mocked-ON — cosine path taken
# ---------------------------------------------------------------------------

class TestCosinePathWithActiveProvider:
    """With an active (mocked) provider, all search / load paths use cosine ORDER BY."""

    @pytest.mark.asyncio
    async def test_a1_memory_store_embeds_content_on_write(self):
        """store() calls provider.embed() and uses the returned vector."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.store(conn, TENANT_ID, "test_role", {"input_summary": "hello"})

        prov.embed.assert_awaited_once()
        # The execute call must use FAKE_VEC_STR, not the zero vector
        assert conn._execute_calls, "Expected an execute call"
        execute_sql, execute_args = conn._execute_calls[0]
        vec_arg = execute_args[3]  # 4th positional = embedding
        assert vec_arg == FAKE_VEC_STR, (
            f"Expected FAKE_VEC_STR in embedding arg, got: {vec_arg[:80]}..."
        )

    @pytest.mark.asyncio
    async def test_a2_memory_recall_uses_cosine_order_by(self):
        """recall() with query_text + active provider uses 'embedding <=> $3::vector'."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.recall(conn, TENANT_ID, "test_role", query_text="AI proposal")

        prov.embed.assert_awaited_once_with("AI proposal")
        assert conn._fetch_calls, "Expected a fetch call"
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" in sql, f"Expected cosine ORDER BY in SQL; got: {sql}"
        assert FAKE_VEC_STR in args, "Query vector string must be in SQL args"

    @pytest.mark.asyncio
    async def test_a3_memory_search_uses_cosine_order_by(self):
        """MemoryStore.search() with active provider and query_text uses cosine path."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.search(conn, TENANT_ID, query_text="compliance")

        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" in sql
        assert FAKE_VEC_STR in args

    @pytest.mark.asyncio
    async def test_a4_tool_memory_search_episodic_cosine(self):
        """_memory_search tool (episodic) with active provider uses cosine path."""
        from agents.tools import _memory_search

        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _memory_search(conn, TENANT_ID, query="cyber", memory_type="episodic")

        prov.embed.assert_awaited_once_with("cyber")
        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" in sql, f"Expected cosine in SQL; got: {sql[:200]}"
        assert FAKE_VEC_STR in args
        # Tenant isolation preserved
        assert TENANT_UUID in args

    @pytest.mark.asyncio
    async def test_a5_tool_memory_search_semantic_cosine(self):
        """_memory_search tool (semantic) with active provider uses cosine path."""
        from agents.tools import _memory_search

        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _memory_search(conn, TENANT_ID, query="formatting rules", memory_type="semantic")

        sql, args = conn._fetch_calls[0]
        assert "semantic_memories" in sql
        assert "embedding <=>" in sql

    @pytest.mark.asyncio
    async def test_a6_tool_memory_search_procedural_cosine(self):
        """_memory_search tool (procedural) with active provider uses cosine path."""
        from agents.tools import _memory_search

        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _memory_search(conn, TENANT_ID, query="drafting steps", memory_type="procedural")

        sql, args = conn._fetch_calls[0]
        assert "procedural_memories" in sql
        assert "embedding <=>" in sql

    @pytest.mark.asyncio
    async def test_a7_tool_library_search_cosine(self):
        """_library_search with active provider uses cosine ORDER BY."""
        from agents.tools import _library_search

        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _library_search(conn, TENANT_ID, query="AI experience")

        prov.embed.assert_awaited_once_with("AI experience")
        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" in sql
        assert FAKE_VEC_STR in args
        assert TENANT_UUID in args

    @pytest.mark.asyncio
    async def test_a8_tool_library_search_cosine_with_category(self):
        """_library_search with query + category + active provider: cosine + category WHERE."""
        from agents.tools import _library_search

        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _library_search(conn, TENANT_ID, query="AI experience", category="capabilities")

        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" in sql
        # category filter still applied — now via the atom_tags satellite EXISTS
        assert "atom_tags" in sql and "t.value ILIKE" in sql

    @pytest.mark.asyncio
    async def test_a9_load_library_atoms_cosine(self):
        """ContextAssembler._load_library_atoms ranks by cosine when provider active."""
        from agents.context import ContextAssembler

        conn = _make_conn()
        prov = _make_active_provider()

        assembler = ContextAssembler()
        with patch("agents.context._get_provider", return_value=prov):
            await assembler._load_library_atoms(
                conn, TENANT_ID, task_data={"task": "draft the technical section"}
            )

        prov.embed.assert_awaited_once()
        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" in sql, f"Expected cosine in SQL; got: {sql}"
        assert FAKE_VEC_STR in args

    @pytest.mark.asyncio
    async def test_a10_write_semantic_embeds(self):
        """write_semantic() calls embed() when provider active."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.write_semantic(conn, TENANT_ID, "test_role", "Some fact", "knowledge")

        prov.embed.assert_awaited_once()
        assert conn._execute_calls
        _, exec_args = conn._execute_calls[0]
        assert exec_args[3] == FAKE_VEC_STR

    @pytest.mark.asyncio
    async def test_a11_write_procedural_embeds(self):
        """write_procedural() calls embed() when provider active."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.write_procedural(
                conn, TENANT_ID, "test_role", "DraftProcedure", "Step-by-step drafting", []
            )

        prov.embed.assert_awaited_once()
        assert conn._execute_calls
        _, exec_args = conn._execute_calls[0]
        assert exec_args[3] == FAKE_VEC_STR

    @pytest.mark.asyncio
    async def test_a12_promote_to_semantic_embeds(self):
        """promote_to_semantic() calls embed() when provider active."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.promote_to_semantic(
                conn, TENANT_ID,
                [str(uuid.uuid4())], "Summary text", "category",
            )

        prov.embed.assert_awaited_once()
        assert conn._execute_calls
        _, exec_args = conn._execute_calls[0]
        assert exec_args[3] == FAKE_VEC_STR

    @pytest.mark.asyncio
    async def test_a13_memory_write_tool_embeds(self):
        """_memory_write tool calls embed() when provider active."""
        from agents.tools import _memory_write

        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _memory_write(conn, TENANT_ID, content="Important observation")

        prov.embed.assert_awaited_once()
        assert conn._execute_calls
        _, exec_args = conn._execute_calls[0]
        # embedding is 4th arg (index 3)
        assert exec_args[3] == FAKE_VEC_STR


# ---------------------------------------------------------------------------
# (b) Provider off (default) — recency/zero-vector behavior unchanged
# ---------------------------------------------------------------------------

class TestDefaultOffBehavior:
    """With EMBEDDINGS_PROVIDER unset or 'none', behavior is byte-identical to original."""

    @pytest.mark.asyncio
    async def test_b1_store_uses_zero_vector_when_provider_inactive(self):
        """store() uses _ZERO_VECTOR when provider is inactive."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.store(conn, TENANT_ID, "test_role", {"input_summary": "hello"})

        assert conn._execute_calls
        _, exec_args = conn._execute_calls[0]
        vec_arg = exec_args[3]
        assert vec_arg == ZERO_VEC_STR, f"Expected zero-vector, got: {vec_arg[:80]}..."

    @pytest.mark.asyncio
    async def test_b2_recall_uses_recency_when_no_query_text(self):
        """recall() without query_text → recency path regardless of provider state."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.recall(conn, TENANT_ID, "test_role")

        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" not in sql, "Recency path must not have cosine ORDER BY"
        assert "importance * decay_factor" in sql

    @pytest.mark.asyncio
    async def test_b3_memory_search_tool_uses_ilike_when_inactive(self):
        """_memory_search falls back to ILIKE when provider is inactive."""
        from agents.tools import _memory_search

        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _memory_search(conn, TENANT_ID, query="proposal", memory_type="episodic")

        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" not in sql, "Cosine must NOT appear in ILIKE fallback"
        assert "ILIKE" in sql
        # Pattern arg must be the escaped/wrapped query
        assert "%proposal%" in args

    @pytest.mark.asyncio
    async def test_b4_library_search_tool_uses_ilike_when_inactive(self):
        """_library_search falls back to ILIKE when provider inactive."""
        from agents.tools import _library_search

        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _library_search(conn, TENANT_ID, query="capabilities")

        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" not in sql
        assert "ILIKE" in sql

    @pytest.mark.asyncio
    async def test_b5_load_library_atoms_uses_recency_when_inactive(self):
        """_load_library_atoms uses usage_count/recency ordering when provider inactive."""
        from agents.context import ContextAssembler

        conn = _make_conn()
        prov = _make_inactive_provider()

        assembler = ContextAssembler()
        with patch("agents.context._get_provider", return_value=prov):
            await assembler._load_library_atoms(
                conn, TENANT_ID, task_data={"task": "write proposal"}
            )

        assert conn._fetch_calls
        sql, args = conn._fetch_calls[0]
        assert "embedding <=>" not in sql, "Recency path must not have cosine"
        assert "usage_count" in sql

    @pytest.mark.asyncio
    async def test_b6_write_semantic_uses_zero_vector_when_inactive(self):
        """write_semantic() uses _ZERO_VECTOR when provider inactive."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.write_semantic(conn, TENANT_ID, "test_role", "fact", "category")

        assert conn._execute_calls
        _, exec_args = conn._execute_calls[0]
        assert exec_args[3] == ZERO_VEC_STR

    @pytest.mark.asyncio
    async def test_b7_env_none_produces_inactive_provider(self):
        """With EMBEDDINGS_PROVIDER=none, EmbeddingProvider._active is False."""
        _reset_embeddings_singleton()
        with patch.dict(os.environ, {"EMBEDDINGS_PROVIDER": "none"}, clear=False):
            _reset_embeddings_singleton()
            from agents.embeddings import get_embedding_provider
            prov = get_embedding_provider()
            assert not prov._active

        _reset_embeddings_singleton()

    @pytest.mark.asyncio
    async def test_b8_env_unset_produces_inactive_provider(self):
        """With EMBEDDINGS_PROVIDER unset, EmbeddingProvider._active is False."""
        _reset_embeddings_singleton()
        env_copy = {k: v for k, v in os.environ.items() if k != "EMBEDDINGS_PROVIDER"}
        with patch.dict(os.environ, env_copy, clear=True):
            _reset_embeddings_singleton()
            from agents.embeddings import get_embedding_provider
            prov = get_embedding_provider()
            assert not prov._active

        _reset_embeddings_singleton()

    @pytest.mark.asyncio
    async def test_b9_memory_search_no_cosine_and_tenant_isolation_preserved(self):
        """Recency path still passes ctx tenant_id as first arg (isolation unchanged)."""
        from agents.tools import _memory_search

        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.tools._get_embedding_provider", return_value=prov):
            await _memory_search(conn, TENANT_ID, query="test")

        sql, args = conn._fetch_calls[0]
        assert args[0] == TENANT_UUID

    @pytest.mark.asyncio
    async def test_b10_search_without_query_text_uses_recency(self):
        """MemoryStore.search() without query_text falls back to recency even with active provider."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()  # active but no query supplied

        with patch("agents.memory._get_provider", return_value=prov):
            await ms.search(conn, TENANT_ID)  # no query_text

        # embed should NOT be called (no text to embed)
        prov.embed.assert_not_awaited()
        assert conn._fetch_calls
        sql, _ = conn._fetch_calls[0]
        assert "importance * decay_factor" in sql


# ---------------------------------------------------------------------------
# (c) SDK absent → degrade to None
# ---------------------------------------------------------------------------

class TestSdkAbsentDegradation:
    """EmbeddingProvider degrades gracefully when the openai SDK is not installed."""

    def test_c1_missing_openai_sdk_returns_inactive(self, caplog):
        """When openai SDK is not importable, provider must be inactive."""
        _reset_embeddings_singleton()
        # Remove openai from sys.modules to simulate missing SDK
        original = sys.modules.pop("openai", None)
        try:
            with patch.dict(
                os.environ, {"EMBEDDINGS_PROVIDER": "openai", "OPENAI_API_KEY": "test-key"},
                clear=False,
            ):
                _reset_embeddings_singleton()
                # Make import of openai raise ImportError
                with patch.dict(sys.modules, {"openai": None}):
                    from agents import embeddings as emb_mod
                    # Force reimport of the class by resetting singleton
                    emb_mod._provider = None
                    # Directly instantiate to test init logic
                    import importlib
                    importlib.reload(emb_mod)
                    emb_mod._provider = None
                    prov = emb_mod.EmbeddingProvider.__new__(emb_mod.EmbeddingProvider)
                    prov._active = False
                    prov._warned_once = False
                    prov._provider_name = "openai"
                    # Simulate missing SDK by patching __import__
                    import builtins
                    original_import = builtins.__import__

                    def _mock_import(name, *args, **kwargs):
                        if name == "openai":
                            raise ImportError("No module named 'openai'")
                        return original_import(name, *args, **kwargs)

                    with patch.object(builtins, "__import__", _mock_import):
                        prov._init_openai()

                    assert not prov._active, "Provider must be inactive when SDK missing"
        finally:
            if original is not None:
                sys.modules["openai"] = original
            _reset_embeddings_singleton()

    @pytest.mark.asyncio
    async def test_c2_missing_api_key_returns_none_from_embed(self, caplog):
        """Missing OPENAI_API_KEY → _active=False → embed() returns None."""
        _reset_embeddings_singleton()
        env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
        env["EMBEDDINGS_PROVIDER"] = "openai"

        # Stub out the openai SDK with a MagicMock so import succeeds
        fake_openai = MagicMock()
        with patch.dict(os.environ, env, clear=True):
            with patch.dict(sys.modules, {"openai": fake_openai}):
                _reset_embeddings_singleton()
                from agents.embeddings import EmbeddingProvider
                prov = EmbeddingProvider.__new__(EmbeddingProvider)
                prov._provider_name = "openai"
                prov._active = False
                prov._warned_once = False
                prov._openai = fake_openai
                prov._init_openai()
                # OPENAI_API_KEY not in env → should remain inactive
                assert not prov._active

        _reset_embeddings_singleton()

    @pytest.mark.asyncio
    async def test_c3_inactive_provider_embed_returns_none(self):
        """embed() on inactive provider returns None immediately."""
        from agents.embeddings import EmbeddingProvider

        prov = EmbeddingProvider.__new__(EmbeddingProvider)
        prov._active = False
        prov._warned_once = False
        prov._provider_name = "none"

        result = await prov.embed("some text")
        assert result is None

    @pytest.mark.asyncio
    async def test_c4_inactive_provider_embed_batch_returns_list_of_none(self):
        """embed_batch() on inactive provider returns [None, None, ...]."""
        from agents.embeddings import EmbeddingProvider

        prov = EmbeddingProvider.__new__(EmbeddingProvider)
        prov._active = False
        prov._warned_once = False
        prov._provider_name = "none"

        result = await prov.embed_batch(["a", "b", "c"])
        assert result == [None, None, None]


# ---------------------------------------------------------------------------
# (d) Voyage → None + dim-mismatch log
# ---------------------------------------------------------------------------

class TestVoyageDimMismatch:
    """EMBEDDINGS_PROVIDER=voyage → provider inactive + dim-mismatch logged."""

    def test_d1_voyage_provider_inactive(self, caplog):
        """Voyage sets _active=False because dim mismatch (1024 vs 1536)."""
        _reset_embeddings_singleton()
        with patch.dict(os.environ, {"EMBEDDINGS_PROVIDER": "voyage"}, clear=False):
            _reset_embeddings_singleton()
            with caplog.at_level(logging.ERROR, logger="pipeline.agents.embeddings"):
                from agents.embeddings import EmbeddingProvider
                prov = EmbeddingProvider()
            assert not prov._active
        _reset_embeddings_singleton()

    def test_d2_voyage_logs_dim_mismatch_warning(self, caplog):
        """Voyage init logs a message mentioning 1024-dim and migration."""
        _reset_embeddings_singleton()
        with patch.dict(os.environ, {"EMBEDDINGS_PROVIDER": "voyage"}, clear=False):
            _reset_embeddings_singleton()
            with caplog.at_level(logging.ERROR, logger="pipeline.agents.embeddings"):
                from agents.embeddings import EmbeddingProvider
                prov = EmbeddingProvider()
            # Check that one of the log records mentions the dim mismatch
            messages = " ".join(r.message for r in caplog.records)
            assert "1024" in messages or "migration" in messages or "vector(1536)" in messages, (
                f"Expected dim-mismatch language in log; got: {messages}"
            )
        _reset_embeddings_singleton()

    @pytest.mark.asyncio
    async def test_d3_voyage_embed_returns_none(self):
        """embed() on a voyage-configured (inactive) provider returns None."""
        from agents.embeddings import EmbeddingProvider

        prov = EmbeddingProvider.__new__(EmbeddingProvider)
        prov._active = False  # voyage always stays inactive
        prov._provider_name = "voyage"
        prov._warned_once = False

        result = await prov.embed("test text")
        assert result is None


# ---------------------------------------------------------------------------
# Singleton / is_enabled helpers
# ---------------------------------------------------------------------------

class TestProviderHelpers:
    """get_embedding_provider() returns singleton; is_enabled() reflects _active."""

    def test_e1_singleton_returns_same_instance(self):
        """get_embedding_provider() returns the same object on repeated calls."""
        _reset_embeddings_singleton()
        from agents.embeddings import get_embedding_provider

        p1 = get_embedding_provider()
        p2 = get_embedding_provider()
        assert p1 is p2

        _reset_embeddings_singleton()

    def test_e2_is_enabled_false_when_inactive(self):
        """is_enabled() returns False when provider is inactive."""
        _reset_embeddings_singleton()
        with patch.dict(os.environ, {"EMBEDDINGS_PROVIDER": "none"}, clear=False):
            _reset_embeddings_singleton()
            from agents.embeddings import is_enabled
            assert not is_enabled()
        _reset_embeddings_singleton()


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

class TestBackfillEmbeddings:
    """MemoryStore.backfill_embeddings() — provider active → UPDATEs rows."""

    @pytest.mark.asyncio
    async def test_f1_backfill_skipped_when_provider_inactive(self):
        """backfill_embeddings() returns 0 immediately when provider inactive."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_inactive_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            result = await ms.backfill_embeddings(conn, "episodic_memories")

        assert result == 0
        assert not conn._fetch_calls, "Should not query DB when provider inactive"

    @pytest.mark.asyncio
    async def test_f2_backfill_updates_zero_vector_rows(self):
        """backfill_embeddings() fetches zero-vector rows and updates them."""
        from agents.memory import MemoryStore

        ms = MemoryStore()

        # Simulate one row needing backfill
        row_id = uuid.uuid4()
        fake_row = MagicMock()
        fake_row.__getitem__ = lambda self, k: str(row_id) if k == "content" else row_id
        fake_row.get = lambda k, d=None: str(row_id) if k == "content" else d

        conn = MagicMock()
        conn._fetch_calls = []
        conn._execute_calls = []

        async def _fetch(sql, *args):
            conn._fetch_calls.append((sql, args))
            return [fake_row]

        async def _execute(sql, *args):
            conn._execute_calls.append((sql, args))
            return "UPDATE 1"

        conn.fetch = _fetch
        conn.execute = _execute

        prov = _make_active_provider()
        prov.embed_batch = AsyncMock(return_value=[FAKE_VEC])

        with patch("agents.memory._get_provider", return_value=prov):
            result = await ms.backfill_embeddings(conn, "episodic_memories", limit=10)

        assert result == 1, f"Expected 1 updated row; got {result}"
        prov.embed_batch.assert_awaited_once()
        assert conn._execute_calls, "Expected UPDATE call"
        update_sql, update_args = conn._execute_calls[0]
        assert "UPDATE" in update_sql
        assert FAKE_VEC_STR in update_args

    @pytest.mark.asyncio
    async def test_f3_backfill_rejects_unknown_table(self):
        """backfill_embeddings() with an unknown table name returns 0."""
        from agents.memory import MemoryStore

        ms = MemoryStore()
        conn = _make_conn()
        prov = _make_active_provider()

        with patch("agents.memory._get_provider", return_value=prov):
            result = await ms.backfill_embeddings(conn, "untrusted_table")

        assert result == 0
