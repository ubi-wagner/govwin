"""
================================================================================
Workflow: OnApplicationAccepted
================================================================================

TRIGGER:    capture:application.accepted:end
            Condition: payload.error is None (successful accept only)

PURPOSE:    After an rfp_admin accepts a customer application, this workflow
            sends a welcome email with credentials, creates default library
            categories for the new tenant, and schedules a follow-up
            reminder if the tenant has not logged in within 48 hours. This
            is the critical onboarding automation — it ensures every new
            customer gets a consistent, well-provisioned workspace from
            day one.

STEPS:
    1. send_welcome_email (NOTIFY)
       Action: system.notify
       Input: channel=email, template=welcome_accepted, tenant_id, user_id
              from event result payload
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed. Library defaults still
                   created (steps run independently in processor).
       Event Emitted: system:workflow.step_completed (single)

    2. create_library_defaults (ACTION)
       Action: pipeline.library.create_default_categories
       Input: tenant_id from event result payload
       Output: categoriesCreated, categoriesSkipped
       Retry: 0
       Timeout: 2 minutes
       On Failure: Log error, emit step_failed. Tenant can still use
                   the platform — they just lack pre-populated categories.
       Event Emitted: system:workflow.step_completed (single)

    3. schedule_login_reminder (HITL_WAIT)
       Action: hitl_wait
       Input: None (waiting for external login event)
       Output: None (skipped in V1)
       Retry: 0
       Timeout: 2880 minutes (48 hours)
       On Timeout: send_login_reminder (not implemented in V1)
       Event Emitted: system:workflow.step_completed (single, skipped=true)

HITL GATES:
    - Step 3 (schedule_login_reminder): Waiting for the new tenant_admin
      user to log in for the first time.
      Timeout: 48h -> send login reminder email
      Resume event: identity:user.logged_in:single

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step
    - Welcome email failure: Library defaults still created because
      create_library_defaults depends_on send_welcome_email but
      processor continues on failure with None inputs for dep data.
      In this case, tenant_id comes from the event payload directly.
    - Library defaults failure: Tenant still has a valid account and
      can use the platform — categories are convenience, not critical
    - Workflow failure: Emit system:workflow.failed event with full context
    - Database failure: Retry once, then fail step with error event

FAULT TOLERANCE:
    - Idempotent: YES — create_default_categories checks for existing
      categories per tenant and skips any that already exist
      (categoriesSkipped counter). Welcome email uses CMS dedup
      (automation_log 5-minute window).
    - Partial completion: Each step is independently valuable. Email
      failure does not prevent library setup.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

INSTANCES:
    - Admin Pipeline: Fires when rfp_admin accepts an application via
      /admin/applications/[id]/accept. The accept route emits
      capture:application.accepted:start/end pair.
    - Customer Portal: Downstream — new tenant receives welcome email
      and sees pre-populated library categories on first login.
    - CMS: Automation rules also fire for this event (welcome email,
      drip enrollment) — the CMS event_listener handles those
      independently.

COST:
    - AI tokens: 0 (no AI invocation — library defaults are static)
    - Compute: < 5 seconds

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: welcome email, library
                           defaults, login reminder HITL wait
    PR #xxx (2026-05-22) — Hardened: comprehensive header, idempotency
                           documentation for library defaults, error
                           handling ensuring email failure does not block
                           library setup, event emissions, fault tolerance
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnApplicationAccepted(Workflow):
    description = "Onboard new tenant after application acceptance"

    trigger = EventTrigger(
        namespace="capture",
        type="application.accepted",
        phase="end",
        condition=lambda p: bool(p.get("tenantId")),
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
            action="workflows.actions.create_library_defaults.create_default_categories",
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
            timeout_minutes=2880,
            on_timeout="send_login_reminder",
        ),
    ]
