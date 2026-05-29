/**
 * PATCH /api/admin/sources/[profileId] — Update source profile settings
 *
 * Partial update of source_profiles fields: auto_crawl_enabled,
 * crawl_cron, admin_notes, visit_instructions.
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

    // ── Build update fields ─────────────────────────────────────────
    const updates: string[] = [];
    const values: Record<string, unknown> = {};

    if (typeof body.autoCrawlEnabled === 'boolean') {
      values.autoCrawlEnabled = body.autoCrawlEnabled;
    }

    if (typeof body.crawlCron === 'string') {
      values.crawlCron = body.crawlCron.trim();
    }

    if (typeof body.adminNotes === 'string') {
      values.adminNotes = body.adminNotes;
    }

    if (typeof body.visitInstructions === 'string') {
      values.visitInstructions = body.visitInstructions;
    }

    if (Object.keys(values).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Verify profile exists ───────────────────────────────────────
    let profile: { id: string; name: string } | undefined;
    try {
      const rows = await sql<{ id: string; name: string }[]>`
        SELECT id, name FROM source_profiles
        WHERE id = ${profileId}::uuid
        LIMIT 1
      `;
      profile = rows[0];
    } catch (e) {
      console.error('[admin/sources/profile] lookup query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json(
        { error: 'Source profile not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Start event ──────────────────────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'source.updated',
      actor: userActor(userId, (session.user as { email?: string }).email),
      payload: {
        sourceId: profileId,
        sourceName: profile.name,
        updatedFields: Object.keys(values),
      },
    });

    // ── Update ──────────────────────────────────────────────────────
    // Build dynamic update using postgres.js tagged template
    const autoCrawlVal = values.autoCrawlEnabled != null ? Boolean(values.autoCrawlEnabled) : null;
    const crawlCronVal = values.crawlCron != null ? String(values.crawlCron) : null;
    const adminNotesProvided = 'adminNotes' in values;
    const adminNotesVal = adminNotesProvided ? (values.adminNotes != null ? String(values.adminNotes) : null) : null;
    const visitInstructionsProvided = 'visitInstructions' in values;
    const visitInstructionsVal = visitInstructionsProvided ? (values.visitInstructions != null ? String(values.visitInstructions) : null) : null;

    try {
      await sql`
        UPDATE source_profiles SET
          auto_crawl_enabled = COALESCE(${autoCrawlVal}::boolean, auto_crawl_enabled),
          crawl_cron = COALESCE(${crawlCronVal}::text, crawl_cron),
          admin_notes = CASE WHEN ${adminNotesProvided}::boolean THEN ${adminNotesVal}::text ELSE admin_notes END,
          visit_instructions = CASE WHEN ${visitInstructionsProvided}::boolean THEN ${visitInstructionsVal}::text ELSE visit_instructions END,
          updated_at = now()
        WHERE id = ${profileId}::uuid
      `;
    } catch (e) {
      console.error('[admin/sources/profile] update query failed:', e);
      await emitEventEnd(startId, { error: { message: e instanceof Error ? e.message : String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventEnd(startId, {
      result: { sourceId: profileId, updatedFields: Object.keys(values) },
    });

    return NextResponse.json({ data: { updated: true } });
  } catch (e) {
    console.error('[api/admin/sources/[profileId] PATCH] error:', e);
    return NextResponse.json(
      { error: 'Failed to update source profile', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
