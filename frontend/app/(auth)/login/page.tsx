import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { getLandingPath, isRole, type Role } from '@/lib/rbac';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    from?: string;
    justChanged?: string;
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
    const sessionUser = session.user as {
      role?: unknown;
      tenantSlug?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    const target = resolveRedirectTarget(params.from, role, sessionUser.tenantSlug ?? null);
    redirect(target);
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
        <p className="text-sm text-gray-500 mb-6">RFP Pipeline</p>

        {justChanged ? (
          <div
            role="status"
            className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
          >
            Password updated. Please sign in with your new password.
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="mt-1 text-right">
              <Link href="/forgot-password" className="text-sm text-blue-600 hover:text-blue-800">
                Forgot password?
              </Link>
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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
