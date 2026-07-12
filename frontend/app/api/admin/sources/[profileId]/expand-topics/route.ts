/**
 * POST /api/admin/sources/[profileId]/expand-topics — Enqueue topic expansion
 *
 * Admin trigger for the DSIP topic-URL expansion path (SCOUTING_SPINE
 * MILESTONE 3, contract C3.b). Inserts a high-priority pipeline_jobs row
 * with kind='expand_topics'. The pipeline dispatcher
 * (pipeline/src/ingest/dispatcher.py :: _run_expand_topics_job) picks it
 * up and runs ingest.topic_expander.expand_solicitation_topics, which
 * fetches + parses + upserts every topic of the solicitation from its
 * source (DSIP public API or per-topic URLs).
 *
 * Metadata keys are snake_case to match exactly what the dispatcher reads:
 *   solicitation_id (required), source_profile_id, topic_numbers,
 *   solicitation_number.
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
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const solicitationId =
      typeof body.solicitationId === 'string' ? body.solicitationId.trim() : '';
    if (!solicitationId || !UUID_RE.test(solicitationId)) {
      return NextResponse.json(
        { error: 'Valid solicitationId (UUID) is required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // topicNumbers? — optional array of non-empty strings
    let topicNumbers: string[] | undefined;
    if (body.topicNumbers !== undefined && body.topicNumbers !== null) {
      if (
        !Array.isArray(body.topicNumbers) ||
        !body.topicNumbers.every((t) => typeof t === 'string')
      ) {
        return NextResponse.json(
          { error: 'topicNumbers must be an array of strings', code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
      const cleaned = (body.topicNumbers as string[])
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      topicNumbers = cleaned.length > 0 ? cleaned : undefined;
    }

    // solicitationNumber? — optional string
    let solicitationNumber: string | undefined;
    if (body.solicitationNumber !== undefined && body.solicitationNumber !== null) {
      if (typeof body.solicitationNumber !== 'string') {
        return NextResponse.json(
          { error: 'solicitationNumber must be a string', code: 'VALIDATION_ERROR' },
          { status: 422 },
        );
      }
      const trimmed = body.solicitationNumber.trim();
      solicitationNumber = trimmed.length > 0 ? trimmed : undefined;
    }

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
      console.error('[admin/sources/expand-topics] profile lookup failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    if (!profile) {
      return NextResponse.json(
        { error: 'Source profile not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Verify solicitation exists ──────────────────────────────────
    // solicitation_number lives on opportunities, not curated_solicitations,
    // so join through the landing opportunity to recover it as a fallback.
    let sol: { id: string; solicitationNumber: string | null } | undefined;
    try {
      const rows = await sql<{ id: string; solicitationNumber: string | null }[]>`
        SELECT cs.id, o.solicitation_number AS "solicitationNumber"
        FROM curated_solicitations cs
        LEFT JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.id = ${solicitationId}::uuid
        LIMIT 1
      `;
      sol = rows[0];
    } catch (e) {
      console.error('[admin/sources/expand-topics] solicitation lookup failed:', e);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    if (!sol) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Fall back to the solicitation's own number when the caller omits it.
    const effectiveSolNumber = solicitationNumber ?? sol.solicitationNumber ?? undefined;

    // ── Start event ─────────────────────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'source.topics_expand_triggered',
      actor: userActor(userId, (session.user as { email?: string }).email),
      tenantId: null,
      payload: {
        sourceId: profileId,
        sourceName: profile.name,
        solicitationId,
        topicCount: topicNumbers?.length ?? null,
      },
    });

    // ── Enqueue expand_topics job ───────────────────────────────────
    // metadata snake_case keys mirror what the dispatcher's
    // _run_expand_topics_job reads (T3.2). priority=2 (high): above shred
    // (3) and scheduled cron (5), below manual ingest (1).
    const metadata: Record<string, unknown> = {
      solicitation_id: solicitationId,
      source_profile_id: profileId,
      triggered_by: userId,
    };
    if (topicNumbers) metadata.topic_numbers = topicNumbers;
    if (effectiveSolNumber) metadata.solicitation_number = effectiveSolNumber;

    let job: { id: string } | undefined;
    try {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO pipeline_jobs (source, kind, status, priority, metadata)
        VALUES (
          'system',
          'expand_topics',
          'pending',
          2,
          ${sql.json((metadata) as Parameters<typeof sql.json>[0])}
        )
        RETURNING id
      `;
      job = rows[0];
    } catch (e) {
      console.error('[admin/sources/expand-topics] job insert failed:', e);
      return NextResponse.json(
        { error: 'Failed to enqueue topic expansion job', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    // ── End event (non-fatal) ───────────────────────────────────────
    try {
      await emitEventEnd(startId, {
        result: { jobId: job.id, solicitationId, sourceId: profileId },
      });
    } catch (e) {
      console.error('[admin/sources/expand-topics] event end failed:', e);
      // non-fatal, continue
    }

    return NextResponse.json({ data: { jobId: job.id } }, { status: 201 });
  } catch (e) {
    console.error('[api/admin/sources/[profileId]/expand-topics POST] error:', e);
    return NextResponse.json(
      { error: 'Failed to enqueue topic expansion job', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
