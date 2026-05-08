"""
Workflow: After Source Scout detects meaningful changes → triage new opportunities.

Trigger: finder:source.change_detected:single
Steps:
  1. Create draft curated_solicitations from extracted opportunities
  2. Notify rfp_admin that new opportunities were found
  3. HITL wait for admin to review/curate the drafts
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
            action="finder.create_drafts_from_scout",
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
