import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { resolveVaultAccess, getVault } from '@/lib/vaults/vaults';
import { NookDetail } from '@/components/portal/vaults/nook-detail';

export const dynamic = 'force-dynamic';

/** A collaboration vault — tenant-side detail (members + content, full rights). tenant_admin+. */
export default async function NookPage({ params }: { params: Promise<{ tenantSlug: string; vaultId: string }> }) {
  const { tenantSlug, vaultId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');
  if (!hasRoleAtLeast(role, 'tenant_admin')) redirect(`/portal/${tenantSlug}/proposals`);

  const access = await resolveVaultAccess(vaultId, { userId: su.id, email: su.email ?? null, role });
  const vault = await getVault(vaultId, tenantId);
  if (!access || access.side !== 'tenant' || access.ownerTenantId !== tenantId || !vault) {
    redirect(`/portal/${tenantSlug}/vaults`);
  }

  return (
    <div>
      <Link href={`/portal/${tenantSlug}/vaults`} className="mb-4 inline-block text-xs text-gray-400 hover:text-gray-700">← All nooks</Link>
      <NookDetail
        apiBase={`/api/portal/${tenantSlug}/vaults/${vaultId}`}
        side="tenant"
        rights={access.rights}
        partnerName={vault.partnerName}
        partnerOrg={vault.partnerOrg}
      />
    </div>
  );
}
