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
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

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
    let diffs;
    try {
      diffs = await sql`
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
    } catch (e) {
      console.error('[admin/sources/diffs] GET query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { diffs } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/diffs GET] error:', e);
    return NextResponse.json(
      { error: 'Failed to fetch diffs', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

// ── PATCH: mark a diff as reviewed ──────────────────────────────────

export async function PATCH(request: Request, ctx: RouteContext) {
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

    // ── Body ────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    const diffId = typeof body.diffId === 'string' ? body.diffId : '';
    if (!UUID_RE.test(diffId)) {
      return NextResponse.json(
        { error: 'Invalid diffId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Update ──────────────────────────────────────────────────────
    let diff: { id: string } | undefined;
    try {
      const rows = await sql<{ id: string }[]>`
        UPDATE source_diffs
        SET reviewed_by = ${userId}::uuid,
            reviewed_at = now()
        WHERE id = ${diffId}::uuid
          AND profile_id = ${profileId}::uuid
          AND reviewed_at IS NULL
        RETURNING id
      `;
      diff = rows[0];
    } catch (e) {
      console.error('[admin/sources/diffs] PATCH update query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!diff) {
      return NextResponse.json(
        { error: 'Diff not found or already reviewed', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Emit event (non-fatal) ─────────────────────────────────────
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'source_diff.reviewed',
        actor: userActor(userId, (session.user as { email?: string }).email),
        payload: {
          correlationId: randomUUID(),
          sourceId: profileId,
          diffId: diff.id,
        },
      });
    } catch (e) {
      console.error('[admin/sources/diffs] event emission failed:', e);
      // non-fatal, continue
    }

    return NextResponse.json({ data: { reviewed: true } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/diffs PATCH] error:', e);
    return NextResponse.json(
      { error: 'Failed to review diff', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
