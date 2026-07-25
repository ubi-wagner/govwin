/**
 * GET /api/admin/dashboard — Admin dashboard with real stats
 *
 * Returns: total tenants, active subscriptions, proposals by stage,
 * revenue (sum purchases), recent events, pipeline job stats.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
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
    try {
      // 1. Tenant counts
      const [tenantStats] = await sql<{
        total: string;
        active: string;
        subscribed: string;
      }[]>`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE status = 'active')::text AS active,
          count(*) FILTER (WHERE subscription_status = 'active')::text AS subscribed
        FROM tenants
      `;

      // 2. Proposal counts by stage
      const proposalsByStage = await sql<{ stage: string; count: string }[]>`
        SELECT stage, count(*)::text AS count
        FROM proposals
        GROUP BY stage
      `;

      // Total proposals
      const totalProposals = proposalsByStage.reduce(
        (sum, row) => sum + parseInt(row.count, 10),
        0,
      );

      // 3. Total solicitations
      const [solicitationStats] = await sql<{ total: string }[]>`
        SELECT count(*)::text AS total FROM curated_solicitations
      `;

      // 4. Revenue
      const [revenueStats] = await sql<{
        totalCents: string | null;
        purchaseCount: string;
      }[]>`
        SELECT
          sum(amount_cents)::text AS total_cents,
          count(*)::text AS purchase_count
        FROM purchases
        WHERE status = 'completed'
      `;

      // 5. Recent events (top 10)
      const recentEvents = await sql`
        SELECT id, namespace, type, phase, actor_type, actor_id,
               tenant_id, payload, created_at
        FROM system_events
        ORDER BY created_at DESC
        LIMIT 10
      `;

      // 6. Pipeline job stats
      const pipelineStats = await sql<{ status: string; count: string }[]>`
        SELECT status, count(*)::text AS count
        FROM pipeline_jobs
        GROUP BY status
      `;

      return NextResponse.json({
        data: {
          tenants: {
            total: parseInt(tenantStats.total, 10),
            active: parseInt(tenantStats.active, 10),
            subscribed: parseInt(tenantStats.subscribed, 10),
          },
          proposals: {
            total: totalProposals,
            by_stage: Object.fromEntries(
              proposalsByStage.map((r) => [r.stage, parseInt(r.count, 10)]),
            ),
          },
          solicitations: {
            total: parseInt(solicitationStats.total, 10),
          },
          revenue: {
            total_cents: parseInt(revenueStats.totalCents ?? '0', 10),
            purchase_count: parseInt(revenueStats.purchaseCount, 10),
          },
          recent_events: recentEvents,
          pipeline: Object.fromEntries(
            pipelineStats.map((r) => [r.status, parseInt(r.count, 10)]),
          ),
        },
      });
    } catch (dbErr) {
      console.error('[admin/dashboard] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Dashboard query failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[admin/dashboard] error:', err);
    return NextResponse.json(
      { error: 'Dashboard query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
