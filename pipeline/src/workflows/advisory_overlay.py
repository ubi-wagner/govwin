"""
================================================================================
Workflow: AdvisoryOverlay  (reusable sub-workflow — the Advisory / Adversarial Overlay)
================================================================================

TRIGGER:    proposal:proposal.advisory_overlay_requested:end
            Condition: payload.proposal_id present
            NOTHING emits this event yet → the overlay is INERT (trigger-gated). Any gate/step
            "invokes" the overlay by emitting this event with the overlay parameters in the payload;
            until something does, it never fires. Reversible before merge.

PURPOSE:    The reusable control layer that sits directly ABOVE any advisor and turns ONE single-shot
            advisor call into a directed, tool-augmented, 1:n adversarial pass with discrepancy
            resolution, remediation, and memory — WITHOUT modifying the advisor. It is the
            generalization of "adversarial mode": a policy-driven layer usable at any workflow gate.

THE 6 OVERLAY PARAMETERS (design: ADVISORY_MANAGER_OVERLAY_DESIGN.md), carried in the trigger payload:
    1. target      — which advisor role to run (payload.target; this build's canonical target is the
                     whole-proposal continuity reviewer, via tool.proposal.check_continuity).
    2. lens[]      — the directive injected into each run (payload.lens_0/lens_1/lens_2): marketing ·
                     research · customer · financial · technical · compliance · adversarial-skeptic.
    3. fan-out N   — run the target N times with varied directives (perspective-diverse). BOUNDED by
                     OVERLAY_FANOUT_SLOTS here (a static, runaway-capped set of fan-out steps); a gate
                     that supplies fewer lenses leaves the extra slots to safe-skip.
    4. pre_tools[] — an optional pre-augmentation tool call BEFORE the advisor (web/data/source). This
                     build wires the market/SOTA scout (tool.market.analyze_sota → market_analyst),
                     fenced + safe-skipping. INDEPENDENT so its absence never blocks the fan-out.
    5. resolution  — the adversarial-survival rule (payload.resolution: majority | consensus |
                     refute_vote), threaded into the reconcile step.
    6. landing/policy — advisory report + remediation → guardrail → HITL gate (the default, a TODO
                     review here) OR auto per the #190 automation-policy layer (a P4 policy toggle,
                     not a code path). This overlay NEVER auto-writes a business table and NEVER
                     advances a gate — the reconcile output is advisory (persisted=False) and lands in
                     a human review task.

FLOW (one invocation):
    (opt) pre_augment → fan out N × AI_INVOKE(target, directed prompt_i) → advisory_manager.reconcile
    (discrepancy → adversarial survival → remediation, + record advisory memory) → land (HITL review).

SAFETY / FAULT TOLERANCE:
    - Bounded: N is capped by OVERLAY_FANOUT_SLOTS (and advisory_manager clamps its own plan to
      MAX_FANOUT) so a runaway fan-out is impossible.
    - No dead-end: pre_augment and the fan-out runs are INDEPENDENT — one advisor failing/skipping
      never blocks the others; the managed engine's continue-on-independent-failure keeps the pass
      alive. reconcile depends on the anchor run (fanout_0); the human review lands the reconciled
      report + remediation.
    - Advisory: reconcile writes nothing to the proposal; advisory_manager records ONLY advisory
      memory. The landing is a review-staged HITL task — it never auto-advances a gate.
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow

# Runaway/budget cap on the fan-out: a static, bounded set of AI_INVOKE slots. A gate supplying fewer
# lenses leaves the extra slots to safe-skip; advisory_manager.plan_fanout independently clamps to
# MAX_FANOUT. Keep this small — each slot is a full advisor invocation.
OVERLAY_FANOUT_SLOTS = 3

# This build's canonical fan-out target: the whole-proposal continuity reviewer. Any advisor family
# can be wrapped by cloning this overlay with a different mapped AI_INVOKE action (the declarative
# engine binds an AI_INVOKE action to a fixed archetype at validate() time); the parameters (lens/N/
# resolution/policy) stay identical.
_TARGET_ADVISOR_ACTION = "tool.proposal.check_continuity"


class AdvisoryOverlay(Workflow):
    description = "Reusable advisory/adversarial overlay: pre-augment → 1:n advisor fan-out → reconcile → HITL land"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advisory_overlay_requested",
        phase="end",
        # Inert: no producer emits this event. A gate invokes the overlay by emitting it with the
        # 6 parameters in the payload.
        condition=lambda p: bool(p.get("proposal_id")),
    )

    steps = (
        [
            # (opt) PRE-AUGMENTATION — control the data flowing IN. Fresh SOTA/market context (fenced,
            # safe-skips when web egress is unconfigured). INDEPENDENT so its failure/skip never blocks
            # the fan-out. This is param #4 (pre_tools) wired to the market/SOTA scout.
            Step(
                name="pre_augment",
                step_type=StepType.AI_INVOKE,
                action="tool.market.analyze_sota",
                input_map={
                    "proposal_id": "payload.proposal_id",
                    "tenant_id": "payload.tenant_id",
                    "section_id": "payload.section_id",
                },
                timeout_minutes=10,
            ),
        ]
        # FAN OUT N × AI_INVOKE(target, directed prompt_i) — param #3, bounded by OVERLAY_FANOUT_SLOTS.
        # Each run is INDEPENDENT (no depends_on between them) so one advisor failing never blocks the
        # others (perspective-diverse: each carries a distinct lens/directive from the payload, param #2;
        # a lens-aware advisor consumes review_lens — the advisors themselves stay unchanged).
        + [
            Step(
                name=f"fanout_{i}",
                step_type=StepType.AI_INVOKE,
                action=_TARGET_ADVISOR_ACTION,
                input_map={
                    "proposal_id": "payload.proposal_id",
                    "tenant_id": "payload.tenant_id",
                    "opportunity_id": "payload.opportunity_id",
                    # The directive lens for THIS run (perspective-diverse fan-out). Absent → safe-skip.
                    "review_lens": f"payload.lens_{i}",
                },
                timeout_minutes=10,
            )
            for i in range(OVERLAY_FANOUT_SLOTS)
        ]
        + [
            # RECONCILE — advisory_manager: discrepancy analysis → adversarial survival (param #5
            # resolution) → remediation, and record ADVISORY MEMORY (its record_advisory_memory tool).
            # depends_on the anchor run so at least one advisor result exists before reconciling.
            # Advisory: persisted=False, writes no business table.
            Step(
                name="reconcile",
                step_type=StepType.AI_INVOKE,
                action="tool.advisory.reconcile",
                depends_on="fanout_0",
                input_map={
                    "proposal_id": "payload.proposal_id",
                    "tenant_id": "payload.tenant_id",
                    "target": '"continuity_manager"',
                    "resolution": "payload.resolution",
                    "task": '"reconcile"',
                },
                timeout_minutes=10,
            ),
            # LAND — param #6 (landing/policy). Default = HITL review: the reconciled report +
            # remediation land in a human review task. This NEVER auto-advances a gate; the auto
            # policy is a P4 #190 toggle, not a separate code path. INDEPENDENT (no depends_on — a hard
            # human gate must never be blocked behind an advisory agent, the launch-readiness invariant)
            # and LAST, so it parks after reconcile has run (list order); the human reviews the
            # reconciled output, correlated by proposal_id.
            Step(
                name="land_review",
                step_type=StepType.TODO,
                action="todo",
                task_type='"advisory_overlay_review"',
                task_title='"Review the advisory-overlay findings and remediation"',
                assignee_role='"tenant_admin"',
                entity_type='"proposal"',
                entity_ref="payload.proposal_id",
                timeout_minutes=4320,
            ),
        ]
    )
