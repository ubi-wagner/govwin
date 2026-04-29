"""
Workflow: After proposal created → AI-draft sections → notify customer.

Trigger: proposal:proposal.created:end (successful creation only)
Steps:
  1. For each empty section, search library for relevant atoms
  2. AI-draft each section using library + RFP context
  3. Notify customer that their proposal workspace is ready
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnProposalCreated(Workflow):
    description = "AI-draft proposal sections and notify customer"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.created",
        phase="end",
        condition=lambda p: p.get("error") is None,
    )

    steps = [
        Step(
            name="draft_sections",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.draft_all_sections",
            input_map={
                "proposal_id": "result.proposalId",
                "tenant_id": "payload.tenantId",
            },
            timeout_minutes=15,
            retry_count=1,
        ),
        Step(
            name="notify_customer",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="draft_sections",
            input_map={
                "channel": '"email"',
                "template": '"proposal_workspace_ready"',
                "tenant_id": "payload.tenantId",
                "proposal_id": "result.proposalId",
            },
        ),
    ]
