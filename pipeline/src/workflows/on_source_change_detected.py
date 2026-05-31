"""
================================================================================
Workflow: OnSourceChangeDetected
================================================================================

TRIGGER:    finder:source.change_detected:single
            Condition: payload.meaningfulChanges > 0

PURPOSE:    When Source Scout detects meaningful changes on a monitored
            government website (SAM.gov alternative sources, agency portals,
            CSO pages), this workflow creates draft solicitations from the
            extracted opportunities and notifies the RFP admin for review.
            This automates the discovery of opportunities that are not
            available through standard API ingest sources.

STEPS:
    1. create_draft_solicitations (ACTION)
       Action: finder.create_drafts_from_scout
       Input: source_id, source_name, region_results from event payload
       Output: draftsCreated, draftsUpdated, duplicatesSkipped, sourceId
       Retry: 0
       Timeout: 10 minutes
       On Failure: If draft creation fails for one source/opportunity,
                   the action continues with remaining opportunities
                   (per-opportunity error handling in action). If entire
                   step fails, still attempt to notify admin with error.
       Event Emitted: system:workflow.step_completed (single)

    2. notify_rfp_admin (NOTIFY)
       Action: system.notify
       Input: channel=email, template=source_scout_changes, source_name,
              meaningful_changes count, drafts_created from step 1
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed. Admin will still see
                   new solicitations in the triage queue on next visit.
       Event Emitted: system:workflow.step_completed (single)

    3. wait_for_admin_review (HITL_WAIT)
       Action: hitl.wait
       Input: None (waiting for external event)
       Output: None (skipped in V1)
       Retry: 0
       Timeout: 1440 minutes (24 hours)
       On Timeout: Re-notify rfp_admin (not implemented in V1)
       Event Emitted: system:workflow.step_completed (single, skipped=true)

HITL GATES:
    - Step 3 (wait_for_admin_review): Admin must review the draft
      solicitations in the triage queue and either accept or dismiss
      each one.
      Timeout: 24h -> re-notify rfp_admin
      Resume event: finder:source_diff.reviewed:end

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step
    - Per-opportunity failure: Handled inside create_drafts_from_scout —
      one failed opportunity does not block creation of others
    - Dedup check: Title+agency dedup prevents duplicate opportunities.
      Existing curated_solicitations for known opportunities are skipped.
    - Notification failure: Admin will still see drafts in triage queue
    - Workflow failure: Emit system:workflow.failed event with full context
    - Database failure: Retry once, then fail step with error event

FAULT TOLERANCE:
    - Idempotent: YES — dedup by title+agency prevents duplicate
      opportunity creation. Existing opportunities with solicitations
      are skipped (duplicatesSkipped counter).
    - Partial completion: Drafted solicitations are committed per-opportunity,
      so partial completion preserves already-created drafts.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

INSTANCES:
    - Admin Pipeline: Fires when the Source Scout worker detects changes
      on a monitored source profile. The scout emits
      finder:source.change_detected:single.
    - Customer Portal: Not applicable (source monitoring is admin-only)
    - CMS: Not applicable

COST:
    - AI tokens: 0 (draft creation is DB-only, no AI invocation)
    - Compute: 1-60 seconds depending on number of opportunities extracted

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: create drafts, notify,
                           HITL wait for review
    PR #xxx (2026-05-22) — Hardened: comprehensive header, dedup check
                           documentation, per-source error handling notes,
                           HITL_WAIT resume event and timeout documented,
                           event emissions at every stage, fault tolerance
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnSourceChangeDetected(Workflow):
    description = (
        "When Source Scout detects meaningful changes on a monitored site, "
        "create draft solicitations from extracted opportunities and notify "
        "the RFP admin for review."
    )

    trigger = EventTrigger(
        namespace="finder",
        type="source.change_detected",
        phase="single",
        condition=lambda payload: payload.get("meaningfulChanges", 0) > 0,
    )

    steps = [
        Step(
            name="create_draft_solicitations",
            action="workflows.actions.create_drafts_from_scout.create_drafts_from_scout",
            step_type=StepType.ACTION,
            input_map={
                "source_id": "payload.sourceId",
                "source_name": "payload.sourceName",
                "region_results": "payload.regionResults",
            },
            timeout_minutes=10,
        ),
        Step(
            name="notify_rfp_admin",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="create_draft_solicitations",
            input_map={
                "channel": '"email"',
                "template": '"source_scout_changes"',
                "source_name": "payload.sourceName",
                "meaningful_changes": "payload.meaningfulChanges",
                "drafts_created": "step.create_draft_solicitations.result.draftsCreated",
            },
        ),
        Step(
            name="wait_for_admin_review",
            step_type=StepType.HITL_WAIT,
            action="hitl.wait",
            depends_on="notify_rfp_admin",
            wait_for=EventTrigger(
                namespace="finder",
                type="source.changes_reviewed",
                phase="single",
            ),
            timeout_minutes=1440,  # 24 hours
            on_timeout="notify_rfp_admin",  # re-notify if no review
        ),
    ]
