/**
 * GET /api/portal/[tenantSlug]/notifications — Notification feed for tenant user
 *
 * Returns notifications derived from system_events where the tenant_id matches
 * and namespace is in the customer-visible set. Supports pagination.
 *
 * Auth: tenant_user or above with tenant access.
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
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 100);
    const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    // ── Business logic ───────────────────────────────────────────
    try {
      const notifications = await sql<{
        id: string;
        type: string;
        namespace: string;
        payload: Record<string, unknown>;
        createdAt: string;
      }[]>`
        SELECT id, type, namespace, payload, created_at
        FROM system_events
        WHERE tenant_id = ${tenantId}::uuid
          AND namespace IN ('proposal', 'capture', 'library')
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const items = notifications.map((n) => ({
        id: n.id,
        type: n.type,
        namespace: n.namespace,
        title: (n.payload as Record<string, unknown>)?.title ?? n.type,
        summary: (n.payload as Record<string, unknown>)?.summary ?? null,
        created_at: n.createdAt,
        is_read: false, // V1: no per-user read tracking; all shown as unread
      }));

      return NextResponse.json({ data: { notifications: items } });
    } catch (dbErr) {
      console.error('[portal/notifications] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to query notifications', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/notifications] error:', err);
    return NextResponse.json(
      { error: 'Failed to query notifications', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
