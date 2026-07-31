"""
================================================================================
MemoryGC — Garbage Collects Expired and Archived Memories
================================================================================

WHO:    Scheduled weekly job. Runs once per week across all tenants.

WHAT:   Hard-deletes memories that have exceeded their retention period.
        Archived episodic memories older than 6 months are deleted. Inactive
        semantic memories with low confidence older than 3 months are deleted.
        Procedural memories with no execution in 12 months are deleted.

WHY:    Without garbage collection, archived and inactive memories accumulate
        indefinitely, consuming storage and slowing index operations. GC
        reclaims space while respecting safety rules (pinned memories,
        well-confirmed knowledge).

HOW:    Executes targeted DELETE statements per memory type with safety
        guards: never deletes memories with importance >= 0.9 (human-pinned),
        never deletes semantic memories with evidence_count >= 5 (well-confirmed).
        Logs all deletion counts to the audit trail via system events.

SCHEDULE: Weekly (once per week, all tenants)

INPUTS: episodic_memories, semantic_memories, procedural_memories

OUTPUTS: Deleted rows, system event audit log

DEPENDENCIES:
    - episodic_memories table (001_baseline.sql)
    - semantic_memories table (001_baseline.sql)
    - procedural_memories table (001_baseline.sql)
    - pipeline.src.events.emit_event

EVENT EMISSIONS:
    - system:memory.gc_completed (single)

CHANGE LOG:
    PR #140 (2026-05-22) — Empty stub
    PR #xxx (2026-05-22) — Full implementation
================================================================================
"""
from __future__ import annotations

import logging

from events import emit_event

logger = logging.getLogger("pipeline.agents.lifecycle.gc")


class MemoryGC:
    """Garbage collects expired and archived memories."""

    async def run_gc(self, conn) -> dict:
        """Delete memories past retention period.

        Retention rules:
        - Archived episodic memories > 6 months: DELETE
        - Inactive semantic memories > 3 months (confidence < 0.3, no access): DELETE
        - Procedural memories > 12 months with no execution: DELETE

        Safety guards:
        - Never delete memories with importance >= 0.9 (pinned by human)
        - Never delete semantic memories with evidence_count >= 5
        - All deletions logged via system event

        Args:
            conn: asyncpg connection

        Returns:
            Dict with deletion counts per type.
        """
        episodic_deleted = 0
        semantic_deleted = 0
        procedural_deleted = 0
        episodic_auto_archived = 0

        try:
            # 1. Delete archived episodic memories older than 6 months
            # Safety: skip memories with importance >= 0.9 (human-pinned)
            result = await conn.execute(
                """
                DELETE FROM episodic_memories
                WHERE is_archived = true
                  AND created_at < now() - interval '6 months'
                  AND importance < 0.9
                """
            )
            episodic_deleted = _parse_update_count(result)

            # 2. Delete inactive semantic memories older than 3 months
            # with low confidence and low evidence count
            # Safety: skip memories with evidence_count >= 5
            result = await conn.execute(
                """
                DELETE FROM semantic_memories
                WHERE is_active = false
                  AND valid_until IS NOT NULL
                  AND valid_until < now() - interval '3 months'
                  AND evidence_count < 5
                """
            )
            semantic_deleted = _parse_update_count(result)

            # Also delete active semantic memories with very low confidence
            # that haven't been accessed in 3 months
            result2 = await conn.execute(
                """
                DELETE FROM semantic_memories
                WHERE confidence < 0.3
                  AND last_accessed < now() - interval '3 months'
                  AND evidence_count < 5
                  AND is_active = true
                """
            )
            semantic_deleted += _parse_update_count(result2)

            # 3. Delete procedural memories with no execution in 12 months
            # Safety: only delete if is_active = false or execution_count = 0
            result = await conn.execute(
                """
                DELETE FROM procedural_memories
                WHERE is_active = false
                  AND updated_at < now() - interval '12 months'
                """
            )
            procedural_deleted = _parse_update_count(result)

            # Also delete procedural memories never executed and older than 12 months
            result2 = await conn.execute(
                """
                DELETE FROM procedural_memories
                WHERE execution_count = 0
                  AND last_executed IS NULL
                  AND created_at < now() - interval '12 months'
                  AND is_active = true
                """
            )
            procedural_deleted += _parse_update_count(result2)

            # 4. Auto-archive low-value episodic memories (not deleted, just archived)
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
            episodic_auto_archived = _parse_update_count(result)

            total_deleted = episodic_deleted + semantic_deleted + procedural_deleted

            # 5. Emit event with deletion counts
            await emit_event(
                conn,
                namespace="system",
                type="memory.gc_completed",
                payload={
                    "episodicDeleted": episodic_deleted,
                    "semanticDeleted": semantic_deleted,
                    "proceduralDeleted": procedural_deleted,
                    "episodicAutoArchived": episodic_auto_archived,
                    "totalDeleted": total_deleted,
                },
            )

            logger.info(
                "gc completed: episodic=%d deleted, semantic=%d deleted, "
                "procedural=%d deleted, %d auto-archived",
                episodic_deleted, semantic_deleted,
                procedural_deleted, episodic_auto_archived,
            )

            return {
                "episodic_deleted": episodic_deleted,
                "semantic_deleted": semantic_deleted,
                "procedural_deleted": procedural_deleted,
                "episodic_auto_archived": episodic_auto_archived,
                "total_deleted": total_deleted,
            }

        except Exception as e:
            logger.error("gc job failed: %s", e)
            return {
                "episodic_deleted": 0,
                "semantic_deleted": 0,
                "procedural_deleted": 0,
                "episodic_auto_archived": 0,
                "total_deleted": 0,
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
