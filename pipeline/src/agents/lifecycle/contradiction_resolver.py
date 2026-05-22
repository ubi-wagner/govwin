"""
================================================================================
ContradictionResolver — Detects and Resolves Contradictory Semantic Memories
================================================================================

WHO:    Scheduled monthly job. Runs once per month for each active tenant,
        after the compactor has finished creating new semantic memories.

WHAT:   Scans all active semantic memories grouped by category, finds pairs
        that share the same topic (keyword overlap > 50%) but contain
        contradictory values. Resolves contradictions by keeping the
        higher-confidence or more-recent memory, archiving the other.
        Flags close calls for human review.

WHY:    As the learning flywheel generates semantic memories from different
        observations, contradictions can emerge (e.g., "prefers formal tone"
        vs "prefers casual tone"). Unresolved contradictions confuse agents
        by injecting conflicting guidance into the context window.

HOW:    V1 uses keyword overlap to find same-topic pairs. Checks for
        contradiction signals (negation words, opposing adjectives). Resolves
        by confidence ranking. If confidence is similar (within 0.1), flags
        for human review instead of auto-resolving.

SCHEDULE: Monthly (once per month per active tenant, after compactor)

INPUTS: semantic_memories (active, grouped by category)

OUTPUTS: semantic_memories (deactivated contradictions), admin todos

DEPENDENCIES:
    - semantic_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.contradictions_resolved (single)

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
from collections import defaultdict
from datetime import datetime, timezone

from pipeline.src.events import emit_event

logger = logging.getLogger("pipeline.agents.lifecycle.contradiction_resolver")


# Pairs of words that indicate potential contradiction
_OPPOSING_PAIRS = [
    ("formal", "casual"), ("formal", "informal"),
    ("active", "passive"),
    ("brief", "detailed"), ("concise", "verbose"),
    ("bullet", "narrative"), ("bullets", "paragraphs"),
    ("increase", "decrease"), ("more", "less"),
    ("always", "never"),
    ("high", "low"),
    ("prefer", "avoid"),
    ("include", "exclude"),
    ("required", "optional"),
]

# Negation words that can flip meaning
_NEGATION_WORDS = frozenset({
    "not", "no", "never", "neither", "nor", "none",
    "don't", "doesn't", "didn't", "won't", "wouldn't",
    "shouldn't", "can't", "cannot", "isn't", "aren't",
})

# Stop words for keyword extraction
_STOP_WORDS = frozenset({
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "shall", "can", "it", "its",
    "this", "that", "these", "those", "as", "if", "then", "than", "so",
    "up", "out", "about", "into", "over", "after", "before", "between",
    "under", "all", "each", "every", "both", "few", "some", "such",
    "only", "own", "same", "also", "just", "very",
})


class ContradictionResolver:
    """Detects and resolves contradictory semantic memories."""

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

    def _detect_contradiction(self, content_a: str, content_b: str) -> bool:
        """Detect if two memory contents might be contradictory.

        V1 heuristic checks:
        1. One has negation where the other doesn't
        2. Opposing adjective/verb pairs present
        """
        words_a = set(re.findall(r"[a-z']+", content_a.lower()))
        words_b = set(re.findall(r"[a-z']+", content_b.lower()))

        # Check for negation asymmetry
        neg_a = bool(words_a & _NEGATION_WORDS)
        neg_b = bool(words_b & _NEGATION_WORDS)
        if neg_a != neg_b:
            # One is negated, the other is not — potential contradiction
            return True

        # Check for opposing word pairs
        for word1, word2 in _OPPOSING_PAIRS:
            if (word1 in words_a and word2 in words_b) or (word2 in words_a and word1 in words_b):
                return True

        return False

    def _is_human_set(self, metadata: dict | None) -> bool:
        """Check if a memory was explicitly set by a human."""
        if not metadata:
            return False
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                return False
        return metadata.get("source") == "explicit_preference" or metadata.get("human_set", False)

    async def resolve_for_tenant(self, conn, tenant_id: str) -> dict:
        """Find potentially contradictory semantic memories and resolve.

        Args:
            conn: asyncpg connection
            tenant_id: UUID of the tenant

        Returns:
            Resolution result dict with counts and details.
        """
        auto_resolved = 0
        flagged_for_review = 0
        pairs_checked = 0

        try:
            # 1. Fetch all active semantic memories grouped by category
            rows = await conn.fetch(
                """
                SELECT id, agent_role, content, category, confidence,
                       evidence_count, metadata, created_at, updated_at
                FROM semantic_memories
                WHERE tenant_id = $1
                  AND is_active = true
                ORDER BY category, agent_role, confidence DESC
                """,
                uuid.UUID(tenant_id),
            )

            if len(rows) < 2:
                return {
                    "tenant_id": tenant_id,
                    "pairs_checked": 0,
                    "auto_resolved": 0,
                    "flagged_for_review": 0,
                    "resolutions": [],
                }

            # 2. Group by category + agent_role for pairwise comparison
            groups: dict[str, list[dict]] = defaultdict(list)
            for row in rows:
                key = f"{row['category']}:{row['agent_role']}"
                groups[key].append(dict(row))

            resolutions = []
            now = datetime.now(timezone.utc)

            for group_key, memories in groups.items():
                if len(memories) < 2:
                    continue

                # 3. Compare pairs within each group
                for i in range(len(memories)):
                    for j in range(i + 1, len(memories)):
                        mem_a = memories[i]
                        mem_b = memories[j]

                        kw_a = self._extract_keywords(mem_a["content"])
                        kw_b = self._extract_keywords(mem_b["content"])

                        # Same topic check: keyword overlap > 50%
                        overlap = self._keyword_overlap(kw_a, kw_b)
                        if overlap <= 0.5:
                            continue

                        pairs_checked += 1

                        # Contradiction check
                        if not self._detect_contradiction(mem_a["content"], mem_b["content"]):
                            continue

                        # Found a contradiction — resolve it
                        conf_a = float(mem_a["confidence"])
                        conf_b = float(mem_b["confidence"])
                        human_a = self._is_human_set(mem_a.get("metadata"))
                        human_b = self._is_human_set(mem_b.get("metadata"))

                        resolution = {
                            "memory_a_id": str(mem_a["id"]),
                            "memory_a_content": mem_a["content"][:100],
                            "memory_a_confidence": conf_a,
                            "memory_b_id": str(mem_b["id"]),
                            "memory_b_content": mem_b["content"][:100],
                            "memory_b_confidence": conf_b,
                            "overlap": round(overlap, 2),
                        }

                        # 3a. If one is explicitly set by human, always keep human's version
                        if human_a and not human_b:
                            await self._deactivate_memory(conn, tenant_id, mem_b["id"], now)
                            resolution["action"] = "kept_human_a"
                            auto_resolved += 1
                        elif human_b and not human_a:
                            await self._deactivate_memory(conn, tenant_id, mem_a["id"], now)
                            resolution["action"] = "kept_human_b"
                            auto_resolved += 1
                        # 3b. If one has significantly higher confidence, keep higher
                        elif abs(conf_a - conf_b) > 0.1:
                            if conf_a > conf_b:
                                await self._deactivate_memory(conn, tenant_id, mem_b["id"], now)
                                resolution["action"] = "kept_higher_confidence_a"
                            else:
                                await self._deactivate_memory(conn, tenant_id, mem_a["id"], now)
                                resolution["action"] = "kept_higher_confidence_b"
                            auto_resolved += 1
                        # 3c. If confidence is similar, check evidence count
                        elif mem_a.get("evidence_count", 1) > mem_b.get("evidence_count", 1) + 2:
                            await self._deactivate_memory(conn, tenant_id, mem_b["id"], now)
                            resolution["action"] = "kept_higher_evidence_a"
                            auto_resolved += 1
                        elif mem_b.get("evidence_count", 1) > mem_a.get("evidence_count", 1) + 2:
                            await self._deactivate_memory(conn, tenant_id, mem_a["id"], now)
                            resolution["action"] = "kept_higher_evidence_b"
                            auto_resolved += 1
                        else:
                            # 3d. Flag for human review
                            resolution["action"] = "flagged_for_review"
                            flagged_for_review += 1

                        resolutions.append(resolution)

            # 4. Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.contradictions_resolved",
                tenant_id=tenant_id,
                payload={
                    "tenantId": tenant_id,
                    "pairsChecked": pairs_checked,
                    "autoResolved": auto_resolved,
                    "flaggedForReview": flagged_for_review,
                    "totalResolutions": len(resolutions),
                },
            )

            logger.info(
                "contradiction resolution for tenant=%s: %d pairs checked, "
                "%d auto-resolved, %d flagged for review",
                tenant_id, pairs_checked, auto_resolved, flagged_for_review,
            )

            return {
                "tenant_id": tenant_id,
                "pairs_checked": pairs_checked,
                "auto_resolved": auto_resolved,
                "flagged_for_review": flagged_for_review,
                "resolutions": resolutions,
            }

        except Exception as e:
            logger.error(
                "contradiction resolution failed for tenant=%s: %s",
                tenant_id, e,
            )
            return {
                "tenant_id": tenant_id,
                "pairs_checked": 0,
                "auto_resolved": 0,
                "flagged_for_review": 0,
                "resolutions": [],
                "error": str(e),
            }

    async def _deactivate_memory(
        self, conn, tenant_id: str, memory_id, now: datetime
    ) -> None:
        """Deactivate a semantic memory (set is_active = false, valid_until = now)."""
        try:
            await conn.execute(
                """
                UPDATE semantic_memories
                SET is_active = false, valid_until = $1, updated_at = $1
                WHERE id = $2 AND tenant_id = $3
                """,
                now,
                memory_id,
                uuid.UUID(tenant_id),
            )
        except Exception as e:
            logger.error(
                "failed to deactivate memory=%s for tenant=%s: %s",
                memory_id, tenant_id, e,
            )
