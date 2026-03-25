"""
Automation Actions — Execute the action side of automation rules.

Each action type has a handler that receives the rule config, event context,
and a template resolver, then performs the appropriate side effect.

Action types:
  emit_event         → Insert a new event into an event bus
  queue_notification → Insert into notifications_queue for email delivery
  queue_job          → Insert into pipeline_jobs for scheduled processing
  log_only           → Just record to automation_log (no side effects)
"""

import json
import logging
from typing import Any, Callable

from events import (
    emit_customer_event,
    emit_opportunity_event,
    pipeline_actor,
)

log = logging.getLogger("automation.actions")


async def execute_action(
    *,
    conn,
    rule: dict,
    event: dict,
    context: dict,
    resolve_template: Callable[[str, dict], str],
) -> dict[str, Any]:
    """
    Dispatch to the appropriate action handler.

    Returns a result dict for the automation_log.
    """
    action_type = rule["action_type"]
    config = rule.get("action_config") or {}
    if isinstance(config, str):
        config = json.loads(config)

    if action_type == "emit_event":
        return await _action_emit_event(conn, rule, event, context, config, resolve_template)
    elif action_type == "queue_notification":
        return await _action_queue_notification(conn, rule, event, context, config, resolve_template)
    elif action_type == "queue_job":
        return await _action_queue_job(conn, rule, event, context, config, resolve_template)
    elif action_type == "log_only":
        return _action_log_only(rule, event, context, config, resolve_template)
    else:
        log.warning(f"[automation.actions] Unknown action type: {action_type}")
        return {"error": f"unknown action_type: {action_type}"}


async def _action_emit_event(
    conn, rule: dict, event: dict, context: dict, config: dict,
    resolve_template: Callable,
) -> dict:
    """
    Emit a new event into an event bus.

    Config:
      bus: "customer_events" | "opportunity_events"
      event_type: "finder.high_score_alert"
      description_template: "High-scoring opp ({payload.total_score}/100)"
    """
    bus = config.get("bus", "customer_events")
    event_type = config.get("event_type", "automation.fired")
    desc_template = config.get("description_template", f"Automation rule '{rule['name']}' fired")
    description = resolve_template(desc_template, context)

    actor = pipeline_actor(f"automation:{rule['name']}")

    if bus == "customer_events":
        # Need a tenant_id — try to get from event or refs
        tenant_id = (
            event.get("tenant_id")
            or context.get("refs", {}).get("tenant_id")
            or context.get("event", {}).get("tenant_id")
        )
        if not tenant_id:
            return {"error": "no tenant_id available for customer event"}

        event_id = await emit_customer_event(
            conn,
            tenant_id=str(tenant_id),
            event_type=event_type,
            opportunity_id=str(event.get("opportunity_id", "")) or None,
            entity_type="automation_rule",
            entity_id=str(rule["id"]),
            description=description,
            actor=actor,
            correlation_id=str(event.get("correlation_id", "")) or None,
            refs={"rule_id": str(rule["id"]), "rule_name": rule["name"]},
            payload=context.get("payload", {}),
        )
        return {"emitted_event_id": event_id, "bus": bus, "event_type": event_type}

    elif bus == "opportunity_events":
        opp_id = str(event.get("opportunity_id", ""))
        if not opp_id:
            return {"error": "no opportunity_id available for opportunity event"}

        event_id = await emit_opportunity_event(
            conn,
            opportunity_id=opp_id,
            event_type=event_type,
            source=f"automation:{rule['name']}",
            actor=actor,
            correlation_id=str(event.get("correlation_id", "")) or None,
            refs={"rule_id": str(rule["id"]), "rule_name": rule["name"]},
            payload=context.get("payload", {}),
        )
        return {"emitted_event_id": event_id, "bus": bus, "event_type": event_type}

    return {"error": f"unsupported bus: {bus}"}


async def _action_queue_notification(
    conn, rule: dict, event: dict, context: dict, config: dict,
    resolve_template: Callable,
) -> dict:
    """
    Insert into notifications_queue for email delivery.

    Config:
      notification_type: "welcome" | "onboarding" | etc.
      subject_template: "Welcome to GovWin Pipeline!"
      priority: 3
    """
    notification_type = config.get("notification_type", "automation")
    subject_template = config.get("subject_template", f"GovWin Pipeline: {rule['name']}")
    subject = resolve_template(subject_template, context)
    priority = config.get("priority", 5)

    # Resolve tenant_id
    tenant_id = (
        event.get("tenant_id")
        or context.get("refs", {}).get("tenant_id")
        or context.get("event", {}).get("tenant_id")
    )
    if not tenant_id:
        return {"error": "no tenant_id for notification"}

    # Resolve related IDs (opportunity, entity, etc.)
    related_ids = []
    opp_id = event.get("opportunity_id")
    if opp_id:
        related_ids.append(str(opp_id))

    try:
        row = await conn.fetchrow(
            """
            INSERT INTO notifications_queue
                (tenant_id, notification_type, subject, related_ids, priority)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            RETURNING id
            """,
            tenant_id,
            notification_type,
            subject,
            json.dumps(related_ids),
            priority,
        )
        notif_id = str(row["id"]) if row else None
        log.info(
            f"[automation.actions] Queued {notification_type} notification "
            f"for tenant {str(tenant_id)[:8]}"
        )
        return {"notification_id": notif_id, "notification_type": notification_type, "subject": subject}
    except Exception as e:
        log.error(f"[automation.actions] Failed to queue notification: {e}")
        return {"error": str(e)}


async def _action_queue_job(
    conn, rule: dict, event: dict, context: dict, config: dict,
    resolve_template: Callable,
) -> dict:
    """
    Insert into pipeline_jobs for processing.

    Config:
      source: "scoring"
      run_type: "score"
      priority: 3
    """
    source = config.get("source", "automation")
    run_type = config.get("run_type", "full")
    priority = config.get("priority", 5)

    # Build job parameters from event context
    parameters = {
        "triggered_by_rule": rule["name"],
        "triggered_by_event": str(event.get("id", "")),
        "triggered_by_event_type": event.get("event_type"),
    }

    # Add tenant_id if available (for scoped scoring)
    tenant_id = (
        event.get("tenant_id")
        or context.get("refs", {}).get("tenant_id")
    )
    if tenant_id:
        parameters["tenant_id"] = str(tenant_id)

    try:
        # Check if a pending/running job already exists for this source
        existing = await conn.fetchval(
            """
            SELECT id FROM pipeline_jobs
            WHERE source = $1 AND status IN ('pending', 'running')
            LIMIT 1
            """,
            source,
        )
        if existing:
            log.info(
                f"[automation.actions] Skipping job queue for {source}: "
                f"job {existing} already pending/running"
            )
            return {"skipped": True, "reason": "existing_pending_job", "existing_job_id": str(existing)}

        row = await conn.fetchrow(
            """
            INSERT INTO pipeline_jobs
                (source, run_type, status, triggered_by, priority, parameters)
            VALUES ($1, $2, 'pending', $3, $4, $5::jsonb)
            RETURNING id
            """,
            source,
            run_type,
            f"automation:{rule['name']}",
            priority,
            json.dumps(parameters),
        )
        job_id = str(row["id"]) if row else None

        # Notify the pipeline worker so it wakes up
        await conn.execute("SELECT pg_notify('pipeline_worker', $1)", source)

        log.info(f"[automation.actions] Queued job {source}/{run_type} (id={job_id})")
        return {"job_id": job_id, "source": source, "run_type": run_type}
    except Exception as e:
        log.error(f"[automation.actions] Failed to queue job: {e}")
        return {"error": str(e)}


def _action_log_only(
    rule: dict, event: dict, context: dict, config: dict,
    resolve_template: Callable,
) -> dict:
    """
    Log-only action — no side effects, just records to automation_log.

    Config:
      message_template: "User {actor.email} logged in"
    """
    message_template = config.get("message_template", f"Rule '{rule['name']}' matched")
    message = resolve_template(message_template, context)

    log.info(f"[automation.log] {rule['name']}: {message}")
    return {"message": message}
