/**
 * GET /api/admin/rfp-curation/[solId]
 *
 * Returns full solicitation detail for the curation workspace: the
 * curated_solicitations row joined with its opportunity, plus related
 * topics, documents, volumes, and compliance variables.
 *
 * Returns: { data: { solicitation: {...}, topics, documents, volumes, compliance } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

export async function GET(
  _request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: Role }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;

    // ── Validate UUID format ────────────────────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Main solicitation + opportunity join ─────────────────────────
    let rows;
    try {
      rows = await sql`
        SELECT cs.*, o.*,
               cs.id AS solicitation_id,
               o.id AS opportunity_id
        FROM curated_solicitations cs
        JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = ${solId}::uuid
      `;
    } catch (e) {
      console.error('[rfp-curation/detail] solicitation query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const solicitation = rows[0];

    // ── Fetch related data in parallel ──────────────────────────────
    let topics, documents, volumes, compliance;
    try {
      [topics, documents, volumes, compliance] = await Promise.all([
        sql`
          SELECT id, topic_number, title, topic_branch, topic_status,
                 tech_focus_areas, close_date, is_active, created_at
          FROM opportunities
          WHERE solicitation_id = ${solId}::uuid
          ORDER BY topic_number ASC NULLS LAST, created_at ASC
        `,
        sql`
          SELECT id, document_type, original_filename, storage_key,
                 file_size, content_type, extracted_at, is_primary, created_at
          FROM solicitation_documents
          WHERE solicitation_id = ${solId}::uuid
          ORDER BY is_primary DESC, created_at ASC
        `,
        sql`
          SELECT v.id, v.volume_number, v.volume_name, v.volume_format,
                 v.description, v.special_requirements,
                 json_agg(
                   json_build_object(
                     'id', ri.id,
                     'itemName', ri.item_name,
                     'itemNumber', ri.item_number,
                     'itemType', ri.item_type,
                     'required', ri.required,
                     'pageLimit', ri.page_limit,
                     'slideLimit', ri.slide_limit
                   ) ORDER BY ri.item_number ASC
                 ) FILTER (WHERE ri.id IS NOT NULL) AS required_items
          FROM solicitation_volumes v
          LEFT JOIN volume_required_items ri ON ri.volume_id = v.id
          WHERE v.solicitation_id = ${solId}::uuid
          GROUP BY v.id
          ORDER BY v.volume_number ASC
        `,
        sql`
          SELECT * FROM solicitation_compliance
          WHERE solicitation_id = ${solId}::uuid
        `,
      ]);
    } catch (e) {
      console.error('[rfp-curation/detail] related data query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        solicitation,
        topics,
        documents,
        volumes,
        compliance: compliance[0] ?? null,
      },
    });
  } catch (error) {
    console.error('[rfp-curation] GET detail failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch solicitation detail', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/admin/rfp-curation/[solId]
 *
 * Update solicitation-level curation fields:
 *   - spotlightSummary (mig 107) — the matching context that the push gate requires
 *     and that fan-out folds into the card for ranking.
 *   - expertNotes — the landing opportunity's customer-visible expert note
 *     (rides the card snapshot; previously had no edit surface at all).
 *
 * Both are card-snapshot inputs, so a save on a PUSHED solicitation re-publishes
 * every released opp to the bridge (republishSolicitationCards — no-op pre-push).
 * Without that, tenants keep ranking against a summary the admin already replaced.
 * Body: { spotlightSummary?: string, expertNotes?: string }
 */
export async function PATCH(request: Request, routeCtx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; email?: string; role?: Role };
    const role = u.role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { solId } = await routeCtx.params;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let body: { spotlightSummary?: unknown; expertNotes?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const hasSummary = typeof body.spotlightSummary === 'string';
    const hasExpertNotes = typeof body.expertNotes === 'string';
    if (!hasSummary && !hasExpertNotes) {
      return NextResponse.json({ error: 'spotlightSummary or expertNotes (string) is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const summary = hasSummary ? (body.spotlightSummary as string).slice(0, 5000) : null;
    const expertNotes = hasExpertNotes ? (body.expertNotes as string).slice(0, 5000) : null;
    // Pre-flight BEFORE any write: an umbrella can legally exist without a landing opp
    // (mig 013), and the expert note lives ON the landing opp. Checking after the summary
    // UPDATE committed a partial, unaudited write and mislabelled it 404.
    if (hasExpertNotes) {
      try {
        const [pre] = await sql<{ opportunityId: string | null }[]>`
          SELECT opportunity_id AS "opportunityId" FROM curated_solicitations WHERE id = ${solId}::uuid`;
        if (!pre) return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        if (!pre.opportunityId) {
          return NextResponse.json({
            error: 'This solicitation has no landing opportunity — the expert note lives on the opportunity card.',
            code: 'NO_LANDING_OPPORTUNITY',
          }, { status: 409 });
        }
      } catch (err) {
        console.error('[rfp-curation] PATCH preflight failed:', err);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }
    try {
      if (hasSummary) {
        const rows = await sql<{ id: string }[]>`
          UPDATE curated_solicitations SET spotlight_summary = ${summary}, updated_at = now()
          WHERE id = ${solId}::uuid RETURNING id`;
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        }
      }
      if (hasExpertNotes) {
        const rows = await sql<{ id: string }[]>`
          UPDATE opportunities SET expert_notes = ${expertNotes}, updated_at = now()
          WHERE id = (SELECT opportunity_id FROM curated_solicitations WHERE id = ${solId}::uuid)
          RETURNING id`;
        if (rows.length === 0) {
          return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
        }
      }
    } catch (err) {
      console.error('[rfp-curation] PATCH curation fields failed:', err);
      return NextResponse.json({ error: 'Failed to update solicitation', code: 'DB_ERROR' }, { status: 500 });
    }
    await emitEventSingle({
      namespace: 'finder',
      type: hasSummary ? 'solicitation.summary_updated' : 'solicitation.expert_notes_updated',
      actor: userActor(u.id ?? '', u.email ?? undefined),
      tenantId: null,
      payload: { solicitationId: solId, fields: [hasSummary && 'spotlightSummary', hasExpertNotes && 'expertNotes'].filter(Boolean) },
    });
    const propagation = await republishSolicitationCards({ solicitationId: solId, actorId: u.id ?? null });
    return NextResponse.json({ data: {
      ...(hasSummary ? { spotlightSummary: summary } : {}),
      ...(hasExpertNotes ? { expertNotes } : {}),
      propagation,
    } });
  } catch (error) {
    console.error('[rfp-curation] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update solicitation', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
