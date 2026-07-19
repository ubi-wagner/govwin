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
    description = "Notify admin of new proposal requiring 72-hour review"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.created",
        phase="end",
        condition=lambda p: bool(p.get("proposalId")),
    )

    steps = [
        # B5 — the 3-source V0 strawman. Draft every EMPTY section (RFP excerpt +
        # library atoms + tenant profile, via section_drafter) and land each through
        # publish_section_draft BEFORE the human review gate. Guarded: only
        # empty/ai_drafted sections are touched, and it is a safe no-op if the
        # fabric / API key is unavailable.
        # AI actor (#117): the proposal_architect reviews the just-provisioned skeleton and
        # suggests structure/organization improvements — ADVISORY. Independent of drafting
        # (no depends_on), so a failure/skip never blocks the loop; the fabric treats agent
        # output as advisory (never auto-writes). Tenant-bound via payload.tenantId.
        Step(
            name="architect_review",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.architect",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
            },
            timeout_minutes=10,
        ),
        # AI actor (#117): the capture_strategist develops win themes, competitive positioning,
        # teaming recommendations, and a risk register for the just-created proposal — ADVISORY.
        # The go/no-go is already settled (portal purchased), but the strategic frame seeds the
        # build. Independent (no depends_on) so a failure/skip never blocks drafting; the fabric
        # treats agent output as advisory (never auto-writes). Tenant-bound via payload.tenantId;
        # the ContextAssembler resolves the solicitation from proposal_id and injects it.
        Step(
            name="ai_capture_strategy",
            step_type=StepType.AI_INVOKE,
            action="tool.capture.generate_strategy",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
            },
            timeout_minutes=10,
        ),
        # AI actors (#129, Batch C): cost_estimator seeds cost-volume realism guidance;
        # pp_matcher surfaces relevant past performance + flags teaming gaps. Both ADVISORY,
        # tenant-bound, and independent of draft_sections so a skip never blocks the loop.
        Step(
            name="ai_cost_estimator",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.cost_estimate",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
            },
            timeout_minutes=10,
        ),
        Step(
            name="ai_pp_matcher",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.match_past_performance",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
            },
            timeout_minutes=10,
        ),
        Step(
            name="draft_sections",
            step_type=StepType.ACTION,
            action="workflows.actions.draft_v0.draft_v0",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
            },
            timeout_minutes=15,
        ),
        Step(
            name="notify_admin_review",
            step_type=StepType.NOTIFY,
            action="system.notify",
            depends_on="draft_sections",
            input_map={
                "channel": '"email"',
                "template": '"admin_proposal_review_required"',
                "tenant_id": "payload.tenantId",
                "proposal_id": "payload.proposalId",
                "proposal_title": "payload.proposalTitle",
            },
        ),
    ]
