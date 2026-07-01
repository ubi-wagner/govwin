import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import SpotlightBuckets from '@/components/portal/spotlight-buckets';

export const dynamic = 'force-dynamic';

/** Greenfield spotlight buckets — customer-defined ranking lenses (mig 096). */
export default async function BucketsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
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
        <h1 className="text-2xl font-bold">Spotlight Buckets</h1>
        <p className="text-gray-500 mt-1 text-sm">Your ranking lenses — each ranks the whole pipeline by the criteria you set.</p>
      </div>
      <SpotlightBuckets tenantSlug={tenantSlug} canEdit={hasRoleAtLeast(role, 'tenant_admin')} />
    </div>
  );
}
