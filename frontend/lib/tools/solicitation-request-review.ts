/**
 * solicitation.request_review (Phase 1 §E6).
 *
 * Curator signals "my work is ready for a second pair of eyes." A
 * different `rfp_admin` must then call `solicitation.approve` (the
 * same-person check there enforces the two-admin rule).
 *
 * State transition: `curation_in_progress` → `review_requested`
 *
 * Optional `requestedReviewerId` — if set, a specific admin is
 * tagged as the intended reviewer. If null, any `rfp_admin` other
 * than the curator can approve.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { StateTransitionError, NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  requestedReviewerId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  status: 'review_requested';
  requestedReviewerId: string | null;
}

export const solicitationRequestReviewTool = defineTool<Input, Output>({
  name: 'solicitation.request_review',
  namespace: 'solicitation',
  description:
    'Curator requests a second-admin review. Transitions curation_in_progress → review_requested.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, requestedReviewerId, notes } = input;
    const actorId = ctx.actor.id;

    const rows = await sql<{ id: string; curatedBy: string | null }[]>`
      UPDATE curated_solicitations
      SET status = 'review_requested',
          curated_by = COALESCE(curated_by, ${actorId}::uuid),
          review_requested_for = ${requestedReviewerId ?? null}::uuid,
          updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND status = 'curation_in_progress'
      RETURNING id, curated_by
    `;

    if (rows.length === 0) {
      const existing = await sql<{ status: string }[]>`
        SELECT status FROM curated_solicitations WHERE id = ${solicitationId}::uuid
      `;
      if (existing.length === 0) {
        throw new NotFoundError(`solicitation not found: ${solicitationId}`);
      }
      throw new StateTransitionError(
        `cannot request review from status=${existing[0].status}`,
        { solicitationId, currentStatus: existing[0].status },
      );
    }

    await sql`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state, notes, metadata)
      VALUES
        (${solicitationId}::uuid, ${actorId}::uuid, 'request_review',
         'curation_in_progress', 'review_requested', ${notes ?? null},
         ${JSON.stringify({ requestedReviewerId: requestedReviewerId ?? null })}::jsonb)
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.review_requested',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        solicitationId,
        requestedReviewerId: requestedReviewerId ?? null,
        curatedBy: rows[0].curatedBy,
      },
    });

    ctx.log?.info?.({
      msg: 'solicitation.request_review succeeded',
      solicitationId,
      requestedReviewerId: requestedReviewerId ?? null,
    });

    return {
      solicitationId,
      status: 'review_requested' as const,
      requestedReviewerId: requestedReviewerId ?? null,
    };
  },
});
