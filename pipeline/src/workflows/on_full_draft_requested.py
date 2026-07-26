"""
================================================================================
Workflow: OnFullDraftRequested  (the Proposal Draft Manager orchestration — 3 modes)
================================================================================

TRIGGER:    proposal:proposal.full_draft_requested:end
            Condition: payload.proposal_id present AND payload.mode in {a, b, c}
            Optional payload.voice (the Voice-of-Proposal register, threaded into drafting).
            NOTHING emits this event yet → these workflows are INERT (trigger-gated). The admin-run
            "Run full draft" control (P3 UI) will emit it; until then nothing fires. Reversible.

PURPOSE:    The Proposal Draft Manager composes the drafting/format/style/cost/package agents + the
            review gate cohort into an admin-run "skeleton + matrix → drafted V0 artifacts" flow, with
            3 automation MODES (design: PROPOSAL_MANAGER_ORCHESTRATION_DESIGN.md §1). All three run the
            same SPINE HEAD — proposal_manager PLANS the per-section draft from the skeleton + compliance
            matrix + ranked library atoms — then diverge on how much the machine does vs the admin.

            EVERY output lands in review-staged canvas_versions (source='ai_revision', persisted
            advisory) — the drafting agents/actions write those; this workflow only SEQUENCES advisory
            AI_INVOKE steps and a HITL gate. It NEVER advances a stage / gate: no step emits
            proposal.advanced; each mode ENDS in a human review TODO. "Adversarial managers take HITL
            out" is a later per-tenant policy choice (P4), never an auto-advance here.

MODE BRANCHING (three Workflow classes sharing the trigger, differentiated by payload.mode — the same
pattern as OnProposalAdvancedToReview / …ToFinal):

  Mode A (V0.1) — HITL + AI enablement (fastest human-controlled). MINIMAL auto steps: stage ranked
      atoms into the toolbox (seed_suggester) → merge selected primitives (section_drafter) → the admin
      scrolls section-by-section, checkboxes, and fires regen/reformat themselves. Ends at a stage
      review TODO. (No auto formatter/stylist — those are admin-triggered in Mode A.)

  Mode B (V0.2) — Informed restyle/reformat (controlled). Takes V0.1 as the guide and runs a controlled
      restyle (stylist) → re-scaffold to the locked structure (formatter) → a lock/review TODO where
      locking SETS the styles for that section. Guided, hand-editable, lockable.

  Mode C (V0.5) — Full auto-draft. The full per-section pipeline [seed_suggester → section_drafter →
      formatter → stylist] → cost_estimator (cost volume) → packaging_specialist (assemble) → the
      REVIEW GATE COHORT (continuity_manager + traceability_auditor + redaction_guard). The gate cohort
      is the SAME advisor set the reusable AdvisoryOverlay wraps — a gate may elevate it to the overlay's
      1:n fan-out + reconcile by emitting proposal.advisory_overlay_requested. Ends at a full-draft
      review TODO (the human — or, later, the adversarial cohort under an auto policy — passes the gate).

VOICE-OF-PROPOSAL: payload.voice (a register / weighting over passive · persuasive · technical ·
      commercial · research · development) is threaded into every drafting/regen step (plan / draft /
      restyle) via input_map. It is a guarded no-op when absent (section_drafter appends the register
      only when a voice is present). Cost/spec steps ignore it.

SAFETY / FAULT TOLERANCE:
    - Advisory-only: every AI_INVOKE step is an advisory agent (never auto-writes a business table);
      outputs land in review-staged canvas_versions and route through the fabric guardrail.
    - No auto-advance: no step emits proposal.advanced; each mode ends in a HITL review TODO.
    - No dead-end: the review gate cohort in Mode C is INDEPENDENT (each gate agent has no dependents),
      so a failing/skipping gate agent never strands the human review; cost_estimate is independent of
      the narrative chain.
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow

# The Voice-of-Proposal register path — threaded into every drafting/regen step. Guarded no-op when
# the payload omits it (section_drafter / proposal_manager append the register only when present).
_VOICE = "payload.voice"


def _plan_step() -> Step:
    """The spine head shared by all three modes: proposal_manager PLANS the per-section draft from the
    skeleton + compliance matrix + ranked library atoms. ADVISORY (emits a plan, writes nothing).
    Threads the Voice-of-Proposal register."""
    return Step(
        name="plan_draft",
        step_type=StepType.AI_INVOKE,
        action="tool.proposal.plan_draft",
        input_map={
            "proposal_id": "payload.proposal_id",
            "tenant_id": "payload.tenant_id",
            "mode": "payload.mode",
            "voice": _VOICE,
        },
        timeout_minutes=10,
    )


class OnFullDraftRequestedModeA(Workflow):
    """Mode A (V0.1) — HITL + AI enablement. Minimal auto: stage atoms + merge, the admin drives."""

    description = "Full draft Mode A (V0.1): stage ranked atoms + merge, human-controlled (HITL)"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.full_draft_requested",
        phase="end",
        condition=lambda p: bool(p.get("proposal_id")) and p.get("mode") == "a",
    )

    steps = [
        _plan_step(),
        # Stage the ranked atoms into the right-side toolbox for each section (the atom-picker feed).
        Step(
            name="seed_suggest",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.seed_suggest",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=5,
        ),
        # Merge the selected primitives into a rough draft (section_drafter). Threads voice.
        Step(
            name="draft_sections",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.draft_all_sections",
            depends_on="seed_suggest",
            input_map={
                "proposal_id": "payload.proposal_id",
                "tenant_id": "payload.tenant_id",
                "voice": _VOICE,
            },
            timeout_minutes=15,
        ),
        # HITL: the admin scrolls section-by-section, checkboxes the closest primitives, and fires
        # regen/reformat. Never auto-advances — the human owns the loop in Mode A. INDEPENDENT (a hard
        # human gate must never be blocked behind an advisory agent) and LAST, so it parks after the
        # draft has run (list order).
        Step(
            name="stage_review",
            step_type=StepType.TODO,
            action="todo",
            task_type='"proposal_draft_stage_review"',
            task_title='"Review staged atoms + merged draft (Mode A) and regenerate as needed"',
            assignee_role='"tenant_admin"',
            entity_type='"proposal"',
            entity_ref="payload.proposal_id",
            timeout_minutes=4320,
        ),
    ]


class OnFullDraftRequestedModeB(Workflow):
    """Mode B (V0.2) — informed restyle/reformat (controlled), lock-sets-style."""

    description = "Full draft Mode B (V0.2): controlled restyle + reformat, lock sets the style"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.full_draft_requested",
        phase="end",
        condition=lambda p: bool(p.get("proposal_id")) and p.get("mode") == "b",
    )

    steps = [
        _plan_step(),
        # Controlled restyle guided by V0.1's audited style/format stripping (stylist). Threads voice.
        Step(
            name="restyle",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.restyle",
            input_map={
                "proposal_id": "payload.proposal_id",
                "tenant_id": "payload.tenant_id",
                "voice": _VOICE,
            },
            timeout_minutes=10,
        ),
        # Re-scaffold to the locked structure (formatter).
        Step(
            name="reformat",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.reformat_section",
            depends_on="restyle",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        # HITL: hand-editable + lockable — locking SETS the styles/formats for that section. Never
        # auto-advances. INDEPENDENT (a hard human gate must never be blocked behind an advisory agent)
        # and LAST, so it parks after the restyle/reformat has run (list order).
        Step(
            name="lock_review",
            step_type=StepType.TODO,
            action="todo",
            task_type='"proposal_style_lock_review"',
            task_title='"Review the controlled restyle (Mode B) and lock the section styles"',
            assignee_role='"tenant_admin"',
            entity_type='"proposal"',
            entity_ref="payload.proposal_id",
            timeout_minutes=4320,
        ),
    ]


class OnFullDraftRequestedModeC(Workflow):
    """Mode C (V0.5) — full auto-draft across the per-section pipeline + cost + package + gate cohort."""

    description = "Full draft Mode C (V0.5): full auto per-section + cost + package + review gate cohort"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.full_draft_requested",
        phase="end",
        condition=lambda p: bool(p.get("proposal_id")) and p.get("mode") == "c",
    )

    steps = [
        _plan_step(),
        # ── Per-section pipeline: seed → draft → format → style (each whole-proposal agent iterates
        #    its sections). Chained so the draft is scaffolded then styled in order. Threads voice.
        Step(
            name="seed_suggest",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.seed_suggest",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=5,
        ),
        Step(
            name="draft_sections",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.draft_all_sections",
            depends_on="seed_suggest",
            input_map={
                "proposal_id": "payload.proposal_id",
                "tenant_id": "payload.tenant_id",
                "voice": _VOICE,
            },
            timeout_minutes=15,
        ),
        Step(
            name="reformat",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.reformat_section",
            depends_on="draft_sections",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        Step(
            name="restyle",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.restyle",
            depends_on="reformat",
            input_map={
                "proposal_id": "payload.proposal_id",
                "tenant_id": "payload.tenant_id",
                "voice": _VOICE,
            },
            timeout_minutes=10,
        ),
        # ── Cost volume (cost_estimator). INDEPENDENT of the narrative chain — a cost failure never
        #    blocks packaging/gates; the narrative ignores voice-vs-cost separation.
        Step(
            name="cost_estimate",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.cost_estimate",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        # ── Assemble the submission package (packaging_specialist). Comes after the narrative is styled.
        Step(
            name="package",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.package",
            depends_on="restyle",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        # ── Review GATE COHORT — the same advisor set the reusable AdvisoryOverlay wraps. Each is
        #    INDEPENDENT (no dependents) so a failing/skipping gate agent never strands the human
        #    review. A gate may ELEVATE this cohort to the overlay's 1:n fan-out + reconcile by
        #    emitting proposal.advisory_overlay_requested. All advisory — no auto-advance.
        Step(
            name="gate_continuity",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.check_continuity",
            depends_on="package",
            input_map={
                "proposal_id": "payload.proposal_id",
                "tenant_id": "payload.tenant_id",
                "opportunity_id": "payload.opportunity_id",
            },
            timeout_minutes=10,
        ),
        Step(
            name="gate_traceability",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.audit_traceability",
            depends_on="package",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        Step(
            name="gate_redaction",
            step_type=StepType.AI_INVOKE,
            action="tool.proposal.scan_redaction",
            depends_on="package",
            input_map={"proposal_id": "payload.proposal_id", "tenant_id": "payload.tenant_id"},
            timeout_minutes=10,
        ),
        # HITL: the human (or, later, the adversarial cohort under a #190 auto policy) reviews the
        # auto-drafted V0.5 artifacts + gate findings and passes the gate. NEVER auto-advances.
        # INDEPENDENT (a hard human gate must never be blocked behind an advisory agent — the
        # launch-readiness invariant) and LAST, so it always surfaces and parks after the whole
        # per-section + cost + package + gate-cohort pipeline has run (list order).
        Step(
            name="review_gate",
            step_type=StepType.TODO,
            action="todo",
            task_type='"proposal_full_draft_review"',
            task_title='"Review the full auto-draft (Mode C, V0.5) and advance the gate"',
            assignee_role='"tenant_admin"',
            entity_type='"proposal"',
            entity_ref="payload.proposal_id",
            timeout_minutes=4320,
        ),
    ]
