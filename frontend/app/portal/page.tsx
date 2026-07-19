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

  // Multi-membership selection (identity P2). A person with MORE THAN ONE active
  // company must choose which to act as — a session is singular. Admins skip this
  // (they log in at the platform, then descend deliberately). With exactly one
  // membership (everyone today) this is a no-op. See
  // docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
  const dispatchUserId = (sessionUser as { id?: string }).id;
  const dispatchPinned = (sessionUser as { membershipPinned?: boolean }).membershipPinned === true;
  // Once the session has committed to a company (pinned), skip the selector entirely —
  // land them in that company. Only offer the picker to a not-yet-committed
  // multi-membership user.
  if (dispatchUserId && !dispatchPinned && !hasRoleAtLeast(role, 'rfp_admin')) {
    try {
      const memberships = await getActiveMemberships(dispatchUserId);
      if (memberships.length > 1) redirect('/select-company');
    } catch (e) {
      // NEXT_REDIRECT must propagate; only swallow genuine query errors.
      if ((e as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    }
  }

  let tenantSlug = sessionUser.tenantSlug ?? null;

  // Validate the tenant still exists — the JWT may carry a stale slug
  // from a deleted tenant (e.g., after a DB wipe for HITL testing).
  if (tenantSlug) {
    try {
      // Exclude suspended AND archived (license slumber) tenants — either way the user
      // has no reachable workspace, so fall through to the friendly message (no loop).
      const [t] = await sql`SELECT slug FROM tenants WHERE slug = ${tenantSlug} AND status != 'suspended' AND archived_at IS NULL LIMIT 1`;
      if (!t) tenantSlug = null; // Tenant gone / archived — treat as no workspace
    } catch {
      tenantSlug = null;
    }
  }

  // If JWT has no tenant but user has one in DB (stale JWT), refresh
  if (!tenantSlug && role !== 'master_admin' && role !== 'rfp_admin') {
    try {
      const userId = (sessionUser as { id?: string }).id;
      if (userId) {
        const [u] = await sql<{ slug: string }[]>`
          SELECT t.slug FROM users u
          JOIN tenants t ON t.id = u.tenant_id
          WHERE u.id = ${userId}::uuid AND t.status != 'suspended' AND t.archived_at IS NULL
        `;
        if (u) tenantSlug = u.slug;
      }
    } catch { /* best effort */ }
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
