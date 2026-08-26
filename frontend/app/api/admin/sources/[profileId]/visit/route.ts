/**
 * POST /api/admin/sources/[profileId]/visit — Log a source visit/action
 *
 * Records a visit to a source profile (visit, download, upload,
 * paste_topics, import_topics, note). Updates the profile's
 * last_visited_at and last_visited_by timestamps.
 *
 * Auth: master_admin or rfp_admin
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ACTIONS = ['visit', 'download', 'upload', 'paste_topics', 'import_topics', 'shred', 'note'] as const;
type VisitAction = (typeof VALID_ACTIONS)[number];

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  let startId: string | null = null;
  try {
    // ── Auth ────────────────────────────────────────────────────────
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

    // ── Params ──────────────────────────────────────────────────────
    const { profileId } = await ctx.params;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Body ────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const url = typeof body.url === 'string' ? body.url.trim() || null : null;
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    const filesCount = typeof body.filesCount === 'number' && Number.isFinite(body.filesCount)
      ? Math.max(0, Math.floor(body.filesCount))
      : 0;
    const topicsCount = typeof body.topicsCount === 'number' && Number.isFinite(body.topicsCount)
      ? Math.max(0, Math.floor(body.topicsCount))
      : 0;
    const metadata = typeof body.metadata === 'object' && body.metadata !== null && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

    // ── Verify profile exists ───────────────────────────────────────
    let profile: { id: string; name: string } | undefined;
    try {
      const rows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM source_profiles
        WHERE id = ${profileId}::uuid AND is_active = true
        LIMIT 1
      `;
      profile = rows[0];
    } catch (e) {
      console.error('[admin/sources/visit] profile lookup failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: 'Source profile not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Start event ──────────────────────────────────────────────────
    startId = await emitEventStart({
      namespace: 'finder',
      type: 'source.visited',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: {
        action,
        sourceName: profile.name,
        sourceId: profileId,
      },
    });

    // ── Insert visit ────────────────────────────────────────────────
    let visit: { id: string };
    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO source_visits (
          profile_id, visited_by, action, url, notes,
          files_count, topics_count, metadata
        ) VALUES (
          ${profileId}::uuid, ${userId}::uuid,
          ${action as VisitAction}, ${url}, ${notes},
          ${filesCount}, ${topicsCount},
          ${sql.json((metadata) as Parameters<typeof sql.json>[0])}
        )
        RETURNING id
      `;
      visit = rows[0];
    } catch (e) {
      console.error('[admin/sources/visit] insert failed:', e);
      await emitEventEnd(startId, { error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── Update profile last-visited (non-fatal) ────────────────────
    try {
      await sql`
        UPDATE source_profiles
        SET last_visited_at = now(),
            last_visited_by = ${userId}::uuid,
            updated_at = now()
        WHERE id = ${profileId}::uuid
      `;
    } catch (e) {
      console.error('[admin/sources/visit] profile update failed:', e);
      // non-fatal, continue
    }

    await emitEventEnd(startId, {
      result: { visitId: visit.id, action, filesCount, topicsCount },
    });

    return NextResponse.json({ data: { visitId: visit.id } });
  } catch (e) {
    if (startId) {
      await emitEventEnd(startId, { error: { message: e instanceof Error ? e.message : String(e), code: 'HANDLER_THREW' } });
    }
    console.error('[api/admin/sources/[profileId]/visit POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
