"""
Workflow: After RFP upload completes → shred → extract compliance → notify.

Trigger: finder:rfp.uploaded:end (successful upload only)
Steps:
  1. Shred the primary document (extract text, structure, embeddings)
  2. Extract compliance variables from the shredded text
  3. Notify the rfp_admin that curation is ready
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
