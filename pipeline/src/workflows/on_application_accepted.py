"""
Workflow: After application accepted → welcome email → schedule onboarding.

Trigger: capture:application.accepted:end (successful accept only)
Steps:
  1. Send welcome email with temp password
  2. Create default library categories for the new tenant
  3. Schedule a follow-up reminder if tenant hasn't logged in within 48h
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnApplicationAccepted(Workflow):
    description = "Onboard new tenant after application acceptance"

    trigger = EventTrigger(
        namespace="capture",
        type="application.accepted",
        phase="end",
        condition=lambda p: p.get("error") is None,
    )

    steps = [
        Step(
            name="send_welcome_email",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "template": '"welcome_accepted"',
                "tenant_id": "result.tenantId",
                "user_id": "result.userId",
            },
        ),
        Step(
            name="create_library_defaults",
            action="pipeline.library.create_default_categories",
            depends_on="send_welcome_email",
            input_map={"tenant_id": "result.tenantId"},
            timeout_minutes=2,
        ),
        Step(
            name="schedule_login_reminder",
            step_type=StepType.HITL_WAIT,
            action="hitl_wait",
            depends_on="create_library_defaults",
            wait_for=EventTrigger(
                namespace="identity",
                type="user.logged_in",
                phase="single",
            ),
            timeout_hours=48,
            on_timeout="send_login_reminder",
        ),
    ]
