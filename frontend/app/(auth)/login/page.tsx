import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';

interface PageProps {
  searchParams: Promise<{ error?: string; from?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session?.user) {
    redirect('/portal');
  }
  const params = await searchParams;
  const errorMsg = resolveErrorMessage(params.error);

  async function handleLogin(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    if (!email || !password) {
      redirect('/login?error=missing');
    }
    try {
      await signIn('credentials', {
        email,
        password,
        redirectTo: '/portal',
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
        <p className="text-sm text-gray-500 mb-6">RFP Pipeline portal</p>

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
    default:
      return 'Something went wrong. Please try again.';
  }
}
