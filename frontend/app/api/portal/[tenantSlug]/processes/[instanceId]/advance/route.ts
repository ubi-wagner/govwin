/**
 * POST /api/portal/[tenantSlug]/processes/[instanceId]/advance
 *
 * Tenant-side force-advance of a paused (HITL-waiting) process: a tenant_admin
 * overrides a parked gate for THEIR OWN tenant — "move to next gate", "mark
 * complete", etc. Body (optional): { note?: string }.
 *
 * Auth: tenant_admin or above, WITH access to this tenant. Tenant scoping is
 * enforced twice: verifyTenantAccess (user ↔ tenant) and forceAdvanceProcess's
 * canForceAdvanceInstance (instance ↔ tenant). Returns { data: { instanceId,
 * resumedStep } }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { forceAdvanceProcess } from '@/lib/process/force-advance';

interface RouteContext {
  params: Promise<{ tenantSlug: string; instanceId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, instanceId } = await ctx.params;

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    // Overriding a human gate is a tenant_admin (or above) action.
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Tenant admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    if (!instanceId || !UUID_RE.test(instanceId)) {
      return NextResponse.json(
        { error: 'Invalid instanceId format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let note: string | undefined;
    try {
      const body = (await request.json()) as { note?: unknown };
      if (body && typeof body.note === 'string') note = body.note.slice(0, 1000);
    } catch {
      // body optional
    }

    const result = await forceAdvanceProcess({
      instanceId,
      actor: {
        id: sessionUser.id,
        email: sessionUser.email ?? null,
        role,
        // Scope to THIS tenant: canForceAdvanceInstance requires
        // actor.tenantId === instance.tenantId for a tenant_admin.
        tenantId,
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
    console.error('[portal/processes/advance] error:', err);
    return NextResponse.json(
      { error: 'Force-advance failed', code: 'ADVANCE_ERROR' },
      { status: 500 },
    );
  }
}
