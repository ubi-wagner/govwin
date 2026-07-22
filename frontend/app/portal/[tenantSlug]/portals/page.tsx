import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import ProposalPortals from '@/components/portal/proposal-portals';

export const dynamic = 'force-dynamic';

/** Greenfield proposal portals — per-opp builds w/ guardrails + shadow admin (mig 097/098). */
export default async function PortalsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  if (!(await verifyTenantAccess(su.id, role, tenant.id as string))) redirect('/portal');
  // Purchase/build management — delegated authority, tenant_admin only.
  if (!hasRoleAtLeast(role, 'tenant_admin')) redirect(`/portal/${tenantSlug}/proposals`);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Proposal Portals</h1>
        <p className="text-gray-500 mt-1 text-sm">Each portal is a build for an opportunity — accept guardrails to launch, then run the stages to closeout.</p>
      </div>
      <ProposalPortals tenantSlug={tenantSlug} canManage={hasRoleAtLeast(role, 'tenant_admin')} isExpert={hasRoleAtLeast(role, 'rfp_admin')} />
    </div>
  );
}
