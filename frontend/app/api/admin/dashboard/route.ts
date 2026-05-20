/**
 * GET /api/admin/dashboard — Admin dashboard with real stats
 *
 * Returns: total tenants, active subscriptions, proposals by stage,
 * revenue (sum purchases), recent events, pipeline job stats.
 *
 * Auth: master_admin or rfp_admin.
 *
 * V1 TODO (P2-19): Implement real aggregation queries.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET() {
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
      role?: unknown;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement admin dashboard queries
    //
    // 1. Tenant counts:
    //    SELECT count(*)::int AS total,
    //           count(*) FILTER (WHERE status = 'active')::int AS active,
    //           count(*) FILTER (WHERE subscription_status = 'active')::int AS subscribed
    //    FROM tenants
    //
    // 2. Proposal counts by stage:
    //    SELECT stage, count(*)::int AS count FROM proposals GROUP BY stage
    //
    // 3. Revenue:
    //    SELECT sum(amount_cents)::bigint AS total_cents,
    //           count(*)::int AS purchase_count
    //    FROM purchases WHERE status = 'completed'
    //
    // 4. Recent events (last 20):
    //    SELECT id, namespace, type, phase, payload, created_at
    //    FROM system_events ORDER BY created_at DESC LIMIT 20
    //
    // 5. Pipeline stats:
    //    SELECT status, count(*)::int AS count FROM pipeline_jobs GROUP BY status
    //
    // Return { data: { tenants, proposals, revenue, recentEvents, pipeline } }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-19',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[admin/dashboard] error:', err);
    return NextResponse.json(
      { error: 'Dashboard query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
