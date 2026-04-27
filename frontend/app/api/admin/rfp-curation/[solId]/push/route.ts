/**
 * POST /api/admin/rfp-curation/[solId]/push
 *
 * Pushes an approved solicitation live to the customer-visible
 * opportunity pool. Delegates to the `solicitation.push` tool via
 * the registry, which validates required compliance variables,
 * flips the state, and writes a HITL memory snapshot.
 *
 * Returns: { data: { solicitationId, status, opportunityId, namespace, pushedAt } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { invoke } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools';
import { createLogger } from '@/lib/logger';
import type { Role } from '@/lib/rbac';

const log = createLogger('rfp-curation');

interface RouteContext {
  params: Promise<{ solId: string }>;
}

export async function POST(
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

    // ── Validate UUID format ────────────────────────────────────────
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
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
      log: log.child({ tool: 'solicitation.push', requestId }),
    };

    // ── Invoke tool ─────────────────────────────────────────────────
    const result = await invoke('solicitation.push', { solicitationId: solId }, toolCtx);

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
    console.error('[rfp-curation] push failed:', error);
    return NextResponse.json(
      { error: 'Failed to push solicitation', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
