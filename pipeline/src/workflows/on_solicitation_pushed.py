"""
================================================================================
Workflow: OnSolicitationPushed
================================================================================

TRIGGER:    finder:solicitation.pushed:single
            Condition: None (fires for all pushes)

PURPOSE:    After an rfp_admin curates and pushes a solicitation, the frontend
            opportunity-bridge has already created a tenant_opportunity_card per
            tenant and auto-scored it (tenant_bucket_scores) on arrival. This
            workflow READS those canonical scores to resolve which tenants have a
            strong (priority) card and emails them the "new opportunities" digest.
            It is the email nudge layered over the in-app cards surface — scoring
            itself is owned by the bridge, not this workflow.

STEPS:
    1. find_matching_tenants (ACTION)
       Action: workflows.actions.score_tenants.match_tenants
       Input: solicitation_id, topic_count from event payload
       Output: tenantIds[], opportunitiesConsidered, tenantsNotified
       Retry: 0
       Timeout: 5 minutes
       On Failure: Reads canonical scores only; a DB error returns status=error
                   (audited via scoring.completed:end) and the digest simply has
                   no recipients — never a dead-end.
       Event Emitted: system:workflow.step_completed (single)

    2. send_spotlight_digest (NOTIFY)
       Action: system.notify
       Input: channel=email, template=spotlight_new_topics, tenant_ids
              from step 1 result, tenant_pref=notify_on_new_priority_opp
              (the CMS event_listener fans the digest out per tenant, gating
              each on that toggle)
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
    - Recipient resolution: match_tenants reads canonical tenant_bucket_scores;
      it writes nothing, so there is no partial-write to recover.
    - Notification failure: Logged; the tenant still sees the opportunity in
      their in-app cards surface (the digest is a supplementary email).
    - Workflow failure: Emit system:workflow.failed event with full context
    - Database failure: Retry once, then fail step with error event

FAULT TOLERANCE:
    - Idempotent: YES — read-only. Re-running just re-resolves the same recipient
      list from the current canonical scores; no rows are written or duplicated.
    - Partial completion: N/A (no writes). If notification fails the tenant still
      sees the opportunity in their cards surface (just no email).
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
            action="workflows.actions.score_tenants.match_tenants",
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
                # Gate each tenant's digest on their new-priority-opportunity toggle.
                "tenant_pref": '"notify_on_new_priority_opp"',
            },
        ),
    ]
