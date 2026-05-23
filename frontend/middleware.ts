import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/auth.config';
import { hasRoleAtLeast, isRole, requiredRoleForPath, type Role } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Edge middleware — runs before every request that matches the
 * `config.matcher` pattern at the bottom of this file.
 *
 * Responsibilities:
 *   1. Short-circuit public paths (no auth needed).
 *   2. Resolve the NextAuth v5 session from the request cookie.
 *   3. Redirect unauthenticated users to /login (or 401 for APIs).
 *   4. Force users with tempPassword=true to /change-password.
 *   5. Enforce the 5-role hierarchy for path prefixes via
 *      requiredRoleForPath from lib/rbac.ts.
 *
 * Why we call `NextAuth(authConfig)` here instead of importing the
 * full `auth` from `@/auth`: the Edge runtime cannot import `lib/db`
 * (postgres uses Node's net/tls) or `bcryptjs` (Node crypto). The
 * edge-safe `authConfig` lives in a separate file and contains only
 * the jwt + session callbacks — enough to decrypt the JWE session
 * cookie that NextAuth v5 sets and expose `req.auth` on middleware
 * requests.
 *
 * The previous middleware used `getToken({ req, secret })` from
 * `next-auth/jwt` (the v4 pattern). That call CANNOT decrypt v5's
 * JWE session tokens, so it silently returned null even for valid
 * sessions — which meant middleware redirected every authenticated
 * request to /login, while the pages' `auth()` call (which DID
 * decrypt correctly) redirected right back to /portal, producing
 * an infinite redirect loop the browser ultimately killed with
 * ERR_TOO_MANY_REDIRECTS.
 *
 * See docs/DECISIONS.md D001 and https://authjs.dev/guides/edge-compatibility.
 */

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/about',
  '/apply',
  '/blog',
  '/features',
  '/pricing',
  '/engine',
  '/how-it-works',
  '/infosec',
  '/resources',
  '/security',
  '/team',
  '/the-expert',
  '/customers',
  '/get-started',
  '/value',
  '/legal',
  '/api/health',
  '/api/waitlist',
  '/api/content',
  '/api/analytics',
  '/api/stripe/webhook',
  '/invite',
];

/** Paths that are public but must match exactly (no startsWith prefix matching). */
const PUBLIC_EXACT_PATHS = [
  '/api/applications',
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
  if (PUBLIC_EXACT_PATHS.includes(pathname)) {
    return true;
  }
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Rate limiting for public POST endpoints (runs before auth check so
// unauthenticated abuse is caught).
const RATE_LIMITED_PATHS: Record<string, { limit: number; windowMs: number }> = {
  '/api/applications': { limit: 5, windowMs: 15 * 60 * 1000 },
  '/api/auth/forgot-password': { limit: 5, windowMs: 15 * 60 * 1000 },
  '/api/auth/reset-password': { limit: 5, windowMs: 15 * 60 * 1000 },
  '/api/waitlist': { limit: 5, windowMs: 15 * 60 * 1000 },
};

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// Create an edge-compatible NextAuth instance from the shared config.
// This instance only understands JWT decoding — it has no providers,
// no DB lookup, no authorize() logic. That's fine because middleware
// only needs to verify the already-issued session cookie, not create
// new sessions.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Rate limiting for public endpoints (all methods)
  const rateLimitConfig = RATE_LIMITED_PATHS[pathname];
  if (rateLimitConfig) {
    const ip = getClientIp(req);
    const key = `${ip}:${pathname}`;
    const result = checkRateLimit(key, rateLimitConfig.limit, rateLimitConfig.windowMs);
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            'X-RateLimit-Limit': String(rateLimitConfig.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
          },
        },
      );
    }
  }

  // Auth login rate limiting (all methods, slightly higher limit)
  if (pathname.startsWith('/api/auth/') && !RATE_LIMITED_PATHS[pathname]) {
    const ip = getClientIp(req);
    const key = `${ip}:/api/auth`;
    const result = checkRateLimit(key, 20, 15 * 60 * 1000);
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many login attempts. Please try again later.', code: 'RATE_LIMITED' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
          },
        },
      );
    }
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = req.auth;
  if (!session?.user) {
    // Unauthenticated — redirect HTML requests to /login, return
    // 401 for API routes.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.nextUrl);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Force password change on first login.
  const tempPassword =
    (session.user as { tempPassword?: boolean }).tempPassword === true;
  const isChangePasswordPath =
    pathname === '/change-password' || pathname === '/api/auth/change-password';
  if (tempPassword && !isChangePasswordPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'password change required' },
        { status: 403 },
      );
    }
    return NextResponse.redirect(new URL('/change-password', req.nextUrl));
  }

  // Role-based path gating.
  const requiredRole = requiredRoleForPath(pathname);
  if (requiredRole) {
    const actorRole: unknown = (session.user as { role?: unknown }).role;
    if (!isRole(actorRole)) {
      return NextResponse.redirect(new URL('/login', req.nextUrl));
    }
    if (!hasRoleAtLeast(actorRole as Role, requiredRole)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
