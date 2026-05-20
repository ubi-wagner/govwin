/**
 * GET /api/portal/[tenantSlug]/purchases — Tenant purchase history
 *
 * Returns purchases for tenant: product_type, amount, status, created_at.
 * Joins with proposals for proposal title.
 *
 * Auth: tenant_admin or above with tenant access.
 *
 * V1 TODO (P2-08): Implement purchase history query.
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

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
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
    // TODO: Implement purchase history query
    //
    // SELECT pu.id, pu.product_type, pu.amount_cents, pu.status,
    //        pu.stripe_session_id, pu.created_at,
    //        p.title AS proposal_title,
    //        o.title AS opportunity_title
    // FROM purchases pu
    // LEFT JOIN proposals p ON p.id = pu.proposal_id
    // LEFT JOIN opportunities o ON o.id = pu.opportunity_id
    // WHERE pu.tenant_id = ${tenantId}::uuid
    // ORDER BY pu.created_at DESC
    // LIMIT 50

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-08',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/purchases] error:', err);
    return NextResponse.json(
      { error: 'Failed to query purchases', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
