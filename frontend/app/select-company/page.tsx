import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getLandingPath, type Role } from '@/lib/rbac';
import { getActiveMemberships } from '@/lib/memberships';
import { selectCompanyAction } from '@/app/actions/auth-actions';
import { SignOutButton } from '@/components/auth/sign-out-button';

/**
 * /select-company — the membership selector (identity P2 + enforcement).
 *
 * A person with MORE THAN ONE active company picks which to act as. A session is
 * SINGULAR: choosing PINS them (selectCompanyAction sets a signed cookie), and the
 * portal layout then denies every other tenant for the rest of the session. To work
 * at another company they sign out and back in. (Only RFP-admins switch in-session.)
 *
 * Re-pick-proof: once a live pin exists this page does NOT re-offer the choice — it
 * forwards to the pinned company. That is what makes "log out to switch" a hard
 * guarantee rather than a convention. A stale pin (its tenant no longer an active
 * membership) is ignored so the user can re-pick and overwrite it (no redirect loop).
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

  const u = session.user as { id?: string; email?: string; tenantSlug?: string | null; membershipPinned?: boolean };
  if (!u.id) redirect('/login?error=session');

  // Re-pick-proof: once this session has committed to a company, there is no in-session
  // switch — forward to the dispatcher (which lands them in their pinned company). To
  // change company they log out and back in. Only RFP-admins re-scope in-session.
  if (u.membershipPinned) redirect('/portal');

  const memberships = await getActiveMemberships(u.id);

  // 0 → no workspace (dispatcher handles the friendly message).
  if (memberships.length === 0) redirect('/portal');

  // Exactly one company → zero-friction auto-enter (nothing to choose; no pin needed).
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
          {memberships.map((m) => (
            <li key={m.id}>
              <form action={selectCompanyAction}>
                <input type="hidden" name="tenantId" value={m.tenantId} />
                <button
                  type="submit"
                  className="w-full flex items-center justify-between rounded-md border border-gray-200 px-4 py-3 text-left hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                >
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">{m.tenantName}</span>
                    <span className="block text-xs text-gray-500">
                      {ROLE_LABEL[m.role] ?? m.role}
                      {m.source === 'collaborator' ? ' · external' : ''}
                    </span>
                  </span>
                  <span className="text-blue-600 text-sm font-medium">Enter →</span>
                </button>
              </form>
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t border-gray-100 pt-4">
          <SignOutButton className="text-sm text-gray-500 hover:text-gray-700" />
        </div>
      </div>
    </div>
  );
}
