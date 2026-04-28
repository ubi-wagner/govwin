/**
 * GET /api/admin/rfp-curation/[solId]/templates
 *
 * Lists template documents linked to a solicitation. Queries
 * `solicitation_documents` filtered to `document_type = 'template'`.
 *
 * Returns: { data: { templates: [...] } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Verify solicitation exists ──────────────────────────────────
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM curated_solicitations WHERE id = ${solId}::uuid
    `;
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Query template documents ────────────────────────────────────
    const templates = await sql`
      SELECT id, solicitation_id, document_type, original_filename,
             storage_key, file_size, content_type, page_count,
             uploaded_by, metadata, created_at, updated_at
      FROM solicitation_documents
      WHERE solicitation_id = ${solId}::uuid
        AND document_type = 'template'
      ORDER BY created_at ASC
    `;

    return NextResponse.json({ data: { templates } });
  } catch (error) {
    console.error('[rfp-curation] GET templates failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch template documents', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
