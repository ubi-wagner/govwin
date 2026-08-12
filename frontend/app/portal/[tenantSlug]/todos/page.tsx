/**
 * Portal To-dos page — a direct ToDo surface for EVERY tenant role, including partner_user
 * (HITL G4). tenant_user+ also have the cockpit drawer; partner_user (a per-proposal collaborator,
 * redirected off the cockpit) previously had NO way to see their own ToDos — this is it. Mounts the
 * same TaskQueue; the route it calls (/api/portal/[slug]/tasks) scopes each actor to their own
 * hierarchical bucket + own-id tasks in this tenant.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { TaskQueue } from '@/components/tasks/task-queue';

export const dynamic = 'force-dynamic';

export default async function TodosPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id || !hasRoleAtLeast(role, 'partner_user')) redirect('/portal');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const ok = await verifyTenantAccess(u.id, role, tenant.id as string);
  if (!ok) redirect('/portal');

  return (
    <div className="max-w-2xl p-4">
      <TaskQueue apiBase={`/api/portal/${tenantSlug}/tasks`} tenantSlug={tenantSlug} />
    </div>
  );
}
