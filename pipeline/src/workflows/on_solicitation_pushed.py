"""
================================================================================
Workflow: OnSolicitationPushed
================================================================================

TRIGGER:    finder:solicitation.pushed:single
            Condition: None (fires for all pushes)

PURPOSE:    After an rfp_admin curates and pushes a solicitation to the
            customer Spotlight pipeline, this workflow scores the solicitation
            against all tenants with active subscriptions and notifies
            matching tenants that new opportunities are available. This is
            the bridge between admin curation and customer discovery — it
            ensures every relevant customer sees new RFPs promptly.

STEPS:
    1. find_matching_tenants (ACTION)
       Action: pipeline.scoring.match_tenants
       Input: solicitation_id, topic_count from event payload
       Output: tenantIds[], tenantsScored, tenantsNotified, avgScore
       Retry: 0
       Timeout: 5 minutes
       On Failure: If tenant scoring fails for one tenant, the action
                   continues with remaining tenants (per-tenant error
                   handling in score_tenants.py). If entire step fails,
                   log error and skip notification.
       Event Emitted: system:workflow.step_completed (single)

    2. send_spotlight_digest (NOTIFY)
       Action: system.notify
       Input: channel=email, template=spotlight_new_topics, tenant_ids
              from step 1 result
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed
       Event Emitted: system:workflow.step_completed (single)

HITL GATES:
    - None (fully automated after admin push)

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step
    - Per-tenant scoring failure: Handled inside score_tenants.py — one
      tenant failing does not block scoring for others
    - Notification failure: Logged but does not affect scoring data already
      written to tenant_pipeline_items
    - Workflow failure: Emit system:workflow.failed event with full context
    - Database failure: Retry once, then fail step with error event

FAULT TOLERANCE:
    - Idempotent: YES — score_tenants uses ON CONFLICT (tenant_id,
      opportunity_id) DO UPDATE, so re-scoring overwrites rather than
      duplicates. Spotlight items are upserted safely.
    - Partial completion: If scoring succeeds but notification fails,
      tenants still see the opportunity in their pipeline (just no email).
    - Duplicate detection: Processor-level dedup by trigger_event_id.
    - Batch processing: Large tenant sets processed in batches (DB query
      returns all at once, but scoring loops are per-tenant with individual
      error handling).

INSTANCES:
    - Admin Pipeline: Fires when rfp_admin pushes a curated solicitation
      via the curation workspace (/admin/rfp-curation/[solId]/push).
    - Customer Portal: Downstream — tenants receive Spotlight notifications
    - CMS: Not applicable

COST:
    - AI tokens: 0 (scoring is algorithmic, no AI invocation)
    - Compute: 1-30 seconds depending on tenant count

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: match tenants + notify
    PR #xxx (2026-05-22) — Hardened: comprehensive header, per-tenant error
                           handling documentation, batch processing notes,
                           idempotency via ON CONFLICT upsert, event
                           emissions at every stage, fault tolerance notes
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnSolicitationPushed(Workflow):
    description = "Notify subscribed customers when new RFP hits Spotlight"

    trigger = EventTrigger(
        namespace="finder",
        type="solicitation.pushed",
        phase="single",
    )

    steps = [
        Step(
            name="find_matching_tenants",
            action="pipeline.scoring.match_tenants",
            input_map={
                "solicitation_id": "payload.solicitationId",
                "topic_count": "payload.topicCount",
            },
            timeout_minutes=5,
        ),
        Step(
            name="send_spotlight_digest",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="find_matching_tenants",
            input_map={
                "channel": '"email"',
                "template": '"spotlight_new_topics"',
                "tenant_ids": "step.find_matching_tenants.result.tenantIds",
            },
        ),
    ]
