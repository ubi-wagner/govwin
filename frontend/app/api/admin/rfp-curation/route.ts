/**
 * GET /api/admin/rfp-curation
 *
 * Lists curated solicitations with optional status filter. Used by the
 * RFP curation admin panel to display the triage queue.
 *
 * Query params:
 *   ?status=new,claimed,curation_in_progress   (comma-separated, optional)
 *
 * Returns: { data: { solicitations: [...] } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';

export async function GET(request: Request) {
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

    // ── Parse optional status filter ────────────────────────────────
    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status');
    const statuses = statusParam
      ? statusParam.split(',').map((s) => s.trim()).filter(Boolean)
      : null;

    // ── Query ───────────────────────────────────────────────────────
    let solicitations;
    if (statuses && statuses.length > 0) {
      solicitations = await sql`
        SELECT cs.id, cs.opportunity_id, cs.status, cs.namespace, cs.claimed_by,
               o.title, o.agency, o.program_type, o.close_date, cs.created_at
        FROM curated_solicitations cs
        JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.status = ANY(${statuses}::text[])
        ORDER BY cs.created_at DESC
        LIMIT 100
      `;
    } else {
      solicitations = await sql`
        SELECT cs.id, cs.opportunity_id, cs.status, cs.namespace, cs.claimed_by,
               o.title, o.agency, o.program_type, o.close_date, cs.created_at
        FROM curated_solicitations cs
        JOIN opportunities o ON o.id = cs.opportunity_id
        ORDER BY cs.created_at DESC
        LIMIT 100
      `;
    }

    return NextResponse.json({ data: { solicitations } });
  } catch (error) {
    console.error('[rfp-curation] GET list failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch curated solicitations', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
