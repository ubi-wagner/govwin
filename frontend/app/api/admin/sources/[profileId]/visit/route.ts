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
import { emitEventSingle, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ACTIONS = ['visit', 'download', 'upload', 'paste_topics', 'import_topics', 'note'] as const;
type VisitAction = (typeof VALID_ACTIONS)[number];

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session' }, { status: 401 });
    }

    // ── Params ──────────────────────────────────────────────────────
    const { profileId } = await ctx.params;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profileId format' }, { status: 400 });
    }

    // ── Body ────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` },
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
    const [profile] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM source_profiles
      WHERE id = ${profileId}::uuid AND is_active = true
      LIMIT 1
    `;
    if (!profile) {
      return NextResponse.json({ error: 'Source profile not found' }, { status: 404 });
    }

    // ── Insert visit ────────────────────────────────────────────────
    const [visit] = await sql<{ id: string }[]>`
      INSERT INTO source_visits (
        profile_id, visited_by, action, url, notes,
        files_count, topics_count, metadata
      ) VALUES (
        ${profileId}::uuid, ${userId}::uuid,
        ${action as VisitAction}, ${url}, ${notes},
        ${filesCount}, ${topicsCount},
        ${JSON.stringify(metadata)}::jsonb
      )
      RETURNING id
    `;

    // ── Update profile last-visited ─────────────────────────────────
    await sql`
      UPDATE source_profiles
      SET last_visited_at = now(),
          last_visited_by = ${userId}::uuid,
          updated_at = now()
      WHERE id = ${profileId}::uuid
    `;

    // ── Emit event ──────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'admin',
      type: 'source.activity',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: {
        action,
        sourceName: profile.name,
        sourceId: profileId,
        filesCount,
        topicsCount,
      },
    });

    return NextResponse.json({ data: { visitId: visit.id } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/visit POST] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
