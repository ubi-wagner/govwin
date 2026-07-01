/**
 * POST /api/admin/rfp-curation/[solId]/apply-to-all-topics
 *
 * Mass-copy the SOLICITATION BASELINE (topic_id IS NULL) compliance matrix +
 * volumes + required-items — INCLUDING template links — onto every topic/AOI under
 * a multi-topic solicitation. Each topic gets its own concrete, independently-
 * editable copy seeded from the baseline (the cohort "apply to all").
 *
 * This is a FAITHFUL full-column copy via INSERT ... SELECT (unlike apply-preset,
 * which copies a subset and drops template_id / required_sections / custom_variables).
 * Existing topic-level rows are replaced.
 *
 * Body: {} (no input — copies the solicitation's own baseline).
 * Returns: { data: { applied: number, topicIds: string[], volumesPerTopic: number } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd } from '@/lib/events';
import type { Role } from '@/lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Column lists verified against the migrated schema (excludes identity / per-topic /
// audit columns, which are set explicitly). Static → safe to inline as raw SQL.
const COMP_COLS =
  'page_limit_technical, page_limit_cost, page_limit_other, font_family, font_size, margins, line_spacing, header_required, header_format, footer_required, footer_format, submission_format, images_tables_allowed, slides_allowed, slide_limit, slide_order, required_sections, required_documents, evaluation_criteria, taba_allowed, indirect_rate_cap, partner_max_pct, cost_sharing_required, cost_volume_format, pi_must_be_employee, pi_university_allowed, clearance_required, itar_required, far_clauses, custom_variables, min_font_size';
const VOL_COLS =
  'volume_number, volume_name, volume_format, description, special_requirements, metadata, applies_to_phase, expert_notes';
const ITEM_COLS =
  'item_number, item_name, item_type, required, page_limit, slide_limit, font_family, font_size, margins, line_spacing, header_format, footer_format, required_sections, format_rules, custom_fields, source_excerpts, metadata, applies_to_phase, min_font_size, canvas_preset, compliance_preset, template_id, expert_notes';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const user = session.user as { id?: string; role?: Role };
  if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
    return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { solId } = await ctx.params;
  if (!UUID_RE.test(solId)) {
    return NextResponse.json({ error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' }, { status: 400 });
  }
  const userId = user.id ?? null;

  try {
    // Topics under this solicitation.
    const topics = await sql<{ id: string }[]>`
      SELECT id FROM opportunities WHERE solicitation_id = ${solId}::uuid
    `;
    if (topics.length === 0) {
      return NextResponse.json({ data: { applied: 0, topicIds: [], volumesPerTopic: 0, note: 'no_topics' } });
    }

    // The solicitation baseline (topic_id IS NULL).
    const [baselineComp] = await sql<{ id: string }[]>`
      SELECT id FROM solicitation_compliance WHERE solicitation_id = ${solId}::uuid AND topic_id IS NULL LIMIT 1
    `;
    const baselineVols = await sql<{ id: string }[]>`
      SELECT id FROM solicitation_volumes WHERE solicitation_id = ${solId}::uuid AND topic_id IS NULL ORDER BY volume_number
    `;
    if (!baselineComp && baselineVols.length === 0) {
      return NextResponse.json(
        { error: 'No solicitation baseline (topic_id IS NULL) compliance or volumes to copy', code: 'NO_BASELINE' },
        { status: 422 },
      );
    }

    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'compliance.applied_to_cohort',
      actor: { type: 'user', id: userId ?? 'unknown' },
      tenantId: null,
      payload: { solicitationId: solId, topicCount: topics.length, volumesPerTopic: baselineVols.length },
    });

    try {
      await sql.begin(async (tx: any) => {
        for (const topic of topics) {
          const topicId = topic.id;

          // ── Compliance: replace the topic row with a full copy of the baseline ──
          if (baselineComp) {
            await tx.unsafe(
              `DELETE FROM solicitation_compliance WHERE solicitation_id = $1::uuid AND topic_id = $2::uuid`,
              [solId, topicId],
            );
            await tx.unsafe(
              `INSERT INTO solicitation_compliance (solicitation_id, topic_id, ${COMP_COLS}, verified_by, verified_at)
               SELECT solicitation_id, $2::uuid, ${COMP_COLS}, $3, now()
               FROM solicitation_compliance WHERE solicitation_id = $1::uuid AND topic_id IS NULL`,
              [solId, topicId, userId],
            );
          }

          // ── Volumes + items: clear the topic's, then copy each baseline volume ──
          const exVols = await tx<{ id: string }[]>`
            SELECT id FROM solicitation_volumes WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid
          `;
          if (exVols.length > 0) {
            const ids = exVols.map((v: { id: string }) => v.id);
            await tx`DELETE FROM volume_required_items WHERE volume_id = ANY(${ids}::uuid[])`;
            await tx`DELETE FROM solicitation_volumes WHERE solicitation_id = ${solId}::uuid AND topic_id = ${topicId}::uuid`;
          }

          for (const bv of baselineVols) {
            const nv: { id: string }[] = await tx.unsafe(
              `INSERT INTO solicitation_volumes (solicitation_id, topic_id, ${VOL_COLS}, created_by)
               SELECT solicitation_id, $2::uuid, ${VOL_COLS}, $3
               FROM solicitation_volumes WHERE id = $1::uuid
               RETURNING id`,
              [bv.id, topicId, userId],
            );
            const newVolId = nv[0]?.id;
            if (newVolId) {
              // Copy required-items WITH template_id + expert_notes (the "template documents").
              await tx.unsafe(
                `INSERT INTO volume_required_items (volume_id, ${ITEM_COLS})
                 SELECT $1::uuid, ${ITEM_COLS} FROM volume_required_items WHERE volume_id = $2::uuid ORDER BY item_number`,
                [newVolId, bv.id],
              );
            }
          }
        }
      });
    } catch (err) {
      console.error('[apply-to-all-topics] copy failed:', err);
      await emitEventEnd(startId, { error: { message: err instanceof Error ? err.message : String(err), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Failed to apply to all topics', code: 'DB_ERROR' }, { status: 500 });
    }

    const topicIds = topics.map((t) => t.id);
    await emitEventEnd(startId, { result: { applied: topicIds.length, volumesPerTopic: baselineVols.length } });
    return NextResponse.json({ data: { applied: topicIds.length, topicIds, volumesPerTopic: baselineVols.length } });
  } catch (err) {
    console.error('[apply-to-all-topics] failed:', err);
    return NextResponse.json({ error: 'Failed to apply to all topics', code: 'DB_ERROR' }, { status: 500 });
  }
}
