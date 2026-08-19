/**
 * opportunity.update_topic (Phase 1 §E extension / Scouting Spine M1 T1.3).
 *
 * Edit an existing topic's metadata after creation. Today only
 * `opportunity.add_topic` / `opportunity.bulk_add_topics` exist — once a
 * topic is created there was no tool to correct its title, description,
 * tech focus areas, branch, lifecycle status, or POC. This closes that
 * gap so admins can curate topics in place.
 *
 * Updates:
 *   - one opportunities row (the topic) by id; only provided fields change
 *   - updated_at = now()
 *   - content_hash recomputed when the title changes (matches the hashing
 *     in opportunity.add_topic: md5(solicitation_id || topic_number || title))
 *
 * Emits `finder:topic.updated` with { opportunityId, changedFields } so the
 * activity feed reflects the edit (aligns with the existing topic.updated
 * contract used by the admin topics PATCH route).
 *
 * Required role: rfp_admin
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { activateLateTopicIfReady, republishSolicitationCards } from '@/lib/curation/republish';
import { defineTool } from './base';

const InputSchema = z.object({
  opportunityId: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(20000).nullable().optional(),
  techFocusAreas: z.array(z.string().max(200)).optional(),
  topicBranch: z.string().max(200).nullable().optional(),
  topicStatus: z
    .enum(['open', 'pre_release', 'closed', 'awarded', 'withdrawn'])
    .optional(),
  pocName: z.string().max(200).nullable().optional(),
  pocEmail: z.string().email().max(200).nullable().optional(),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  id: string;
  source: string;
  sourceId: string;
  title: string;
  agency: string | null;
  office: string | null;
  programType: string | null;
  solicitationId: string | null;
  topicNumber: string | null;
  topicBranch: string | null;
  topicStatus: string | null;
  techFocusAreas: string[] | null;
  naicsCodes: string[] | null;
  pocName: string | null;
  pocEmail: string | null;
  closeDate: string | null;
  postedDate: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

// Fields the caller can mutate — used to compute changedFields for the event.
const EDITABLE_FIELDS = [
  'title',
  'description',
  'techFocusAreas',
  'topicBranch',
  'topicStatus',
  'pocName',
  'pocEmail',
] as const;

export const opportunityUpdateTopicTool = defineTool<Input, Output>({
  name: 'opportunity.update_topic',
  namespace: 'opportunity',
  description:
    'Update an existing topic\'s metadata (title, description, tech focus areas, branch, lifecycle status, POC) by opportunity id. Only provided fields change; the content hash is recomputed when the title changes.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { opportunityId } = input;
    const actorId = ctx.actor.id;

    // Only the fields the caller actually supplied — drives both the
    // "nothing to update" guard and the event's changedFields list.
    const changedFields = EDITABLE_FIELDS.filter(
      (f) => input[f] !== undefined,
    );
    if (changedFields.length === 0) {
      throw new ValidationError('no fields provided to update', {
        opportunityId,
      });
    }

    // Confirm the topic exists up front (gives a clean NotFoundError) and
    // grab solicitation_id + topic_number so we can recompute content_hash
    // identically to opportunity.add_topic when the title changes.
    let existing: { solicitationId: string | null; topicNumber: string | null }[];
    try {
      existing = await sql<
        { solicitationId: string | null; topicNumber: string | null }[]
      >`
        SELECT solicitation_id, topic_number
        FROM opportunities
        WHERE id = ${opportunityId}::uuid
      `;
    } catch (err) {
      console.error('[opportunity.update_topic] existence check failed:', err);
      throw err;
    }
    if (existing.length === 0) {
      throw new NotFoundError(`topic not found: ${opportunityId}`);
    }

    // content_hash recompute inputs. Match add-topic's
    // md5(solicitation_id || topic_number || title). When the title is
    // unchanged, or we lack the hash inputs (non-topic row), leave the
    // existing hash untouched.
    const titleChanged = input.title !== undefined;
    const solId = existing[0].solicitationId;
    const topicNumber = existing[0].topicNumber;
    const canRehash = titleChanged && solId !== null && topicNumber !== null;

    let rows: Output[];
    try {
      rows = await sql<Output[]>`
        UPDATE opportunities
        SET
          title = COALESCE(${input.title ?? null}, title),
          description = CASE WHEN ${input.description !== undefined}
                             THEN ${input.description ?? null}
                             ELSE description END,
          tech_focus_areas = CASE WHEN ${input.techFocusAreas !== undefined}
                                  THEN ${input.techFocusAreas ?? []}::text[]
                                  ELSE tech_focus_areas END,
          topic_branch = CASE WHEN ${input.topicBranch !== undefined}
                              THEN ${input.topicBranch ?? null}
                              ELSE topic_branch END,
          topic_status = COALESCE(${input.topicStatus ?? null}, topic_status),
          poc_name = CASE WHEN ${input.pocName !== undefined}
                          THEN ${input.pocName ?? null}
                          ELSE poc_name END,
          poc_email = CASE WHEN ${input.pocEmail !== undefined}
                           THEN ${input.pocEmail ?? null}
                           ELSE poc_email END,
          content_hash = CASE WHEN ${canRehash}
                              THEN md5(${solId ?? ''} || ${topicNumber ?? ''} || ${input.title ?? ''})
                              ELSE content_hash END,
          updated_at = now()
        WHERE id = ${opportunityId}::uuid
        RETURNING
          id, source, source_id AS "sourceId", title, agency, office,
          program_type AS "programType",
          solicitation_id AS "solicitationId", topic_number AS "topicNumber",
          topic_branch AS "topicBranch", topic_status AS "topicStatus",
          tech_focus_areas AS "techFocusAreas", naics_codes AS "naicsCodes",
          poc_name AS "pocName", poc_email AS "pocEmail",
          close_date AS "closeDate", posted_date AS "postedDate",
          description, is_active AS "isActive",
          created_at AS "createdAt", updated_at AS "updatedAt"
      `;
    } catch (err) {
      console.error('[opportunity.update_topic] update failed:', err);
      throw err;
    }

    if (rows.length === 0) {
      // Raced with a delete between the existence check and the update.
      throw new NotFoundError(`topic not found: ${opportunityId}`);
    }

    const r = rows[0];

    await emitEventSingle({
      namespace: 'finder',
      type: 'topic.updated',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        opportunityId,
        solicitationId: r.solicitationId,
        changedFields,
      },
    });

    ctx.log?.info?.({
      msg: 'opportunity.update_topic succeeded',
      opportunityId,
      changedFields,
    });

    // Mid-window propagation: title/description are card fields AND bucket-scoring text.
    // A never-released topic on a pushed solicitation is a LATE ADDITION — release it the
    // moment it is date-complete; one already on the bridge just gets its card refreshed.
    const late = await activateLateTopicIfReady(opportunityId, { id: actorId, email: ctx.actor.email ?? null });
    if (!late.released && late.reason === 'already_released') {
      await republishSolicitationCards({
        solicitationId: r.solicitationId ?? '', opportunityId, actorId,
      });
    }

    const toIso = (v: unknown): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);

    return {
      id: r.id,
      source: r.source,
      sourceId: r.sourceId,
      title: r.title,
      agency: r.agency ?? null,
      office: r.office ?? null,
      programType: r.programType ?? null,
      solicitationId: r.solicitationId ?? null,
      topicNumber: r.topicNumber ?? null,
      topicBranch: r.topicBranch ?? null,
      topicStatus: r.topicStatus ?? null,
      techFocusAreas: r.techFocusAreas ?? null,
      naicsCodes: r.naicsCodes ?? null,
      pocName: r.pocName ?? null,
      pocEmail: r.pocEmail ?? null,
      closeDate: toIso(r.closeDate),
      postedDate: toIso(r.postedDate),
      description: r.description ?? null,
      isActive: r.isActive,
      createdAt: toIso(r.createdAt) ?? '',
      updatedAt: toIso(r.updatedAt),
    };
  },
});
