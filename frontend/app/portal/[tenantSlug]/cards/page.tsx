import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import PipelineCards from '@/components/portal/pipeline-cards';

export const dynamic = 'force-dynamic';

/** Greenfield opportunity pipeline — the tenant's denormalized cards (mig 094). */
export default async function CardsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  if (!(await verifyTenantAccess(su.id, role, tenant.id as string))) redirect('/portal');
  if (!hasRoleAtLeast(role, 'tenant_user')) redirect(`/portal/${tenantSlug}/proposals`);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Opportunity Pipeline</h1>
        <p className="text-gray-500 mt-1 text-sm">Your live opportunity cards — pin to pull the docs local; ranked by your spotlight buckets.</p>
      </div>
      <PipelineCards tenantSlug={tenantSlug} role={role} />
    </div>
  );
}
