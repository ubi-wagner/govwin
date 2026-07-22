/**
 * GET /api/admin/agents/workforce (#117) — RFP-admin oversight of the agent workforce.
 *
 * Per-archetype live stats from agent_task_queue (pending / running / done / failed +
 * last run + last error), keyed by agent_role, plus a per-tenant rollup. The frontend
 * merges these with the static roster (scope, trigger, status) so an RFP admin can see, at
 * a glance, which agents are working, backed up, or erroring — the oversight surface for
 * tuning decisions.
 *
 * BRIDGE INVARIANT: this conveys USAGE metadata forward only (counts/status/timing) — never
 * tenant content. Tenant data stays in the tenant (the forward-only bridge); to inspect an
 * agent's actual output for a company, the admin descends into its RLS space (shadow).
 * Control + usage is bidirectional; tenant data is not. Only aggregate counts are selected.
 *
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET() {
  try {
    const session = await auth();
    const u = session?.user as { id?: string; role?: unknown } | undefined;
    const role: Role | null = isRole(u?.role) ? (u!.role as Role) : null;
    if (!u?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let rows: Array<{ agentRole: string; pending: number; running: number; done: number; failed: number; lastRun: string | null }>;
    try {
      rows = await sql<Array<{ agentRole: string; pending: number; running: number; done: number; failed: number; lastRun: string | null }>>`
        SELECT
          agent_role AS "agentRole",
          COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending,
          COUNT(*) FILTER (WHERE status = 'running')::int   AS running,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS done,
          COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed,
          MAX(COALESCE(completed_at, picked_at, created_at)) AS "lastRun"
        FROM agent_task_queue
        WHERE created_at > now() - interval '30 days'
        GROUP BY agent_role
      `;
    } catch (e) {
      console.error('[admin/agents/workforce] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    const byRole: Record<string, unknown> = {};
    for (const r of rows) byRole[r.agentRole] = r;

    // Per-tenant rollup — the RFP admin oversees every tenant, so usage rolls up by
    // company (which customers are working the agents, how hard, and any failures).
    let byTenant: Array<Record<string, unknown>> = [];
    try {
      byTenant = await sql<Array<Record<string, unknown>>>`
        SELECT aq.tenant_id AS "tenantId", t.name AS tenant,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE aq.status = 'completed')::int AS done,
               COUNT(*) FILTER (WHERE aq.status = 'failed')::int AS failed,
               COUNT(*) FILTER (WHERE aq.status IN ('pending','running'))::int AS active,
               COUNT(DISTINCT aq.agent_role)::int AS agents,
               MAX(COALESCE(aq.completed_at, aq.picked_at, aq.created_at)) AS "lastRun"
        FROM agent_task_queue aq
        JOIN tenants t ON t.id = aq.tenant_id
        WHERE aq.created_at > now() - interval '30 days'
        GROUP BY aq.tenant_id, t.name
        ORDER BY total DESC
        LIMIT 100
      `;
    } catch (e) {
      console.error('[admin/agents/workforce] byTenant query failed:', e);
    }

    return NextResponse.json({ data: { stats: byRole, byTenant } });
  } catch (e) {
    console.error('[admin/agents/workforce] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
