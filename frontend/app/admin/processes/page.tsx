/**
 * Admin cross-tenant process ledger — /admin/processes
 *
 * "A list across multiple rows that is just a filter and view of any or all of
 * the tenants' active processes" (#5). Reuses the SAME health classifier as the
 * tenant ledger (lib/process/health.ts) so stalled/failing badges are identical
 * across the admin and customer views. Force-advance reuses the admin endpoint.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { AdminProcessesClient, type AdminProcessRow } from './admin-processes-client';

export const dynamic = 'force-dynamic';

export default async function AdminProcessesPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const u = session.user as { role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/');

  let rows: AdminProcessRow[] | null = null;
  try {
    rows = await sql<AdminProcessRow[]>`
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
        AND pi.archived_at IS NULL
      ORDER BY pi.updated_at DESC
      LIMIT 300
    `;
  } catch (e) {
    console.error('[admin/processes] query failed:', e);
    rows = null;
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Processes</h1>
        <p className="text-sm text-gray-500">
          Active automation across all tenants. Filter by tenant or health;
          problems are surfaced first. Advance a waiting gate inline.
        </p>
      </div>
      <AdminProcessesClient rows={rows ?? []} loadError={rows === null} />
    </div>
  );
}
