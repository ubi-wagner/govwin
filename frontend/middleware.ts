import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { hasRoleAtLeast, isRole, requiredRoleForPath } from '@/lib/rbac';

/**
 * Middleware — runs on the edge, gates every request before it
 * reaches a page/route handler.
 *
 * Responsibilities:
 *   1. Short-circuit public paths (no auth needed).
 *   2. Resolve the NextAuth JWT into a user.
 *   3. If the user has temp_password=true, force them to
 *      /change-password (except for the change-password endpoint
 *      itself and the sign-out endpoint).
 *   4. Enforce the 5-role hierarchy for path prefixes using
 *      requiredRoleForPath from lib/rbac.ts.
 *
 * See docs/DECISIONS.md D001.
 */

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/about',
  '/features',
  '/pricing',
  '/engine',
  '/team',
  '/customers',
  '/get-started',
  '/legal',
  '/api/health',
  '/api/waitlist',
  '/api/stripe/webhook',
  '/invite',
];

// Static asset extensions that bypass auth. Exhaustive on purpose:
// the previous version used `pathname.includes('.')` as a shortcut,
// which silently bypassed auth on any future route segment that
// happened to contain a literal dot (e.g., a dynamic param accepting
// an email or a versioned filename). Anchored to end-of-string so
// only filename extensions match — not random dots in URL paths.
const STATIC_ASSET_RE =
  /\.(ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|woff2?|ttf|otf|eot|txt|xml|json|webmanifest)$/i;

function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/favicon') ||
    STATIC_ASSET_RE.test(pathname)
  ) {
    return true;
  }
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    // NextAuth v5 uses __Secure-authjs.session-token in production
    // and authjs.session-token in development. getToken handles both.
  });

  if (!token) {
    // Unauthenticated — redirect HTML requests to /login,
    // return 401 for API routes.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Force password change on first login.
  const tempPassword = token.tempPassword === true;
  const isChangePasswordPath =
    pathname === '/change-password' || pathname === '/api/auth/change-password';
  if (tempPassword && !isChangePasswordPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'password change required' },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL('/change-password', request.url));
  }

  // Role-based path gating.
  const requiredRole = requiredRoleForPath(pathname);
  if (requiredRole) {
    const actorRole = token.role;
    if (!isRole(actorRole)) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    if (!hasRoleAtLeast(actorRole, requiredRole)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
