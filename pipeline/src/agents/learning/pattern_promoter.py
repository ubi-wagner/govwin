"""
================================================================================
PatternPromoter — Promotes Confirmed Episodic Patterns to Semantic Knowledge
================================================================================

WHO:    Scheduled weekly job. Runs once per week for each active tenant.

WHAT:   Finds clusters of similar episodic memories (3+ members) that share
        enough keyword overlap to indicate a confirmed pattern. Promotes each
        cluster into a single semantic memory and archives the originals. This
        is the key learning flywheel mechanism.

WHY:    Episodic memories are raw observations. Over time, repeated observations
        confirm patterns that should become durable semantic knowledge. Promoting
        patterns reduces memory clutter, improves retrieval quality, and gives
        agents higher-confidence knowledge to work with.

HOW:    V1 uses keyword overlap (set intersection > 50%) to find clusters.
        For each cluster of 3+ members, creates a semantic memory with
        summarized content, sets confidence based on cluster size, records
        source episodic IDs, and archives the originals.

SCHEDULE: Weekly (once per week per active tenant)

INPUTS: Unarchived episodic memories grouped by agent_role + memory_type

OUTPUTS: semantic_memories (new entries), episodic_memories (archived)

DEPENDENCIES:
    - episodic_memories table (001_baseline.sql)
    - semantic_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.pattern_promoted (single)

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation
================================================================================
"""
from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from events import emit_event

logger = logging.getLogger("pipeline.agents.pattern_promoter")


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


class PatternPromoter:
    """Promotes confirmed episodic patterns to semantic knowledge."""

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

    def _find_clusters(self, memories: list[dict]) -> list[list[dict]]:
        """Find clusters of memories with > 50% keyword overlap.

        Uses simple greedy clustering: start with highest-importance memory,
        add others that overlap > 50% with the seed.
        """
        if len(memories) < 3:
            return []

        # Pre-compute keywords for each memory
        mem_keywords: list[tuple[dict, set[str]]] = []
        for mem in memories:
            kws = self._extract_keywords(mem.get("content", ""))
            mem_keywords.append((mem, kws))

        # Sort by importance descending for seed selection
        mem_keywords.sort(key=lambda x: x[0].get("importance", 0.5), reverse=True)

        clusters: list[list[dict]] = []
        used_ids: set[str] = set()

        for seed_mem, seed_kws in mem_keywords:
            seed_id = str(seed_mem["id"])
            if seed_id in used_ids or len(seed_kws) < 2:
                continue

            cluster = [seed_mem]
            used_ids.add(seed_id)

            for other_mem, other_kws in mem_keywords:
                other_id = str(other_mem["id"])
                if other_id in used_ids or len(other_kws) < 2:
                    continue

                overlap = self._keyword_overlap(seed_kws, other_kws)
                if overlap > 0.5:
                    cluster.append(other_mem)
                    used_ids.add(other_id)

            if len(cluster) >= 3:
                clusters.append(cluster)

        return clusters

    def _summarize_cluster(self, cluster: list[dict]) -> str:
        """Create a summary of a cluster of episodic memories."""
        # Collect all keywords and find the most common ones
        all_keywords: list[str] = []
        for mem in cluster:
            all_keywords.extend(self._extract_keywords(mem.get("content", "")))

        from collections import Counter
        common = Counter(all_keywords).most_common(8)
        top_keywords = [kw for kw, _ in common]

        # Build summary from cluster characteristics
        contents = [mem.get("content", "")[:100] for mem in cluster]
        first_content = contents[0] if contents else ""

        return (
            f"Pattern observed {len(cluster)} times: "
            f"Key themes: {', '.join(top_keywords[:5])}. "
            f"Representative: {first_content}"
        )

    def _infer_category(self, cluster: list[dict]) -> str:
        """Infer a semantic memory category from cluster content."""
        all_content = " ".join(m.get("content", "").lower() for m in cluster)

        if any(w in all_content for w in ["tone", "voice", "style", "format", "bullet", "formal"]):
            return "writing_preference"
        elif any(w in all_content for w in ["agency", "program", "sbir", "sttr", "baa"]):
            return "agency_knowledge"
        elif any(w in all_content for w in ["score", "rating", "calibrat", "predict"]):
            return "scoring_calibration"
        elif any(w in all_content for w in ["process", "workflow", "step", "procedure"]):
            return "process_preference"
        elif any(w in all_content for w in ["person", "pi", "contact", "reviewer"]):
            return "personnel_knowledge"
        else:
            return "content_preference"

    async def promote_for_tenant(self, conn, tenant_id: str) -> list[dict]:
        """Find episodic memories that should become semantic knowledge.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant

        Returns:
            List of promotion result dicts.
        """
        results = []

        try:
            # 1. Fetch all unarchived episodic memories
            rows = await conn.fetch(
                """
                SELECT id, agent_role, content, memory_type, importance, metadata
                FROM episodic_memories
                WHERE tenant_id = $1
                  AND is_archived = false
                ORDER BY importance DESC, occurred_at DESC
                """,
                uuid.UUID(tenant_id),
            )

            if len(rows) < 3:
                logger.info(
                    "tenant=%s has only %d unarchived memories, skipping promotion",
                    tenant_id, len(rows),
                )
                return results

            # 2. Group by agent_role + memory_type
            groups: dict[str, list[dict]] = defaultdict(list)
            for row in rows:
                key = f"{row['agent_role']}:{row['memory_type']}"
                groups[key].append(dict(row))

            # 3. Find clusters in each group
            promoted_count = 0
            archived_count = 0

            for group_key, memories in groups.items():
                clusters = self._find_clusters(memories)

                for cluster in clusters:
                    agent_role = cluster[0]["agent_role"]

                    # 4a. Check that no existing semantic memory covers this pattern
                    cluster_keywords = set()
                    for mem in cluster:
                        cluster_keywords |= self._extract_keywords(mem.get("content", ""))

                    existing = await conn.fetch(
                        """
                        SELECT id, content
                        FROM semantic_memories
                        WHERE tenant_id = $1
                          AND agent_role = $2
                          AND is_active = true
                        """,
                        uuid.UUID(tenant_id),
                        agent_role,
                    )

                    already_covered = False
                    for ex in existing:
                        ex_keywords = self._extract_keywords(ex["content"])
                        overlap = self._keyword_overlap(cluster_keywords, ex_keywords)
                        if overlap > 0.6:
                            already_covered = True
                            break

                    if already_covered:
                        continue

                    # 4b. Create semantic memory
                    summary = self._summarize_cluster(cluster)
                    category = self._infer_category(cluster)
                    confidence = min(1.0, 0.5 + (len(cluster) - 1) * 0.1)
                    source_ids = [mem["id"] for mem in cluster]
                    mem_id = str(uuid.uuid4())

                    try:
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
                            uuid.UUID(mem_id),
                            uuid.UUID(tenant_id),
                            agent_role,
                            self._ZERO_VECTOR,
                            summary,
                            category,
                            confidence,
                            len(cluster),
                            source_ids,
                            datetime.now(timezone.utc),
                        )
                        promoted_count += 1

                        # 4c. Archive the episodic originals
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
                                archived_count += 1
                            except Exception as e:
                                logger.error("failed to archive memory=%s: %s", mem["id"], e)

                        results.append({
                            "action": "promoted",
                            "semantic_memory_id": mem_id,
                            "agent_role": agent_role,
                            "category": category,
                            "confidence": confidence,
                            "cluster_size": len(cluster),
                            "episodic_ids_archived": [str(m["id"]) for m in cluster],
                        })

                    except Exception as e:
                        logger.error("failed to create semantic memory from cluster: %s", e)

            # Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.pattern_promoted",
                tenant_id=tenant_id,
                payload={
                    "tenantId": tenant_id,
                    "patternsPromoted": promoted_count,
                    "memoriesArchived": archived_count,
                    "totalMemoriesScanned": len(rows),
                },
            )

            logger.info(
                "promotion for tenant=%s: %d patterns promoted, %d memories archived",
                tenant_id, promoted_count, archived_count,
            )

            return results

        except Exception as e:
            logger.error("failed to promote patterns for tenant=%s: %s", tenant_id, e)
            return results
