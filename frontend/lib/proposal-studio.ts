/**
 * Proposal Studio — the ONE canonical emission path for a review-phase request.
 *
 * Both the portal Studio wizard and the admin doorbell funnel through requestReviewPhase so every
 * phase run (start / regenerate / approve-advance / auto-chain) produces the same auditable trail: it
 * marks the target phase 'running', emits `proposal:review_phase.requested` (the trigger the pipeline
 * OnReviewPhaseRequested{Draft,Refine,Compliance} workflows consume), and logs proposal_activity_log.
 * `source` distinguishes studio_portal vs studio_doorbell. docs/PROPOSAL_STUDIO_DESIGN.md.
 *
 * The Studio is ADVISORY: phases land in review-staged canvas_versions; it never advances a proposal
 * stage, locks a section, or submits. "complete" = drafted + reviewed, not submitted.
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

export const STUDIO_PHASES = ['draft', 'refine', 'compliance'] as const;
export type StudioPhase = (typeof STUDIO_PHASES)[number];

/** Draft → Refine → Compliance → complete (mirrors pipeline studio_actions.NEXT_PHASE). */
export const NEXT_STUDIO_PHASE: Record<StudioPhase, StudioPhase | 'complete'> = {
  draft: 'refine',
  refine: 'compliance',
  compliance: 'complete',
};

export type StudioSource = 'studio_portal' | 'studio_doorbell';

export interface RequestReviewPhaseParams {
  proposalId: string;
  tenantId: string;
  opportunityId: string | null;
  phase: StudioPhase;
  auto: boolean;
  guidance: string | null;
  actorId: string;
  actorEmail: string | null;
  role: Role;
  source: StudioSource;
}

export async function requestReviewPhase(p: RequestReviewPhaseParams): Promise<void> {
  // Mark the TARGET phase running (the ACTION flips it to awaiting_review / auto-chains on completion).
  try {
    await sql`
      UPDATE proposals
      SET studio_phase = ${p.phase}, studio_phase_status = 'running', studio_auto = ${p.auto}
      WHERE id = ${p.proposalId} AND tenant_id = ${p.tenantId}::uuid
    `;
  } catch (stateErr) {
    console.error('[requestReviewPhase] state update failed', stateErr);
  }

  // Emit the trigger (start/end). The workflow reads the END payload.
  const eventPayload = {
    proposalId: p.proposalId,
    proposal_id: p.proposalId,
    tenant_id: p.tenantId,
    phase: p.phase,
    auto: p.auto,
    guidance: p.guidance,
    opportunity_id: p.opportunityId,
    source: p.source,
  };
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'review_phase.requested',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload: eventPayload,
  });
  await emitEventEnd(startId, { result: eventPayload });

  // Activity log (non-critical; system_events is canonical). 'ai_draft_requested' is the allowed
  // CHECK literal; the studio specifics live in details.
  try {
    await sql`
      INSERT INTO proposal_activity_log
        (proposal_id, tenant_id, actor_id, actor_email, actor_role, activity_type, details)
      VALUES (${p.proposalId}::uuid, ${p.tenantId}::uuid, ${p.actorId}::uuid,
              ${p.actorEmail ?? null}, ${p.role}, 'ai_draft_requested',
              ${sql.json({ kind: 'studio_phase', phase: p.phase, auto: p.auto, source: p.source, hasGuidance: !!p.guidance })})
    `;
  } catch (logErr) {
    console.error('[requestReviewPhase] activity log failed', logErr);
  }
}
