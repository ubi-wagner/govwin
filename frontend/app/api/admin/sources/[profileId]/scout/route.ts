/**
 * POST /api/admin/sources/[profileId]/scout — Trigger a manual scout run
 *
 * Enqueues a pipeline_job with kind='scout_source' and metadata
 * containing the profileId. The pipeline worker picks it up and
 * runs the source scout for this profile.
 *
 * Auth: master_admin or rfp_admin
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
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

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json(
        { error: 'Missing user id in session', code: 'UNAUTHENTICATED' },
        { status: 401 },
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

    // ── Verify profile exists ───────────────────────────────────────
    const [profile] = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM source_profiles
      WHERE id = ${profileId}::uuid AND is_active = true
      LIMIT 1
    `;
    if (!profile) {
      return NextResponse.json(
        { error: 'Source profile not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Start event ──────────────────────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'source.scout_triggered',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: {
        sourceId: profileId,
        sourceName: profile.name,
      },
    });

    // ── Enqueue scout job ───────────────────────────────────────────
    const [job] = await sql<{ id: string }[]>`
      INSERT INTO pipeline_jobs (source, kind, status, priority, metadata)
      VALUES (
        'scout',
        'scout_source',
        'pending',
        3,
        ${sql.json({ source_id: profileId, triggered_by: userId })}
      )
      RETURNING id
    `;

    await emitEventEnd(startId, {
      result: { jobId: job.id, sourceId: profileId },
    });

    return NextResponse.json({ data: { jobId: job.id } }, { status: 201 });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/scout POST] error:', e);
    return NextResponse.json(
      { error: 'Failed to enqueue scout job', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
