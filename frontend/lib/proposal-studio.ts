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
import { coerceJsonb } from '@/lib/jsonb';
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
  //
  // RETURNING voice is load-bearing, not incidental (bug log B84). `OnReviewPhaseRequestedDraft`'s
  // plan_draft step and `OnReviewPhaseRequestedRefine`'s restyle step both declare
  // `"voice": "payload.voice"` in their input_map, and this emitter never wrote that key — so the
  // engine resolved it to null on every Studio run and the drafting agent fell back to its default
  // register. `requestFullDraft` DOES carry voice, so the same proposal with the same persisted
  // setting drafted in the tenant's voice from the full-draft button and in the house voice from the
  // Studio. Reading it here closes that, and gives `proposals.voice` its first reader anywhere:
  // `section_drafter` takes voice from the invocation context, never from the row.
  //
  // Same statement, no extra round-trip. If the UPDATE throws, voice stays null — which is exactly
  // the pre-fix behaviour, so a failure here degrades rather than breaking the run.
  let voice: unknown = null;
  try {
    const [row] = await sql<{ voice: unknown }[]>`
      UPDATE proposals
      SET studio_phase = ${p.phase}, studio_phase_status = 'running', studio_auto = ${p.auto}
      WHERE id = ${p.proposalId} AND tenant_id = ${p.tenantId}::uuid
      RETURNING voice
    `;
    voice = coerceJsonb<unknown>(row?.voice, null);
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
    voice,
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
