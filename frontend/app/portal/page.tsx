import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getLandingPath, isRole, type Role } from '@/lib/rbac';

/**
 * /portal — post-login traffic cop.
 *
 * NextAuth's credentials sign-in uses `redirectTo: '/portal'` from
 * the login page. Every freshly-authenticated user lands here first,
 * and this component forwards them to their role-appropriate home:
 *
 *   master_admin / rfp_admin      → /admin/dashboard
 *   tenant_admin / tenant_user    → /portal/<slug>/dashboard
 *   partner_user                  → /portal/<slug>/dashboard
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
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role) {
    // Authenticated but the JWT has no (or an invalid) role. Safest
    // action is to force a fresh sign-in.
    redirect('/login?error=session');
  }

  const tenantSlug = sessionUser.tenantSlug ?? null;
  const target = getLandingPath(role, tenantSlug);

  if (target) {
    redirect(target);
  }

  // No valid landing path — user is authenticated but has no tenant
  // assigned. Render a message instead of looping.
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900">No workspace assigned</h1>
        <p className="mt-3 text-sm text-gray-600">
          You're signed in but your account isn't linked to a tenant
          yet. Ask your administrator to grant you access, or contact
          support if you think this is an error.
        </p>
        <form action="/api/auth/signout" method="POST" className="mt-6">
          <button
            type="submit"
            className="w-full rounded-md bg-gray-100 hover:bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
