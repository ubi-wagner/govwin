/**
 * POST /api/admin/workflows/[instanceId]/advance
 *
 * Force-advance a paused (HITL-waiting) process: the admin acts as the human
 * the workflow was waiting for, marking the parked step complete so the engine
 * continues. Body (optional): { note?: string }.
 *
 * Auth: rfp_admin or above. (The customer-admin path is a future portal route
 * that reuses forceAdvanceProcess with the operator's tenant — canForceAdvance
 * Instance enforces own-tenant scope there. It is intentionally not exposed
 * here.)
 *
 * Returns: { data: { instanceId, resumedStep } } on success.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { forceAdvanceProcess } from '@/lib/process/force-advance';

interface RouteContext {
  params: Promise<{ instanceId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    if (!hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Params + body ─────────────────────────────────────────────
    const { instanceId } = await ctx.params;
    if (!instanceId || !UUID_RE.test(instanceId)) {
      return NextResponse.json(
        { error: 'Invalid instanceId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let note: string | undefined;
    try {
      const body = (await request.json()) as { note?: unknown };
      if (body && typeof body.note === 'string') {
        note = body.note.slice(0, 1000);
      }
    } catch {
      // body is optional
    }

    // ── Force-advance via the shared core ─────────────────────────
    const result = await forceAdvanceProcess({
      instanceId,
      actor: {
        id: sessionUser.id,
        email: sessionUser.email ?? null,
        role,
        tenantId: sessionUser.tenantId ?? null,
      },
      note,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json({ data: result.data });
  } catch (err) {
    console.error('[admin/workflows/[instanceId]/advance] error:', err);
    return NextResponse.json(
      { error: 'Force-advance failed', code: 'ADVANCE_ERROR' },
      { status: 500 },
    );
  }
}
