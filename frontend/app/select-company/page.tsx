import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { isRole, getLandingPath, type Role } from '@/lib/rbac';
import { getActiveMemberships } from '@/lib/memberships';
import { SignOutButton } from '@/components/auth/sign-out-button';

/**
 * /select-company — the membership selector (identity P2).
 *
 * A person with MORE THAN ONE active company picks which to act as. A session is
 * SINGULAR: the choice pins them to one company; to work at another they log out
 * and log back in. (Only RFP-admins switch in-session — a separate flow.) With one
 * membership the /portal dispatcher skips this page entirely.
 * See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
const ROLE_LABEL: Record<string, string> = {
  tenant_admin: 'Company admin',
  tenant_user: 'Team member',
  partner_user: 'Collaborator',
  rfp_admin: 'RFP admin',
  master_admin: 'System admin',
};

export default async function SelectCompanyPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!u.id) redirect('/login?error=session');

  const memberships = await getActiveMemberships(u.id);

  // 0 → no workspace (dispatcher handles); 1 → straight through; only >1 stays here.
  if (memberships.length === 0) redirect('/portal');
  if (memberships.length === 1) {
    const only = memberships[0];
    redirect(getLandingPath(only.role as Role, only.tenantSlug) ?? '/portal');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Choose a company</h1>
        <p className="text-sm text-gray-500 mb-6">
          Signed in as {u.email}. You have access to more than one company — pick which
          one to work in. You can only be in one at a time; to switch, sign out and back in.
        </p>

        <ul className="space-y-2">
          {memberships.map((m) => {
            const href = getLandingPath(m.role as Role, m.tenantSlug) ?? `/portal/${m.tenantSlug}/dashboard`;
            return (
              <li key={m.id}>
                <Link
                  href={href}
                  className="flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                >
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{m.tenantName}</span>
                    <span className="block text-xs text-gray-500">
                      {ROLE_LABEL[m.role] ?? m.role}
                      {m.source === 'collaborator' ? ' · external' : ''}
                    </span>
                  </span>
                  <span className="text-blue-600 text-sm font-medium">Enter →</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 border-t border-gray-100 pt-4">
          <SignOutButton className="text-sm text-gray-500 hover:text-gray-700" />
        </div>
      </div>
    </div>
  );
}
