/**
 * solicitation.dismiss (Phase 1 §E5).
 *
 * Admin marks a solicitation as not worth pursuing (off-scope,
 * low-fit, wrong agency, duplicate, etc.). Terminal state — once
 * dismissed, the row never leaves 'dismissed' without explicit
 * master_admin reversal (not wired in Phase 1).
 *
 * State transition: `new` | `claimed` (by self) | `ai_analyzed` |
 *                    `curation_in_progress` → `dismissed`
 *
 * HITL memory write: YES. Dismissing with a reason is a curator
 * decision that feeds future triage — §H's read side uses the
 * aggregated dismissal signal to auto-deprioritize similar RFPs
 * in the triage queue (Phase 4+ agent training).
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { StateTransitionError, NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';
import { writeCurationMemory } from './curation-memory';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  /** Phase classification — 'phase_1_like' = Phase I equivalent,
   *  'phase_2_like' = Phase II equivalent, 'unknown' = indeterminate.
   *  Used for training future triage models. */
  phaseClassification: z.enum(['phase_1_like', 'phase_2_like', 'unknown']).optional(),
  /** Short reason. Freeform — the admin's one-line justification. */
  notes: z.string().max(2000).optional(),
});

type Input = z.infer<typeof InputSchema>;

// States from which dismissal is legal.
const DISMISSIBLE_FROM = [
  'new',
  'claimed',
  'released_for_analysis',
  'ai_analyzed',
  'shredder_failed',
  'curation_in_progress',
  'rejected_review',
] as const;

interface Output {
  solicitationId: string;
  status: 'dismissed';
  previousStatus: string;
}

export const solicitationDismissTool = defineTool<Input, Output>({
  name: 'solicitation.dismiss',
  namespace: 'solicitation',
  description:
    'Dismiss a solicitation as not worth pursuing. Terminal state. Writes a curator memory so future triage can learn from dismissal patterns.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, phaseClassification, notes } = input;
    const actorId = ctx.actor.id;

    // Fetch current state (to know the from_state for audit + to return it).
    // We need the namespace for the memory write too.
    const existing = await sql<
      { status: string; claimedBy: string | null; namespace: string | null }[]
    >`
      SELECT status, claimed_by, namespace FROM curated_solicitations
      WHERE id = ${solicitationId}::uuid
    `;
    if (existing.length === 0) {
      throw new NotFoundError(`solicitation not found: ${solicitationId}`);
    }
    const current = existing[0];

    if (!(DISMISSIBLE_FROM as readonly string[]).includes(current.status)) {
      throw new StateTransitionError(
        `cannot dismiss from status=${current.status}`,
        {
          solicitationId,
          currentStatus: current.status,
          allowedFrom: DISMISSIBLE_FROM,
        },
      );
    }

    // If claimed by someone else, only that claimer (or master_admin via
    // role hierarchy — not enforced here, simpler to require self-claim
    // or unclaimed) can dismiss. Block cross-admin dismissals so an
    // accidental click doesn't kill another curator's work.
    if (current.claimedBy && current.claimedBy !== actorId) {
      throw new StateTransitionError(
        `cannot dismiss: solicitation is claimed by another admin`,
        {
          solicitationId,
          currentClaimedBy: current.claimedBy,
          actorId,
        },
      );
    }

    const rows = await sql<{ id: string }[]>`
      UPDATE curated_solicitations
      SET status = 'dismissed',
          dismissed_reason = ${notes ?? null},
          phase_like = ${phaseClassification === 'phase_1_like' ? 'phase_1'
                       : phaseClassification === 'phase_2_like' ? 'phase_2'
                       : null},
          updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND status = ${current.status}
      RETURNING id
    `;

    if (rows.length === 0) {
      // Race: someone moved the row between our SELECT and UPDATE.
      throw new StateTransitionError(
        `dismiss lost a race on solicitation ${solicitationId}`,
        { solicitationId },
      );
    }

    await sql`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state, notes,
         metadata)
      VALUES
        (${solicitationId}::uuid, ${actorId}::uuid, 'dismiss',
         ${current.status}, 'dismissed', ${notes ?? null},
         ${JSON.stringify({ phaseClassification: phaseClassification ?? null })}::jsonb)
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.dismissed',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        solicitationId,
        fromState: current.status,
        toState: 'dismissed',
        phaseClassification: phaseClassification ?? null,
        hasNotes: notes != null,
      },
    });

    // HITL: dismissal is a curator decision worth remembering. If the
    // solicitation has a namespace key, file the decision for future
    // cross-cycle triage. If namespace is null (solicitation never got
    // shredded), skip — we can't file without a key.
    if (current.namespace) {
      await writeCurationMemory(ctx, {
        solicitationId,
        namespace: current.namespace,
        action: 'correct', // dismiss = "this shouldn't pursue" — a correction of the default "might be interesting" posture
        notes: notes ?? undefined,
      });
    }

    ctx.log?.info?.({
      msg: 'solicitation.dismiss succeeded',
      solicitationId,
      actorId,
      fromStatus: current.status,
      phaseClassification,
    });

    return {
      solicitationId,
      status: 'dismissed' as const,
      previousStatus: current.status,
    };
  },
});
