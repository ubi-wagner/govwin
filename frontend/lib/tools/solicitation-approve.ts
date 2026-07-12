/**
 * solicitation.approve (Phase 1 §E7).
 *
 * An admin approves curation work, moving it toward release.
 *
 * Segregation-of-duties policy (updated from D-Phase1-09): a single RFP admin
 * MAY approve their own curation so a lone operator can run ingest → curate →
 * approve → push end-to-end. This is deliberate — the original two-admin rule
 * (curator ≠ approver) blocked solo operation. Self-approvals are not hidden:
 * they are flagged (`metadata.selfApproved = true`) in curation_revisions and
 * are self-evident in triage_actions (actor_id == curated_by), so a reviewer
 * can still audit them. Re-introduce a hard curator≠approver gate here if/when
 * true multi-admin peer review is required.
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
  NotFoundError,
  StateTransitionError,
} from '@/lib/errors';
import { randomUUID } from 'crypto';
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
    'Admin approves a curated solicitation (review_requested → approved). A single admin may self-approve for solo operation; self-approvals are audit-flagged.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, notes } = input;
    const actorId = ctx.actor.id;

    let rows: { id: string; curatedBy: string; namespace: string | null }[];
    try {
      rows = await sql<{ id: string; curatedBy: string; namespace: string | null }[]>`
        UPDATE curated_solicitations
        SET status = 'approved',
            approved_by = ${actorId}::uuid,
            updated_at = now()
        WHERE id = ${solicitationId}::uuid
          AND status = 'review_requested'
          AND curated_by IS NOT NULL
        RETURNING id, curated_by, namespace
      `;
    } catch (err) {
      console.error('[solicitation.approve] update failed:', err);
      throw err;
    }

    if (rows.length === 0) {
      // Disambiguate between the three failure modes for clear UI.
      let existing: { status: string; curatedBy: string | null }[];
      try {
        existing = await sql<
          { status: string; curatedBy: string | null }[]
        >`
          SELECT status, curated_by FROM curated_solicitations WHERE id = ${solicitationId}::uuid
        `;
      } catch (err) {
        console.error('[solicitation.approve] fallback lookup failed:', err);
        throw err;
      }
      if (existing.length === 0) {
        throw new NotFoundError(`solicitation not found: ${solicitationId}`);
      }
      if (existing[0].status !== 'review_requested') {
        throw new StateTransitionError(
          `cannot approve from status=${existing[0].status}`,
          { solicitationId, currentStatus: existing[0].status },
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
    const selfApproved = curatedBy === actorId;

    try {
      await sql`
        INSERT INTO triage_actions
          (solicitation_id, actor_id, action, from_state, to_state, notes)
        VALUES
          (${solicitationId}::uuid, ${actorId}::uuid, 'approve',
           'review_requested', 'approved', ${notes ?? null})
      `;
    } catch (err) {
      console.error('[solicitation.approve] triage_actions insert failed:', err);
      throw err;
    }

    // ── Curation revision tracking ──────────────────────────────────
    try {
      await sql`
        INSERT INTO curation_revisions
          (solicitation_id, actor_id, actor_email, revision_type, field_name, old_value, new_value, metadata)
        VALUES (
          ${solicitationId}::uuid,
          ${actorId}::uuid,
          ${ctx.actor.email ?? null},
          'review_approved',
          'status',
          'review_requested',
          'approved',
          ${sql.json({ curatedBy, notes: notes ?? null, selfApproved })}
        )
      `;
    } catch (revErr) {
      console.error('[solicitation.approve] curation_revisions insert failed:', revErr);
      // Non-fatal — continue
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.approved',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
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
