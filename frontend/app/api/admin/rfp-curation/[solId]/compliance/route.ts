/**
 * GET + POST /api/admin/rfp-curation/[solId]/compliance
 *
 * GET: Returns the full solicitation_compliance row for a solicitation.
 * POST: Saves a compliance variable value via the
 *       `compliance.save_variable_value` tool.
 *
 * GET returns:  { data: { compliance: {...} | null } }
 * POST returns: { data: { solicitationId, variableName, storedAs, action, verifiedAt, memoryWritten } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { invoke } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools';
import { createLogger } from '@/lib/logger';
import type { Role } from '@/lib/rbac';
import { emitEventSingle } from '@/lib/events';
import { randomUUID } from 'crypto';

const log = createLogger('rfp-curation');

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const rows = await sql`
      SELECT * FROM solicitation_compliance
      WHERE solicitation_id = ${solId}::uuid
    `;

    return NextResponse.json({ data: { compliance: rows[0] ?? null } });
  } catch (error) {
    console.error('[rfp-curation] GET compliance failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch compliance data', code: 'INTERNAL_ERROR' },
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
      email?: string;
      role?: Role;
      tenantId?: string | null;
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

    if (!body.variableName || typeof body.variableName !== 'string') {
      return NextResponse.json(
        { error: 'variableName is required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Build ToolContext ────────────────────────────────────────────
    const requestId = `req_${crypto.randomUUID().slice(0, 8)}`;
    const toolCtx: ToolContext = {
      actor: {
        type: 'user',
        id: user.id!,
        email: user.email,
        role: user.role,
      },
      tenantId: user.tenantId ?? null,
      requestId,
      log: log.child({ tool: 'compliance.save_variable_value', requestId }),
    };

    // ── Invoke tool ─────────────────────────────────────────────────
    const result = await invoke(
      'compliance.save_variable_value',
      {
        solicitationId: solId,
        variableName: body.variableName,
        value: body.value,
        sourceExcerpt: body.sourceExcerpt,
        notes: body.notes,
        action: body.action,
        anchor: body.anchor,
      },
      toolCtx,
    );

    await emitEventSingle({
      namespace: 'finder',
      type: 'compliance_value.saved',
      actor: { type: 'user', id: user.id! },
      tenantId: null,
      payload: { correlationId: randomUUID(), solicitationId: solId, variableName: body.variableName as string },
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    // Translate known AppError subclasses to proper HTTP responses
    if (error && typeof error === 'object' && 'httpStatus' in error) {
      const appErr = error as { httpStatus: number; message: string; code: string; details?: unknown };
      return NextResponse.json(
        { error: appErr.message, code: appErr.code, details: appErr.details },
        { status: appErr.httpStatus },
      );
    }
    console.error('[rfp-curation] POST compliance failed:', error);
    return NextResponse.json(
      { error: 'Failed to save compliance value', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
