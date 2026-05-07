"""RFP Shredder worker — standalone entry point for shredding solicitations.

Wraps the shredder runner (shredder.runner.shred_solicitation) with
proper connection management and error handling. Can be invoked:

  1. Via the dispatcher (pipeline_jobs kind='shred_solicitation') — this
     is the normal path; the dispatcher calls _run_shred_job which uses
     shredder.runner directly.

  2. Via this worker class when the shredder needs to be invoked from
     other pipeline code (e.g. batch re-shred, admin API trigger).

The worker does NOT duplicate the dispatcher logic. It provides:
  - Standalone run() for direct invocation with a connection
  - Batch re-shred support (process all solicitations in a given status)
  - Event emission for the finder.rfp.shredded lifecycle event
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

log = logging.getLogger("pipeline.workers.rfp_shredder")


class RfpShredderWorker:
    """Worker that orchestrates RFP shredding for one or many solicitations."""

    async def run(
        self,
        conn: asyncpg.Connection,
        solicitation_id: Optional[str] = None,
        batch_status: Optional[str] = None,
        batch_limit: int = 10,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Run the shredder for a single solicitation or a batch.

        Args:
            conn: asyncpg connection.
            solicitation_id: If provided, shred this single solicitation.
            batch_status: If provided (and no solicitation_id), shred all
                solicitations with this status, up to batch_limit.
            batch_limit: Max solicitations to process in batch mode.

        Returns:
            Summary dict with results per solicitation processed.
        """
        if solicitation_id:
            return await self._shred_one(conn, solicitation_id)

        if batch_status:
            return await self._shred_batch(conn, batch_status, batch_limit)

        return {"error": "solicitation_id or batch_status required", "processed": 0}

    async def _shred_one(
        self,
        conn: asyncpg.Connection,
        solicitation_id: str,
    ) -> dict[str, Any]:
        """Shred a single solicitation and emit lifecycle events."""
        from shredder import runner as shredder_runner

        # Get or create the Anthropic client
        client = getattr(shredder_runner, "ANTHROPIC_CLIENT", None)
        if client is None:
            try:
                import anthropic
                client = anthropic.AsyncAnthropic()
            except ImportError:
                log.error("anthropic SDK not available")
                return {
                    "error": "anthropic SDK not installed",
                    "solicitation_id": solicitation_id,
                }

        try:
            result = await shredder_runner.shred_solicitation(
                conn, solicitation_id, client
            )
        except Exception as e:
            log.error(
                "shredder failed for %s: %s", solicitation_id, e
            )
            return {
                "error": str(e)[:500],
                "solicitation_id": solicitation_id,
                "status": "shredder_failed",
            }

        # Emit the finder.rfp.shredded lifecycle event
        await self._emit_shredded_event(conn, solicitation_id, result)

        return result

    async def _shred_batch(
        self,
        conn: asyncpg.Connection,
        status: str,
        limit: int,
    ) -> dict[str, Any]:
        """Shred all solicitations with the given status, up to limit."""
        rows = await conn.fetch(
            """
            SELECT id FROM curated_solicitations
            WHERE status = $1
            ORDER BY created_at ASC
            LIMIT $2
            """,
            status,
            limit,
        )

        results: list[dict[str, Any]] = []
        succeeded = 0
        failed = 0

        for row in rows:
            sol_id = str(row["id"])
            result = await self._shred_one(conn, sol_id)
            results.append(result)
            if result.get("status") == "ai_analyzed":
                succeeded += 1
            else:
                failed += 1

        return {
            "processed": len(results),
            "succeeded": succeeded,
            "failed": failed,
            "results": results,
        }

    async def _emit_shredded_event(
        self,
        conn: asyncpg.Connection,
        solicitation_id: str,
        result: dict[str, Any],
    ) -> None:
        """Emit finder.rfp.shredded event after successful shredding.

        This is the lifecycle event that downstream systems (scoring,
        spotlight, customer notifications) listen for.
        """
        try:
            await conn.execute(
                """
                INSERT INTO system_events
                  (id, namespace, type, phase, actor_type, actor_id,
                   payload, created_at)
                VALUES ($1, 'finder', 'rfp.shredded', 'single',
                        'pipeline', 'rfp_shredder',
                        $2::jsonb, now())
                """,
                uuid.uuid4(),
                json.dumps({
                    "solicitation_id": solicitation_id,
                    "status": result.get("status"),
                    "sections": result.get("sections", 0),
                    "compliance_matches": result.get("compliance_matches", 0),
                    "namespace": result.get("namespace"),
                    "total_input_tokens": result.get("total_input_tokens", 0),
                    "total_output_tokens": result.get("total_output_tokens", 0),
                }),
            )
        except Exception as e:
            log.error("failed to emit rfp.shredded event: %s", e)
