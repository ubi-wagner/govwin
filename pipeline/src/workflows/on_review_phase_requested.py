"""
================================================================================
Workflow: OnReviewPhaseRequested  (Proposal Studio — 3 gated loops)
================================================================================

TRIGGER:    proposal:review_phase.requested:end
            Condition: payload.proposal_id present AND payload.phase in {draft, refine, compliance}
            (three Workflow classes sharing the trigger, branching on payload.phase — the same
             pattern as OnFullDraftRequested{ModeA,B,C}).

PURPOSE:    The Proposal Studio runs the proposal through three gated loops over the EXISTING agent
            cohorts — Draft → Refine → Compliance — reusing the same AI_INVOKE actions
            OnFullDraftRequested Mode C chains, but broken into three human-gated phases. Each phase
            runs its advisory cohort (guidance from the admin's review comments threaded in), then the
            advance_studio_phase ACTION either opens the human gate (manual) or auto-chains the next
            phase (auto — the doorbell path). docs/PROPOSAL_STUDIO_DESIGN.md.

SAFETY:     Advisory-only (outputs land in review-staged canvas_versions); the Studio NEVER advances a
            proposal stage, locks a section, or submits. Agents are independent + safe-skip (unkeyed
            AI_INVOKE steps skip and the phase still advances to its gate). The advance ACTION owns the
            studio_* state, never a business content table.

CHANGE LOG:
    Studio Phase 1 — Initial implementation (3-phase gated draft workflow).
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow

# The admin's review comments — threaded into each drafting/refine step as steering (guarded no-op
# when absent, like the Voice-of-Proposal register).
_GUIDANCE = "payload.guidance"
_VOICE = "payload.voice"


def _advance_step(phase: str) -> Step:
    """The tail of every phase: emit review_phase.completed, then open the human gate (manual) or
    auto-chain the next phase (auto). Owns the studio_* state machine."""
    return Step(
        name="advance_phase",
        step_type=StepType.ACTION,
        action="workflows.actions.studio_actions.advance_studio_phase",
        input_map={
            "proposal_id": "payload.proposal_id",
            "tenant_id": "payload.tenant_id",
            "phase": f'"{phase}"',
            "auto": "payload.auto",
            "opportunity_id": "payload.opportunity_id",
            "source": "payload.source",
        },
        timeout_minutes=5,
    )


def _trigger(phase: str) -> EventTrigger:
    return EventTrigger(
        namespace="proposal",
        type="review_phase.requested",
        phase="end",
        condition=lambda p, _ph=phase: bool(p.get("proposal_id")) and p.get("phase") == _ph,
    )


class OnReviewPhaseRequestedDraft(Workflow):
    """Phase 1 — DRAFT: plan → seed ranked atoms → draft every section (grounded on the library)."""

    description = "Studio phase 1 (Draft): plan + seed + draft all sections"
    trigger = _trigger("draft")

    steps = [
        Step(
            name="plan_draft", step_type=StepType.AI_INVOKE, action="tool.proposal.plan_draft",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id",
                       "voice": _VOICE, "guidance": _GUIDANCE},
            timeout_minutes=10,
        ),
        Step(
            name="seed_suggest", step_type=StepType.AI_INVOKE, action="tool.proposal.seed_suggest",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=5,
        ),
        Step(
            # THE per-section drafter. This used to be an AI_INVOKE on
            # `tool.proposal.draft_all_sections`, which maps to the section_drafter ARCHETYPE — an
            # agent built to draft ONE section from a payload carrying its title, page budget,
            # required subsections and ranked library atoms. The step passed none of that: just
            # proposal_id and tenant_id. So the "draft every section" step made a single nameless
            # call, the archetype defaulted section_title to "Untitled Section", and the run
            # completed having drafted nothing while the workflow reported success. Proven live on
            # the T3CP build: 20 sections in, one "Untitled Section" blob out.
            #
            # `draft_v0` is the ACTION that actually does it — the one OnProposalCreated has always
            # used. It loads every still-fillable section, assembles the RFP + compliance + library
            # context per section, invokes the fabric once per section, and lands each draft through
            # publish_section_draft's guards. Same actor, real context, one section at a time.
            # No depends_on: seed_suggest is advisory (AI_INVOKE) and must never gate this hard
            # step — draft_v0 retrieves its own library context per section, so a skipped or
            # rate-limited seeder degrades the draft's starting material, never blocks it.
            name="draft_sections", step_type=StepType.ACTION, action="workflows.actions.draft_v0.draft_v0",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id",
                       "voice": _VOICE, "guidance": _GUIDANCE},
            timeout_minutes=15,
        ),
        _advance_step("draft"),
    ]


class OnReviewPhaseRequestedRefine(Workflow):
    """Phase 2 — REFINE: re-scaffold (formatter) → restyle to one house style (stylist) → cost + package."""

    description = "Studio phase 2 (Refine): reformat + restyle + cost + package"
    trigger = _trigger("refine")

    steps = [
        Step(
            name="reformat", step_type=StepType.AI_INVOKE, action="tool.proposal.reformat_section",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        Step(
            name="restyle", step_type=StepType.AI_INVOKE, action="tool.proposal.restyle",
            depends_on="reformat",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id",
                       "voice": _VOICE, "guidance": _GUIDANCE},
            timeout_minutes=10,
        ),
        # Cost is independent of the narrative chain — a cost failure never blocks the loop.
        Step(
            name="cost_estimate", step_type=StepType.AI_INVOKE, action="tool.proposal.cost_estimate",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        Step(
            name="package", step_type=StepType.AI_INVOKE, action="tool.proposal.package",
            depends_on="restyle",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        _advance_step("refine"),
    ]


class OnReviewPhaseRequestedCompliance(Workflow):
    """Phase 3 — COMPLIANCE: the gate cohort — requirement coverage, continuity, redaction — advisory."""

    description = "Studio phase 3 (Compliance): compliance + continuity + traceability + redaction"
    trigger = _trigger("compliance")

    steps = [
        # All four gate agents are INDEPENDENT so a failing/skipping one never strands the loop.
        Step(
            name="check_compliance", step_type=StepType.AI_INVOKE, action="tool.proposal.check_compliance",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        Step(
            name="check_continuity", step_type=StepType.AI_INVOKE, action="tool.proposal.check_continuity",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id",
                       "opportunity_id": "payload.opportunity_id"},
            timeout_minutes=10,
        ),
        Step(
            name="audit_traceability", step_type=StepType.AI_INVOKE, action="tool.proposal.audit_traceability",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        Step(
            name="scan_redaction", step_type=StepType.AI_INVOKE, action="tool.proposal.scan_redaction",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        _advance_step("compliance"),
    ]
