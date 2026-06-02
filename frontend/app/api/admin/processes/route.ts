/**
 * GET /api/admin/processes — cross-tenant process ledger (rfp_admin+).
 *
 * Returns active process_instances across ALL tenants with the tenant name and
 * an open-task count, for the admin "filter and view any or all tenants'
 * processes" ledger (#5). Read-only; force-advance reuses the existing
 * /api/admin/workflows/[id]/advance endpoint.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const rows = await sql<{
      id: string;
      workflowName: string;
      status: string;
      currentStep: string | null;
      deadline: string | null;
      lastHeartbeatAt: string | null;
      lastError: string | null;
      lastErrorStep: string | null;
      updatedAt: string | null;
      tenantId: string | null;
      tenantName: string | null;
      openTasks: number;
    }[]>`
      SELECT pi.id, pi.workflow_name, pi.status, pi.current_step,
             pi.deadline, pi.last_heartbeat_at, pi.last_error, pi.last_error_step,
             pi.updated_at, pi.tenant_id, t.name AS tenant_name,
             COALESCE(tk.open_tasks, 0)::int AS open_tasks
      FROM process_instances pi
      LEFT JOIN tenants t ON t.id = pi.tenant_id
      LEFT JOIN (
        SELECT process_instance_id, count(*) AS open_tasks
        FROM tasks WHERE status IN ('open', 'in_progress')
        GROUP BY process_instance_id
      ) tk ON tk.process_instance_id = pi.id
      WHERE pi.status IN ('running', 'paused', 'pending', 'retrying')
      ORDER BY pi.updated_at DESC
      LIMIT 300
    `;

    return NextResponse.json({ data: { processes: rows } });
  } catch (err) {
    console.error('[admin/processes GET] error:', err);
    return NextResponse.json({ error: 'Failed to load processes', code: 'DB_ERROR' }, { status: 500 });
  }
}
