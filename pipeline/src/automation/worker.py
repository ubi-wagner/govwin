"""
Automation Worker — Bridges the event bus into the automation engine.

Two workers (one per bus) consume ALL event types and feed them
to the automation engine for rule evaluation.

This is intentionally broad: the engine decides which rules match,
not the worker's event_types filter.
"""

import logging

from workers.base import BaseEventWorker
from .engine import evaluate_event

log = logging.getLogger("automation.worker")


class AutomationCustomerWorker(BaseEventWorker):
    """
    Consumes ALL customer_events and evaluates automation rules.

    This worker uses a wildcard approach: it subscribes to all known
    customer event types and lets the engine's rule matching handle
    the filtering. New event types are automatically picked up when
    rules are added — no code changes needed.
    """

    namespace = "automation.customer"
    event_bus = "customer_events"
    event_types = [
        # Account lifecycle
        "account.login",
        "account.tenant_created",
        "account.tenant_updated",
        "account.profile_updated",
        "account.user_added",
        "account.login_failed",
        # Finder / pipeline
        "finder.opp_presented",
        "finder.high_score_alert",
        # Reminders
        "reminder.nudge_sent",
        "reminder.amendment_alert",
        "reminder.deadline_acknowledged",
        # Drive
        "account.drive_provisioned",
        # User actions
        "opportunity.pinned",
        "opportunity.unpinned",
        "opportunity.status_changed",
        "opportunity.document_added",
    ]
    batch_size = 50

    async def handle_event(self, event: dict) -> None:
        await evaluate_event(self.conn, event, "customer_events")


class AutomationOpportunityWorker(BaseEventWorker):
    """
    Consumes ALL opportunity_events and evaluates automation rules.
    """

    namespace = "automation.opportunity"
    event_bus = "opportunity_events"
    event_types = [
        "ingest.new",
        "ingest.updated",
        "ingest.field_changed",
        "scoring.scored",
        "scoring.rescored",
        "scoring.llm_adjusted",
        "drive.archived",
    ]
    batch_size = 50

    async def handle_event(self, event: dict) -> None:
        await evaluate_event(self.conn, event, "opportunity_events")



# Note: content_events does not have a dequeue function (no worker consumption).
# Content events are low-volume CMS actions emitted from the Next.js API.
# Content automation rules (content.published, etc.) are evaluated
# via the API-side event emission — see frontend/lib/events.ts.
# If content event automation is needed in the future, add a
# dequeue_content_events() DB function mirroring the other two buses.
