"""
================================================================================
PreferenceExtractor — Extracts Tenant Preferences from Episodic Memory Patterns
================================================================================

WHO:    Scheduled daily job. Runs once per day for each active tenant that has
        recent episodic memories.

WHAT:   Scans recent episodic memories (last 30 days, importance > 0.3) for
        repeated patterns grouped by agent_role. When the same edit type or
        keyword pattern appears 3+ times, extracts a semantic memory representing
        a tenant preference.

WHY:    Transforms raw episodic observations into durable semantic knowledge.
        This is the first stage of the learning flywheel: repeated observations
        become known preferences that agents can use in future invocations.

HOW:    V1 uses keyword matching (no LLM). Groups episodic memories by
        agent_role, then looks for repeated words/phrases in content fields.
        When a cluster of 3+ memories share dominant keywords, a semantic
        preference is created or reinforced.

SCHEDULE: Daily (once per day per active tenant)

INPUTS: episodic_memories (last 30 days, importance > 0.3)

OUTPUTS: semantic_memories (new or updated preference entries)

DEPENDENCIES:
    - episodic_memories table (001_baseline.sql)
    - semantic_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.preferences_extracted (single)

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

logger = logging.getLogger("pipeline.agents.preference_extractor")


# Common English stop words to ignore during keyword extraction
_STOP_WORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "need", "dare",
    "ought", "used", "it", "its", "this", "that", "these", "those",
    "i", "me", "my", "we", "us", "our", "you", "your", "he", "him",
    "his", "she", "her", "they", "them", "their", "not", "no", "nor",
    "as", "if", "then", "than", "so", "up", "out", "about", "into",
    "over", "after", "before", "between", "under", "above", "below",
    "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "also", "just", "very",
    "human", "edited", "output", "edit", "type", "percentage", "key",
    "changes", "agent", "memory",
})


class PreferenceExtractor:
    """Extracts tenant preferences from episodic memory patterns."""

    # Zero vector placeholder (1536 dims for text-embedding-3-small compat)
    _ZERO_VECTOR = "[" + ",".join(["0.0"] * 1536) + "]"

    def _extract_keywords(self, text: str) -> list[str]:
        """Extract meaningful keywords from text, filtering stop words."""
        words = re.findall(r"[a-z]{3,}", text.lower())
        return [w for w in words if w not in _STOP_WORDS]

    def _find_dominant_themes(self, memories: list[dict]) -> list[dict]:
        """Find keyword themes that appear in 3+ memories.

        Returns list of theme dicts with keywords, memory_ids, and frequency.
        """
        # Count keywords across all memories, tracking which memories contain each
        keyword_to_memories: dict[str, list[str]] = defaultdict(list)

        for mem in memories:
            content = mem.get("content", "")
            keywords = set(self._extract_keywords(content))
            mem_id = str(mem["id"])
            for kw in keywords:
                keyword_to_memories[kw].append(mem_id)

        # Find keywords appearing in 3+ memories
        frequent_keywords = {
            kw: mem_ids
            for kw, mem_ids in keyword_to_memories.items()
            if len(mem_ids) >= 3
        }

        if not frequent_keywords:
            return []

        # Group overlapping keywords into themes
        themes = []
        used_keywords: set[str] = set()

        # Sort by frequency descending
        sorted_kws = sorted(frequent_keywords.items(), key=lambda x: len(x[1]), reverse=True)

        for kw, mem_ids in sorted_kws:
            if kw in used_keywords:
                continue

            # Find other frequent keywords that co-occur in the same memories
            theme_keywords = [kw]
            theme_mem_set = set(mem_ids)
            used_keywords.add(kw)

            for other_kw, other_ids in sorted_kws:
                if other_kw in used_keywords:
                    continue
                other_set = set(other_ids)
                overlap = theme_mem_set & other_set
                if len(overlap) >= 3:
                    theme_keywords.append(other_kw)
                    used_keywords.add(other_kw)

            themes.append({
                "keywords": theme_keywords[:10],  # Cap at 10 keywords per theme
                "memory_ids": list(theme_mem_set),
                "frequency": len(theme_mem_set),
            })

        return themes

    def _classify_preference(self, keywords: list[str], memories: list[dict]) -> str:
        """Classify a preference category based on keywords and memory content."""
        all_content = " ".join(m.get("content", "").lower() for m in memories)

        style_indicators = {"tone", "voice", "formal", "informal", "passive", "active",
                            "style", "formatting", "format", "bullet", "narrative"}
        content_indicators = {"added", "removed", "information", "reference", "contract",
                              "data", "specific", "detail", "content"}
        structure_indicators = {"section", "paragraph", "reorder", "reorganize",
                                "structure", "hierarchy", "heading", "outline"}

        kw_set = set(keywords)
        style_score = len(kw_set & style_indicators) + all_content.count("style")
        content_score = len(kw_set & content_indicators) + all_content.count("content")
        structure_score = len(kw_set & structure_indicators) + all_content.count("structure")

        if style_score >= content_score and style_score >= structure_score:
            return "writing_preference"
        elif structure_score >= content_score:
            return "structure_preference"
        else:
            return "content_preference"

    async def extract_for_tenant(self, conn, tenant_id: str) -> list[dict]:
        """Scan recent episodic memories and extract recurring patterns.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant

        Returns:
            List of preference dicts created or updated.
        """
        results = []

        try:
            # 1. Fetch episodic memories from last 30 days with importance > 0.3
            rows = await conn.fetch(
                """
                SELECT id, agent_role, content, memory_type, importance, metadata
                FROM episodic_memories
                WHERE tenant_id = $1
                  AND is_archived = false
                  AND importance > 0.3
                  AND occurred_at > now() - interval '30 days'
                ORDER BY occurred_at DESC
                """,
                uuid.UUID(tenant_id),
            )

            if len(rows) < 3:
                logger.info(
                    "tenant=%s has only %d recent memories, skipping extraction",
                    tenant_id, len(rows),
                )
                return results

            # 2. Group by agent_role
            by_role: dict[str, list[dict]] = defaultdict(list)
            for row in rows:
                by_role[row["agent_role"]].append(dict(row))

            # 3. For each role, look for repeated themes
            for agent_role, memories in by_role.items():
                if len(memories) < 3:
                    continue

                themes = self._find_dominant_themes(memories)

                for theme in themes:
                    if theme["frequency"] < 3:
                        continue

                    keywords = theme["keywords"]
                    category = self._classify_preference(keywords, memories)
                    preference_content = (
                        f"Recurring pattern for {agent_role}: "
                        f"themes [{', '.join(keywords[:5])}] "
                        f"observed {theme['frequency']} times"
                    )

                    # 4. Check if semantic memory already exists for this preference
                    # Use keyword overlap to find similar existing preferences
                    existing = await conn.fetch(
                        """
                        SELECT id, content, confidence, evidence_count
                        FROM semantic_memories
                        WHERE tenant_id = $1
                          AND agent_role = $2
                          AND category = $3
                          AND is_active = true
                        """,
                        uuid.UUID(tenant_id),
                        agent_role,
                        category,
                    )

                    matched_existing = None
                    for ex in existing:
                        ex_keywords = set(self._extract_keywords(ex["content"]))
                        theme_keywords_set = set(keywords)
                        overlap = ex_keywords & theme_keywords_set
                        if len(overlap) >= 2:
                            matched_existing = ex
                            break

                    if matched_existing:
                        # Update existing: increment evidence_count, update confidence
                        new_evidence = matched_existing["evidence_count"] + 1
                        new_confidence = min(1.0, 0.5 + (new_evidence - 1) * 0.1)

                        try:
                            await conn.execute(
                                """
                                UPDATE semantic_memories
                                SET evidence_count = $1,
                                    confidence = $2,
                                    updated_at = $3
                                WHERE id = $4 AND tenant_id = $5
                                """,
                                new_evidence,
                                new_confidence,
                                datetime.now(timezone.utc),
                                matched_existing["id"],
                                uuid.UUID(tenant_id),
                            )
                            results.append({
                                "action": "updated",
                                "memory_id": str(matched_existing["id"]),
                                "agent_role": agent_role,
                                "category": category,
                                "evidence_count": new_evidence,
                                "confidence": new_confidence,
                            })
                        except Exception as e:
                            logger.error(
                                "failed to update preference memory=%s: %s",
                                matched_existing["id"], e,
                            )
                    else:
                        # Create new semantic memory with confidence 0.5
                        mem_id = str(uuid.uuid4())
                        source_ids = [uuid.UUID(mid) for mid in theme["memory_ids"][:10]]

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
                                preference_content,
                                category,
                                0.5,
                                theme["frequency"],
                                source_ids,
                                json.dumps({"keywords": keywords[:10], "source": "preference_extractor"}),
                                datetime.now(timezone.utc),
                            )
                            results.append({
                                "action": "created",
                                "memory_id": mem_id,
                                "agent_role": agent_role,
                                "category": category,
                                "evidence_count": theme["frequency"],
                                "confidence": 0.5,
                            })
                        except Exception as e:
                            logger.error(
                                "failed to create preference memory: %s", e,
                            )

            # Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.preferences_extracted",
                tenant_id=tenant_id,
                payload={
                    "tenantId": tenant_id,
                    "preferencesCreated": sum(1 for r in results if r["action"] == "created"),
                    "preferencesUpdated": sum(1 for r in results if r["action"] == "updated"),
                    "totalMemoriesScanned": len(rows),
                },
            )

            logger.info(
                "extracted preferences for tenant=%s: %d created, %d updated from %d memories",
                tenant_id,
                sum(1 for r in results if r["action"] == "created"),
                sum(1 for r in results if r["action"] == "updated"),
                len(rows),
            )

            return results

        except Exception as e:
            logger.error("failed to extract preferences for tenant=%s: %s", tenant_id, e)
            return results
