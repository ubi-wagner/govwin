/**
 * GET /api/portal/[tenantSlug]/notifications — Notification feed for tenant user
 *
 * Returns notifications from system_events where the payload targets this
 * tenant or user. Supports pagination and marking as read.
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-10): Implement notification feed query.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

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

    // ── Parse query params ───────────────────────────────────────
    const url = new URL(request.url);
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '20', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 100);
    const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement notification feed
    //
    // Query system_events for notification-type events targeting this tenant:
    //
    // SELECT se.id, se.namespace, se.type, se.payload, se.created_at
    // FROM system_events se
    // WHERE se.namespace = 'system'
    //   AND se.type = 'notification.requested'
    //   AND (
    //     se.tenant_id = ${tenantId}::uuid
    //     OR se.payload->>'tenant_id' = ${tenantId}
    //     OR se.payload->>'user_id' = ${sessionUser.id}
    //   )
    // ORDER BY se.created_at DESC
    // LIMIT ${limit} OFFSET ${offset}
    //
    // For V2: add a dedicated notifications table with read/unread tracking
    // per user. For V1, all notifications for the tenant are shown.

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-10',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/notifications] error:', err);
    return NextResponse.json(
      { error: 'Failed to query notifications', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
