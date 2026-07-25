import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { SignOutButton } from '@/components/auth/sign-out-button';

/**
 * Collaboration-vault ("nook") layout — the top-level collaborator surface (P8.9).
 *
 * DELIBERATELY NOT the portal layout: a vault-only partner holds NO membership at the
 * owner tenant, so verifyTenantAccess would bounce them. Access to any nook is resolved
 * per-vault by resolveVaultAccess in the pages below; this layout only requires a valid
 * session. A thin shell (brand + sign out) — the collaborator sees only their nook(s),
 * never a tenant's navigation.
 */
export default async function VaultsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/vaults" className="text-sm font-semibold text-gray-800 hover:text-gray-600">
            Collaboration
          </Link>
          <SignOutButton className="text-xs text-gray-400 hover:text-gray-700" />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
