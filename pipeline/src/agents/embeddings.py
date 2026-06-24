"""Embedding provider for agent memory and library vector search.

Driven by env var EMBEDDINGS_PROVIDER (default: none).

PROVIDERS
---------
none (default)
    Returns None from embed() / embed_batch(). All callers fall back to their
    current recency/ILIKE path — byte-identical to pre-embeddings behavior.

openai
    Lazy-imports the openai SDK. Model: text-embedding-3-small (1536-dim,
    matches the existing vector(1536) columns in episodic/semantic/procedural
    memories and library_units). Requires OPENAI_API_KEY env var.
    If the SDK is missing OR the key is missing → logs once, returns None
    (safe degradation — never raises).

voyage
    Voyage AI models produce 1024-dim vectors, but the DB columns are
    vector(1536). Emitting a 1024-dim vector into a 1536-dim column would
    corrupt the index. The provider logs a ONE-TIME warning explaining the
    dimension mismatch and always returns None. A `vector(1536) → vector(1024)`
    column migration must be applied before Voyage can be enabled.

THREAD-SAFETY / SINGLETON
--------------------------
get_embedding_provider() returns the same EmbeddingProvider instance for the
process lifetime (module-level singleton set on first call). Tests that need a
clean state should call _reset_provider() or patch the singleton directly.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger("pipeline.agents.embeddings")

# ── singleton ──────────────────────────────────────────────────────────────

_provider: Optional["EmbeddingProvider"] = None


def get_embedding_provider() -> "EmbeddingProvider":
    """Return the module-level singleton EmbeddingProvider (created on first call)."""
    global _provider
    if _provider is None:
        _provider = EmbeddingProvider()
    return _provider


def is_enabled() -> bool:
    """Return True if the configured provider can actually produce embeddings.

    False when EMBEDDINGS_PROVIDER is unset, 'none', 'voyage' (dim mismatch),
    or when the required SDK / API key is absent.
    """
    return get_embedding_provider()._active


def _reset_provider() -> None:
    """Reset the singleton (for tests only)."""
    global _provider
    _provider = None


# ── provider class ─────────────────────────────────────────────────────────

class EmbeddingProvider:
    """Thin wrapper around an embedding API, controlled by EMBEDDINGS_PROVIDER.

    Public methods:
        async embed(text: str) -> list[float] | None
        async embed_batch(texts: list[str]) -> list[list[float] | None]
    """

    # Expected dimensionality — matches the existing vector(1536) columns.
    EXPECTED_DIMS = 1536
    # OpenAI model that natively produces 1536-dim outputs.
    OPENAI_MODEL = "text-embedding-3-small"

    def __init__(self) -> None:
        raw = os.environ.get("EMBEDDINGS_PROVIDER", "none").strip().lower()
        self._provider_name = raw
        self._active = False          # True only when a real provider is ready
        self._warned_once = False     # prevent log spam

        if raw in ("", "none"):
            # DEFAULT-OFF: caller gets None → zero-vector / recency fallback.
            pass

        elif raw == "openai":
            self._init_openai()

        elif raw == "voyage":
            self._warn_voyage_dims()

        else:
            logger.error(
                "[embeddings] Unknown EMBEDDINGS_PROVIDER=%r; "
                "falling back to none (recency / zero-vector).",
                raw,
            )

    # ── initialisation helpers ─────────────────────────────────────────────

    def _init_openai(self) -> None:
        """Attempt to import the openai SDK and validate the API key."""
        try:
            import openai as _openai_sdk  # lazy import
            self._openai = _openai_sdk
        except ImportError:
            logger.error(
                "[embeddings] EMBEDDINGS_PROVIDER=openai but the 'openai' SDK "
                "is not installed. pip install openai to enable vector search. "
                "Degrading to recency / zero-vector fallback."
            )
            return

        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            logger.error(
                "[embeddings] EMBEDDINGS_PROVIDER=openai but OPENAI_API_KEY is "
                "not set. Degrading to recency / zero-vector fallback."
            )
            return

        self._active = True
        logger.info(
            "[embeddings] OpenAI provider active (model=%s, dims=%d).",
            self.OPENAI_MODEL,
            self.EXPECTED_DIMS,
        )

    def _warn_voyage_dims(self) -> None:
        """Voyage produces 1024-dim vectors; DB columns are vector(1536) — mismatch."""
        logger.error(
            "[embeddings] EMBEDDINGS_PROVIDER=voyage: Voyage AI models produce "
            "1024-dim vectors, but the database columns are vector(1536). "
            "Inserting wrong-dimension vectors would corrupt the HNSW index. "
            "A migration to change vector(1536) → vector(1024) must be applied "
            "before Voyage can be activated. Degrading to recency / zero-vector "
            "fallback until the migration is in place."
        )
        # _active stays False → callers use zero-vector / recency

    # ── public API ─────────────────────────────────────────────────────────

    async def embed(self, text: str) -> list[float] | None:
        """Embed a single string.

        Returns a list of 1536 floats, or None if no provider is active /
        any error occurs. None always degrades gracefully to zero-vector or
        recency ordering — never raises.
        """
        if not self._active:
            return None

        try:
            return await self._embed_openai(text)
        except Exception as exc:
            # Log once per process then silently degrade
            if not self._warned_once:
                logger.error(
                    "[embeddings] embed() failed (will not repeat this log): %s", exc
                )
                self._warned_once = True
            return None

    async def embed_batch(self, texts: list[str]) -> list[list[float] | None]:
        """Embed multiple strings in one API call (when provider supports it).

        Returns a list parallel to *texts*; any element may be None on error.
        Falls back to sequential single-embeds when batch is not supported.
        """
        if not self._active:
            return [None] * len(texts)

        if not texts:
            return []

        try:
            return await self._embed_batch_openai(texts)
        except Exception as exc:
            if not self._warned_once:
                logger.error(
                    "[embeddings] embed_batch() failed (will not repeat): %s", exc
                )
                self._warned_once = True
            return [None] * len(texts)

    # ── provider-specific implementations ─────────────────────────────────

    async def _embed_openai(self, text: str) -> list[float]:
        """Call the OpenAI embeddings endpoint (async via AsyncOpenAI)."""
        client = self._openai.AsyncOpenAI()
        response = await client.embeddings.create(
            model=self.OPENAI_MODEL,
            input=text,
        )
        vec = response.data[0].embedding
        if len(vec) != self.EXPECTED_DIMS:
            raise ValueError(
                f"OpenAI returned {len(vec)}-dim vector; expected {self.EXPECTED_DIMS}."
            )
        return vec

    async def _embed_batch_openai(self, texts: list[str]) -> list[list[float] | None]:
        """Batch embed via OpenAI (single API call, up to 2048 items)."""
        client = self._openai.AsyncOpenAI()
        response = await client.embeddings.create(
            model=self.OPENAI_MODEL,
            input=texts,
        )
        # API returns items sorted by index
        results: list[list[float] | None] = [None] * len(texts)
        for item in response.data:
            vec = item.embedding
            if len(vec) == self.EXPECTED_DIMS:
                results[item.index] = vec
            else:
                logger.error(
                    "[embeddings] batch item %d: got %d-dim vector; expected %d.",
                    item.index, len(vec), self.EXPECTED_DIMS,
                )
        return results
