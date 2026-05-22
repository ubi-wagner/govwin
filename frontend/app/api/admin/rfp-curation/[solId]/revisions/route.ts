import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

/**
 * GET /api/admin/rfp-curation/[solId]/revisions
 *
 * Returns the full curation revision history for a solicitation.
 * Auth: rfp_admin or master_admin.
 *
 * Query params:
 *   ?limit=100   — max revisions to return (default 100, max 500)
 *   ?type=X      — filter by revision_type (optional)
 *
 * Returns: { data: { revisions: [...] } }
 */
export async function GET(
  request: Request,
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

    // ── Verify solicitation exists ──────────────────────────────────
    let exists: { id: string }[];
    try {
      exists = await sql<{ id: string }[]>`
        SELECT id FROM curated_solicitations WHERE id = ${solId}::uuid
      `;
    } catch (e) {
      console.error('[rfp-curation/revisions] existence check failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    if (exists.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Parse query params ──────────────────────────────────────────
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const typeParam = url.searchParams.get('type');

    const limit = Math.min(
      Math.max(parseInt(limitParam ?? '100', 10) || 100, 1),
      500,
    );

    // ── Query revisions ─────────────────────────────────────────────
    let revisions: {
      id: string;
      solicitationId: string;
      actorId: string | null;
      actorEmail: string | null;
      revisionType: string;
      fieldName: string | null;
      oldValue: string | null;
      newValue: string | null;
      metadata: Record<string, unknown>;
      createdAt: Date;
    }[];

    try {
      if (typeParam) {
        revisions = await sql<typeof revisions>`
          SELECT id, solicitation_id, actor_id, actor_email, revision_type,
                 field_name, old_value, new_value, metadata, created_at
          FROM curation_revisions
          WHERE solicitation_id = ${solId}::uuid
            AND revision_type = ${typeParam}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      } else {
        revisions = await sql<typeof revisions>`
          SELECT id, solicitation_id, actor_id, actor_email, revision_type,
                 field_name, old_value, new_value, metadata, created_at
          FROM curation_revisions
          WHERE solicitation_id = ${solId}::uuid
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      }
    } catch (e) {
      console.error('[rfp-curation/revisions] query failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        revisions: revisions.map((r) => ({
          id: r.id,
          solicitation_id: r.solicitationId,
          actor_id: r.actorId,
          actor_email: r.actorEmail,
          revision_type: r.revisionType,
          field_name: r.fieldName,
          old_value: r.oldValue,
          new_value: r.newValue,
          metadata: r.metadata,
          created_at: r.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('[rfp-curation/revisions] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch revision history', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
