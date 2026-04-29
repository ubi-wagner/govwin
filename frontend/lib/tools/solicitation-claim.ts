/**
 * solicitation.claim (Phase 1 §E3).
 *
 * Atomic claim of an unclaimed 'new' solicitation. Race-safe via the
 * WHERE clause — two admins clicking "claim" on the same row produce
 * exactly one winner + one `ClaimConflictError`.
 *
 * State transition: `new` → `claimed`
 *
 * No curation-memory write — claiming is routine, not a decision.
 * Memory writes fire on release, dismiss, approve, reject_review,
 * push, and per-variable verifications.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { ClaimConflictError, NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  status: 'claimed';
  claimedBy: string;
  claimedAt: string;
}

export const solicitationClaimTool = defineTool<Input, Output>({
  name: 'solicitation.claim',
  namespace: 'solicitation',
  description:
    'Atomically claim an unclaimed solicitation for curation. Races are resolved by the DB; the loser gets ClaimConflictError.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId } = input;
    const actorId = ctx.actor.id;

    const rows = await sql<{ id: string; claimedAt: Date }[]>`
      UPDATE curated_solicitations
      SET status = 'claimed',
          claimed_by = ${actorId}::uuid,
          claimed_at = now(),
          updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND status = 'new'
        AND claimed_by IS NULL
      RETURNING id, claimed_at
    `;

    if (rows.length === 0) {
      // Disambiguate: NotFound vs already-claimed. Useful for UI feedback.
      const existing = await sql<{ status: string; claimedBy: string | null }[]>`
        SELECT status, claimed_by FROM curated_solicitations WHERE id = ${solicitationId}::uuid
      `;
      if (existing.length === 0) {
        throw new NotFoundError(`solicitation not found: ${solicitationId}`);
      }
      throw new ClaimConflictError(
        `cannot claim solicitation: current status=${existing[0].status}`,
        {
          solicitationId,
          currentStatus: existing[0].status,
          currentClaimedBy: existing[0].claimedBy,
        },
      );
    }

    await sql`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state)
      VALUES
        (${solicitationId}::uuid, ${actorId}::uuid, 'claim', 'new', 'claimed')
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.claimed',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: { correlationId: randomUUID(), solicitationId, fromState: 'new', toState: 'claimed' },
    });

    ctx.log?.info?.({
      msg: 'solicitation.claim succeeded',
      solicitationId,
      actorId,
    });

    return {
      solicitationId,
      status: 'claimed' as const,
      claimedBy: actorId,
      claimedAt: rows[0].claimedAt.toISOString(),
    };
  },
});
