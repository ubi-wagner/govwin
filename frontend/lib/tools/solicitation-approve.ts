/**
 * solicitation.approve (Phase 1 §E7).
 *
 * The SECOND admin reviews + approves curation work. Hard rule
 * (D-Phase1-09 in docs/DECISIONS.md): the approver MUST be a
 * different user than the curator. Enforced in the WHERE clause
 * (`AND curated_by != ${actorId}`) so the DB is the authority, not
 * application logic that could drift.
 *
 * State transition: `review_requested` → `approved`
 *
 * HITL memory write: YES. Approval means "this curation cycle is
 * correct and complete" — the strongest signal in the whole flow.
 * Writes an action='approve' episodic memory with namespace key.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import {
  ForbiddenError,
  NotFoundError,
  StateTransitionError,
} from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';
import { writeCurationMemory } from './curation-memory';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  status: 'approved';
  curatedBy: string;
  approvedBy: string;
}

export const solicitationApproveTool = defineTool<Input, Output>({
  name: 'solicitation.approve',
  namespace: 'solicitation',
  description:
    'Second admin approves a curated solicitation. The approver must not be the same user as the curator (enforced in SQL).',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, notes } = input;
    const actorId = ctx.actor.id;

    const rows = await sql<{ id: string; curatedBy: string; namespace: string | null }[]>`
      UPDATE curated_solicitations
      SET status = 'approved',
          approved_by = ${actorId}::uuid,
          updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND status = 'review_requested'
        AND curated_by IS NOT NULL
        AND curated_by != ${actorId}::uuid
      RETURNING id, curated_by, namespace
    `;

    if (rows.length === 0) {
      // Disambiguate between the three failure modes for clear UI.
      const existing = await sql<
        { status: string; curatedBy: string | null }[]
      >`
        SELECT status, curated_by FROM curated_solicitations WHERE id = ${solicitationId}::uuid
      `;
      if (existing.length === 0) {
        throw new NotFoundError(`solicitation not found: ${solicitationId}`);
      }
      if (existing[0].status !== 'review_requested') {
        throw new StateTransitionError(
          `cannot approve from status=${existing[0].status}`,
          { solicitationId, currentStatus: existing[0].status },
        );
      }
      if (existing[0].curatedBy === actorId) {
        throw new ForbiddenError(
          'same person cannot curate and approve: two-admin rule',
          // details carry a stable error code distinguishing this from
          // other ForbiddenError cases (wrong role, tenant mismatch, etc.)
          { code: 'SAME_PERSON_REVIEW', solicitationId, actorId },
        );
      }
      // Null curated_by shouldn't be possible in review_requested state
      // (request_review populates it), but guard anyway.
      throw new StateTransitionError(
        `cannot approve: curated_by is null`,
        { solicitationId },
      );
    }

    const { curatedBy, namespace } = rows[0];

    await sql`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state, notes)
      VALUES
        (${solicitationId}::uuid, ${actorId}::uuid, 'approve',
         'review_requested', 'approved', ${notes ?? null})
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'rfp.review_approved',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        solicitationId,
        curatedBy,
        approvedBy: actorId,
      },
    });

    // HITL: approval is the highest-confidence signal in the workflow.
    // File as a curator memory so §H's read side can use "prior cycle
    // was approved by N admins" to weight namespace pre-fill confidence.
    if (namespace) {
      await writeCurationMemory(ctx, {
        solicitationId,
        namespace,
        action: 'approve',
        notes: notes ?? undefined,
      });
    }

    ctx.log?.info?.({
      msg: 'solicitation.approve succeeded',
      solicitationId,
      curatedBy,
      approvedBy: actorId,
    });

    return {
      solicitationId,
      status: 'approved' as const,
      curatedBy,
      approvedBy: actorId,
    };
  },
});
