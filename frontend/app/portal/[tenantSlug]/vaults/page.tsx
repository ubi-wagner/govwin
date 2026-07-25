import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { NooksIndex } from '@/components/portal/vaults/nooks-index';

export const dynamic = 'force-dynamic';

/** Collaboration vaults ("nooks") — tenant admin management surface (P8.9). tenant_admin+. */
export default async function VaultsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  if (!(await verifyTenantAccess(su.id, role, tenant.id as string))) redirect('/portal');
  if (!hasRoleAtLeast(role, 'tenant_admin')) redirect(`/portal/${tenantSlug}/proposals`);

  return <NooksIndex tenantSlug={tenantSlug} />;
}
