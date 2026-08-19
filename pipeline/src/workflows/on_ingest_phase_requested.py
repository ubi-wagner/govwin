"""
================================================================================
Workflow: OnIngestPhaseRequested  (Ingest Studio — the gated ingest)
================================================================================

TRIGGER:    finder:ingest.phase_requested:end
            Condition: payload.solicitation_id present AND payload.phase in
            {extract, matrix, review, molds} — four Workflow classes sharing one trigger and
            branching on payload.phase, the same idiom as OnReviewPhaseRequested{Draft,Refine,
            Compliance} and OnFullDraftRequested{ModeA,B,C}.

PURPOSE:    Runs a curated solicitation through four gated phases over the EXISTING ingest cohort,
            which was registered but dormant:

              extract  ingest_analyst      text → a structured reading
              matrix   matrix_stager       reading → a STAGED compliance matrix
              review   curation_qa × 3     refute the staged values against their citations,
                       advisory_manager    then reconcile (the colour team)
              molds    skeleton_architect  volumes + section molds, from a LANDED matrix only

            No new archetypes: all four were already in TOOL_ACTION_TO_ARCHETYPE. We are at 36
            archetypes with most asleep; the fix for that is to wake them, not to mint more.

WHY THE REVIEW PHASE IS WORTH HAVING NOW: since migrations 187/188 every extracted value carries
            the sentence it was read from, its page, and which document. So "refute this matrix"
            is a checkable question — *does p.2 of document 2 actually say the Technical Volume
            may not exceed 10 pages?* — rather than a vibe. Without citations an adversarial gate
            is theater; with them it is an audit.

SAFETY:     Advisory throughout. NOTHING here writes solicitation_compliance — landing is a
            separate, gated act performed by the frontend `landSkeleton`, refused while the
            provenance audit reports a blocker. Agents are independent and safe-skip: an
            unavailable agent leaves the phase at its gate with a human able to act, never a
            stuck instance. The advance ACTION owns only `curated_solicitations.ingest_phase`.

CHANGE LOG:
    Ingest Studio Phase 1 — initial implementation (4 gated phases over the dormant cohort).
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow

_SOL = "payload.solicitation_id"
_GUIDANCE = "payload.guidance"   # the admin's comment, threaded in on a regenerate

# Bounded colour-team fan-out. Keep small — each slot is a full reviewer call, and the runaway
# bound matters more than breadth (AGENT_WORKFORCE.md: runtime bounds runaway).
COLOUR_TEAM_SLOTS = 3


def _trigger(phase: str) -> EventTrigger:
    return EventTrigger(
        namespace="finder",
        type="ingest.phase_requested",
        phase="end",
        condition=lambda p, _ph=phase: bool(p.get("solicitation_id")) and p.get("phase") == _ph,
    )


def _advance(phase: str) -> Step:
    """Tail of every phase: emit completed, then hold the gate (manual) or chain (auto)."""
    return Step(
        name="advance_phase",
        step_type=StepType.ACTION,
        action="workflows.actions.ingest_actions.advance_ingest_phase",
        input_map={
            "solicitation_id": _SOL,
            "phase": f'"{phase}"',
            "auto": "payload.auto",
            "draft_id": "payload.draft_id",
            "guidance": _GUIDANCE,
            "source": "payload.source",
        },
        timeout_minutes=5,
    )


class OnIngestPhaseRequestedExtract(Workflow):
    """Phase 1 — EXTRACT: read the solicitation text into a structured reading."""

    description = "Ingest Studio phase 1 (Extract): ingest_analyst reads the solicitation"
    trigger = _trigger("extract")

    steps = [
        Step(
            name="extract", step_type=StepType.AI_INVOKE, action="tool.solicitation.ingest",
            input_map={"solicitation_id": _SOL, "guidance": _GUIDANCE},
            timeout_minutes=15,
        ),
        _advance("extract"),
    ]


class OnIngestPhaseRequestedMatrix(Workflow):
    """Phase 2 — MATRIX: turn the reading into a STAGED compliance matrix. Staged, not landed."""

    description = "Ingest Studio phase 2 (Matrix): matrix_stager proposes a compliance matrix"
    trigger = _trigger("matrix")

    steps = [
        Step(
            name="stage_matrix", step_type=StepType.AI_INVOKE, action="tool.matrix.stage",
            input_map={"solicitation_id": _SOL, "guidance": _GUIDANCE},
            timeout_minutes=15,
        ),
        _advance("matrix"),
    ]


class OnIngestPhaseRequestedReview(Workflow):
    """Phase 3 — ADVERSARIAL REVIEW: N reviewers try to refute the staged matrix, then reconcile.

    Each reviewer carries a distinct LENS (citation · completeness · consistency), because the
    ways an extraction goes wrong are different in kind: a value whose excerpt does not support
    it, a binding rule with no row at all, and a set of values that contradict each other are
    three separate failures and one reviewer looking for all three finds none of them well.

    The runs are INDEPENDENT — one reviewer failing never blocks the others — and reconcile
    depends only on the anchor run, so a partial colour team still produces a verdict.
    """

    description = "Ingest Studio phase 3 (Review): colour team refutes the staged matrix, then reconciles"
    trigger = _trigger("review")

    steps = (
        [
            Step(
                name=f"refute_{i}", step_type=StepType.AI_INVOKE, action="tool.curation.qa",
                input_map={
                    "solicitation_id": _SOL,
                    # Absent lens ⇒ the step safe-skips rather than running an unfocused pass.
                    "review_lens": f"payload.lens_{i}",
                    "guidance": _GUIDANCE,
                },
                timeout_minutes=10,
            )
            for i in range(COLOUR_TEAM_SLOTS)
        ]
        + [
            Step(
                name="reconcile", step_type=StepType.AI_INVOKE, action="tool.advisory.reconcile",
                depends_on="refute_0",
                input_map={
                    "solicitation_id": _SOL,
                    "target": '"curation_qa"',
                    "resolution": "payload.resolution",
                    "task": '"reconcile"',
                },
                timeout_minutes=10,
            ),
            # Record the verdict on the staged draft. INDEPENDENT of reconcile: a landing/record
            # step must never be gated behind an advisory agent (the no-dead-end invariant).
            Step(
                name="record_review", step_type=StepType.ACTION,
                action="workflows.actions.ingest_actions.record_ingest_review",
                input_map={"solicitation_id": _SOL, "resolution": "payload.resolution"},
                timeout_minutes=5,
            ),
            _advance("review"),
        ]
    )


class OnIngestPhaseRequestedMolds(Workflow):
    """Phase 4 — MOLDS: author volumes + section molds. Reads a LANDED matrix only.

    A separate job from extraction, with a separate failure mode: extraction asks *did we read it
    right*, authoring asks *is this the right shape to respond in*. Fused (as they were in
    materializeSkeleton), a misread page limit silently becomes a wrong mold and nobody can tell
    which step was at fault. Gated behind landing so a mold can never be built on a value nobody
    approved.
    """

    description = "Ingest Studio phase 4 (Molds): skeleton_architect authors volumes + section molds"
    trigger = _trigger("molds")

    steps = [
        Step(
            name="build_molds", step_type=StepType.AI_INVOKE, action="tool.skeleton.build",
            input_map={"solicitation_id": _SOL, "guidance": _GUIDANCE},
            timeout_minutes=15,
        ),
        _advance("molds"),
    ]
