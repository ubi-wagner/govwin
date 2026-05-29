/**
 * GET  /api/admin/sources — List all active source profiles with visit counts
 * POST /api/admin/sources — Create a new source profile
 *
 * Auth: master_admin or rfp_admin
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

// ─── GET: list active sources ─────────────────────────────────────

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let sources, recentActivity, recentDiffs;
    try {
      sources = await sql`
        SELECT sp.*,
          (SELECT COUNT(*) FROM source_visits sv WHERE sv.profile_id = sp.id) AS visit_count,
          (SELECT MAX(sv.created_at) FROM source_visits sv WHERE sv.profile_id = sp.id) AS last_activity
        FROM source_profiles sp
        WHERE sp.is_active = true
        ORDER BY sp.name
      `;

      recentActivity = await sql`
        SELECT sv.*, sp.name AS source_name
        FROM source_visits sv
        JOIN source_profiles sp ON sp.id = sv.profile_id
        ORDER BY sv.created_at DESC
        LIMIT 20
      `;

      recentDiffs = await sql`
        SELECT sd.id, sd.profile_id, sd.summary, sd.severity,
               sd.is_meaningful, sd.created_at,
               sp.name AS source_name,
               sr.name AS region_name
        FROM source_diffs sd
        JOIN source_profiles sp ON sp.id = sd.profile_id
        LEFT JOIN source_regions sr ON sr.id = sd.region_id
        WHERE sd.is_meaningful = true
        ORDER BY sd.created_at DESC
        LIMIT 20
      `;
    } catch (e) {
      console.error('[admin/sources] GET query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { sources, recentActivity, recentDiffs } });
  } catch (e) {
    console.error('[api/admin/sources GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ─── POST: create a source profile ───────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Input validation ──────────────────────────────────────────
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const siteType = typeof body.siteType === 'string' ? body.siteType.trim() : '';
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';

    if (!name || !siteType || !baseUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: name, siteType, baseUrl', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const validSiteTypes = ['dsip', 'sam_gov', 'sbir_gov', 'grants_gov', 'afwerx', 'xtech', 'nsf', 'custom'];
    if (!validSiteTypes.includes(siteType)) {
      return NextResponse.json(
        { error: `Invalid siteType. Must be one of: ${validSiteTypes.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const bookmarkUrl = typeof body.bookmarkUrl === 'string' ? body.bookmarkUrl.trim() || null : null;
    const agency = typeof body.agency === 'string' ? body.agency.trim() || null : null;
    const programType = typeof body.programType === 'string' ? body.programType.trim() || null : null;
    const adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() || null : null;
    const visitInstructions = typeof body.visitInstructions === 'string' ? body.visitInstructions.trim() || null : null;

    // ── Start event ────────────────────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'source.created',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: { name, siteType, baseUrl },
    });

    // ── Insert ────────────────────────────────────────────────────
    let row: { id: string; name: string };
    try {
      const rows = await sql<{ id: string; name: string }[]>`
        INSERT INTO source_profiles (
          name, site_type, base_url, bookmark_url,
          agency, program_type, admin_notes, visit_instructions,
          created_by
        ) VALUES (
          ${name}, ${siteType}, ${baseUrl}, ${bookmarkUrl},
          ${agency}, ${programType}, ${adminNotes}, ${visitInstructions},
          ${userId}::uuid
        )
        RETURNING id, name
      `;
      row = rows[0];
    } catch (e) {
      console.error('[admin/sources] POST insert failed:', e);
      await emitEventEnd(startId, { error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventEnd(startId, {
      result: { sourceId: row.id, name: row.name, siteType },
    });

    return NextResponse.json({ data: { id: row.id, name: row.name } });
  } catch (e) {
    console.error('[api/admin/sources POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
