/**
 * GET /api/admin/sources/[profileId]/diffs — List diffs for a source profile
 *
 * Returns the most recent source_diffs for this profile, ordered by
 * created_at DESC. Includes related region name for context.
 *
 * Auth: master_admin or rfp_admin
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    // ── Auth ────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Params ──────────────────────────────────────────────────────
    const { profileId } = await ctx.params;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json(
        { error: 'Invalid profileId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Query diffs ─────────────────────────────────────────────────
    const diffs = await sql`
      SELECT sd.id, sd.profile_id, sd.region_id, sd.is_meaningful,
             sd.summary, sd.severity, sd.claude_model,
             sd.claude_tokens_used, sd.reviewed_by, sd.reviewed_at,
             sd.created_at,
             sr.name AS region_name
      FROM source_diffs sd
      LEFT JOIN source_regions sr ON sr.id = sd.region_id
      WHERE sd.profile_id = ${profileId}::uuid
      ORDER BY sd.created_at DESC
      LIMIT 50
    `;

    return NextResponse.json({ data: { diffs } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/diffs GET] error:', e);
    return NextResponse.json(
      { error: 'Failed to fetch diffs', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
