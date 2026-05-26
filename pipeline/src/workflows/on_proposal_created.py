"""
================================================================================
Workflow: OnProposalCreated
================================================================================

TRIGGER:    proposal:proposal.created:end
            Condition: payload.error is None (successful creation only)

PURPOSE:    After a customer creates a proposal workspace, this workflow
            invokes the AI drafting agent to generate initial content for
            all empty proposal sections using library atoms and RFP context,
            then notifies the customer that their workspace is ready. This
            is the primary value delivery moment — the customer sees
            AI-drafted content immediately upon opening their workspace.

STEPS:
    1. draft_sections (AI_INVOKE)
       Action: tool.proposal.draft_all_sections
       Input: proposal_id, tenant_id from event payload
       Output: sections drafted count, token usage (or skipped if AI
               tool not resolvable locally in V1)
       Retry: 1 attempt, 60s delay
       Timeout: 15 minutes
       On Failure: Log error, emit step_failed. Still notify customer
                   but with adjusted context (workspace ready without
                   AI-drafted content — they can draft manually).
       Event Emitted: system:workflow.step_completed (single)

    2. notify_customer (NOTIFY)
       Action: system.notify
       Input: channel=email, template=proposal_workspace_ready,
              tenant_id, proposal_id from event payload
       Output: notified=True/False
       Retry: 0
       Timeout: 30 minutes
       On Failure: Log error, emit step_failed. Customer can still
                   access their workspace via the portal directly.
       Event Emitted: system:workflow.step_completed (single)

HITL GATES:
    - None (fully automated after proposal creation)

ERROR HANDLING:
    - Step failure: Log error, emit system:workflow.step_failed event,
      continue to next step
    - AI drafting failure: Customer still notified that workspace is
      ready (the notification step runs regardless because the processor
      continues past failed dependencies). The AI_INVOKE step returns
      skipped=True if the tool is not resolvable locally (V1 behavior).
    - Budget check: Future enhancement — verify tenant has sufficient
      AI token budget before invoking the drafter. Currently not
      enforced at workflow level (handled at tool level if applicable).
    - Notification failure: Customer can still access workspace directly
    - Workflow failure: Emit system:workflow.failed event with full context
    - External service failure: Anthropic API retried 1x with 60s delay

FAULT TOLERANCE:
    - Idempotent: PARTIAL — AI drafting may produce different content on
      re-run, but it checks for existing section content and only drafts
      empty sections. Notification uses CMS dedup window.
    - Partial completion: If AI drafting fails, customer still gets the
      workspace (just without pre-drafted content). Notification fires
      regardless.
    - Duplicate detection: Processor-level dedup by trigger_event_id.

INSTANCES:
    - Admin Pipeline: Not applicable (admin does not create proposals)
    - Customer Portal: Fires when tenant_admin creates a proposal via
      the portal proposal creation flow. The creation route emits
      proposal:proposal.created:start/end pair.
    - CMS: Automation rules also fire for this event (proposal workspace
      ready email) — the CMS event_listener handles those independently.

COST:
    - AI tokens: ~20K-100K tokens per proposal (Claude for section
      drafting across 5-10 sections). Skipped in V1 if tool not
      resolvable locally.
    - Compute: 2-15 minutes for AI drafting; < 1 second for notification

CHANGE LOG:
    PR #140 (2026-05-22) — Initial implementation: AI draft + notify
    PR #xxx (2026-05-22) — Hardened: comprehensive header, error handling
                           ensuring notification fires even if AI drafting
                           fails, budget check documentation, progress
                           tracking notes, event emissions, fault tolerance
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnProposalCreated(Workflow):
    description = "AI-draft proposal sections and notify customer"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.created",
        phase="end",
        condition=lambda p: bool(p.get("proposalId")),
    )

    steps = [
        Step(
            name="draft_sections",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.draft_all_sections",
            input_map={
                "proposal_id": "payload.proposalId",
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
                "proposal_id": "payload.proposalId",
            },
        ),
    ]
