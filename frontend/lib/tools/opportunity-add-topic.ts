/**
 * opportunity.add_topic (Phase 1 §E extension).
 *
 * Adds a topic under a parent solicitation. Topics are the discrete
 * pursuit units that customers pin/purchase (SBIR topic, STTR topic,
 * BAA task, CSO focus area, Challenge area, OTA work order).
 *
 * Creates:
 *   - opportunities row with solicitation_id FK + topic metadata
 *
 * Inherits compliance / volumes / documents from the parent
 * solicitation. Customer-side Spotlight surfaces active topics.
 *
 * Required role: rfp_admin
 */

import { z } from 'zod';
import { sql } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { emitEventSingle } from '@/lib/events';
import { defineTool } from './base';

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  topicNumber: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  description: z.string().max(20000).optional(),
  topicBranch: z.string().max(200).optional(),
  programType: z.string().max(100).optional(),
  techFocusAreas: z.array(z.string().max(200)).default([]),
  naicsCodes: z.array(z.string()).default([]),
  pocName: z.string().max(200).optional(),
  pocEmail: z.string().email().max(200).optional(),
  closeDate: z.string().optional(),
  postedDate: z.string().optional(),
  topicStatus: z.enum(['open', 'pre_release', 'closed']).default('open'),
});

type Input = z.infer<typeof InputSchema>;

interface Output {
  topicId: string;
  solicitationId: string;
  topicNumber: string;
}

export const opportunityAddTopicTool = defineTool<Input, Output>({
  name: 'opportunity.add_topic',
  namespace: 'opportunity',
  description:
    'Create a topic under a parent solicitation. Topics are discrete pursuit units (SBIR topic, BAA task, Challenge focus area, OTA work order) that customers pin via Spotlight.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    const { solicitationId, topicNumber, title } = input;
    const actorId = ctx.actor.id;

    // Confirm the parent solicitation exists + grab context we need
    // for the topic's opportunity row (source, agency, etc. can be
    // inherited from the primary opportunity under the same solicitation).
    const solRows = await sql<
      {
        id: string;
        solicitationType: string | null;
        primaryOppId: string | null;
        inheritSource: string | null;
        inheritAgency: string | null;
        inheritOffice: string | null;
      }[]
    >`
      SELECT cs.id, cs.solicitation_type,
             cs.opportunity_id AS primary_opp_id,
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

    // Dedupe on (solicitation_id, topic_number) — same topic number
    // under the same umbrella is always the same topic.
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM opportunities
      WHERE solicitation_id = ${solicitationId}::uuid
        AND topic_number = ${topicNumber}
      LIMIT 1
    `;
    if (existing.length > 0) {
      throw new ValidationError(
        `topic ${topicNumber} already exists under this solicitation`,
        { topicId: existing[0].id, topicNumber },
      );
    }

    const closeDt = input.closeDate ? new Date(input.closeDate) : null;
    const postedDt = input.postedDate ? new Date(input.postedDate) : null;
    const source = parent.inheritSource ?? 'manual_upload';
    // Derive a unique source_id for the topic so the UNIQUE(source, source_id)
    // constraint on opportunities doesn't collide. Format: {parent}-{topic_number}.
    const sourceIdDerived = `${solicitationId.slice(0, 8)}-${topicNumber}`;

    const rows = await sql<{ id: string }[]>`
      INSERT INTO opportunities
        (source, source_id, title, agency, office, program_type,
         close_date, posted_date, description,
         content_hash, is_active,
         solicitation_id, topic_number, topic_branch,
         topic_status, tech_focus_areas, naics_codes,
         poc_name, poc_email)
      VALUES
        (${source}, ${sourceIdDerived}, ${title},
         ${parent.inheritAgency ?? null},
         ${input.topicBranch ?? parent.inheritOffice ?? null},
         ${input.programType ?? null},
         ${closeDt}, ${postedDt},
         ${input.description ?? null},
         md5(${solicitationId} || ${topicNumber} || ${title}), true,
         ${solicitationId}::uuid,
         ${topicNumber},
         ${input.topicBranch ?? null},
         ${input.topicStatus},
         ${input.techFocusAreas}::text[],
         ${input.naicsCodes}::text[],
         ${input.pocName ?? null},
         ${input.pocEmail ?? null})
      RETURNING id
    `;
    const topicId = rows[0].id;

    // If the parent was 'single' type, flip to 'multi_topic' — it now
    // has a real topic under it (the primary opportunity or additional).
    await sql`
      UPDATE curated_solicitations
      SET solicitation_type = 'multi_topic', updated_at = now()
      WHERE id = ${solicitationId}::uuid
        AND solicitation_type = 'single'
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'topic.added',
      actor: { type: 'user', id: actorId, email: ctx.actor.email ?? undefined },
      payload: {
        solicitationId,
        topicId,
        topicNumber,
      },
    });

    ctx.log?.info?.({
      msg: 'opportunity.add_topic succeeded',
      solicitationId,
      topicId,
      topicNumber,
    });

    return { topicId, solicitationId, topicNumber };
  },
});
