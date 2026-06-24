"""Agent memory operations — store and recall from episodic_memories table.

V1 (default): text-based store/recall without vector embeddings.
V2 (opt-in):  when EMBEDDINGS_PROVIDER is set to a working provider, embeds
              content on write and uses cosine ORDER BY on retrieval.

DEFAULT-OFF guarantee:
    With EMBEDDINGS_PROVIDER unset or 'none', behavior is byte-identical to
    the original implementation — _ZERO_VECTOR is stored, recency/(importance*decay)
    ordering is used for recall/search.  No functional change until the env
    var is explicitly set on deploy.
"""

import json
import logging
import time
import uuid
from datetime import datetime, timezone

from events import emit_event

logger = logging.getLogger("pipeline.agents.memory")

# ── Lazy import helper — avoids circular import from module top-level ──────


def _get_provider():
    """Return the module-level EmbeddingProvider singleton (lazy)."""
    from agents.embeddings import get_embedding_provider  # lazy, avoids circular
    return get_embedding_provider()


class MemoryStore:
    """PostgreSQL-backed memory with tenant isolation.

    Uses the episodic_memories table (001_baseline.sql) for storage.
    V1 skips embedding generation — stores a zero vector placeholder.
    Recall uses recency + importance scoring instead of vector similarity.
    """

    # Zero vector placeholder (1536 dims for text-embedding-3-small compat)
    _ZERO_VECTOR = "[" + ",".join(["0.0"] * 1536) + "]"

    async def store(self, conn, tenant_id: str, agent_name: str, memory_data: dict) -> str:
        """Store an episodic memory for a tenant+agent pair.

        When EMBEDDINGS_PROVIDER is active the content is embedded and stored;
        otherwise _ZERO_VECTOR is stored (DEFAULT-OFF: no behavior change).

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            agent_name: agent role/archetype name
            memory_data: dict with input_summary, output_summary, timestamp

        Returns:
            UUID of the created memory row
        """
        start_ms = time.monotonic()
        memory_id = str(uuid.uuid4())
        content = json.dumps(memory_data)

        # Embed content if provider is active; else keep zero-vector (DEFAULT-OFF)
        embedding_str = self._ZERO_VECTOR
        try:
            provider = _get_provider()
            if provider._active:
                vec = await provider.embed(content)
                if vec is not None:
                    embedding_str = "[" + ",".join(str(v) for v in vec) + "]"
        except Exception as _emb_exc:
            logger.error("[memory.store] embedding failed, using zero-vector: %s", _emb_exc)

        # Emit start event
        start_event_id = ""
        try:
            start_event_id = await emit_event(
                conn, namespace="tool", type="memory.stored", phase="start",
                tenant_id=tenant_id,
                payload={"agentRole": agent_name, "tenantId": tenant_id},
            )
        except Exception:
            pass

        try:
            await conn.execute(
                """
                INSERT INTO episodic_memories
                    (id, tenant_id, agent_role, embedding, content, memory_type,
                     importance, metadata, source, occurred_at, created_at)
                VALUES
                    ($1, $2, $3, $4::vector, $5, 'interaction',
                     0.5, $6::jsonb, 'fabric', $7, $7)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                agent_name,
                embedding_str,
                content,
                json.dumps({
                    "input": memory_data.get("input_summary", ""),
                    "output": memory_data.get("output_summary", ""),
                }),
                datetime.now(timezone.utc),
            )
            logger.info(
                "stored memory %s for tenant=%s agent=%s",
                memory_id, tenant_id, agent_name,
            )
            duration_ms = int((time.monotonic() - start_ms) * 1000)
            try:
                await emit_event(
                    conn, namespace="tool", type="memory.stored", phase="end",
                    parent_event_id=start_event_id, tenant_id=tenant_id,
                    payload={"agentRole": agent_name, "memoryId": memory_id,
                             "durationMs": duration_ms},
                )
            except Exception:
                pass
            return memory_id
        except Exception as e:
            logger.error("failed to store memory: %s", e)
            duration_ms = int((time.monotonic() - start_ms) * 1000)
            try:
                await emit_event(
                    conn, namespace="tool", type="memory.stored", phase="end",
                    parent_event_id=start_event_id, tenant_id=tenant_id,
                    payload={"agentRole": agent_name, "error": str(e)[:200],
                             "durationMs": duration_ms},
                )
            except Exception:
                pass
            return ""

    async def recall(self, conn, tenant_id: str, agent_name: str, limit: int = 10, *, query_text: str | None = None) -> list[dict]:
        """Recall memories for a tenant+agent pair.

        When EMBEDDINGS_PROVIDER is active AND query_text is supplied, uses
        cosine ORDER BY embedding <=> $queryvec for semantically relevant recall.
        Otherwise uses the recency/(importance*decay) path (DEFAULT-OFF: no change).

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            agent_name: agent role/archetype name
            limit: max number of memories to return
            query_text: optional search text for cosine retrieval (V2+)

        Returns:
            List of memory dicts with content and metadata
        """
        start_ms = time.monotonic()

        # Emit start event
        start_event_id = ""
        try:
            start_event_id = await emit_event(
                conn, namespace="tool", type="memory.recalled", phase="start",
                tenant_id=tenant_id,
                payload={"agentRole": agent_name, "tenantId": tenant_id, "limit": limit},
            )
        except Exception:
            pass

        # ── Cosine path (embeddings active + query supplied) ──────────────
        query_vec = None
        if query_text:
            try:
                provider = _get_provider()
                if provider._active:
                    query_vec = await provider.embed(query_text)
            except Exception as _emb_exc:
                logger.error("[memory.recall] embed for query failed: %s", _emb_exc)

        try:
            if query_vec is not None:
                query_vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"
                rows = await conn.fetch(
                    """
                    SELECT id, content, memory_type, importance, metadata,
                           occurred_at, access_count
                    FROM episodic_memories
                    WHERE tenant_id = $1
                      AND agent_role = $2
                      AND is_archived = false
                    ORDER BY embedding <=> $3::vector
                    LIMIT $4
                    """,
                    uuid.UUID(tenant_id),
                    agent_name,
                    query_vec_str,
                    limit,
                )
            else:
                # DEFAULT-OFF: recency path (byte-identical to original)
                rows = await conn.fetch(
                    """
                    SELECT id, content, memory_type, importance, metadata,
                           occurred_at, access_count
                    FROM episodic_memories
                    WHERE tenant_id = $1
                      AND agent_role = $2
                      AND is_archived = false
                    ORDER BY (importance * decay_factor) DESC, occurred_at DESC
                    LIMIT $3
                    """,
                    uuid.UUID(tenant_id),
                    agent_name,
                    limit,
                )

            memories = []
            for row in rows:
                # Update access tracking
                try:
                    await conn.execute(
                        """
                        UPDATE episodic_memories
                        SET last_accessed = now(), access_count = access_count + 1
                        WHERE id = $1
                        """,
                        row["id"],
                    )
                except Exception:
                    pass  # Access tracking is non-critical

                memories.append({
                    "id": str(row["id"]),
                    "content": row["content"],
                    "memory_type": row["memory_type"],
                    "importance": float(row["importance"]),
                    "metadata": row["metadata"],
                    "occurred_at": row["occurred_at"].isoformat() if row["occurred_at"] else None,
                })

            duration_ms = int((time.monotonic() - start_ms) * 1000)
            try:
                await emit_event(
                    conn, namespace="tool", type="memory.recalled", phase="end",
                    parent_event_id=start_event_id, tenant_id=tenant_id,
                    payload={"agentRole": agent_name, "memoriesReturned": len(memories),
                             "durationMs": duration_ms},
                )
            except Exception:
                pass

            return memories
        except Exception as e:
            logger.error("failed to recall memories: %s", e)
            duration_ms = int((time.monotonic() - start_ms) * 1000)
            try:
                await emit_event(
                    conn, namespace="tool", type="memory.recalled", phase="end",
                    parent_event_id=start_event_id, tenant_id=tenant_id,
                    payload={"agentRole": agent_name, "error": str(e)[:200],
                             "durationMs": duration_ms},
                )
            except Exception:
                pass
            return []

    async def search(self, conn, tenant_id: str, query_embedding: list[float] | None = None, memory_type: str | None = None, agent_role: str | None = None, limit: int = 10, *, query_text: str | None = None) -> list[dict]:
        """Search memories by vector similarity or recency.

        When query_text is supplied AND EMBEDDINGS_PROVIDER is active, uses
        cosine ORDER BY embedding <=> $queryvec (tenant-scoped).
        When query_embedding is a non-zero vector it is used directly (V2 API).
        Otherwise falls back to recency/(importance*decay) ordering (DEFAULT-OFF).

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            query_embedding: pre-computed embedding vector (legacy V2 API)
            memory_type: optional filter (episodic only for now)
            agent_role: optional filter by agent role
            limit: max results
            query_text: text to embed on-the-fly for cosine search

        Returns:
            List of memory dicts.
        """
        if agent_role:
            return await self.recall(conn, tenant_id, agent_role, limit=limit, query_text=query_text)

        # Resolve query vector from text (preferred) or pre-computed arg
        resolved_vec: list[float] | None = None
        if query_text:
            try:
                provider = _get_provider()
                if provider._active:
                    resolved_vec = await provider.embed(query_text)
            except Exception as _emb_exc:
                logger.error("[memory.search] embed failed: %s", _emb_exc)
        elif query_embedding and any(v != 0.0 for v in query_embedding):
            resolved_vec = query_embedding

        try:
            if resolved_vec is not None:
                vec_str = "[" + ",".join(str(v) for v in resolved_vec) + "]"
                rows = await conn.fetch(
                    """
                    SELECT id, content, memory_type, importance, metadata,
                           occurred_at, access_count
                    FROM episodic_memories
                    WHERE tenant_id = $1
                      AND is_archived = false
                    ORDER BY embedding <=> $2::vector
                    LIMIT $3
                    """,
                    uuid.UUID(tenant_id),
                    vec_str,
                    limit,
                )
            else:
                # DEFAULT-OFF: recency path (unchanged from V1)
                rows = await conn.fetch(
                    """
                    SELECT id, content, memory_type, importance, metadata,
                           occurred_at, access_count
                    FROM episodic_memories
                    WHERE tenant_id = $1
                      AND is_archived = false
                    ORDER BY (importance * decay_factor) DESC, occurred_at DESC
                    LIMIT $2
                    """,
                    uuid.UUID(tenant_id),
                    limit,
                )
            return [
                {
                    "id": str(row["id"]),
                    "content": row["content"],
                    "memory_type": row["memory_type"],
                    "importance": float(row["importance"]),
                    "metadata": row["metadata"],
                    "occurred_at": row["occurred_at"].isoformat() if row["occurred_at"] else None,
                }
                for row in rows
            ]
        except Exception as e:
            logger.error("search failed: %s", e)
            return []

    async def write_episodic(self, conn, tenant_id: str, agent_role: str, content: str, metadata: dict) -> str:
        """Write a raw episodic memory."""
        return await self.store(conn, tenant_id, agent_role, {
            "input_summary": content[:200],
            "output_summary": "",
            "raw_content": content,
            **metadata,
        })

    async def write_semantic(self, conn, tenant_id: str, agent_role: str, content: str, category: str, confidence: float = 0.5) -> str:
        """Write a semantic memory into the semantic_memories table.

        Embeds content when provider is active; else stores _ZERO_VECTOR (DEFAULT-OFF).
        """
        memory_id = str(uuid.uuid4())
        embedding_str = self._ZERO_VECTOR
        try:
            provider = _get_provider()
            if provider._active:
                vec = await provider.embed(content)
                if vec is not None:
                    embedding_str = "[" + ",".join(str(v) for v in vec) + "]"
        except Exception as _emb_exc:
            logger.error("[memory.write_semantic] embedding failed: %s", _emb_exc)

        try:
            await conn.execute(
                """
                INSERT INTO semantic_memories
                    (id, tenant_id, agent_role, embedding, content,
                     category, confidence, evidence_count,
                     source_memories, created_at, updated_at, last_accessed)
                VALUES ($1, $2, $3, $4::vector, $5,
                        $6, $7, 0,
                        ARRAY[]::uuid[], $8, $8, $8)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                agent_role,
                embedding_str,
                content,
                category,
                confidence,
                datetime.now(timezone.utc),
            )
            logger.info(
                "wrote semantic memory %s for tenant=%s agent=%s category=%s",
                memory_id, tenant_id, agent_role, category,
            )
            return memory_id
        except Exception as e:
            logger.error("failed to write semantic memory: %s", e)
            return ""

    async def write_procedural(self, conn, tenant_id: str, agent_role: str, name: str, description: str, steps: list[dict]) -> str:
        """Write a procedural memory into the procedural_memories table.

        Embeds name + description when provider is active; else stores _ZERO_VECTOR (DEFAULT-OFF).
        """
        memory_id = str(uuid.uuid4())
        embedding_str = self._ZERO_VECTOR
        try:
            provider = _get_provider()
            if provider._active:
                embed_text = f"{name}: {description}"
                vec = await provider.embed(embed_text)
                if vec is not None:
                    embedding_str = "[" + ",".join(str(v) for v in vec) + "]"
        except Exception as _emb_exc:
            logger.error("[memory.write_procedural] embedding failed: %s", _emb_exc)

        try:
            await conn.execute(
                """
                INSERT INTO procedural_memories
                    (id, tenant_id, agent_role, embedding, name,
                     description, steps, success_rate,
                     created_at, updated_at)
                VALUES ($1, $2, $3, $4::vector, $5,
                        $6, $7::jsonb, 0.5,
                        $8, $8)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                agent_role,
                embedding_str,
                name,
                description,
                json.dumps(steps),
                datetime.now(timezone.utc),
            )
            logger.info(
                "wrote procedural memory %s for tenant=%s agent=%s name=%s",
                memory_id, tenant_id, agent_role, name,
            )
            return memory_id
        except Exception as e:
            logger.error("failed to write procedural memory: %s", e)
            return ""

    # ─── Lifecycle support methods ──────────────────────────────────────

    async def promote_to_semantic(
        self,
        conn,
        tenant_id: str,
        episodic_ids: list[str],
        summary: str,
        category: str,
        confidence: float = 0.5,
        agent_role: str = "system",
    ) -> str:
        """Create a semantic memory from a cluster of episodic memories.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            episodic_ids: list of episodic memory UUIDs that sourced this
            summary: human-readable summary content
            category: semantic category (writing_preference, agency_knowledge, etc.)
            confidence: initial confidence score (0.0-1.0)
            agent_role: agent role this memory belongs to

        Returns:
            UUID of the created semantic memory, or empty string on failure.
        """
        memory_id = str(uuid.uuid4())
        # Embed summary when provider is active; else zero-vector (DEFAULT-OFF)
        embedding_str = self._ZERO_VECTOR
        try:
            provider = _get_provider()
            if provider._active:
                vec = await provider.embed(summary)
                if vec is not None:
                    embedding_str = "[" + ",".join(str(v) for v in vec) + "]"
        except Exception as _emb_exc:
            logger.error("[memory.promote_to_semantic] embedding failed: %s", _emb_exc)

        try:
            source_uuids = [uuid.UUID(eid) for eid in episodic_ids]
            await conn.execute(
                """
                INSERT INTO semantic_memories
                    (id, tenant_id, agent_role, embedding, content,
                     category, confidence, evidence_count,
                     source_memories, created_at, updated_at,
                     last_accessed)
                VALUES ($1, $2, $3, $4::vector, $5,
                        $6, $7, $8,
                        $9, $10, $10, $10)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                agent_role,
                embedding_str,
                summary,
                category,
                confidence,
                len(episodic_ids),
                source_uuids,
                datetime.now(timezone.utc),
            )
            logger.info(
                "promoted %d episodic memories to semantic=%s for tenant=%s",
                len(episodic_ids), memory_id, tenant_id,
            )
            return memory_id
        except Exception as e:
            logger.error("failed to promote to semantic: %s", e)
            return ""

    async def archive_memories(self, conn, memory_ids: list[str], tenant_id: str) -> int:
        """Bulk archive episodic memories by setting is_archived = true.

        Args:
            conn: asyncpg connection
            memory_ids: list of episodic memory UUIDs to archive
            tenant_id: tenant scope (required for RLS safety)

        Returns:
            Number of memories successfully archived.
        """
        if not memory_ids:
            return 0

        archived = 0
        for mid in memory_ids:
            try:
                result = await conn.execute(
                    """
                    UPDATE episodic_memories
                    SET is_archived = true
                    WHERE id = $1 AND tenant_id = $2 AND is_archived = false
                    """,
                    uuid.UUID(mid),
                    uuid.UUID(tenant_id),
                )
                if result:
                    count = int(result.split()[-1])
                    if count > 0:
                        archived += 1
            except Exception as e:
                logger.error("failed to archive memory=%s: %s", mid, e)

        logger.info("archived %d of %d memories", archived, len(memory_ids))
        return archived

    async def update_decay(self, conn, memory_id: str, new_decay: float, tenant_id: str) -> bool:
        """Update the decay factor for a specific memory.

        Args:
            conn: asyncpg connection
            memory_id: UUID of the episodic memory
            new_decay: new decay factor value (0.0-1.0)
            tenant_id: tenant scope (required for RLS safety)

        Returns:
            True if update succeeded, False otherwise.
        """
        try:
            clamped = max(0.01, min(1.0, new_decay))
            await conn.execute(
                """
                UPDATE episodic_memories
                SET decay_factor = $1
                WHERE id = $2 AND tenant_id = $3
                """,
                clamped,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
            )
            return True
        except Exception as e:
            logger.error("failed to update decay for memory=%s: %s", memory_id, e)
            return False

    async def get_memories_for_lifecycle(
        self,
        conn,
        tenant_id: str,
        older_than_days: int = 30,
        memory_type: str | None = None,
        limit: int = 500,
    ) -> list[dict]:
        """Fetch old memories for lifecycle processing (decay, compaction, GC).

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            older_than_days: only return memories older than this many days
            memory_type: optional filter by memory_type (observation, interaction, etc.)
            limit: max number of memories to return

        Returns:
            List of memory dicts with id, content, metadata, etc.
        """
        try:
            if memory_type:
                rows = await conn.fetch(
                    """
                    SELECT id, agent_role, content, memory_type, importance,
                           decay_factor, metadata, occurred_at, last_accessed,
                           access_count, is_archived
                    FROM episodic_memories
                    WHERE tenant_id = $1
                      AND is_archived = false
                      AND memory_type = $2
                      AND occurred_at < now() - make_interval(days => $3)
                    ORDER BY importance DESC, occurred_at DESC
                    LIMIT $4
                    """,
                    uuid.UUID(tenant_id),
                    memory_type,
                    older_than_days,
                    limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT id, agent_role, content, memory_type, importance,
                           decay_factor, metadata, occurred_at, last_accessed,
                           access_count, is_archived
                    FROM episodic_memories
                    WHERE tenant_id = $1
                      AND is_archived = false
                      AND occurred_at < now() - make_interval(days => $2)
                    ORDER BY importance DESC, occurred_at DESC
                    LIMIT $3
                    """,
                    uuid.UUID(tenant_id),
                    older_than_days,
                    limit,
                )

            return [
                {
                    "id": str(row["id"]),
                    "agent_role": row["agent_role"],
                    "content": row["content"],
                    "memory_type": row["memory_type"],
                    "importance": float(row["importance"]),
                    "decay_factor": float(row["decay_factor"]),
                    "metadata": row["metadata"],
                    "occurred_at": row["occurred_at"].isoformat() if row["occurred_at"] else None,
                    "last_accessed": row["last_accessed"].isoformat() if row["last_accessed"] else None,
                    "access_count": row["access_count"],
                }
                for row in rows
            ]
        except Exception as e:
            logger.error(
                "failed to fetch lifecycle memories for tenant=%s: %s",
                tenant_id, e,
            )
            return []

    # ── Backfill support ─────────────────────────────────────────────────

    async def backfill_embeddings(
        self,
        conn,
        table: str,
        limit: int = 100,
    ) -> int:
        """Backfill embeddings for rows that still carry the zero-vector.

        Only runs when EMBEDDINGS_PROVIDER is active. Skips silently otherwise.

        Supported tables: episodic_memories, semantic_memories, procedural_memories.
        Fetches rows where embedding IS NULL or embedding = zero-vector, embeds
        the content/description, then UPDATEs in place.

        Args:
            conn: asyncpg connection
            table: table name (one of the three memory tables)
            limit: max rows to process in this batch

        Returns:
            Number of rows successfully backfilled (0 when provider inactive).
        """
        allowed_tables = {"episodic_memories", "semantic_memories", "procedural_memories"}
        if table not in allowed_tables:
            logger.error("[backfill_embeddings] unknown table: %s", table)
            return 0

        provider = _get_provider()
        if not provider._active:
            logger.info("[backfill_embeddings] provider not active — skipping")
            return 0

        zero_vec_prefix = "[0.0,0.0,0.0"  # cheap prefix check for all-zeros

        # Determine which column holds the embeddable text
        if table == "procedural_memories":
            content_col = "description"
        else:
            content_col = "content"

        try:
            rows = await conn.fetch(
                f"""
                SELECT id, {content_col}
                FROM {table}
                WHERE embedding IS NULL
                   OR embedding::text LIKE $1
                LIMIT $2
                """,  # noqa: S608 — table is whitelisted above
                f"{zero_vec_prefix}%",
                limit,
            )
        except Exception as exc:
            logger.error("[backfill_embeddings] fetch failed for %s: %s", table, exc)
            return 0

        if not rows:
            return 0

        texts = [row[content_col] or "" for row in rows]
        vectors = await provider.embed_batch(texts)

        updated = 0
        for row, vec in zip(rows, vectors):
            if vec is None:
                continue
            vec_str = "[" + ",".join(str(v) for v in vec) + "]"
            try:
                await conn.execute(
                    f"UPDATE {table} SET embedding = $1::vector WHERE id = $2",  # noqa: S608
                    vec_str,
                    row["id"],
                )
                updated += 1
            except Exception as exc:
                logger.error(
                    "[backfill_embeddings] update failed for id=%s: %s", row["id"], exc
                )

        logger.info("[backfill_embeddings] backfilled %d/%d rows in %s", updated, len(rows), table)
        return updated
