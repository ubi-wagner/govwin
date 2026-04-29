/**
 * solicitation.release (Phase 1 §E4).
 *
 * The claimer releases the solicitation for AI analysis. This is the
 * handoff from triage to the shredder: inserting a `pipeline_jobs`
 * row with `kind='shred_solicitation'` causes the cron dispatcher
 * (pipeline/src/ingest/dispatcher.py) to pick it up on its next tick
 * and run `shredder.runner.shred_solicitation` against it.
 *
 * State transition: `claimed` (by self) → `released_for_analysis`
 *
 * Side effects:
 *   1. UPDATE curated_solicitations → status, updated_at
 *   2. INSERT triage_actions audit row
 *   3. INSERT pipeline_jobs (kind='shred_solicitation', metadata.solicitation_id)
 *   4. Emit `finder.rfp.released_for_analysis` single event
 *
 * No curation-memory write — release is a workflow action, not a
 * compliance decision. Memory writes fire when an admin verifies
 * a specific compliance value (E.3's save_variable_value).
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { StateTransitionError, NotFoundError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  status: 'released_for_analysis';
  shredJobId: string;
}

export const solicitationReleaseTool = defineTool<Input, Output>({
  name: 'solicitation.release',
  namespace: 'solicitation',
  description:
    'Release a claimed solicitation for AI analysis. Inserts a shred_solicitation pipeline job that the cron dispatcher picks up.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId } = input;
    const actorId = ctx.actor.id;

    // Atomic transition — only the claimer may release their claim.
    const rows = await sql<{ id: string }[]>`
      UPDATE curated_solicitations
      SET status = 'released_for_analysis',
          updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND status = 'claimed'
        AND claimed_by = ${actorId}::uuid
      RETURNING id
    `;

    if (rows.length === 0) {
      const existing = await sql<{ status: string; claimedBy: string | null }[]>`
        SELECT status, claimed_by FROM curated_solicitations WHERE id = ${solicitationId}::uuid
      `;
      if (existing.length === 0) {
        throw new NotFoundError(`solicitation not found: ${solicitationId}`);
      }
      throw new StateTransitionError(
        `cannot release solicitation: status=${existing[0].status}, claimedBy=${existing[0].claimedBy ?? 'null'} (expected claimed by actor ${actorId})`,
        {
          solicitationId,
          currentStatus: existing[0].status,
          currentClaimedBy: existing[0].claimedBy,
          actorId,
        },
      );
    }

    // Triage audit row
    await sql`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state)
      VALUES
        (${solicitationId}::uuid, ${actorId}::uuid, 'release',
         'claimed', 'released_for_analysis')
    `;

    // Insert shred job. The Phase 1 §C dispatcher sees kind='shred_solicitation'
    // and routes to shredder.runner.shred_solicitation. priority=3 so
    // shred jobs sit between high-priority manual ingests (1) and
    // scheduled cron ingests (5 default).
    const jobRows = await sql<{ id: string }[]>`
      INSERT INTO pipeline_jobs
        (source, kind, status, priority, metadata)
      VALUES
        ('system', 'shred_solicitation', 'pending', 3,
         ${JSON.stringify({ solicitation_id: solicitationId })}::jsonb)
      RETURNING id
    `;
    const shredJobId = jobRows[0].id;

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.released',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        solicitationId,
        shredJobId,
        fromState: 'claimed',
        toState: 'released_for_analysis',
      },
    });

    ctx.log?.info?.({
      msg: 'solicitation.release succeeded',
      solicitationId,
      actorId,
      shredJobId,
    });

    return {
      solicitationId,
      status: 'released_for_analysis' as const,
      shredJobId,
    };
  },
});
