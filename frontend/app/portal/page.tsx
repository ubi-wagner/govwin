import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { getLandingPath, isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { getActiveMemberships } from '@/lib/memberships';

/**
 * /portal — post-login traffic cop.
 *
 * NextAuth's credentials sign-in uses `redirectTo: '/portal'` from
 * the login page. Every freshly-authenticated user lands here first,
 * and this component forwards them to their role-appropriate home:
 *
 *   master_admin / rfp_admin      → /admin/dashboard
 *   tenant_admin / tenant_user    → /portal/<slug>/dashboard
 *   partner_user                  → /portal/<slug>/proposals
 *   user with no tenant assigned  → rendered as a friendly "no workspace"
 *                                   message (infinite-loop safe — we
 *                                   never redirect from /portal back
 *                                   to /portal)
 *
 * The temp_password middleware guard runs BEFORE this dispatcher, so
 * users with `temp_password = true` get force-redirected to
 * /change-password first and only reach here after setting a real one.
 */
export default async function PortalDispatcher() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    role?: unknown;
    tenantSlug?: string | null;
  };
  let role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;

  // If JWT role is missing/invalid, try to recover from DB before forcing re-login
  if (!role) {
    try {
      const userId = (sessionUser as { id?: string }).id;
      const email = (sessionUser as { email?: string }).email;
      if (userId) {
        const [u] = await sql<{ role: string }[]>`
          SELECT role FROM users WHERE id = ${userId}::uuid LIMIT 1
        `;
        if (u && isRole(u.role)) role = u.role;
      } else if (email) {
        const [u] = await sql<{ role: string }[]>`
          SELECT role FROM users WHERE email = ${email} LIMIT 1
        `;
        if (u && isRole(u.role)) role = u.role;
      }
    } catch { /* fall through to redirect */ }
  }

  if (!role) {
    redirect('/login?error=session');
  }

  // Multi-membership + landing (identity P2/P4). For a NON-ADMIN the landing company
  // must be one where they hold an ACTIVE membership at a non-archived tenant — the JWT
  // tenantSlug is only a hint (getActiveMemberships is authoritative, filtering revoked
  // memberships AND archived companies). This is what keeps a DEACTIVATED or archived
  // user out of a redirect loop: no active membership → no landing → the friendly
  // message below. A not-yet-committed multi-membership user picks which company first.
  // Admins land on the platform regardless of slug. See MULTI_MEMBERSHIP_IDENTITY_DESIGN.
  const dispatchUserId = (sessionUser as { id?: string }).id;
  const dispatchPinned = (sessionUser as { membershipPinned?: boolean }).membershipPinned === true;
  let tenantSlug = sessionUser.tenantSlug ?? null;

  if (dispatchUserId && !hasRoleAtLeast(role, 'rfp_admin')) {
    try {
      const memberships = await getActiveMemberships(dispatchUserId);
      if (!dispatchPinned && memberships.length > 1) redirect('/select-company');
      // Land at the JWT company iff it's still an active membership, else the first
      // active one, else nothing (→ no-workspace / paused message).
      const match = memberships.find((m) => m.tenantSlug === tenantSlug) ?? memberships[0] ?? null;
      tenantSlug = match ? match.tenantSlug : null;
    } catch (e) {
      if ((e as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) throw e;
      tenantSlug = null;
    }
  }

  const target = getLandingPath(role, tenantSlug);

  if (target) {
    redirect(target);
  }

  // No valid landing path. Distinguish a company in license SLUMBER (archived) from a
  // genuinely unlinked account, so the message is accurate. Render (never redirect from
  // /portal to /portal) to stay loop-safe.
  let companyArchived = false;
  const jwtSlug = sessionUser.tenantSlug ?? null;
  if (jwtSlug) {
    try {
      const [t] = await sql`SELECT 1 FROM tenants WHERE slug = ${jwtSlug} AND archived_at IS NOT NULL LIMIT 1`;
      companyArchived = !!t;
    } catch { /* fall back to the generic message */ }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {companyArchived ? 'Access paused' : 'No workspace assigned'}
        </h1>
        <p className="mt-3 text-sm text-gray-600">
          {companyArchived ? (
            <>Your company&apos;s access is paused while its license is renewed. Your work
            is safe and will be exactly where you left it once access is restored. Contact
            your administrator or RFP Pipeline to reactivate.</>
          ) : (
            <>You&apos;re signed in but your account isn&apos;t linked to a tenant
            yet. Ask your administrator to grant you access, or contact
            support if you think this is an error.</>
          )}
        </p>
        <div className="mt-6">
          <SignOutButton className="w-full rounded-md bg-gray-100 hover:bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700" />
        </div>
      </div>
    </div>
  );
}
