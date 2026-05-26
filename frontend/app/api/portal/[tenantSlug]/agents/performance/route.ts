/**
 * GET /api/portal/[tenantSlug]/agents/performance — Agent performance metrics
 *
 * Returns aggregate metrics from agent_task_queue for this tenant:
 * task count by status, average duration, success rate per agent role.
 *
 * Auth: tenant_admin or above with tenant access.
 *
 * V1 TODO (P2-17): Implement agent performance metrics.
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

    let metrics;
    try {
      metrics = await sql`
        SELECT agent_role,
               count(*)::int AS total_tasks,
               count(*) FILTER (WHERE status = 'completed')::int AS completed,
               count(*) FILTER (WHERE status = 'failed')::int AS failed,
               coalesce(avg(EXTRACT(EPOCH FROM (completed_at - created_at)))::int, 0) AS avg_duration_seconds,
               coalesce(round(count(*) FILTER (WHERE status = 'completed')::numeric /
                     NULLIF(count(*), 0) * 100, 1), 0) AS success_rate
        FROM agent_task_queue
        WHERE tenant_id = ${tenantId}::uuid
        GROUP BY agent_role
        ORDER BY total_tasks DESC
      `;
    } catch (dbErr) {
      console.error('[portal/agents/performance] metrics query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { metrics } });
  } catch (err) {
    console.error('[portal/agents/performance] error:', err);
    return NextResponse.json(
      { error: 'Failed to query agent performance', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
