"""
Workflow: After proposal stage advanced → run review if applicable → notify.

Trigger: proposal:proposal.advanced:single
Steps vary by target stage:
  - pink_team: AI compliance review → notify reviewer
  - red_team: AI scoring review → notify reviewer
  - gold_team: Notify exec for go/no-go
  - final: Lock workspace → generate export preview
  - submitted: Archive snapshot → notify all collaborators
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnProposalAdvancedToPinkTeam(Workflow):
    description = "Run AI compliance review when proposal enters pink team"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advanced",
        phase="single",
        condition=lambda p: p.get("toStage") == "pink_team",
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
                "template": '"pink_team_review_ready"',
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
                condition=lambda p: p.get("fromStage") == "pink_team",
            ),
            timeout_hours=72,
            on_timeout="send_review_reminder",
        ),
    ]


class OnProposalAdvancedToFinal(Workflow):
    description = "Lock workspace and generate export preview at final stage"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advanced",
        phase="single",
        condition=lambda p: p.get("toStage") == "final",
    )

    steps = [
        Step(
            name="generate_export_preview",
            action="pipeline.export.generate_preview",
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
