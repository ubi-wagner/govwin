"""
Reminder workers — V1 Tier 2

Workers:
  - ReminderDeadlineWorker: Check deadlines for pursued opps, queue nudge emails
  - ReminderAmendmentWorker: When opp is updated, alert tenants tracking it
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from .base import BaseEventWorker
from events import emit_customer_event, pipeline_actor, trigger_ref

log = logging.getLogger("workers.reminder")


class ReminderDeadlineWorker(BaseEventWorker):
    """
    Scheduled worker (runs daily via pipeline_jobs, not event-driven).

    Checks all tenants with product_tier in ('reminder','binder','grinder')
    for opportunities they are pursuing/monitoring with approaching deadlines.

    Nudge schedule:
      - 7 days before close: first nudge
      - 3 days before close: second nudge
      - 1 day before close: urgent nudge

    Emits customer_events: reminder.nudge_sent
    Queues notifications_queue entries for email delivery.
    """

    namespace = "reminder.deadline"
    event_bus = "customer_events"
    # This worker is triggered by a scheduled pipeline_job, not by events.
    # It reads directly from tenant_opportunities to check deadlines.
    event_types = ["reminder.deadline_acknowledged"]
    batch_size = 50

    async def check_deadlines(self) -> dict[str, int]:
        """
        Main scheduled method. Called by the pipeline job executor.
        Returns: { 'nudges_sent': N, 'tenants_checked': N }
        """
        nudge_windows = [
            (1, "urgent"),
            (3, "second"),
            (7, "first"),
        ]

        nudges_sent = 0
        now = datetime.now(timezone.utc)

        # Find all reminder+ tenants with active opps
        tenants = await self.conn.fetch(
            """
            SELECT DISTINCT t.id AS tenant_id, t.name, t.product_tier, t.primary_email
            FROM tenants t
            WHERE t.status = 'active'
              AND t.product_tier IN ('reminder', 'binder', 'grinder')
            """
        )

        for tenant in tenants:
            for days, nudge_type in nudge_windows:
                window_start = now + timedelta(days=days - 1)
                window_end = now + timedelta(days=days)

                # Find opps closing in this window that haven't been nudged yet
                opps = await self.conn.fetch(
                    """
                    SELECT o.id, o.title, o.solicitation_number, o.close_date, o.agency,
                           to2.total_score, to2.pursuit_status
                    FROM tenant_opportunities to2
                    JOIN opportunities o ON o.id = to2.opportunity_id
                    WHERE to2.tenant_id = $1
                      AND to2.pursuit_status IN ('pursuing', 'monitoring')
                      AND o.close_date BETWEEN $2 AND $3
                      AND o.status = 'active'
                      AND NOT EXISTS (
                          SELECT 1 FROM customer_events ce
                          WHERE ce.tenant_id = $1
                            AND ce.opportunity_id = o.id
                            AND ce.event_type = 'reminder.nudge_sent'
                            AND (ce.metadata->>'nudge_type')::text = $4
                      )
                    """,
                    tenant["tenant_id"],
                    window_start,
                    window_end,
                    nudge_type,
                )

                for opp in opps:
                    # Emit customer event
                    await emit_customer_event(
                        self.conn,
                        tenant_id=str(tenant["tenant_id"]),
                        event_type="reminder.nudge_sent",
                        opportunity_id=str(opp["id"]),
                        entity_type="opportunity",
                        entity_id=str(opp["id"]),
                        description=f"{nudge_type} deadline nudge: {opp['title']} closes in {days} day(s)",
                        actor=pipeline_actor("reminder_deadline"),
                        refs={
                            "tenant_id": str(tenant["tenant_id"]),
                            "opportunity_id": str(opp["id"]),
                        },
                        payload={
                            "nudge_type": nudge_type,
                            "days_remaining": days,
                            "close_date": opp["close_date"].isoformat() if opp["close_date"] else None,
                            "pursuit_status": opp["pursuit_status"],
                            "total_score": float(opp["total_score"]) if opp["total_score"] else None,
                            "solicitation_number": opp["solicitation_number"],
                            "agency": opp["agency"],
                            "tenant_name": tenant["name"],
                            "product_tier": tenant["product_tier"],
                        },
                    )

                    # Queue email notification
                    subject = {
                        "urgent": f"URGENT: {opp['title']} closes TOMORROW",
                        "second": f"Reminder: {opp['title']} closes in 3 days",
                        "first": f"Heads up: {opp['title']} closes in 7 days",
                    }[nudge_type]

                    await self.conn.execute(
                        """
                        INSERT INTO notifications_queue
                            (tenant_id, notification_type, subject, related_ids, priority)
                        VALUES ($1, 'deadline_nudge', $2, $3::jsonb, $4)
                        """,
                        tenant["tenant_id"],
                        subject,
                        json.dumps([str(opp["id"])]),
                        1 if nudge_type == "urgent" else 3 if nudge_type == "second" else 5,
                    )

                    nudges_sent += 1

        return {"nudges_sent": nudges_sent, "tenants_checked": len(tenants)}

    async def handle_event(self, event: dict) -> None:
        # Handle acknowledgments — currently a no-op, but tracked for analytics
        log.info(
            f"[reminder.deadline] Tenant {event.get('tenant_id')} "
            f"acknowledged nudge for opp {event.get('opportunity_id')}"
        )


class ReminderAmendmentWorker(BaseEventWorker):
    """
    Handles: ingest.updated, ingest.field_changed

    When an opportunity is amended on SAM.gov:
    1. Find all tenants tracking this opp (pursuing or monitoring)
    2. Filter to reminder+ tier tenants
    3. Emit customer_events: reminder.amendment_alert
    4. Queue notification emails
    """

    namespace = "reminder.amendment"
    event_bus = "opportunity_events"
    event_types = ["ingest.updated", "ingest.field_changed"]
    batch_size = 50

    async def handle_event(self, event: dict) -> None:
        opp_id = event["opportunity_id"]
        field_changed = event.get("field_changed", "unknown")
        old_value = event.get("old_value")
        new_value = event.get("new_value")

        # Find all reminder+ tenants tracking this opp
        tenants = await self.conn.fetch(
            """
            SELECT to2.tenant_id, to2.pursuit_status, to2.total_score,
                   t.name AS tenant_name, t.primary_email, t.product_tier
            FROM tenant_opportunities to2
            JOIN tenants t ON t.id = to2.tenant_id
            WHERE to2.opportunity_id = $1
              AND to2.pursuit_status IN ('pursuing', 'monitoring')
              AND t.status = 'active'
              AND t.product_tier IN ('reminder', 'binder', 'grinder')
            """,
            opp_id,
        )

        if not tenants:
            return

        # Get opp details for the notification
        opp = await self.conn.fetchrow(
            "SELECT title, solicitation_number, agency FROM opportunities WHERE id = $1",
            opp_id,
        )
        if not opp:
            return

        for tenant in tenants:
            # Emit customer event
            await emit_customer_event(
                self.conn,
                tenant_id=str(tenant["tenant_id"]),
                event_type="reminder.amendment_alert",
                opportunity_id=str(opp_id),
                entity_type="opportunity",
                entity_id=str(opp_id),
                description=f"Amendment detected on {opp['title']}: {field_changed} changed",
                actor=pipeline_actor("reminder_amendment"),
                trigger=trigger_ref(str(event["id"]), event["event_type"]),
                refs={
                    "tenant_id": str(tenant["tenant_id"]),
                    "opportunity_id": str(opp_id),
                },
                payload={
                    "field_changed": field_changed,
                    "old_value": old_value,
                    "new_value": new_value,
                    "pursuit_status": tenant["pursuit_status"],
                    "total_score": float(tenant["total_score"]) if tenant["total_score"] else None,
                    "solicitation_number": opp["solicitation_number"],
                    "agency": opp["agency"],
                    "tenant_name": tenant["tenant_name"],
                    "product_tier": tenant["product_tier"],
                },
            )

            # Queue notification
            await self.conn.execute(
                """
                INSERT INTO notifications_queue
                    (tenant_id, notification_type, subject, related_ids, priority)
                VALUES ($1, 'amendment_alert', $2, $3::jsonb, 2)
                """,
                tenant["tenant_id"],
                f"Amendment: {opp['title']} - {field_changed} updated",
                json.dumps([str(opp_id)]),
            )

        log.info(
            f"[reminder.amendment] Alerted {len(tenants)} tenants "
            f"about amendment to opp {opp_id} ({field_changed})"
        )
