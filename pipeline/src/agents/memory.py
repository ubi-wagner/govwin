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

    async def search(self, conn, tenant_id: str, query_embedding: list[float], memory_type: str | None = None, limit: int = 10) -> list[dict]:
        """Search memories by vector similarity (V2 — requires embeddings).

        Falls back to recency-based recall if embeddings are zero vectors.
        """
        # V1: delegate to recency-based recall since we don't have real embeddings yet
        # When embedding pipeline is ready, this will use cosine similarity
        return await self.recall(conn, tenant_id, "all", limit=limit)

    async def write_episodic(self, conn, tenant_id: str, agent_role: str, content: str, metadata: dict) -> str:
        """Write a raw episodic memory."""
        return await self.store(conn, tenant_id, agent_role, {
            "input_summary": content[:200],
            "output_summary": "",
            "raw_content": content,
            **metadata,
        })

    async def write_semantic(self, conn, tenant_id: str, agent_role: str, content: str, category: str, confidence: float = 0.5) -> str:
        """Write a semantic memory (stored as episodic with semantic type metadata)."""
        return await self.store(conn, tenant_id, agent_role, {
            "input_summary": f"[semantic:{category}] {content[:150]}",
            "output_summary": "",
            "category": category,
            "confidence": confidence,
            "raw_content": content,
        })

    async def write_procedural(self, conn, tenant_id: str, agent_role: str, name: str, description: str, steps: list[dict]) -> str:
        """Write a procedural memory (stored as episodic with procedural type metadata)."""
        return await self.store(conn, tenant_id, agent_role, {
            "input_summary": f"[procedural:{name}] {description[:150]}",
            "output_summary": "",
            "procedure_name": name,
            "description": description,
            "steps": steps,
        })
