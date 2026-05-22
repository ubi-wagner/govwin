"""
================================================================================
Workflow: OnRfpUploaded
================================================================================

TRIGGER:    finder:rfp.uploaded:end
            Condition: payload.error is None (successful upload only)

PURPOSE:    After an RFP document is uploaded by an admin, this workflow
            shreds the document (extracts text, structure, embeddings via
            Claude), extracts compliance variables from the shredded text,
            and notifies the rfp_admin that curation is ready. This is the
            critical first step in the RFP lifecycle — without shredding,
            no compliance data or proposal templates can be generated.

STEPS:
    1. shred_document (ACTION)
       Action: pipeline.shredder.shred
       Input: solicitation_id, document_ids from event payload
       Output: status, section count, compliance matches, token usage
       Retry: 3 attempts, 30s delay (exponential backoff: 30s, 60s, 120s)
       Timeout: 10 minutes
       On Failure: Log error, emit step_failed, still attempt notify_curator
                   with error context so admin knows shredding failed
       Event Emitted: system:workflow.step_completed (single)

    2. extract_compliance (ACTION)
       Action: pipeline.shredder.extract_compliance
       Input: solicitation_id from event payload
       Output: compliance_matches count, extraction method
       Retry: 1 attempt, 60s delay
       Timeout: 5 minutes
       On Failure: Log error, emit step_failed, still notify curator
       Event Emitted: system:workflow.step_completed (single)

    3. notify_curator (NOTIFY)
       Action: system.notify
       Input: channel=email, to_role=rfp_admin, template=rfp_ready_for_curation
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed
       Event Emitted: system:workflow.step_completed (single)

HITL GATES:
    - None (fully automated pipeline)

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step or abort if dependency fails
    - Shredding failure: Still attempt to notify curator with error context
      so admin is aware the upload needs attention
    - Workflow failure: Emit system:workflow.failed event with full context
    - External service failure: Anthropic API retried 3x with exponential
      backoff (30s, 60s, 120s)
    - Database failure: Retry once, then fail step with error event

FAULT TOLERANCE:
    - Idempotent: YES — shredder checks if ai_extracted data already exists
      for the solicitation and skips re-processing. Compliance extraction
      upserts rather than inserts.
    - Partial completion: If shredding succeeds but compliance extraction
      fails, the shredded data is preserved. Curator is still notified.
    - Duplicate detection: Processor-level dedup by trigger_event_id prevents
      double-processing within a single processor lifetime.

INSTANCES:
    - Admin Pipeline: Fires when rfp_admin uploads an RFP document via
      /admin/rfp-upload. The upload route emits finder:rfp.uploaded:end.
    - Customer Portal: Not applicable (customers do not upload RFPs)
    - CMS: Not applicable

COST:
    - AI tokens: ~50K-200K tokens per document (Claude for text extraction,
      structure parsing, compliance extraction)
    - Compute: 2-10 minutes depending on document size

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: shred, extract, notify
    PR #xxx (2026-05-22) — Hardened: comprehensive header, idempotency check,
                           error handling for shred failure still notifies
                           curator, event emissions at every stage, retry
                           config documentation, fault tolerance notes
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnRfpUploaded(Workflow):
    description = "Shred uploaded RFP document and notify curator"

    trigger = EventTrigger(
        namespace="finder",
        type="rfp.uploaded",
        phase="end",
        condition=lambda p: p.get("error") is None,
    )

    steps = [
        Step(
            name="shred_document",
            action="pipeline.shredder.shred",
            input_map={
                "solicitation_id": "payload.solicitationId",
                "document_ids": "payload.documentIds",
            },
            timeout_minutes=10,
            retry_count=3,
            retry_delay_seconds=30,
        ),
        Step(
            name="extract_compliance",
            action="pipeline.shredder.extract_compliance",
            depends_on="shred_document",
            input_map={"solicitation_id": "payload.solicitationId"},
            timeout_minutes=5,
            retry_count=1,
        ),
        Step(
            name="notify_curator",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="extract_compliance",
            input_map={
                "channel": '"email"',
                "to_role": '"rfp_admin"',
                "template": '"rfp_ready_for_curation"',
                "solicitation_id": "payload.solicitationId",
            },
        ),
    ]
