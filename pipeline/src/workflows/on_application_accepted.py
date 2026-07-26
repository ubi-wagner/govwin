"""
================================================================================
Workflow: OnApplicationAccepted
================================================================================

TRIGGER:    capture:application.accepted:end
            Condition: payload.tenantId is present (successful accept only)

PURPOSE:    After an rfp_admin accepts a customer application, this workflow
            cold-starts the new tenant: an AI onboarding concierge proposes
            profile enrichment / spotlight buckets / a getting-started plan,
            and a 48h HITL wait watches for the new tenant_admin's first
            login. This is the critical onboarding automation — every new
            customer gets a consistent, agent-assisted start from day one.

STEPS:
    1. ai_onboarding_concierge (AI_INVOKE)
       Action: tool.onboarding.concierge -> onboarding_agent archetype
       Input: tenant_id <- result.tenantId, user_id <- result.userId
       Timeout: 10 minutes
       Advisory (advisory -> guardrail -> land-or-review), tenant-bound via
       result.tenantId, and INDEPENDENT (no depends_on) so a skip/failure
       never dead-ends onboarding.
       Event Emitted: system:workflow.step_completed (single)

    2. schedule_login_reminder (HITL_WAIT)
       Action: hitl_wait — waits for the new tenant_admin's first login
       Wait-for: identity:user.logged_in:single
       Timeout: 2880 minutes (48 hours)
       On Timeout: emits system:workflow.wait_timed_out (the login-reminder
                   escalation step is V2 — no send_login_reminder exists yet).
       Event Emitted: system:workflow.step_completed (single)

HITL GATES:
    - Step 2 (schedule_login_reminder): Waiting for the new tenant_admin
      user to log in for the first time.
      Timeout: 48h -> system:workflow.wait_timed_out
      Resume event: identity:user.logged_in:single

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next independent step.
    - Concierge failure/skip: onboarding still completes — the AI step is
      advisory and nothing depends on it.
    - Workflow failure: Emit system:workflow.failed event with full context.
    - Database failure: Retry once, then fail step with error event.

FAULT TOLERANCE:
    - Advisory AI output is never auto-written to business tables
      (land-or-review); runtime bounds runaway (round/cost/rate caps).
    - Partial completion: each step is independently valuable — the concierge
      never blocks the login wait.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

INSTANCES:
    - Admin Pipeline: Fires when rfp_admin accepts an application via
      /admin/applications/[id]/accept. The accept route emits
      capture:application.accepted:start/end pair.
    - Customer Portal: Downstream — the new tenant sees the concierge's
      getting-started plan / suggested buckets on first login.
    - CMS: Automation rules also fire for this event (welcome email,
      drip enrollment) — the CMS event_listener handles those
      independently.

COST:
    - AI tokens: onboarding_agent runs one bounded concierge pass.
    - Compute: < 5 seconds of orchestration (excluding the LLM call).

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: welcome email, library
                           defaults, login reminder HITL wait
    PR #127              — onboarding_agent AI concierge replaces the static
                           welcome-email + library-defaults steps (advisory,
                           independent); library seeding retired with the
                           library_units cutover.
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
        # AI actor (#127): the onboarding_agent cold-starts the new tenant — proposes profile
        # enrichment, spotlight buckets to seed, whether to atomize uploads, and a getting-started
        # ToDo plan — so the mirror agents (scoring/analyst/architect/librarian/capture) are
        # effective on day one. ADVISORY (advisory → guardrail → land-or-review); tenant-bound via
        # result.tenantId. Independent (no depends_on) so a skip never blocks library setup.
        Step(
            name="ai_onboarding_concierge",
            step_type=StepType.AI_INVOKE,
            action="tool.onboarding.concierge",
            input_map={"tenant_id": "result.tenantId", "user_id": "result.userId"},
            timeout_minutes=10,
        ),
        Step(
            name="schedule_login_reminder",
            step_type=StepType.HITL_WAIT,
            action="hitl_wait",
            wait_for=EventTrigger(
                namespace="identity",
                type="user.logged_in",
                phase="single",
            ),
            timeout_minutes=2880,
            # Login-reminder escalation is V2 — no send_login_reminder step exists.
            # Timeout emits system:workflow.wait_timed_out as the escalation hook
            # (INC-6: validate() rejects dangling on_timeout refs).
        ),
    ]
