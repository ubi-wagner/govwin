/**
 * solicitation.reject_review (Phase 1 §E8).
 *
 * Reviewer rejects the curation and sends it back for more work.
 * Notes are REQUIRED — the curator needs to know why.
 *
 * State transition: `review_requested` → `curation_in_progress`
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { StateTransitionError, NotFoundError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  /** Required. The reviewer's rejection rationale — shown to the curator. */
  notes: z.string().min(1).max(2000),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  status: 'curation_in_progress';
}

export const solicitationRejectReviewTool = defineTool<Input, Output>({
  name: 'solicitation.reject_review',
  namespace: 'solicitation',
  description:
    'Reviewer rejects a review_requested solicitation back to curation_in_progress. Notes are required (shown to curator).',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, notes } = input;
    const actorId = ctx.actor.id;

    const rows = await sql<{ id: string }[]>`
      UPDATE curated_solicitations
      SET status = 'curation_in_progress',
          review_requested_for = NULL,
          updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND status = 'review_requested'
      RETURNING id
    `;

    if (rows.length === 0) {
      const existing = await sql<{ status: string }[]>`
        SELECT status FROM curated_solicitations WHERE id = ${solicitationId}::uuid
      `;
      if (existing.length === 0) {
        throw new NotFoundError(`solicitation not found: ${solicitationId}`);
      }
      throw new StateTransitionError(
        `cannot reject review from status=${existing[0].status}`,
        { solicitationId, currentStatus: existing[0].status },
      );
    }

    await sql`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state, notes)
      VALUES
        (${solicitationId}::uuid, ${actorId}::uuid, 'reject_review',
         'review_requested', 'curation_in_progress', ${notes})
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'rfp.review_rejected',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: { solicitationId, reviewerId: actorId },
    });

    ctx.log?.info?.({
      msg: 'solicitation.reject_review succeeded',
      solicitationId,
    });

    return {
      solicitationId,
      status: 'curation_in_progress' as const,
    };
  },
});
