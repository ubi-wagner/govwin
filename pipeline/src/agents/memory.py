"""Agent memory operations — hybrid search, write, update across three memory types."""


class MemoryStore:
    """PostgreSQL + pgvector backed memory with tenant isolation."""

    async def search(self, conn, tenant_id: str, query_embedding: list[float], memory_type: str | None = None, limit: int = 10) -> list[dict]:
        # TODO: Implement hybrid search (vector + metadata + recency + importance)
        return []

    async def write_episodic(self, conn, tenant_id: str, agent_role: str, content: str, metadata: dict) -> str:
        # TODO: Implement
        return ""

    async def write_semantic(self, conn, tenant_id: str, agent_role: str, content: str, category: str, confidence: float = 0.5) -> str:
        # TODO: Implement
        return ""

    async def write_procedural(self, conn, tenant_id: str, agent_role: str, name: str, description: str, steps: list[dict]) -> str:
        # TODO: Implement
        return ""
