/**
 * GET /api/portal/[tenantSlug]/dashboard
 *
 * Returns tenant dashboard stats: proposal counts by stage, recent activity,
 * library unit count, upcoming deadlines, and subscription status.
 *
 * Auth: tenant_user or above with tenant access.
 *
 * V1 TODO (P2-01): Implement the SQL queries below.
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

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement dashboard queries
    //
    // 1. Proposal counts by stage:
    //    SELECT stage, count(*)::int AS count
    //    FROM proposals WHERE tenant_id = ${tenantId}::uuid
    //    GROUP BY stage
    //
    // 2. Recent activity (last 10 events for this tenant):
    //    SELECT id, namespace, type, payload, created_at
    //    FROM system_events
    //    WHERE tenant_id = ${tenantId}::uuid
    //    ORDER BY created_at DESC LIMIT 10
    //
    // 3. Library unit count:
    //    SELECT count(*)::int AS count
    //    FROM library_units WHERE tenant_id = ${tenantId}::uuid
    //
    // 4. Upcoming deadlines (opportunities with close_date in next 30 days):
    //    SELECT o.title, o.close_date, o.agency
    //    FROM opportunities o
    //    JOIN tenant_pipeline_items tpi ON tpi.opportunity_id = o.id
    //    WHERE tpi.tenant_id = ${tenantId}::uuid
    //      AND o.close_date > now()
    //      AND o.close_date < now() + interval '30 days'
    //    ORDER BY o.close_date ASC LIMIT 5
    //
    // 5. Subscription status from tenant row

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-01',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/dashboard] error:', err);
    return NextResponse.json(
      { error: 'Dashboard query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
