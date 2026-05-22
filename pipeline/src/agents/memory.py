"""Agent memory operations — store and recall from episodic_memories table.

V1 implementation: text-based store/recall without vector embeddings.
Uses the episodic_memories table with tenant isolation via tenant_id + agent_role.
Vector search (embedding-based recall) deferred to V2 when embedding pipeline is ready.
"""

import json
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger("pipeline.agents.memory")


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

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            agent_name: agent role/archetype name
            memory_data: dict with input_summary, output_summary, timestamp

        Returns:
            UUID of the created memory row
        """
        memory_id = str(uuid.uuid4())
        content = json.dumps(memory_data)

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
                self._ZERO_VECTOR,
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
            return memory_id
        except Exception as e:
            logger.error("failed to store memory: %s", e)
            return ""

    async def recall(self, conn, tenant_id: str, agent_name: str, limit: int = 10) -> list[dict]:
        """Recall recent memories for a tenant+agent pair.

        V1: recency-based recall (most recent first, weighted by importance).
        V2 will add vector similarity when embedding pipeline is ready.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant
            agent_name: agent role/archetype name
            limit: max number of memories to return

        Returns:
            List of memory dicts with content and metadata
        """
        try:
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

            return memories
        except Exception as e:
            logger.error("failed to recall memories: %s", e)
            return []

    async def search(self, conn, tenant_id: str, query_embedding: list[float], memory_type: str | None = None, agent_role: str | None = None, limit: int = 10) -> list[dict]:
        """Search memories by vector similarity (V2 — requires embeddings).

        Falls back to recency-based recall if embeddings are zero vectors.
        """
        if agent_role:
            return await self.recall(conn, tenant_id, agent_role, limit=limit)
        # V1 fallback: query without agent_role filter
        try:
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
        """Write a semantic memory into the semantic_memories table."""
        memory_id = str(uuid.uuid4())
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
                self._ZERO_VECTOR,
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
        """Write a procedural memory into the procedural_memories table."""
        memory_id = str(uuid.uuid4())
        try:
            await conn.execute(
                """
                INSERT INTO procedural_memories
                    (id, tenant_id, agent_role, embedding, name,
                     description, steps, confidence,
                     created_at, updated_at, last_accessed)
                VALUES ($1, $2, $3, $4::vector, $5,
                        $6, $7::jsonb, 0.5,
                        $8, $8, $8)
                """,
                uuid.UUID(memory_id),
                uuid.UUID(tenant_id),
                agent_role,
                self._ZERO_VECTOR,
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
                self._ZERO_VECTOR,
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
