/**
 * solicitation.push (Phase 1 §E9) — the canonical Phase 1 success event.
 *
 * Final curation act: an approved solicitation goes live in the
 * opportunity pool where customers can see it. Three responsibilities:
 *
 *   1. Validate required compliance variables are populated — if any
 *      are missing, throw ValidationError with the list (UI shows
 *      exactly which fields need filling).
 *   2. Atomic state flip approved → pushed_to_pipeline + set
 *      opportunities.is_active=true (the "visible to customers" gate).
 *   3. HITL memory write: a procedural memory capturing the full
 *      compliance matrix for this cycle + namespace. Future cycles
 *      of the same program pre-fill from this row with 100% confidence.
 *
 * State transition: `approved` → `pushed_to_pipeline`
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
} from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { publishAndFanOut } from '@/lib/opportunity-bridge';
import { defineTool } from './base';
import { writeCurationMemory } from './curation-memory';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  solicitationId: string;
  status: 'pushed_to_pipeline';
  opportunityId: string;
  namespace: string | null;
  pushedAt: string;
}

// Compliance variables that MUST be populated before push. Not
// exhaustive — just the ones that make an opportunity actionable for
// a customer. Annotated sections + per-agency variables can be null.
const REQUIRED_COMPLIANCE = [
  'submission_format',
] as const;

export const solicitationPushTool = defineTool<Input, Output>({
  name: 'solicitation.push',
  namespace: 'solicitation',
  description:
    'Push an approved curated solicitation live — validates required compliance, flips is_active, writes a procedural-memory snapshot of the cycle.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId } = input;
    const actorId = ctx.actor.id;

    // 1. Preflight — fetch current state + compliance + opportunity_id.
    let rows;
    try {
      rows = await sql<
      {
        status: string;
        namespace: string | null;
        opportunityId: string;
        submissionFormat: string | null;
        pageLimitTechnical: number | null;
        customVariables: Record<string, unknown> | null;
        hasSubmissionFormat: boolean;
      }[]
    >`
      SELECT cs.status, cs.namespace, cs.opportunity_id,
             sc.submission_format, sc.page_limit_technical,
             sc.custom_variables,
             -- Gate satisfiability: submission_format populated ANYWHERE for this
             -- solicitation — the curator's verified layer (custom_variables.value,
             -- written by compliance.save_variable_value) OR a named column, at the
             -- solicitation OR any topic level. The interactive curation flow writes
             -- only custom_variables, so a named-column-only check blocked solo push.
             EXISTS (
               SELECT 1 FROM solicitation_compliance x
               WHERE x.solicitation_id = cs.id AND (
                 NULLIF(x.submission_format, '') IS NOT NULL
                 OR NULLIF(x.custom_variables->'submission_format'->>'value', '') IS NOT NULL
               )
             ) AS has_submission_format
      FROM curated_solicitations cs
      -- Read the solicitation-level row (topic_id IS NULL) — the same row
      -- buildCardSnapshot uses, so the gate and the customer card agree.
      LEFT JOIN solicitation_compliance sc
        ON sc.solicitation_id = cs.id AND sc.topic_id IS NULL
      WHERE cs.id = ${solicitationId}::uuid
    `;
    } catch (err) {
      console.error('[solicitation.push] preflight query failed:', err);
      throw err;
    }

    if (rows.length === 0) {
      throw new NotFoundError(`solicitation not found: ${solicitationId}`);
    }
    const r = rows[0];

    if (r.status !== 'approved') {
      throw new StateTransitionError(
        `cannot push from status=${r.status} (must be 'approved')`,
        { solicitationId, currentStatus: r.status },
      );
    }

    // 2. Validate required compliance variables. submission_format counts as
    //    present if the curator set it either via the interactive tool
    //    (custom_variables.value) or a named column (preset/shredder) — see the
    //    has_submission_format existence check in the preflight.
    const missing: string[] = [];
    for (const varName of REQUIRED_COMPLIANCE) {
      if (varName === 'submission_format' && !r.hasSubmissionFormat) {
        missing.push(varName);
      }
    }
    if (missing.length > 0) {
      throw new ValidationError(
        `cannot push: required compliance variables missing`,
        { solicitationId, missingVariables: missing },
      );
    }

    // 3. Atomic push in transaction — status update + opportunity activation + triage action
    let pushedRows: { pushedAt: Date }[];
    try {
      // eslint-disable-next-line
      pushedRows = await sql.begin(async (tx: any) => {
      const rows = await tx`
        UPDATE curated_solicitations
        SET status = 'pushed_to_pipeline',
            pushed_at = now(),
            updated_at = now()
        WHERE id = ${solicitationId}::uuid
          AND status = 'approved'
        RETURNING pushed_at
      ` as { pushedAt: Date }[];

      if (rows.length === 0) {
        throw new StateTransitionError(
          `push lost a race on solicitation ${solicitationId}`,
          { solicitationId },
        );
      }

      // 4. Flip the FULL activation set visible — customers see it after
      // this. Contract C1.a: the activation set is the landing opportunity
      // (cs.opportunity_id) PLUS every topic of the solicitation
      // (opportunities.solicitation_id = sol.id). A single-topic
      // solicitation has no child topics, so only the landing opportunity
      // matches and exactly one row flips — identical to prior behavior.
      // A multi-topic solicitation flips landing + all children, atomically
      // in this same txn.
      await tx`
        UPDATE opportunities
        SET is_active = true, updated_at = now(),
            submission_stage = 'open',
            open_date   = COALESCE(open_date, now()),
            released_by = COALESCE(released_by, ${actorId}::uuid),
            released_at = COALESCE(released_at, now()),
            built_by    = COALESCE(built_by, (SELECT curated_by FROM curated_solicitations WHERE id = ${solicitationId}::uuid))
        WHERE solicitation_id = ${solicitationId}::uuid
           OR id = ${r.opportunityId}::uuid
      `;

      // 5. Audit + event.
      await tx`
        INSERT INTO triage_actions
          (solicitation_id, actor_id, action, from_state, to_state)
        VALUES
          (${solicitationId}::uuid, ${actorId}::uuid, 'push',
           'approved', 'pushed_to_pipeline')
      `;

      return rows;
      });
    } catch (err) {
      console.error('[solicitation.push] transaction failed:', err);
      throw err;
    }

    if (pushedRows.length === 0) {
      throw new StateTransitionError(
        `push lost a race on solicitation ${solicitationId}`,
        { solicitationId },
      );
    }

    // ── Curation revision tracking ──────────────────────────────────
    try {
      await sql`
        INSERT INTO curation_revisions
          (solicitation_id, actor_id, actor_email, revision_type, field_name, old_value, new_value)
        VALUES (
          ${solicitationId}::uuid,
          ${actorId}::uuid,
          ${ctx.actor.email ?? null},
          'status_changed',
          'status',
          'approved',
          'pushed_to_pipeline'
        )
      `;
    } catch (revErr) {
      console.error('[solicitation.push] curation_revisions insert failed:', revErr);
      // Non-fatal — continue
    }

    // Count the actually-activated set for downstream workflow matching
    // (on_solicitation_pushed expects it). Contract C1.a/C1.c: this MUST
    // match the activation WHERE clause above (landing opportunity PLUS
    // every topic of the solicitation) so topicCount reflects all topics
    // that were just set is_active=true — not just child topics.
    let topicCount: number;
    try {
      const [topicRow] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM opportunities
        WHERE solicitation_id = ${solicitationId}::uuid
           OR id = ${r.opportunityId}::uuid
      `;
      topicCount = parseInt(topicRow?.count ?? '0', 10);
    } catch (err) {
      console.error('[solicitation.push] topic count query failed:', err);
      throw err;
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.pushed',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        solicitationId,
        opportunityId: r.opportunityId,
        namespace: r.namespace,
        topicCount,
      },
    });

    // 5b. Publish EVERY activated opportunity to the forward-only bridge + fan out
    // a thin card to every subscribed tenant (greenfield opportunity-card spine,
    // mig 094). The activation set is the landing opportunity PLUS every topic of
    // the solicitation — so a multi-topic BAA lands N topic cards for customers,
    // not just one umbrella card (the bridge is the canonical admin→customer
    // coupling). Best-effort: the push already succeeded; replication is
    // idempotent and can be re-driven by a backfill, so a failure here (per
    // opportunity or overall) must not fail the push.
    try {
      const activated = await sql<{ id: string }[]>`
        SELECT id FROM opportunities
        WHERE solicitation_id = ${solicitationId}::uuid
           OR id = ${r.opportunityId}::uuid
      `;
      const stamp = new Date().toISOString();
      let published = 0;
      for (const opp of activated) {
        try {
          const result = await publishAndFanOut(opp.id, 'published', actorId, stamp);
          if (result) published++;
        } catch (oneErr) {
          ctx.log?.warn?.({ msg: 'bridge publish failed for opportunity (non-fatal)', opportunityId: opp.id, err: oneErr instanceof Error ? oneErr.message : String(oneErr) });
        }
      }
      ctx.log?.info?.({ msg: 'bridge published + fanned out', solicitationId, opportunitiesPublished: published, ofActivated: activated.length });
    } catch (bridgeErr) {
      ctx.log?.warn?.({ msg: 'bridge publish/fan-out failed (non-fatal)', solicitationId, err: bridgeErr instanceof Error ? bridgeErr.message : String(bridgeErr) });
    }

    // 6. HITL memory write — the BIG one. Push is the final curation
    // signal; file it as a curator memory so §H's read side picks up
    // every verified value from this cycle for future pre-fill. The
    // individual compliance verifications already wrote memories in
    // E.3's save_variable_value; this push memory is the "cycle
    // complete" anchor.
    if (r.namespace) {
      await writeCurationMemory(ctx, {
        solicitationId,
        namespace: r.namespace,
        action: 'push',
      });
    }

    ctx.log?.info?.({
      msg: 'solicitation.push succeeded',
      solicitationId,
      opportunityId: r.opportunityId,
      namespace: r.namespace,
    });

    return {
      solicitationId,
      status: 'pushed_to_pipeline' as const,
      opportunityId: r.opportunityId,
      namespace: r.namespace,
      pushedAt: pushedRows[0].pushedAt.toISOString(),
    };
  },
});
