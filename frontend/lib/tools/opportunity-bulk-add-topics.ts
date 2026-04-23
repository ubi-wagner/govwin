/**
 * opportunity.bulk_add_topics (Phase 1 §E extension).
 *
 * Add many topics to a parent solicitation in one call — critical for
 * DoD BAAs which can have 100-300 topics per cycle. Each topic gets
 * the same idempotency guard as opportunity.add_topic (dedupe on
 * solicitation_id + topic_number). Existing topics are skipped, not
 * errored.
 *
 * Input: array of { topic_number, title, ...optional fields }.
 * Returns: { inserted: uuid[], skipped: string[] } so the UI can
 * show exactly which topics were new.
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const TopicSchema = z.object({
  topicNumber: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional(),
  topicBranch: z.string().max(200).optional(),
  techFocusAreas: z.array(z.string().max(200)).default([]),
});

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  topics: z.array(TopicSchema).min(1).max(500),
  defaultBranch: z.string().max(200).optional(),
  topicStatus: z.enum(['open', 'pre_release', 'closed']).default('open'),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  inserted: { id: string; topicNumber: string }[];
  skipped: string[];
  totalRequested: number;
}

export const opportunityBulkAddTopicsTool = defineTool<Input, Output>({
  name: 'opportunity.bulk_add_topics',
  namespace: 'opportunity',
  description:
    'Bulk-add topics under a parent solicitation. Skips duplicates (by topic_number). Single tool call for up to 500 topics.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, topics, defaultBranch, topicStatus } = input;
    const actorId = ctx.actor.id;

    // Verify solicitation exists + grab inherit context
    const solRows = await sql<
      {
        id: string;
        inheritSource: string | null;
        inheritAgency: string | null;
        inheritOffice: string | null;
      }[]
    >`
      SELECT cs.id,
             o.source AS inherit_source,
             o.agency AS inherit_agency,
             o.office AS inherit_office
      FROM curated_solicitations cs
      LEFT JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.id = ${solicitationId}::uuid
    `;
    if (solRows.length === 0) {
      throw new NotFoundError(`solicitation not found: ${solicitationId}`);
    }
    const parent = solRows[0];

    // Find existing topic numbers under this solicitation
    const existingRows = await sql<{ topicNumber: string }[]>`
      SELECT topic_number FROM opportunities
      WHERE solicitation_id = ${solicitationId}::uuid
        AND topic_number IS NOT NULL
    `;
    const existing = new Set(existingRows.map((r) => r.topicNumber));

    // Check for dupes within the input itself too
    const seenInput = new Set<string>();
    const inputDupes: string[] = [];
    for (const t of topics) {
      if (seenInput.has(t.topicNumber)) inputDupes.push(t.topicNumber);
      seenInput.add(t.topicNumber);
    }
    if (inputDupes.length > 0) {
      throw new ValidationError(
        `Duplicate topic numbers in input: ${inputDupes.join(', ')}`,
        { duplicates: inputDupes },
      );
    }

    const source = parent.inheritSource ?? 'manual_upload';
    const inserted: { id: string; topicNumber: string }[] = [];
    const skipped: string[] = [];

    // Insert each non-existing topic
    for (const t of topics) {
      if (existing.has(t.topicNumber)) {
        skipped.push(t.topicNumber);
        continue;
      }

      const sourceIdDerived = `${solicitationId.slice(0, 8)}-${t.topicNumber}`;
      const branch = t.topicBranch ?? defaultBranch ?? parent.inheritOffice ?? null;

      try {
        const rows = await sql<{ id: string }[]>`
          INSERT INTO opportunities
            (source, source_id, title, agency, office,
             close_date, posted_date, description,
             content_hash, is_active,
             solicitation_id, topic_number, topic_branch,
             topic_status, tech_focus_areas, naics_codes)
          VALUES
            (${source}, ${sourceIdDerived}, ${t.title},
             ${parent.inheritAgency ?? null},
             ${branch},
             NULL, NULL,
             ${t.description ?? null},
             md5(${solicitationId} || ${t.topicNumber} || ${t.title}), true,
             ${solicitationId}::uuid,
             ${t.topicNumber},
             ${branch},
             ${topicStatus},
             ${t.techFocusAreas}::text[],
             '{}'::text[])
          RETURNING id
        `;
        inserted.push({ id: rows[0].id, topicNumber: t.topicNumber });
      } catch (err) {
        // Don't fail the batch on one bad row; log + skip
        ctx.log?.warn?.({
          msg: 'bulk_add_topics: row failed',
          topicNumber: t.topicNumber,
          err: err instanceof Error ? err.message : String(err),
        });
        skipped.push(t.topicNumber);
      }
    }

    // Flip solicitation_type to multi_topic if we added any
    if (inserted.length > 0) {
      await sql`
        UPDATE curated_solicitations
        SET solicitation_type = 'multi_topic', updated_at = now()
        WHERE id = ${solicitationId}::uuid
          AND solicitation_type = 'single'
      `;
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'topic.bulk_added',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        solicitationId,
        insertedCount: inserted.length,
        skippedCount: skipped.length,
      },
    });

    ctx.log?.info?.({
      msg: 'opportunity.bulk_add_topics succeeded',
      solicitationId,
      inserted: inserted.length,
      skipped: skipped.length,
    });

    return { inserted, skipped, totalRequested: topics.length };
  },
});
