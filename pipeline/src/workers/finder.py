"""
Finder workers — V1 Tier 1

Workers:
  - FinderOppIngestWorker: When new opps are ingested, check which tenants
    should see them and emit customer events
  - FinderDriveArchiveWorker: Archive new opportunities to Drive weekly folders
"""

import json
import logging
from datetime import datetime, timezone

from .base import BaseEventWorker

log = logging.getLogger("workers.finder")


class FinderOppIngestWorker(BaseEventWorker):
    """
    Handles: ingest.new, ingest.updated

    When a new opportunity is ingested or an existing one is updated:
    1. Checks tenant_opportunities to see which tenants have this opp scored
    2. Emits customer_events for each affected tenant:
       - finder.opp_presented (new opp surfaced)
       - For updates: triggers re-scoring via opportunity_events
    """

    namespace = "finder.ingest"
    event_bus = "opportunity_events"
    event_types = ["ingest.new", "ingest.updated"]
    batch_size = 50

    async def handle_event(self, event: dict) -> None:
        opp_id = event["opportunity_id"]
        event_type = event["event_type"]

        if event_type == "ingest.new":
            # Check which tenants have this opp in their pipeline after scoring
            rows = await self.conn.fetch(
                """
                SELECT to2.tenant_id, to2.total_score, to2.pursuit_recommendation,
                       t.max_active_opps, t.product_tier
                FROM tenant_opportunities to2
                JOIN tenants t ON t.id = to2.tenant_id
                WHERE to2.opportunity_id = $1
                  AND t.status = 'active'
                """,
                opp_id,
            )

            for row in rows:
                try:
                    await self.conn.execute(
                        """
                        INSERT INTO customer_events
                            (tenant_id, event_type, opportunity_id, description, metadata)
                        VALUES ($1, 'finder.opp_presented', $2, $3, $4::jsonb)
                        """,
                        row["tenant_id"],
                        opp_id,
                        f"New opportunity scored at {row['total_score']}",
                        json.dumps({
                            "total_score": float(row["total_score"]) if row["total_score"] else None,
                            "recommendation": row["pursuit_recommendation"],
                            "product_tier": row["product_tier"],
                        }),
                    )
                except Exception as e:
                    log.error(f"[finder.ingest] Failed to emit customer event for tenant {row['tenant_id']}: {e}")

        elif event_type == "ingest.updated":
            # Emit a re-score event so the scoring engine picks it up
            await self.conn.execute(
                """
                INSERT INTO opportunity_events
                    (opportunity_id, event_type, source, metadata)
                VALUES ($1, 'scoring.rescored', $2, $3::jsonb)
                """,
                opp_id,
                event.get("source", "unknown"),
                json.dumps({
                    "triggered_by": "ingest.updated",
                    "field_changed": event.get("field_changed"),
                }),
            )


class FinderDriveArchiveWorker(BaseEventWorker):
    """
    Handles: ingest.new

    After a new opportunity is ingested, archives it to the Drive
    weekly folder structure:
      /Opportunities/YYYY-WNN/SAM-{solNum}-{title}/

    This worker runs AFTER the ingest worker, consuming the same events
    but with a different namespace so both get processed.

    Note: Drive API calls are made from the Next.js side via API routes.
    This worker inserts a pipeline_job for drive_sync which the
    Next.js API can then process, OR directly calls the Drive API
    if running in a context with the service account credentials.
    """

    namespace = "finder.drive_archive"
    event_bus = "opportunity_events"
    event_types = ["ingest.new"]
    batch_size = 25

    async def handle_event(self, event: dict) -> None:
        opp_id = event["opportunity_id"]

        # Fetch opportunity details
        opp = await self.conn.fetchrow(
            """
            SELECT id, source, source_id, title, solicitation_number,
                   posted_date, document_urls, source_url
            FROM opportunities WHERE id = $1
            """,
            opp_id,
        )
        if not opp:
            log.warning(f"[finder.drive_archive] Opportunity {opp_id} not found")
            return

        # Queue a drive sync job for this opportunity
        # The actual Drive API call happens in the Next.js worker or a
        # dedicated Drive sync process that has the service account key
        await self.conn.execute(
            """
            INSERT INTO pipeline_jobs (source, run_type, status, triggered_by, parameters)
            VALUES ('drive_sync', 'archive_opp', 'pending', $1, $2::jsonb)
            """,
            self.worker_id,
            json.dumps({
                "opportunity_id": str(opp_id),
                "solicitation_number": opp["solicitation_number"],
                "title": opp["title"],
                "posted_date": opp["posted_date"].isoformat() if opp["posted_date"] else None,
                "document_urls": opp["document_urls"],
                "source_url": opp["source_url"],
            }),
        )

        # Mark the opp as having a drive archive event
        await self.conn.execute(
            """
            INSERT INTO opportunity_events
                (opportunity_id, event_type, source, metadata)
            VALUES ($1, 'drive.archived', $2, $3::jsonb)
            """,
            opp_id,
            opp["source"],
            json.dumps({"queued_job": True}),
        )
