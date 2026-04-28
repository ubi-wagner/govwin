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
    const rows = await sql`
      SELECT cs.*, o.*,
             cs.id AS solicitation_id,
             o.id AS opportunity_id
      FROM curated_solicitations cs
      JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.id = ${solId}::uuid
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const solicitation = rows[0];

    // ── Fetch related data in parallel ──────────────────────────────
    const [topics, documents, volumes, compliance] = await Promise.all([
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
