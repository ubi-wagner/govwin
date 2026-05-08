/**
 * DELETE /api/admin/sources/[profileId]/regions/[regionId] — Soft-delete a region
 *
 * Sets is_active = false on the region. Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ profileId: string; regionId: string }>;
}

export async function DELETE(_request: Request, ctx: RouteContext) {
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
    const { profileId, regionId } = await ctx.params;
    if (!UUID_RE.test(profileId) || !UUID_RE.test(regionId)) {
      return NextResponse.json(
        { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Soft delete ─────────────────────────────────────────────────
    const [region] = await sql<{ id: string; name: string }[]>`
      UPDATE source_regions
      SET is_active = false, updated_at = now()
      WHERE id = ${regionId}::uuid
        AND profile_id = ${profileId}::uuid
        AND is_active = true
      RETURNING id, name
    `;

    if (!region) {
      return NextResponse.json(
        { error: 'Region not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Emit event ──────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'finder',
      type: 'source_region.deleted',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: {
        correlationId: randomUUID(),
        sourceId: profileId,
        regionId: region.id,
        regionName: region.name,
      },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/regions/[regionId] DELETE] error:', e);
    return NextResponse.json(
      { error: 'Failed to delete region', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
