"""
================================================================================
MemoryCompactor — Compresses Clusters of Similar Episodic Memories
================================================================================

WHO:    Scheduled monthly job. Runs once per month for each active tenant.

WHAT:   Finds clusters of similar old episodic memories (older than 30 days)
        and compresses them into summarized semantic memories. The original
        episodic memories are archived. This reduces memory clutter and
        improves retrieval quality.

WHY:    Over time, agents accumulate many episodic memories about similar
        topics. These near-duplicates waste context window budget during
        retrieval and dilute signal. Compaction consolidates them into
        high-value semantic summaries.

HOW:    V1 uses keyword overlap (> 60% using set intersection) to find
        clusters within each agent_role + memory_type group. For clusters
        with 5+ members, creates a semantic memory with summarized content
        and archives the originals.

SCHEDULE: Monthly (once per month per active tenant)

INPUTS: episodic_memories (unarchived, older than 30 days)

OUTPUTS: semantic_memories (new compressed entries), episodic_memories (archived)

DEPENDENCIES:
    - episodic_memories table (001_baseline.sql)
    - semantic_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.compaction_completed (single)

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation
================================================================================
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone

from pipeline.src.events import emit_event

logger = logging.getLogger("pipeline.agents.lifecycle.compactor")


# Stop words for keyword extraction
_STOP_WORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "it", "its",
    "this", "that", "these", "those", "not", "no", "nor", "as", "if",
    "then", "than", "so", "up", "out", "about", "into", "over", "after",
    "before", "between", "under", "all", "each", "every", "both", "few",
    "more", "most", "other", "some", "such", "only", "own", "same",
    "also", "just", "very",
})


class MemoryCompactor:
    """Compresses clusters of similar episodic memories into semantic summaries."""

    # Zero vector placeholder (1536 dims for text-embedding-3-small compat)
    _ZERO_VECTOR = "[" + ",".join(["0.0"] * 1536) + "]"

    def _extract_keywords(self, text: str) -> set[str]:
        """Extract meaningful keywords from text."""
        words = re.findall(r"[a-z]{3,}", text.lower())
        return {w for w in words if w not in _STOP_WORDS}

    def _keyword_overlap(self, kw_a: set[str], kw_b: set[str]) -> float:
        """Compute keyword overlap ratio between two sets."""
        if not kw_a or not kw_b:
            return 0.0
        intersection = kw_a & kw_b
        smaller = min(len(kw_a), len(kw_b))
        return len(intersection) / smaller if smaller > 0 else 0.0

    def _find_clusters(self, memories: list[dict], min_size: int = 5) -> list[list[dict]]:
        """Find clusters of memories with > 60% keyword overlap.

        Args:
            memories: list of memory dicts with id, content
            min_size: minimum cluster size to return (default 5)

        Returns:
            List of clusters (each cluster is a list of memory dicts).
        """
        if len(memories) < min_size:
            return []

        # Pre-compute keywords for each memory
        mem_keywords: list[tuple[dict, set[str]]] = []
        for mem in memories:
            kws = self._extract_keywords(mem.get("content", ""))
            if len(kws) >= 2:
                mem_keywords.append((mem, kws))

        # Sort by importance descending for seed selection
        mem_keywords.sort(key=lambda x: x[0].get("importance", 0.5), reverse=True)

        clusters: list[list[dict]] = []
        used_ids: set[str] = set()

        for seed_mem, seed_kws in mem_keywords:
            seed_id = str(seed_mem["id"])
            if seed_id in used_ids:
                continue

            cluster = [seed_mem]
            used_ids.add(seed_id)

            for other_mem, other_kws in mem_keywords:
                other_id = str(other_mem["id"])
                if other_id in used_ids:
                    continue

                overlap = self._keyword_overlap(seed_kws, other_kws)
                if overlap > 0.6:
                    cluster.append(other_mem)
                    used_ids.add(other_id)

            if len(cluster) >= min_size:
                clusters.append(cluster)

        return clusters

    def _summarize_cluster(self, cluster: list[dict]) -> str:
        """Create a summary of a cluster of episodic memories."""
        all_keywords: list[str] = []
        for mem in cluster:
            all_keywords.extend(self._extract_keywords(mem.get("content", "")))

        common = Counter(all_keywords).most_common(10)
        top_keywords = [kw for kw, _ in common]

        # Find date range
        dates = []
        for mem in cluster:
            occurred = mem.get("occurred_at")
            if occurred:
                dates.append(occurred)

        date_range = ""
        if dates:
            earliest = min(dates)
            latest = max(dates)
            date_range = f" Observed from {earliest.strftime('%Y-%m-%d')} to {latest.strftime('%Y-%m-%d')}."

        return (
            f"Compacted {len(cluster)} observations. "
            f"Dominant themes: {', '.join(top_keywords[:6])}.{date_range}"
        )

    def _infer_category(self, cluster: list[dict]) -> str:
        """Infer a semantic memory category from cluster content."""
        all_content = " ".join(m.get("content", "").lower() for m in cluster)

        if any(w in all_content for w in ["tone", "voice", "style", "format", "bullet", "formal"]):
            return "writing_preference"
        elif any(w in all_content for w in ["agency", "program", "sbir", "sttr", "baa"]):
            return "agency_knowledge"
        elif any(w in all_content for w in ["score", "calibrat", "predict", "accuracy"]):
            return "scoring_calibration"
        elif any(w in all_content for w in ["process", "workflow", "step", "procedure"]):
            return "process_preference"
        elif any(w in all_content for w in ["person", "pi", "contact", "reviewer"]):
            return "personnel_knowledge"
        else:
            return "content_preference"

    async def compact_for_tenant(self, conn, tenant_id: str) -> dict:
        """Find clusters of similar episodic memories and compress.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant

        Returns:
            Compaction result dict with counts.
        """
        clusters_compacted = 0
        memories_archived = 0
        semantics_created = 0

        try:
            # 1. Fetch unarchived episodic memories older than 30 days
            rows = await conn.fetch(
                """
                SELECT id, agent_role, content, memory_type, importance,
                       metadata, occurred_at
                FROM episodic_memories
                WHERE tenant_id = $1
                  AND is_archived = false
                  AND occurred_at < now() - interval '30 days'
                ORDER BY agent_role, memory_type, importance DESC
                """,
                uuid.UUID(tenant_id),
            )

            if len(rows) < 5:
                logger.info(
                    "tenant=%s has only %d old memories, skipping compaction",
                    tenant_id, len(rows),
                )
                return {
                    "tenant_id": tenant_id,
                    "clusters_compacted": 0,
                    "memories_archived": 0,
                    "semantics_created": 0,
                }

            # 2. Group by agent_role + memory_type
            groups: dict[str, list[dict]] = defaultdict(list)
            for row in rows:
                key = f"{row['agent_role']}:{row['memory_type']}"
                groups[key].append(dict(row))

            # 3. Find and process clusters in each group
            now = datetime.now(timezone.utc)

            for group_key, memories in groups.items():
                clusters = self._find_clusters(memories, min_size=5)

                for cluster in clusters:
                    agent_role = cluster[0]["agent_role"]

                    # 4a. Create semantic memory with summarized content
                    summary = self._summarize_cluster(cluster)
                    category = self._infer_category(cluster)

                    # Confidence based on cluster agreement
                    avg_importance = sum(m.get("importance", 0.5) for m in cluster) / len(cluster)
                    confidence = min(1.0, 0.5 + (len(cluster) - 1) * 0.05 + avg_importance * 0.2)

                    source_ids = [mem["id"] for mem in cluster]
                    mem_id = str(uuid.uuid4())

                    try:
                        await conn.execute(
                            """
                            INSERT INTO semantic_memories
                                (id, tenant_id, agent_role, embedding, content,
                                 category, confidence, evidence_count,
                                 source_memories, metadata, created_at, updated_at,
                                 last_accessed)
                            VALUES ($1, $2, $3, $4::vector, $5,
                                    $6, $7, $8,
                                    $9, $10::jsonb, $11, $11, $11)
                            """,
                            uuid.UUID(mem_id),
                            uuid.UUID(tenant_id),
                            agent_role,
                            self._ZERO_VECTOR,
                            summary,
                            category,
                            confidence,
                            len(cluster),
                            source_ids,
                            json.dumps({
                                "source": "compactor",
                                "group_key": group_key,
                                "cluster_size": len(cluster),
                            }),
                            now,
                        )
                        semantics_created += 1
                        clusters_compacted += 1

                        # 4b. Archive original episodic memories
                        for mem in cluster:
                            try:
                                await conn.execute(
                                    """
                                    UPDATE episodic_memories
                                    SET is_archived = true, superseded_by = $1
                                    WHERE id = $2 AND tenant_id = $3
                                    """,
                                    uuid.UUID(mem_id),
                                    mem["id"],
                                    uuid.UUID(tenant_id),
                                )
                                memories_archived += 1
                            except Exception as e:
                                logger.error(
                                    "failed to archive memory=%s during compaction: %s",
                                    mem["id"], e,
                                )

                    except Exception as e:
                        logger.error("failed to create compacted semantic memory: %s", e)

            # 5. Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.compaction_completed",
                tenant_id=tenant_id,
                payload={
                    "tenantId": tenant_id,
                    "clustersCompacted": clusters_compacted,
                    "memoriesArchived": memories_archived,
                    "semanticsCreated": semantics_created,
                    "totalMemoriesScanned": len(rows),
                },
            )

            logger.info(
                "compaction for tenant=%s: %d clusters compacted, %d memories archived, %d semantics created",
                tenant_id, clusters_compacted, memories_archived, semantics_created,
            )

            return {
                "tenant_id": tenant_id,
                "clusters_compacted": clusters_compacted,
                "memories_archived": memories_archived,
                "semantics_created": semantics_created,
            }

        except Exception as e:
            logger.error("compaction failed for tenant=%s: %s", tenant_id, e)
            return {
                "tenant_id": tenant_id,
                "clusters_compacted": 0,
                "memories_archived": 0,
                "semantics_created": 0,
                "error": str(e),
            }
