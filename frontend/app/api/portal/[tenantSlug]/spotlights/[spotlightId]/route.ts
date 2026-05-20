/**
 * GET   /api/portal/[tenantSlug]/spotlights/[spotlightId] — Spotlight detail with scored items
 * PATCH /api/portal/[tenantSlug]/spotlights/[spotlightId] — Update spotlight filters/name
 *
 * Auth: tenant_user (GET) or tenant_admin (PATCH) with tenant access.
 *
 * V1 TODO (P2-07): Implement spotlight detail and update.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string; spotlightId: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, spotlightId } = await ctx.params;

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

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement spotlight detail
    //
    // 1. Fetch spotlight + verify it belongs to this tenant:
    //    SELECT * FROM spotlights WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid
    //
    // 2. Fetch scored items matching spotlight filters:
    //    SELECT o.*, tpi.score, tpi.is_pinned, tpi.thumb_direction
    //    FROM tenant_pipeline_items tpi
    //    JOIN opportunities o ON o.id = tpi.opportunity_id
    //    WHERE tpi.tenant_id = ${tenantId}::uuid
    //      AND <apply spotlight.filters against o columns>
    //    ORDER BY tpi.score DESC
    //    LIMIT 50

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-07',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/spotlights/detail] error:', err);
    return NextResponse.json(
      { error: 'Failed to query spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, spotlightId } = await ctx.params;

    // ── Auth (tenant_admin required for updates) ─────────────────
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
    if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'tenant_admin')) {
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

    // TODO: Parse body, update spotlight name/filters
    // UPDATE spotlights SET name = ..., filters = ..., updated_at = now()
    // WHERE id = ${spotlightId}::uuid AND tenant_id = ${tenantId}::uuid

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-07',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/spotlights/update] error:', err);
    return NextResponse.json(
      { error: 'Failed to update spotlight', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
