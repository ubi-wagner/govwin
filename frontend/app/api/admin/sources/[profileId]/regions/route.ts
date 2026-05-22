/**
 * GET  /api/admin/sources/[profileId]/regions — List regions for a source profile
 * POST /api/admin/sources/[profileId]/regions — Create a new region annotation
 *
 * Auth: master_admin or rfp_admin
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_REGION_TYPES = ['content', 'listing', 'download', 'navigation', 'table'] as const;

interface RouteContext {
  params: Promise<{ profileId: string }>;
}

// ── GET: list regions ────────────────────────────────────────────────

export async function GET(_request: Request, ctx: RouteContext) {
  try {
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

    const { profileId } = await ctx.params;
    if (!UUID_RE.test(profileId)) {
      return NextResponse.json(
        { error: 'Invalid profileId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let regions;
    try {
      regions = await sql`
        SELECT id, profile_id, name, selector_hint, content_context,
               region_type, sample_html, sample_text, is_active,
               created_at, updated_at
        FROM source_regions
        WHERE profile_id = ${profileId}::uuid AND is_active = true
        ORDER BY name
      `;
    } catch (e) {
      console.error('[admin/sources/regions] GET query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { regions } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/regions GET] error:', e);
    return NextResponse.json(
      { error: 'Failed to fetch regions', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

// ── POST: create a region ────────────────────────────────────────────

export async function POST(request: Request, ctx: RouteContext) {
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

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const contentContext = typeof body.contentContext === 'string' ? body.contentContext.trim() : '';

    if (!name || !contentContext) {
      return NextResponse.json(
        { error: 'name and contentContext are required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const selectorHint = typeof body.selectorHint === 'string' ? body.selectorHint.trim() || null : null;
    const regionType = typeof body.regionType === 'string' && (VALID_REGION_TYPES as readonly string[]).includes(body.regionType)
      ? body.regionType
      : 'content';
    const sampleHtml = typeof body.sampleHtml === 'string' ? body.sampleHtml || null : null;
    const sampleText = typeof body.sampleText === 'string' ? body.sampleText || null : null;

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
      console.error('[admin/sources/regions] profile lookup failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json(
        { error: 'Source profile not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Insert region ───────────────────────────────────────────────
    let region: { id: string };
    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO source_regions (
          profile_id, name, selector_hint, content_context,
          region_type, sample_html, sample_text
        ) VALUES (
          ${profileId}::uuid, ${name}, ${selectorHint},
          ${contentContext}, ${regionType}, ${sampleHtml}, ${sampleText}
        )
        RETURNING id
      `;
      region = rows[0];
    } catch (e) {
      console.error('[admin/sources/regions] insert failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── Emit event (non-fatal) ─────────────────────────────────────
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'source_region.created',
        actor: userActor(userId, (session.user as { email?: string }).email),
        payload: {
          correlationId: randomUUID(),
          sourceId: profileId,
          sourceName: profile.name,
          regionId: region.id,
          regionName: name,
        },
      });
    } catch (e) {
      console.error('[admin/sources/regions] event emission failed:', e);
      // non-fatal, continue
    }

    return NextResponse.json({ data: { id: region.id } }, { status: 201 });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/regions POST] error:', e);
    return NextResponse.json(
      { error: 'Failed to create region', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
