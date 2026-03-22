"""
Email Trigger Worker — Real-time email delivery for urgent customer events.

Consumes customer_events bus for high-priority notification types:
  - reminder.amendment_alert   → immediate email
  - reminder.nudge_sent        → immediate email (urgent nudges)

When these events fire, the reminder workers already inserted into
notifications_queue. This worker picks up those queue entries and
delivers them immediately via Gmail API, rather than waiting for
the scheduled email_delivery cron (every 15 min).

For lower-priority notifications (digests, new opp alerts), the
scheduled flush in main.py handles delivery.
"""

import logging

from .base import BaseEventWorker

log = logging.getLogger("workers.email_trigger")

# Event types that warrant immediate email delivery
URGENT_EVENT_TYPES = [
    "reminder.amendment_alert",
    "reminder.nudge_sent",
]


class EmailTriggerWorker(BaseEventWorker):
    """
    Consumes urgent customer_events and triggers immediate email delivery.

    This worker does NOT send emails itself — it calls
    deliver_pending_notifications() from the emailer module,
    which reads from notifications_queue and sends via Gmail.

    This ensures that urgent notifications (amendments, deadline nudges)
    are delivered within seconds rather than waiting for the 15-min cron.
    """

    namespace = "email.trigger"
    event_bus = "customer_events"
    event_types = URGENT_EVENT_TYPES
    batch_size = 20

    async def handle_batch(self, events: list[dict]) -> dict[str, int]:
        """
        Process a batch of urgent events by flushing the notification queue.

        We don't process events one-by-one — instead, when any urgent events
        arrive, we flush all pending notifications. This is more efficient
        and avoids duplicate sends.
        """
        if not events:
            return {"processed": 0, "errors": 0}

        self.log.info(
            f"[email.trigger] {len(events)} urgent events received, "
            f"flushing notification queue"
        )

        try:
            from .emailer import deliver_pending_notifications
            result = await deliver_pending_notifications(self.conn)
            delivered = result.get("delivered", 0)
            failed = result.get("failed", 0)

            self.log.info(
                f"[email.trigger] Delivered {delivered} emails, {failed} failed"
            )

            return {
                "processed": len(events),
                "errors": 0 if failed == 0 else 1,
            }

        except ImportError:
            self.log.warning(
                "[email.trigger] emailer module not available — "
                "Gmail service account may not be configured"
            )
            return {"processed": len(events), "errors": 0}

        except Exception as e:
            self.log.error(f"[email.trigger] Email delivery failed: {e}")
            return {"processed": 0, "errors": len(events)}
