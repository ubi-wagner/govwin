import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isRole, getLandingPath, type Role } from '@/lib/rbac';

/**
 * Post-login redirect for non-admin users.
 *
 * Reads the user's role and tenant slug from the session, then redirects
 * to the appropriate landing page. If no tenant is assigned, shows a
 * "setting up" message.
 */
export default async function DashboardRedirectPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantSlug?: string | null;
  };

  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;

  if (!role) {
    redirect('/login?error=session');
  }

  const landingPath = getLandingPath(role, sessionUser.tenantSlug ?? null);

  if (landingPath) {
    redirect(landingPath);
  }

  // No tenant assigned — show setup message
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl mb-4">
          &#9202;
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Setting Up Your Workspace</h1>
        <p className="text-sm text-gray-500 mb-6">
          Your account has been created, but your company workspace is still being configured.
          This typically happens within a few hours of your application being approved.
        </p>
        <p className="text-xs text-gray-400 mb-6">
          If you believe this is an error, please contact{' '}
          <a href="mailto:eric@rfppipeline.com" className="text-blue-600 hover:underline">
            eric@rfppipeline.com
          </a>
        </p>
        <form action="/api/auth/signout" method="POST">
          <button
            type="submit"
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
