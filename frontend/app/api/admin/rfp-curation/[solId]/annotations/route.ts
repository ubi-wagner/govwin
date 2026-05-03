/**
 * GET + POST /api/admin/rfp-curation/[solId]/annotations
 *
 * GET:  Lists all annotations for a solicitation from
 *       `solicitation_annotations`, ordered by creation time.
 * POST: Creates a new annotation (highlight, text box, or compliance tag).
 *
 * GET returns:  { data: { annotations: [...] } }
 * POST returns: { data: { annotation: {...} } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_KINDS = ['highlight', 'text_box', 'compliance_tag'] as const;

export async function GET(
  _request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: Role }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
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

    // ── Query ───────────────────────────────────────────────────────
    const annotations = await sql`
      SELECT * FROM solicitation_annotations
      WHERE solicitation_id = ${solId}::uuid
      ORDER BY created_at ASC
    `;

    return NextResponse.json({ data: { annotations } });
  } catch (error) {
    console.error('[rfp-curation] GET annotations failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch annotations', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const user = session.user as {
      id?: string;
      role?: Role;
    };
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

    // ── Parse body ──────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { kind, sourceLocation, payload, complianceVariableName } = body;

    if (typeof kind !== 'string' || !(VALID_KINDS as readonly string[]).includes(kind)) {
      return NextResponse.json(
        { error: `kind is required and must be one of: ${VALID_KINDS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (!sourceLocation || typeof sourceLocation !== 'object') {
      return NextResponse.json(
        { error: 'sourceLocation is required and must be an object', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (payload !== undefined && (typeof payload !== 'object' || payload === null)) {
      return NextResponse.json(
        { error: 'payload must be an object', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (complianceVariableName !== undefined && typeof complianceVariableName !== 'string') {
      return NextResponse.json(
        { error: 'complianceVariableName must be a string', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const actorId = user.id!;

    // ── Verify solicitation exists ──────────────────────────────────
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM curated_solicitations WHERE id = ${solId}::uuid
    `;
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Insert annotation ───────────────────────────────────────────
    const [annotation] = await sql`
      INSERT INTO solicitation_annotations
        (solicitation_id, actor_id, kind, source_location, payload, compliance_variable_name)
      VALUES
        (${solId}::uuid, ${actorId}::uuid, ${kind},
         ${JSON.stringify(sourceLocation)}::jsonb,
         ${JSON.stringify(payload ?? {})}::jsonb,
         ${typeof complianceVariableName === 'string' ? complianceVariableName : null})
      RETURNING *
    `;

    await emitEventSingle({
      namespace: 'finder',
      type: 'annotation.saved',
      actor: { type: 'user', id: actorId },
      tenantId: null,
      payload: { correlationId: randomUUID(), solicitationId: solId, annotationId: (annotation as { id: string }).id },
    });

    return NextResponse.json({ data: { annotation } });
  } catch (error) {
    console.error('[rfp-curation] POST annotation failed:', error);
    return NextResponse.json(
      { error: 'Failed to save annotation', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
