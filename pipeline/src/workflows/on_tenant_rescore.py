"""
================================================================================
Workflows: OnCardApplied / OnBucketsUpdated  (tenant-side bucket scoring)
================================================================================

Scoring is a TENANT-SIDE, EVENT-DRIVEN process on the audited workflow spine —
not a synchronous side-effect of the admin push. Two triggers fire a deterministic
rescore of the tenant's bucket scores:

  • capture:card.applied     — a card landed / updated in the tenant's mirror
                               (the bridge fan-out delivered it) → rescore THAT card
                               against all the tenant's active buckets.
  • capture:buckets.updated  — the tenant created/edited/ranked a bucket (changed
                               their OPP list) → rescore ALL their open cards.

Both run the deterministic `rescore` action (a faithful port of the frontend
scorer) — the DEFAULT of the scoring_strategist agent. When the agent overlay is
built out (episodic memory + pin/purchase levers), the step's action becomes
AI_INVOKE(tool.opportunity.score) with the deterministic pass as its fallback.

Tenant-bound: the action writes tenant_bucket_scores under app.tenant_id (RLS).
Single-step, no HITL, never dead-ends (a tenant with no active buckets is a safe
no-op). Fully audited (capture:card.scored / capture:tenant.rescored + the managed
instance lifecycle).
================================================================================
"""
from workflows.base import Workflow, Step, StepType, EventTrigger


class OnCardApplied(Workflow):
    description = "Rescore a tenant's card against their buckets when it lands in their mirror"

    trigger = EventTrigger(
        namespace="capture",
        type="card.applied",
        phase="single",
        # Must name the tenant + the card, or there's nothing to score.
        condition=lambda p: bool(p.get("tenantId") and p.get("opportunityId")),
    )

    steps = [
        Step(
            name="rescore_card",
            step_type=StepType.ACTION,
            action="workflows.actions.rescore.rescore_tenant_card",
            input_map={
                "tenant_id": "payload.tenantId",
                "opportunity_id": "payload.opportunityId",
            },
            timeout_minutes=5,
        ),
    ]


class OnBucketsUpdated(Workflow):
    description = "Rescore all of a tenant's open cards when they change their OPP list / buckets"

    trigger = EventTrigger(
        namespace="capture",
        type="buckets.updated",
        phase="single",
        condition=lambda p: bool(p.get("tenantId")),
    )

    steps = [
        Step(
            name="rescore_all",
            step_type=StepType.ACTION,
            action="workflows.actions.rescore.rescore_tenant",
            input_map={"tenant_id": "payload.tenantId"},
            timeout_minutes=10,
        ),
    ]
