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

    // 1. Verify opportunity exists in tenant_pipeline_items
    let items: { id: string }[];
    try {
      items = await sql<{ id: string }[]>`
        SELECT id FROM tenant_pipeline_items
        WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
      `;
    } catch (dbErr) {
      console.error('[portal/opportunities/actions] pipeline query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Opportunity not found in pipeline', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // 2. Execute action
    try {
      if (action === 'pin') {
        await sql`
          UPDATE tenant_pipeline_items
          SET pursuit_status = 'monitoring', is_pinned = true
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        `;
      } else if (action === 'unpin') {
        await sql`
          UPDATE tenant_pipeline_items
          SET is_pinned = false
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        `;
      } else if (action === 'thumb_up') {
        await sql`
          UPDATE tenant_pipeline_items
          SET recommendation = 'positive'
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        `;
      } else if (action === 'thumb_down') {
        await sql`
          UPDATE tenant_pipeline_items
          SET recommendation = 'negative'
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        `;
      } else if (action === 'pursue') {
        return NextResponse.json({
          data: {
            message: 'To pursue this opportunity, use the proposal creation endpoint: POST /api/portal/{tenantSlug}/proposals/create',
            opportunityId,
          },
        });
      }
    } catch (dbErr) {
      console.error('[portal/opportunities/actions] update failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // 3. Emit capture event
    const actionToPastTense: Record<string, string> = {
      pin: 'pinned',
      unpin: 'unpinned',
      thumb_up: 'thumbed_up',
      thumb_down: 'thumbed_down',
      pursue: 'pursued',
    };
    try {
      await emitEventSingle({
        namespace: 'capture',
        type: `opportunity.${actionToPastTense[action] ?? action}`,
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: { opportunityId, action },
      });
    } catch (evtErr) {
      console.error('[portal/opportunities/actions] event emission failed:', evtErr);
    }

    return NextResponse.json({ data: { opportunityId, action, success: true } });
  } catch (err) {
    console.error('[portal/opportunities/actions] error:', err);
    return NextResponse.json(
      { error: 'Action failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
