/**
 * POST /api/admin/rfp-curation/[solId]/assess-ingest
 *
 * Admin-agent Phase 1 producer. Requests an ADVISORY ingest-readiness assessment of a
 * curated solicitation: emits `finder.ingest.assessment_requested`, which triggers the
 * OnIngestAssessmentRequested workflow → the platform-scope `rfp_ingest_manager` agent
 * (docs/ADMIN_AGENT_DESIGN.md). The agent reads the ingest state (shred/extract →
 * compliance matrix → skeleton), infers the pipeline stage, and produces a coordination
 * plan (which specialist agents to run next) — advisory only, never mutates.
 *
 * Auth: rfp_admin or master_admin (platform/our-org op — no tenant scope).
 * Returns: { data: { solicitationId, requested: true } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, routeCtx: RouteContext) {
  try {
    // ── Auth: rfp_admin / master_admin only (platform-scope op) ──────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const user = session.user as { id?: string; email?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Verify the solicitation exists (never emit for a phantom id) ──
    let existing: { id: string }[];
    try {
      existing = await sql<{ id: string }[]>`
        SELECT id FROM curated_solicitations WHERE id = ${solId}::uuid
      `;
    } catch (dbErr) {
      console.error('[rfp-curation] assess-ingest fetch failed:', dbErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Emit the trigger (start/end). The workflow reads payload.solicitationId
    //    off the END event, so it is carried in the emitEventEnd result. ──
    let startId: string;
    try {
      startId = await emitEventStart({
        namespace: 'finder',
        type: 'ingest.assessment_requested',
        actor: userActor(user.id!, user.email),
        payload: { solicitationId: solId },
      });
    } catch (evtErr) {
      console.error('[rfp-curation] assess-ingest emitEventStart failed:', evtErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    try {
      await emitEventEnd(startId, {
        result: { solicitationId: solId, requested: true },
      });
    } catch (evtErr) {
      console.error('[rfp-curation] assess-ingest emitEventEnd failed:', evtErr);
      // The start row is emitted; the end failing is non-fatal to the caller.
    }

    return NextResponse.json({ data: { solicitationId: solId, requested: true } });
  } catch (error) {
    console.error('[rfp-curation] assess-ingest failed:', error);
    return NextResponse.json(
      { error: 'Failed to request ingest assessment', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
