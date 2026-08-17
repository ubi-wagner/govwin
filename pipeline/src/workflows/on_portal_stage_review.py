"""
================================================================================
Workflow: OnPortalStageReviewRequested  (TW-8 — the AI-manager portal stage gate)
docs/TENANT_WORKFLOW_SETUP_DESIGN.md §3½
================================================================================
TRIGGER:    capture:stage_review.requested:end
            Condition: payload.portalId present
            (emitted by the frontend phase-machine when a portal ENTERS an `agent_manager` stage —
             lib/portal-workflow.ts emitStageReviewRequested, on instantiate / advance / accept.)

PURPOSE:    Make the AI-manager stage gate a first-class ENGINE reaction, not a bolt-on. When a portal
            enters an agent_manager stage, run the review MANAGER cohort (advisory) then emit
            `capture:stage_review.completed` — the completion TRIGGER the frontend gate-close consumes
            (assisted: a human ticks the gate ToDo; auto: the opted-in gate-advance route). This is the
            trigger → (advisory agent ∥ hard action) → trigger chain:
                stage_review.requested → [record] → stage_review.completed
                                       ↘ [review_manager]  (advisory leaf, parallel; never gates)
            which the frontend then turns into portal.stage_advanced (the next trigger). `record` is
            INDEPENDENT of review_manager — an advisory agent never gates a hard step (no-deadend).

SAFETY:     Advisory-only, per the platform invariants. The AI_INVOKE manager output is never auto-applied
            (advisory), and the record ACTION writes NO business table and NEVER advances the portal —
            advancePortalStage stays the sole (frontend) authority (the input-map-ancestor rule forbids a
            pipeline step consuming agent output to land it). Unmapped/fabric-absent AI_INVOKE safe-skips
            and the gate still stands (the gate ToDo the frontend created keeps the human path open).

CHANGE LOG:
    TW-8b — Initial implementation (the engine chain for the AI-manager stage gate).
================================================================================
"""
from workflows.base import EventTrigger, Step, StepType, Workflow


class OnPortalStageReviewRequested(Workflow):
    """Run the review manager for a portal's agent_manager stage, then emit stage_review.completed."""

    description = "AI-manager portal stage gate: run the review manager, emit stage_review.completed"

    trigger = EventTrigger(
        namespace="capture",
        type="stage_review.requested",
        phase="end",
        condition=lambda p: bool(p.get("portalId")),
    )

    steps = [
        # The review MANAGER (advisory_manager) reconciles the stage's cohort output. AI_INVOKE →
        # advisory result only; safe-skips (workflow still advances to `record`) when the fabric/key
        # is absent, so the gate never dead-ends.
        Step(
            name="review_manager",
            step_type=StepType.AI_INVOKE,
            action="tool.advisory.reconcile",
            input_map={
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
                "portal_id": "payload.portalId",
                "stage": "payload.stageKey",
            },
            timeout_minutes=15,
        ),
        # Emit the completion event (advisory — no advance, no business write). INDEPENDENT of the
        # review_manager by design: an advisory AI_INVOKE must NEVER gate a hard step (the no-deadend
        # invariant — test_ai_invoke_steps_never_block_the_pipeline), and the manager safe-skips when
        # the fabric/key is absent. `record` references only payload.* (not the agent's result), so it
        # needs no ordering dependency; the manager runs in parallel as an advisory leaf and its
        # findings surface at the gate via its own landing. Same shape as on_source_change_detected.
        Step(
            name="record",
            step_type=StepType.ACTION,
            action="workflows.actions.portal_stage_actions.record_stage_review",
            input_map={
                "portal_id": "payload.portalId",
                "proposal_id": "payload.proposalId",
                "tenant_id": "payload.tenantId",
                "stage_key": "payload.stageKey",
                "agent_manager_key": "payload.agentManagerKey",
                "auto": "payload.autoAdvance",
            },
            timeout_minutes=5,
        ),
    ]
