import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { getLandingPath, isRole, type Role } from '@/lib/rbac';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    from?: string;
    justChanged?: string;
    switchedTo?: string;
    switchedFrom?: string;
  }>;
}

/**
 * Determine where to send the user after login.
 *
 * Priority:
 *   1. `from` query param (middleware stored the original destination)
 *   2. Role-based landing path via getLandingPath()
 *   3. Fallback to /portal (the dispatcher handles edge cases)
 */
function resolveRedirectTarget(
  from: string | undefined,
  role: Role | null,
  tenantSlug: string | null,
): string {
  // If middleware captured the page the user was trying to reach, send
  // them back there — but only if it's a relative path (never redirect
  // to an external URL).
  if (from && from.startsWith('/') && from !== '/login') {
    return from;
  }
  if (role) {
    const landing = getLandingPath(role, tenantSlug);
    if (landing) return landing;
  }
  return '/portal';
}

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await auth();
  const params = await searchParams;

  // Already authenticated — redirect to the appropriate workspace.
  if (session?.user) {
    // If we arrived here with error=session, don't auto-redirect —
    // the session is corrupt and the user needs to sign out. Same when mid-company-switch
    // (a deep link to another company just signed them out): show the notice + form.
    if (params.error === 'session' || params.switchedTo) {
      // Fall through to render the login form with the message
    } else {
      const sessionUser = session.user as {
        role?: unknown;
        tenantSlug?: string | null;
      };
      const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
      if (!role) {
        redirect('/login?error=session');
      }
      const target = resolveRedirectTarget(params.from, role, sessionUser.tenantSlug ?? null);
      redirect(target);
    }
  }

  const errorMsg = resolveErrorMessage(params.error);
  const justChanged = params.justChanged === '1';

  async function handleLogin(formData: FormData): Promise<void> {
    'use server';
    const raw = await searchParams;
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    if (!email || !password) {
      redirect('/login?error=missing');
    }
    // Carry the `from` param so the /portal dispatcher (or middleware)
    // can honour it after sign-in. The actual role-based redirect is
    // handled by the /portal dispatcher page once the session is live.
    const redirectTo = raw.from && raw.from.startsWith('/') && raw.from !== '/login'
      ? raw.from
      : '/portal';
    try {
      await signIn('credentials', {
        email,
        password,
        redirectTo,
      });
    } catch (e) {
      // NextAuth throws a NEXT_REDIRECT on success — re-throw to let it propagate.
      if ((e as { digest?: string } | null)?.digest?.startsWith('NEXT_REDIRECT')) {
        throw e;
      }
      console.error('[login] signIn failed', String(e));
      redirect('/login?error=invalid');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Sign in</h1>
        <p className="text-sm text-gray-500 mb-2">RFP Pipeline</p>
        <p className="text-xs text-gray-400 mb-6">
          One sign-in for customers, collaborators, and staff. If your email works with
          more than one company, you&apos;ll choose which to enter next.
        </p>

        {justChanged ? (
          <div
            role="status"
            className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            Password updated. Please sign in with your new password.
          </div>
        ) : null}
        {params.switchedTo ? (
          <div
            role="status"
            className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            You&apos;ve been signed out of <strong>{params.switchedFrom || 'your last company'}</strong>.
            Sign in to continue into <strong>{params.switchedTo}</strong> — you&apos;ll land right where
            your notification pointed you.
          </div>
        ) : null}
        {errorMsg ? (
          <div
            role="alert"
            className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMsg}
          </div>
        ) : null}

        <form action={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2.5 min-h-11 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2.5 min-h-11 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="mt-1 text-right">
              <Link href="/forgot-password" className="text-sm text-blue-600 hover:text-blue-800">
                Forgot password?
              </Link>
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 min-h-11 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}

function resolveErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  switch (error) {
    case 'missing':
      return 'Email and password are required.';
    case 'invalid':
    case 'CredentialsSignin':
      return 'Invalid email or password.';
    case 'session':
      return 'Your session has expired or is invalid. Please sign in again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
