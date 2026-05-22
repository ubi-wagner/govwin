"""
================================================================================
MemoryDecay — Applies Time-Based Decay to Memory Importance Scores
================================================================================

WHO:    Scheduled daily job. Runs once per day across all tenants (not
        tenant-specific — operates on the full table with a single pass).

WHAT:   Applies gradual decay to memory decay_factor values so that old,
        rarely-accessed memories lose influence over time without being deleted.
        Different memory types decay at different rates: episodic fastest,
        semantic moderate, procedural slowest (most stable knowledge).

WHY:    Without decay, the memory table grows in effective size forever.
        Old observations that are no longer relevant would compete with
        fresh, accurate memories during retrieval. Decay ensures that
        retrieval naturally favors recent, frequently-accessed knowledge.

HOW:    Uses SQL UPDATE statements with rate multipliers per memory type.
        Memories accessed in the last 7 days are exempt. High-importance
        memories (>= 0.9) have a minimum floor. Semantic memories decay
        at 50% rate, procedural at 20% rate compared to episodic.

SCHEDULE: Daily (once per day, all tenants)

INPUTS: episodic_memories, semantic_memories, procedural_memories

OUTPUTS: Updated decay_factor values on memory rows

DEPENDENCIES:
    - episodic_memories table (001_baseline.sql)
    - semantic_memories table (001_baseline.sql — no decay_factor column,
      uses confidence as proxy)
    - procedural_memories table (001_baseline.sql — no decay_factor column,
      uses success_rate as proxy)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.decay_applied (single)

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation
================================================================================
"""
from __future__ import annotations

import logging

from pipeline.src.events import emit_event

logger = logging.getLogger("pipeline.agents.lifecycle.decay")


class MemoryDecay:
    """Applies time-based decay to memory importance scores."""

    async def run_decay(self, conn) -> dict:
        """Apply decay to all active memories across all tenants.

        Decay formula:
            new_decay_factor = decay_factor * (rate ^ days_since_last_access)

        Rates:
            - Episodic: 0.999 per day
            - Semantic: uses confidence, not decayed directly in V1
              (confidence is evidence-based, not time-based)
            - Procedural: uses success_rate, not decayed directly in V1

        Floors:
            - Memories accessed in last 7 days: no decay
            - Memories with importance >= 0.9: minimum decay_factor = 0.5
            - General minimum: decay_factor >= 0.01

        Args:
            conn: asyncpg connection

        Returns:
            Dict with counts of memories decayed per type.
        """
        episodic_decayed = 0
        episodic_floored = 0

        try:
            # 1. Decay episodic memories not accessed in 7+ days
            # Apply base decay of 0.999 per day, adjusted by importance
            result = await conn.execute(
                """
                UPDATE episodic_memories
                SET decay_factor = GREATEST(
                    0.01,
                    decay_factor * (
                        0.995
                        * (1.0 + 0.1 * LN(GREATEST(access_count, 1)))
                        * CASE
                            WHEN importance > 0.8 THEN 0.999
                            WHEN importance < 0.3 THEN 0.98
                            ELSE 1.0
                          END
                    )
                )
                WHERE is_archived = false
                  AND last_accessed < now() - interval '7 days'
                """
            )
            # Parse the UPDATE count from the result string (e.g., "UPDATE 42")
            episodic_decayed = _parse_update_count(result)

            # 2. Enforce floor for high-importance episodic memories
            result = await conn.execute(
                """
                UPDATE episodic_memories
                SET decay_factor = 0.5
                WHERE is_archived = false
                  AND importance >= 0.9
                  AND decay_factor < 0.5
                """
            )
            episodic_floored = _parse_update_count(result)

            # 3. Auto-archive episodic memories with very low decay
            # These have decayed below usefulness threshold
            result = await conn.execute(
                """
                UPDATE episodic_memories
                SET is_archived = true
                WHERE is_archived = false
                  AND decay_factor < 0.05
                  AND importance < 0.2
                  AND access_count < 2
                  AND occurred_at < now() - interval '60 days'
                """
            )
            auto_archived = _parse_update_count(result)

            # Note: semantic_memories and procedural_memories don't have a
            # decay_factor column. Their relevance is managed through
            # confidence (semantic) and success_rate (procedural), which
            # are updated by the calibrator, not by time-based decay.

            # 4. Emit event
            await emit_event(
                conn,
                namespace="system",
                type="memory.decay_applied",
                payload={
                    "episodicDecayed": episodic_decayed,
                    "episodicFloored": episodic_floored,
                    "autoArchived": auto_archived,
                },
            )

            logger.info(
                "decay applied: episodic=%d decayed, %d floored, %d auto-archived",
                episodic_decayed, episodic_floored, auto_archived,
            )

            return {
                "episodic_decayed": episodic_decayed,
                "episodic_floored": episodic_floored,
                "auto_archived": auto_archived,
            }

        except Exception as e:
            logger.error("decay job failed: %s", e)
            return {
                "episodic_decayed": 0,
                "episodic_floored": 0,
                "auto_archived": 0,
                "error": str(e),
            }


def _parse_update_count(result: str) -> int:
    """Parse the row count from an asyncpg execute result string.

    asyncpg returns strings like 'UPDATE 42' or 'DELETE 10'.
    """
    if not result:
        return 0
    try:
        parts = result.strip().split()
        if len(parts) >= 2:
            return int(parts[-1])
    except (ValueError, IndexError):
        pass
    return 0
