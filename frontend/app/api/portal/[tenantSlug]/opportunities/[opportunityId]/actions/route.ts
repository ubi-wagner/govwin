/**
 * POST /api/portal/[tenantSlug]/opportunities/[opportunityId]/actions
 *
 * Opportunity actions: pin/unpin, thumb_up/thumb_down, pursue.
 * Updates tenant_pipeline_items with user preferences.
 *
 * Body: { action: 'pin' | 'unpin' | 'thumb_up' | 'thumb_down' | 'pursue' }
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-03): Implement the action handlers below.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; opportunityId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, opportunityId } = await ctx.params;

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

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Tenant lookup + access ───────────────────────────────────
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

    // ── Input validation ─────────────────────────────────────────
    let body: { action?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const { action } = body;
    const validActions = ['pin', 'unpin', 'thumb_up', 'thumb_down', 'pursue'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${validActions.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement opportunity actions
    //
    // 1. Verify opportunity exists in tenant_pipeline_items:
    //    SELECT id FROM tenant_pipeline_items
    //    WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
    //
    // 2. Execute action:
    //    pin/unpin:     UPDATE tenant_pipeline_items SET is_pinned = true/false
    //    thumb_up/down: UPDATE tenant_pipeline_items SET thumb_direction = 'up'/'down'
    //    pursue:        INSERT INTO proposals (tenant_id, opportunity_id, title, stage)
    //                   VALUES (..., 'draft') — or redirect to purchase flow
    //
    // 3. Emit capture event:
    //    await emitEventSingle({
    //      namespace: 'capture',
    //      type: `opportunity.${action}`,
    //      actor: userActor(sessionUser.id, sessionUser.email),
    //      tenantId,
    //      payload: { opportunityId, action },
    //    });

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-03',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/opportunities/actions] error:', err);
    return NextResponse.json(
      { error: 'Action failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
