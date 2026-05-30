"""
================================================================================
Workflow: OnProposalAdvancedToReview / OnProposalAdvancedToFinal
================================================================================

This module contains two workflow classes that handle proposal stage
advancement. They share the same base trigger event
(proposal:proposal.advanced:single) but are differentiated by the
payload.targetStage condition.

────────────────────────────────────────────────────────────────────────
Sub-Workflow 1: OnProposalAdvancedToReview
────────────────────────────────────────────────────────────────────────

TRIGGER:    proposal:proposal.advanced:single
            Condition: payload.targetStage == "review"

PURPOSE:    When a proposal advances to the review stage, this
            workflow runs an AI compliance review (checking the proposal
            against the solicitation's compliance requirements), notifies
            the designated reviewers that the review is ready, and waits
            for the human review to complete. Review is the first
            formal review gate in the proposal lifecycle — it catches
            compliance gaps before significant writing effort is invested.

STEPS:
    1. ai_compliance_review (AI_INVOKE)
       Action: tool.proposal.check_compliance
       Input: proposal_id from event payload
       Output: compliance score, gaps found (or skipped if tool not
               resolvable locally in V1)
       Retry: 0
       Timeout: 10 minutes
       On Failure: Log error, emit step_failed. Still notify reviewers
                   that review is ready (they can review manually).
       Event Emitted: system:workflow.step_completed (single)

    2. notify_reviewers (NOTIFY)
       Action: system.notify
       Input: channel=email, template=review_ready, proposal_id
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed. Reviewers can still see
                   the proposal in their review queue.
       Event Emitted: system:workflow.step_completed (single)

    3. wait_for_review (HITL_WAIT)
       Action: hitl_wait
       Input: None (waiting for reviewer to advance proposal past review)
       Output: None (skipped in V1)
       Retry: 0
       Timeout: 4320 minutes (72 hours)
       On Timeout: send_review_reminder (not implemented in V1)
       Event Emitted: system:workflow.step_completed (single, skipped=true)

HITL GATES:
    - Step 3 (wait_for_review): A designated reviewer must complete the
      review and advance the proposal to the next stage.
      Timeout: 72h -> send review reminder email
      Resume event: proposal:proposal.advanced:single where
                    payload.previousStage == "review"

ERROR HANDLING:
    - AI compliance review failure: Reviewers still notified. They
      perform the compliance check manually.
    - Notification failure: Reviewers see the proposal in their queue
      on next portal visit.
    - Workflow failure: Emit system:workflow.failed event.

FAULT TOLERANCE:
    - Idempotent: PARTIAL — AI compliance review may produce different
      results on re-run. Notification uses CMS dedup window.
    - Partial completion: If AI review fails, manual review proceeds.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

────────────────────────────────────────────────────────────────────────
Sub-Workflow 2: OnProposalAdvancedToFinal
────────────────────────────────────────────────────────────────────────

TRIGGER:    proposal:proposal.advanced:single
            Condition: payload.targetStage == "final"

PURPOSE:    When a proposal advances to the final stage, this workflow
            generates an export preview document (ZIP of all sections as
            markdown) and notifies all collaborators that the final
            version is ready for review before submission. This is the
            last automated step before the proposal is submitted to the
            government agency.

STEPS:
    1. generate_export_preview (ACTION)
       Action: pipeline.export.generate_preview
       Input: proposal_id from event payload
       Output: previewUrl (S3 key), sectionsExported, totalBytes
       Retry: 0
       Timeout: 15 minutes
       On Failure: Log error, emit step_failed. Still notify collaborators
                   that proposal is in final stage (without preview link).
       Event Emitted: system:workflow.step_completed (single)

    2. notify_all_collaborators (NOTIFY)
       Action: system.notify
       Input: channel=email, template=proposal_final_ready, proposal_id
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed. Collaborators see the
                   proposal in their portal view.
       Event Emitted: system:workflow.step_completed (single)

HITL GATES:
    - None (fully automated after stage advancement)

ERROR HANDLING:
    - Export generation failure: Collaborators still notified that
      proposal is in final stage. They can view sections in the portal.
    - S3 upload failure: Preview generation continues but returns
      previewUrl=None. Logged as warning.
    - Notification failure: Collaborators see final status in portal.
    - Workflow failure: Emit system:workflow.failed event.

FAULT TOLERANCE:
    - Idempotent: YES — preview generation overwrites existing preview
      at the same S3 key. ZIP is regenerated from current section content.
    - Partial completion: If preview fails, notification still fires.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

INSTANCES (both sub-workflows):
    - Admin Pipeline: Not applicable (admin does not advance proposals)
    - Customer Portal: Fires when tenant_admin advances a proposal stage
      via the portal proposal workspace. The advancement route emits
      proposal:proposal.advanced:single.
    - CMS: Automation rules also fire for this event (stage advanced
      email) — the CMS event_listener handles those independently.

COST:
    - Pink team AI review: ~10K-50K tokens (compliance check against
      solicitation requirements). Skipped in V1 if tool not resolvable.
    - Final export: 0 AI tokens; 5-30 seconds compute for ZIP generation
      and S3 upload.

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: pink team AI review +
                           notify + HITL wait; final export + notify
    PR #xxx (2026-05-22) — Hardened: comprehensive header splitting two
                           sub-workflows, per-step error handling docs,
                           HITL_WAIT resume event documented, event
                           emissions at every stage, fault tolerance notes
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnProposalAdvancedToReview(Workflow):
    description = "Run AI compliance review when proposal enters review"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advanced",
        phase="end",
        condition=lambda p: p.get("targetStage") == "review",
    )

    steps = [
        Step(
            name="ai_compliance_review",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.check_compliance",
            input_map={"proposal_id": "payload.proposalId"},
            timeout_minutes=10,
        ),
        Step(
            name="notify_reviewers",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="ai_compliance_review",
            input_map={
                "channel": '"email"',
                "template": '"review_ready"',
                "proposal_id": "payload.proposalId",
            },
        ),
        Step(
            name="wait_for_review",
            step_type=StepType.HITL_WAIT,
            action="hitl_wait",
            depends_on="notify_reviewers",
            wait_for=EventTrigger(
                namespace="proposal",
                type="proposal.advanced",
                phase="single",
                condition=lambda p: p.get("previousStage") == "review",
            ),
            timeout_minutes=4320,
            on_timeout="send_review_reminder",
        ),
    ]


class OnProposalAdvancedToFinal(Workflow):
    description = "Lock workspace and generate export preview at final stage"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advanced",
        phase="end",
        condition=lambda p: p.get("targetStage") == "final",
    )

    steps = [
        Step(
            name="generate_export_preview",
            action="workflows.actions.generate_preview.generate_preview",
            input_map={"proposal_id": "payload.proposalId"},
            timeout_minutes=15,
        ),
        Step(
            name="notify_all_collaborators",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="generate_export_preview",
            input_map={
                "channel": '"email"',
                "template": '"proposal_final_ready"',
                "proposal_id": "payload.proposalId",
            },
        ),
    ]
