/**
 * requestFullDraft — the ONE canonical emission path for a proposal full-draft request.
 *
 * Both the tenant portal control (`/api/portal/[t]/proposals/[p]/full-draft`) and the admin-plane
 * "doorbell" (`/api/admin/proposals/[p]/full-draft`) funnel through here so every full draft — no
 * matter who rings it — produces the SAME auditable trail: it persists the Voice register, emits
 * `proposal:proposal.full_draft_requested` (start/end — the trigger the pipeline
 * OnFullDraftRequested{ModeA,B,C} workflows consume), and logs `proposal_activity_log`. The only
 * difference is the `source` field, carried on both the event payload and the activity row, so an
 * admin-initiated build audits distinctly from a tenant-initiated one (docs/ADMIN_AGENT_DESIGN.md).
 *
 * Callers must have already validated inputs, resolved the proposal→tenant, and entered the tenant
 * context (`enterTenant(tenantId)`); this helper only persists + emits + logs.
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

export const DRAFT_MODES = ['a', 'b', 'c'] as const;
export type DraftMode = (typeof DRAFT_MODES)[number];

// The Voice-of-Proposal token set (mig 139 proposals.voice / the pipeline's section_drafter
// _VOICE_REGISTERS). Keep in sync with the pipeline tokens.
export const VOICE_TOKENS = [
  'passive',
  'persuasive',
  'technical',
  'commercial',
  'research',
  'development',
] as const;
export type VoiceToken = (typeof VOICE_TOKENS)[number];

export const ADVERSARIAL_POLICIES = ['hitl', 'auto'] as const;
export type AdversarialPolicy = (typeof ADVERSARIAL_POLICIES)[number];

/** Where the full-draft request originated — carried on the event + activity row for attribution. */
export type FullDraftSource = 'portal' | 'admin_doorbell';

export interface RequestFullDraftParams {
  proposalId: string;
  tenantId: string;
  opportunityId: string | null;
  mode: DraftMode;
  voice: VoiceToken[] | null;
  adversarial: boolean;
  adversarialPolicy: AdversarialPolicy;
  actorId: string;
  actorEmail: string | null;
  role: Role;
  source: FullDraftSource;
}

export async function requestFullDraft(p: RequestFullDraftParams): Promise<void> {
  // Persist the Voice-of-Proposal register when supplied. jsonb via sql.json so it reads back as an
  // array (not a char-iterated string). Non-fatal: the event also carries `voice`.
  if (p.voice !== null) {
    try {
      await sql`
        UPDATE proposals
        SET voice = ${sql.json(p.voice)}
        WHERE id = ${p.proposalId} AND tenant_id = ${p.tenantId}::uuid
      `;
    } catch (voiceErr) {
      console.error('[requestFullDraft] voice persist failed', voiceErr);
    }
  }

  // ── Emit proposal.full_draft_requested (start/end pair) ──────
  // The END event is what the workflow triggers on; its payload carries the workflow inputs
  // (snake_case: proposal_id, tenant_id, mode, voice, opportunity_id, adversarial_*).
  const eventPayload = {
    proposalId: p.proposalId,
    proposal_id: p.proposalId,
    tenant_id: p.tenantId,
    mode: p.mode,
    voice: p.voice,
    opportunity_id: p.opportunityId,
    adversarial: p.adversarial,
    adversarial_policy: p.adversarialPolicy,
    adversarial_resolution: 'majority',
    // Attribution — portal (tenant) vs admin_doorbell. Ignored by the workflow; recorded for audit.
    source: p.source,
  };
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'proposal.full_draft_requested',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload: eventPayload,
  });
  await emitEventEnd(startId, { result: eventPayload });

  // ── Activity log (non-critical; system_events above is the canonical audit) ──
  // activity_type is CHECK-constrained (mig 044); 'ai_draft_requested' is the allowed literal.
  try {
    await sql`
      INSERT INTO proposal_activity_log
        (proposal_id, tenant_id, actor_id, actor_email, actor_role, activity_type, details)
      VALUES (${p.proposalId}::uuid, ${p.tenantId}::uuid, ${p.actorId}::uuid,
              ${p.actorEmail ?? null}, ${p.role}, 'ai_draft_requested',
              ${sql.json({ kind: 'full_draft', mode: p.mode, voice: p.voice, adversarial: p.adversarial, adversarialPolicy: p.adversarialPolicy, source: p.source })})
    `;
  } catch (logErr) {
    console.error('[requestFullDraft] activity log failed', logErr);
  }
}
