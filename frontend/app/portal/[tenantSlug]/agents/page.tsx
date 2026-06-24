import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { AgentUsagePanel } from '@/components/portal/agent-usage-panel';

export const dynamic = 'force-dynamic';

/**
 * Portal "AI Usage" — read-only aggregate AI activity for the tenant
 * (tenant_admin+). No pricing/token/dollar figures (RATE_MONITORING §7).
 * The layout already verified tenant access; this page adds the role gate.
 */
export default async function PortalAgentsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  // Usage view is for tenant admins; send others back to the dashboard.
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    redirect(`/portal/${tenantSlug}/dashboard`);
  }

  // Defense-in-depth: verify tenant access at the page layer too (matches the
  // sibling portal pages — don't rely solely on the layout's tenant check).
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenant.id as string);
  if (!hasAccess) redirect('/portal');

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">AI Usage</h1>
        <p className="text-sm text-gray-500 mt-1">
          Your team&apos;s AI activity and monthly allocation.
        </p>
      </header>
      <AgentUsagePanel tenantSlug={tenantSlug} />
    </div>
  );
}
