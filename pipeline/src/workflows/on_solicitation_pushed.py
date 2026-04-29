"""
Workflow: After solicitation pushed to Spotlight → notify subscribed tenants.

Trigger: finder:solicitation.pushed:single
Steps:
  1. Find all tenants with active subscriptions
  2. For each tenant, check if their NAICS/tech focus matches any topic
  3. Send Spotlight digest notification to matching tenants
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
