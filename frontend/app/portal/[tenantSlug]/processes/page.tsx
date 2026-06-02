/**
 * Tenant Process Ledger — portal/<slug>/processes
 *
 * Monitoring + action surface for this tenant's automation processes
 * (process_instances). Sortable card ledger with stall/fail indicators; a
 * tenant_admin can override a parked HITL gate ("move to next gate") here.
 *
 * View: tenant_user and above. Override action: tenant_admin (enforced again in
 * the advance route + forceAdvanceProcess). Load failures are surfaced as an
 * error (not silently rendered as "no processes").
 */
import { redirect } from 'next/navigation';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { ProcessesClient, type ProcessRow } from './processes-client';

export const dynamic = 'force-dynamic';

export default async function ProcessesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');
  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');

  const canAdvance = hasRoleAtLeast(role, 'tenant_admin');

  let rows: ProcessRow[] | null = null;
  try {
    rows = await sql<ProcessRow[]>`
      SELECT id, workflow_name, status, current_step, step_status,
             deadline, last_heartbeat_at, last_error, last_error_step,
             started_at, updated_at, created_at
      FROM process_instances
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY updated_at DESC
      LIMIT 100
    `;
  } catch (e) {
    console.error('[portal/processes] query failed:', e);
    rows = null; // distinct from [] — surfaced as a load error, not "empty"
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Processes</h1>
        <p className="text-sm text-gray-500">
          Automation running for your workspace. Items needing attention are
          flagged; an admin can move a waiting step to its next gate.
        </p>
      </div>
      <ProcessesClient
        rows={rows ?? []}
        loadError={rows === null}
        canAdvance={canAdvance}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
