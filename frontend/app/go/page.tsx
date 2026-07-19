import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

/**
 * /go?task=<id> — the in-between landing page (W-N/O). Nudge emails link here.
 * If the visitor isn't signed in, NextAuth bounces them to /login and back; once
 * authed, we resolve the task's entity + tenant and route them straight to it
 * (e.g. the proposal workspace) so the email lands them ON the work, not a generic
 * dashboard. We only use the task to find WHERE to send them; access to the
 * destination is enforced by the destination page (tenant access checked here).
 */
export default async function GoPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; tenant?: string }>;
}) {
  const { task: taskId, tenant: tenantParam } = await searchParams;

  const session = await auth();
  if (!session?.user) {
    const cb = taskId
      ? `/go?task=${encodeURIComponent(taskId)}`
      : tenantParam
        ? `/go?tenant=${encodeURIComponent(tenantParam)}`
        : '/portal';
    redirect(`/login?callbackUrl=${encodeURIComponent(cb)}`);
  }
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) redirect('/login?error=session');

  // Route a non-admin through /api/enter to PIN the target company, so a
  // multi-membership recipient lands DIRECTLY in that company's queue instead of the
  // picker. Admins go straight (they shadow). See MULTI_MEMBERSHIP_IDENTITY_DESIGN.
  const enter = (slug: string, dest: string) =>
    hasRoleAtLeastAdmin(role)
      ? dest
      : `/api/enter?slug=${encodeURIComponent(slug)}&next=${encodeURIComponent(dest)}`;

  // Company-queue deep link (no task): land on that company's dashboard — the queue
  // (ToDos + notifications). Nudge emails that aren't tied to one task use this.
  if (tenantParam && !taskId) {
    const slug = tenantParam.trim();
    if (slug) redirect(enter(slug, `/portal/${slug}/dashboard`));
    redirect('/portal');
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!taskId || !UUID_RE.test(taskId)) redirect('/portal');

  let row:
    | { entityType: string | null; entityId: string | null; tenantId: string | null; slug: string | null }
    | undefined;
  try {
    [row] = await sql<
      { entityType: string | null; entityId: string | null; tenantId: string | null; slug: string | null }[]
    >`
      SELECT t.entity_type, t.entity_id, t.tenant_id, tn.slug
      FROM tasks t
      LEFT JOIN tenants tn ON tn.id = t.tenant_id
      WHERE t.id = ${taskId}::uuid
      LIMIT 1
    `;
  } catch (e) {
    console.error('[go] task lookup failed:', e);
    redirect('/portal');
  }

  // Unknown task → send them to their home rather than erroring.
  if (!row) redirect(hasRoleAtLeastAdmin(role) ? '/admin' : '/portal');

  // Admin-scoped task (no tenant) → the admin task queue.
  if (!row.tenantId || !row.slug) {
    redirect(hasRoleAtLeastAdmin(role) ? '/admin/tasks' : '/portal');
  }

  // Must have access to the destination tenant; otherwise their own home.
  const hasAccess = await verifyTenantAccess(u.id, role, row.tenantId);
  if (!hasAccess) redirect('/portal');

  if (row.entityType === 'proposal' && row.entityId) {
    redirect(enter(row.slug, `/portal/${row.slug}/proposals/${row.entityId}`));
  }
  // No specific entity → the company's queue (the dashboard surfaces ToDos + notifications).
  redirect(enter(row.slug, `/portal/${row.slug}/dashboard`));
}

function hasRoleAtLeastAdmin(role: Role): boolean {
  return role === 'master_admin' || role === 'rfp_admin';
}
