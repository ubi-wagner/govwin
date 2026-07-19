"""
================================================================================
Workflow: OnCollaboratorInvited
================================================================================

TRIGGER:    proposal:collaborator.invited:end
            Condition: payload.proposalId is present (successful invite only)

PURPOSE:    When a tenant admin invites a collaborator / teaming partner onto a
            proposal, the partner_coordinator agent drafts a professional
            welcome/onboarding message (role, deliverables needed, timeline,
            next steps) and flags any partner-relevant compliance items — all
            ADVISORY. The draft is queued for the tenant admin to review and
            send; the agent never contacts partners directly (human gate).

            This is the kickoff→actor→review loop for the partner_coordinator:
            a discrete user action (invite) fires a bounded, per-collaborator
            agent invocation (never a fan-out).

STEPS:
    1. ai_partner_welcome (AI_INVOKE)
       Action: tool.partner.coordinate
       Input: proposal_id, tenant_id, action="welcome", plus the partner's
              name/email/role from the collaborator.invited payload.
       Output: welcome draft + partner status + risk flags (advisory), or
               skipped=True if the fabric / API key is unavailable (V1).
       Retry: 0
       Timeout: 10 minutes
       On Failure: Log error, emit step_failed. The admin can still onboard
                   the partner manually — the invite itself already succeeded.

    2. notify_admin_partner_draft (NOTIFY)
       Action: system.notify
       Input: channel=email, template=partner_onboarding_ready, proposal_id,
              tenant_id, collaborator email/name.
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       INDEPENDENT (no depends_on): fires regardless of the agent result, so a
       skipped/failed agent never dead-ends the loop — the admin is routed to
       onboard the partner either way.

HITL GATES:
    - The welcome message is a DRAFT. Per the partner_coordinator guardrails,
      all external communications require human review before sending; nothing
      is auto-sent.

ERROR HANDLING:
    - Agent failure/skip: advisory only; the invite + access grant already
      committed in the route. The notify still fires (independent).
    - Notification failure: the admin still sees the new collaborator in the
      proposal workspace.
    - Workflow failure: emit system:workflow.failed.

FAULT TOLERANCE:
    - Idempotent: PARTIAL — the draft may differ on re-run; it is advisory and
      never auto-written to a business table. Notification uses CMS dedup.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

SAFETY (#117 agent invariants):
    - Tenant-bound: the agent is pinned to payload.tenantId; its tool schemas
      expose NO tenant_id (tenant-discretion).
    - Injection-fenced: the collaborator's name/email/role are delimited as
      untrusted USER CONTENT in the agent prompt.
    - Advisory → review: output is never auto-applied; the fabric returns it
      for the admin to act on.
    - No dead-end: the AI_INVOKE step is safe-skipped when unmapped/unavailable
      and the notify is independent of it.

INSTANCES:
    - Customer Portal: fires when a tenant_admin invites a collaborator via the
      proposal workspace collaborators route (emits proposal:collaborator.invited).
    - Admin Pipeline: N/A.

COST:
    - partner_coordinator: ~$0.05/call (claude-haiku), one call per invite.

CHANGE LOG:
    #117 — Initial implementation: wake partner_coordinator as an AI_INVOKE
           actor on collaborator invitation (kickoff trigger + review loop).
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnCollaboratorInvited(Workflow):
    description = "Draft a partner welcome for admin review when a collaborator is invited"

    trigger = EventTrigger(
        namespace="proposal",
        type="collaborator.invited",
        phase="end",
        condition=lambda p: bool(p.get("proposalId")),
    )

    steps = [
        # AI actor (#117): the partner_coordinator drafts the welcome/onboarding message and
        # flags partner-relevant compliance/risks — ADVISORY, human-gated (never auto-sent).
        # Tenant-bound via payload.tenantId; the partner identity is passed as flat fields and
        # injection-fenced in the prompt. Independent so a skip never blocks the loop.
        Step(
            name="ai_partner_welcome",
            step_type=StepType.AI_INVOKE,
            action="tool.partner.coordinate",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
                "action": '"welcome"',
                "partner_name": "payload.name",
                "partner_email": "payload.email",
                "partner_role": "payload.role",
            },
            timeout_minutes=10,
        ),
        # Route the tenant admin to review the draft (or onboard manually). INDEPENDENT of the
        # agent step so a failed/skipped draft never dead-ends the automation.
        Step(
            name="notify_admin_partner_draft",
            step_type=StepType.NOTIFY,
            action="system.notify",
            input_map={
                "channel": '"email"',
                "template": '"partner_onboarding_ready"',
                "tenant_id": "payload.tenantId",
                "proposal_id": "payload.proposalId",
                "collaborator_email": "payload.email",
                "collaborator_name": "payload.name",
            },
        ),
    ]
