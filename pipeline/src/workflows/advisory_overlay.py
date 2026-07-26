"""
================================================================================
Workflow: AdvisoryOverlay  (reusable sub-workflow — the Advisory / Adversarial Overlay)
================================================================================

TRIGGER:    proposal:proposal.advisory_overlay_requested:end
            Condition: payload.proposal_id present. TWO classes share this trigger and
            branch on payload.policy (the same idiom as OnFullDraftRequested{ModeA,B,C}):
              - AdvisoryOverlay      → policy != 'auto'  → HITL review TODO landing
              - AdvisoryOverlayAuto  → policy == 'auto'  → non-blocking advisory record
            The Proposal Draft Manager's Mode C now EMITS this event (via the
            request_advisory_overlay action) when the admin selects the adversarial gate;
            standalone gates may still emit it directly. Absent that, it stays INERT.

PURPOSE:    The reusable control layer that sits directly ABOVE any advisor and turns ONE
            single-shot advisor call into a directed, tool-augmented, 1:n adversarial pass
            with discrepancy resolution, remediation, and memory — WITHOUT modifying the
            advisor. It is the generalization of "adversarial mode": a policy-driven layer
            usable at any workflow gate.

THE 6 OVERLAY PARAMETERS (design: ADVISORY_MANAGER_OVERLAY_DESIGN.md), carried in payload:
    1. target      — which advisor role to run (payload.target; this build's canonical
                     target is the whole-proposal continuity reviewer).
    2. lens[]      — the directive injected into each run (payload.lens_0/lens_1/lens_2):
                     marketing · research · customer · financial · technical · compliance ·
                     adversarial-skeptic.
    3. fan-out N   — run the target N times with varied directives (perspective-diverse),
                     BOUNDED by OVERLAY_FANOUT_SLOTS (a static, runaway-capped set).
    4. pre_tools[] — an optional pre-augmentation tool call BEFORE the advisor (web/data/
                     source). This build wires the market/SOTA scout, fenced + safe-skipping.
    5. resolution  — the adversarial-survival rule (payload.resolution: majority | consensus
                     | refute_vote), threaded into the reconcile step.
    6. landing/policy — advisory report + remediation → guardrail → HITL gate (AdvisoryOverlay,
                     the default) OR AUTO per the tenant's adversarial policy (AdvisoryOverlayAuto).
                     "Auto" is a LANDING choice — the reconciled verdict is RECORDED as an
                     advisory audit event instead of parking a human — NOT a rewrite and NOT
                     a gate advance. NEITHER class auto-writes a business table or advances a
                     gate; the reconcile output is advisory (persisted=False).

FLOW (one invocation):
    (opt) pre_augment → fan out N × AI_INVOKE(target, directed prompt_i) → advisory_manager
    .reconcile (discrepancy → adversarial survival → remediation, + record advisory memory) →
    LAND: HITL review TODO (policy != auto) OR advisory record action (policy == auto).

SAFETY / FAULT TOLERANCE:
    - Bounded: N capped by OVERLAY_FANOUT_SLOTS; advisory_manager clamps its own plan.
    - No dead-end: pre_augment + fan-out runs are INDEPENDENT — one failing/skipping never
      blocks the others; reconcile depends on the anchor run (fanout_0). The landing step
      (TODO or record) is the terminal step (nothing depends on it).
    - Advisory: reconcile writes nothing to the proposal; advisory_manager records ONLY
      advisory memory. HITL land never auto-advances a gate; AUTO land only records an
      advisory audit event — still no gate advance, no business-table write.
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow

# Runaway/budget cap on the fan-out: a static, bounded set of AI_INVOKE slots. A gate
# supplying fewer lenses leaves the extra slots to safe-skip; advisory_manager.plan_fanout
# independently clamps to MAX_FANOUT. Keep this small — each slot is a full advisor call.
OVERLAY_FANOUT_SLOTS = 3

# This build's canonical fan-out target: the whole-proposal continuity reviewer. Any advisor
# family can be wrapped by cloning this overlay with a different mapped AI_INVOKE action.
_TARGET_ADVISOR_ACTION = "tool.proposal.check_continuity"


def _pre_augment_step() -> Step:
    """(opt) PRE-AUGMENTATION — control the data flowing IN. Fresh SOTA/market context
    (fenced, safe-skips when web egress is unconfigured). INDEPENDENT so its failure/skip
    never blocks the fan-out. Overlay param #4 (pre_tools) wired to the market/SOTA scout."""
    return Step(
        name="pre_augment",
        step_type=StepType.AI_INVOKE,
        action="tool.market.analyze_sota",
        input_map={
            "proposal_id": "payload.proposal_id",
            "tenant_id": "payload.tenant_id",
            "section_id": "payload.section_id",
        },
        timeout_minutes=10,
    )


def _fanout_steps() -> list[Step]:
    """FAN OUT N × AI_INVOKE(target, directed prompt_i) — param #3, bounded by
    OVERLAY_FANOUT_SLOTS. Each run is INDEPENDENT (no depends_on) so one advisor failing
    never blocks the others (perspective-diverse: each carries a distinct lens from the
    payload, param #2; a lens-aware advisor consumes review_lens — advisors stay unchanged)."""
    return [
        Step(
            name=f"fanout_{i}",
            step_type=StepType.AI_INVOKE,
            action=_TARGET_ADVISOR_ACTION,
            input_map={
                "proposal_id": "payload.proposal_id",
                "tenant_id": "payload.tenant_id",
                "opportunity_id": "payload.opportunity_id",
                # The directive lens for THIS run (perspective-diverse). Absent → safe-skip.
                "review_lens": f"payload.lens_{i}",
            },
            timeout_minutes=10,
        )
        for i in range(OVERLAY_FANOUT_SLOTS)
    ]


def _reconcile_step() -> Step:
    """RECONCILE — advisory_manager: discrepancy analysis → adversarial survival (param #5
    resolution) → remediation, and record ADVISORY MEMORY (its record_advisory_memory tool).
    depends_on the anchor run so ≥1 advisor result exists before reconciling. Advisory:
    persisted=False, writes no business table."""
    return Step(
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
    )


def _land_review_todo() -> Step:
    """LAND (HITL) — param #6 default: the reconciled report + remediation land in a human
    review task. NEVER auto-advances a gate. INDEPENDENT (a hard human gate must never be
    blocked behind an advisory agent — launch-readiness invariant) and LAST (parks after
    reconcile by list order); the human reviews the reconciled output, correlated by
    proposal_id."""
    return Step(
        name="land_review",
        step_type=StepType.TODO,
        action="todo",
        task_type='"advisory_overlay_review"',
        task_title='"Review the advisory-overlay findings and remediation"',
        assignee_role='"tenant_admin"',
        entity_type='"proposal"',
        entity_ref="payload.proposal_id",
        timeout_minutes=4320,
    )


def _record_auto_step() -> Step:
    """LAND (AUTO) — param #6 under an adversarial auto policy: record the reconciled verdict
    as an advisory audit event INSTEAD of parking a human. This is how "adversarial managers
    take HITL out" — a LANDING choice, not a rewrite. Still NO gate advance, NO business-table
    write. Reads its fields from the PAYLOAD (not reconcile's output), so it is INDEPENDENT
    (no depends_on — a landing step, like the HITL land_review TODO, must never gate behind an
    advisory agent: the launch no-dead-end invariant) and LAST (records after reconcile by list
    order)."""
    return Step(
        name="record_auto",
        step_type=StepType.ACTION,
        action="workflows.actions.advisory_actions.record_advisory_reconciliation",
        input_map={
            "proposal_id": "payload.proposal_id",
            "tenant_id": "payload.tenant_id",
            "resolution": "payload.resolution",
            "target": "payload.target",
        },
        timeout_minutes=5,
    )


class AdvisoryOverlay(Workflow):
    """HITL landing (default). policy != 'auto' → the reconciled report lands in a human
    review TODO that never auto-advances a gate."""

    description = "Advisory/adversarial overlay (HITL): pre-augment → 1:n fan-out → reconcile → HITL land"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advisory_overlay_requested",
        phase="end",
        # HITL is the default landing — anything that is not explicitly 'auto'.
        condition=lambda p: bool(p.get("proposal_id")) and p.get("policy") != "auto",
    )

    steps = [_pre_augment_step()] + _fanout_steps() + [_reconcile_step(), _land_review_todo()]


class AdvisoryOverlayAuto(Workflow):
    """AUTO landing. policy == 'auto' → the reconciled verdict is RECORDED as an advisory
    audit event (no human review TODO). Same fan-out + reconcile; only the landing differs.
    Still advisory — no gate advance, no business-table write."""

    description = "Advisory/adversarial overlay (AUTO): pre-augment → 1:n fan-out → reconcile → advisory record"

    trigger = EventTrigger(
        namespace="proposal",
        type="proposal.advisory_overlay_requested",
        phase="end",
        condition=lambda p: bool(p.get("proposal_id")) and p.get("policy") == "auto",
    )

    steps = [_pre_augment_step()] + _fanout_steps() + [_reconcile_step(), _record_auto_step()]
