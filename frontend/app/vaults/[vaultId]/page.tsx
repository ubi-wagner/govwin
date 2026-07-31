import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { isRole, type Role } from '@/lib/rbac';
import { resolveVaultAccess, getVaultOwnerContext } from '@/lib/vaults/vaults';
import { NookDetail } from '@/components/portal/vaults/nook-detail';

export const dynamic = 'force-dynamic';

/**
 * /vaults/<id> — a collaborator's nook detail (P8.9). Access is resolved per-vault by
 * resolveVaultAccess (NOT tenant membership), so an invited partner reaches ONLY this nook.
 * The same NookDetail component renders here as on the tenant side, gated by the
 * server-resolved rights (COLLAB_RIGHTS: upload · atomize · download-WHOLE-only). It
 * addresses the shared tenant-namespaced vault API via the owner slug.
 */
export default async function CollaboratorNookPage({ params }: { params: Promise<{ vaultId: string }> }) {
  const { vaultId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');

  const access = await resolveVaultAccess(vaultId, { userId: su.id, email: su.email ?? null, role });
  if (!access) redirect('/vaults');
  const owner = await getVaultOwnerContext(vaultId);
  if (!owner) redirect('/vaults');

  return (
    <div>
      <Link href="/vaults" className="mb-4 inline-block text-xs text-gray-400 hover:text-gray-700">← All vaults</Link>
      <NookDetail
        apiBase={`/api/portal/${owner.ownerSlug}/vaults/${vaultId}`}
        side={access.side}
        rights={access.rights}
        partnerName={owner.ownerName}
        partnerOrg={null}
      />
    </div>
  );
}
