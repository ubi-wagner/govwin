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
  // The newcomer on-ramp — and it required a login, which is the exact audience it cannot have.
  // The homepage links to it TWICE ("Start here →", and the hero's "New to federal R&D? Start
  // here"), it sits in the site nav as "Federal R&D 101", and its own content module describes it
  // as "the newcomer on-ramp: what federal R&D funding is, whether you qualify". Every one of those
  // entry points led a first-time visitor to /login?from=%2Ffederal-rd-101.
  //
  // Third omission from this list found in one sweep (with /api/invite and the two password-reset
  // pages). A hand-maintained list next to a directory of public pages WILL drift, so
  // __tests__/middleware.test.ts now enumerates app/(marketing) and app/(auth) from disk and fails
  // when the two disagree — the list stays hand-written because Edge cannot read the filesystem,
  // but it can no longer drift silently.
  '/federal-rd-101',
  '/legal',
  '/api/health',
  '/api/waitlist',
  '/api/content',
  '/api/analytics',
  '/api/stripe/webhook',
  // Delivery outcomes from Postmark. No session by construction — the request arrives from the
  // provider — and POSTMARK_WEBHOOK_SECRET is the authorization, checked inside the route.
  '/api/webhooks/postmark',
  '/invite',
];

/**
 * Paths that are public but must match exactly (no startsWith prefix matching).
 *
 * `/api/invite` is here because THE TOKEN IS THE CREDENTIAL. An invited collaborator has no account
 * yet — that is the entire point of an invite link — so requiring a session to read or accept one
 * is a contradiction the flow cannot satisfy. `/invite/<token>` (the page) was already public and
 * its two fetches were not, so the page loaded, `GET /api/invite` answered 401 into a silent catch
 * (the invitee saw no inviter, no company, no proposal), and `POST /api/invite` answered 401 when
 * they submitted a password. Proven live on a fresh box before the fix.
 *
 * This is the same bug as the cron one documented under CRON_EXACT_PATHS: a handler written to
 * authenticate by something other than a session, made unreachable by the session gate in front of
 * it. That one was found and fixed for two routes; nothing swept for the rest, and this was the
 * rest. The route still validates the token itself and 404s an unknown one, so opening the path
 * grants nothing the token does not.
 */
const PUBLIC_EXACT_PATHS = [
  '/api/applications',
  '/api/invite',
  // THE PASSWORD-RESET PAGES. Same defect as /api/invite above, bigger blast radius: these are for
  // people who CANNOT log in, and they sat behind the login gate.
  //
  //   /login renders a "Forgot password?" link → /forgot-password → 307 back to /login.
  //   A password-reset EMAIL links to /reset-password?token=…&email=… → 307 back to /login,
  //   and the page that would have consumed the token never runs.
  //
  // Everything else in the flow was already built and working: both pages exist and read their
  // query parameters correctly, and `POST /api/auth/forgot-password` answers
  // `200 {"data":{"sent":true}}` — because `/api/auth/*` is public a few lines above, so the API
  // was reachable while the UI in front of it was not. Only this list was missing them.
  //
  // Exact, never a prefix: neither page has sub-routes, and a prefix would open anything beneath.
  // No rate limit needed here — these are renders; the two endpoints they POST to are already in
  // RATE_LIMITED_PATHS at 5 per 15 minutes, which is where the abuse budget belongs.
  '/forgot-password',
  '/reset-password',
];

// Static asset extensions that bypass auth. Exhaustive on purpose:
// the previous version used `pathname.includes('.')` as a shortcut,
// which silently bypassed auth on any future route segment that
// happened to contain a literal dot (e.g., a dynamic param accepting
// an email or a versioned filename). Anchored to end-of-string so
// only filename extensions match — not random dots in URL paths.
const STATIC_ASSET_RE =
  /\.(ico|png|jpe?g|gif|svg|webp|avif|css|js|mjs|map|woff2?|ttf|otf|eot|txt|xml|json|webmanifest)$/i;

/**
 * Endpoints a HEADLESS SCHEDULER may call with `Authorization: Bearer $CRON_SECRET` instead of a
 * session. Exact paths only — never a prefix, so nothing under /api/admin is opened by accident.
 *
 * WHY THIS EXISTS. Both routes were written with a bearer path in the handler:
 *
 *     const viaCron = !!cronSecret && authz === `Bearer ${cronSecret}`;
 *
 * …which this middleware made UNREACHABLE. Every non-public path needs a session here, and the
 * check runs first, so a correctly-authenticated cron poke got `{"error":"unauthenticated"}` before
 * the handler was ever entered. Proven live: with CRON_SECRET set on both sides, the right bearer
 * still 401'd, and the lowercase body is what gave the middleware away — the routes answer
 * `{ error: 'Authentication required', code: 'UNAUTHENTICATED' }`.
 *
 * That silently disabled two features. The card-reconcile sweep is the only thing that heals a
 * tenant which never opens its feed (the feed read-repairs only for a tenant that VISITS), and the
 * TW-8 agent-gate auto-advance is documented as "inert until AGENT_GATE_SWEEP_URL is set" when in
 * fact it would have stayed inert after it was set.
 *
 * This only stops the middleware REJECTING. Each route still performs its own bearer check and its
 * own role check, so a path added here without a handler-side check fails closed: the handler sees
 * no session and refuses.
 */
const CRON_EXACT_PATHS = [
  '/api/admin/reconcile-cards',
  '/api/admin/agent-gates/sweep',
  // Third occurrence of the trap the comment above describes. The bracket sweep was written with
  // the same handler-side bearer check and the same omission here, and produced the same tell:
  // `{"error":"unauthenticated"}` in lowercase, which is the middleware's wording and not the
  // route's. A comment explaining a trap does not prevent the trap; the LIST is the mechanism.
  '/api/admin/event-brackets/sweep',
  // FOURTH occurrence, added at the same time as the route rather than after the 401. The
  // space-presence sweep is the only closer for a bracket whose owner shut the tab, so omitting it
  // here would have left the customer-facing symptom this whole change exists to remove — an
  // "opened your workspace" with no matching close — while every other path looked fixed.
  '/api/admin/space-presence/sweep',
  // FIFTH occurrence — and the comment two entries up predicted it exactly: "a comment explaining a
  // trap does not prevent the trap; the LIST is the mechanism." The task-claim sweep shipped with
  // the handler-side `Bearer $CRON_SECRET` check and without this line, so it answered 401 with the
  // middleware's lowercase `unauthenticated` before its handler ever ran.
  //
  // Measured on a live server with the CORRECT secret, which is the only way to tell the two 401s
  // apart — a WRONG token produces the same body from both the gate and the handler:
  //   /api/admin/space-presence/sweep  → 200 {"data":{"closed":2,...}}   (listed: handler ran)
  //   /api/admin/tasks/sweep-claims    → 401 {"error":"unauthenticated"} (unlisted: gate refused)
  //
  // It matters more than the count suggests. The session bounds GUARANTEE people are signed out
  // mid-task, and this sweep is the only thing that returns their claim to the queue — so a silent
  // 401 here means ToDos accumulate holders who are gone and nobody else can pick them up.
  '/api/admin/tasks/sweep-claims',
];

function isAuthorizedCron(pathname: string, authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  // No secret configured ⇒ no cron path exists. Never fall open on an unset variable.
  if (!secret || !authorization) return false;
  if (!CRON_EXACT_PATHS.includes(pathname)) return false;
  return authorization === `Bearer ${secret}`;
}

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
  // Opening /api/invite to anonymous callers (above) makes it an unauthenticated endpoint that
  // accepts a token and SETS A PASSWORD — the same risk class as reset-password, so it gets the
  // same budget. The limit is what stops the open path from being a token-guessing oracle. A
  // higher ceiling than the others would be wrong: a real invitee needs two requests, not five.
  '/api/invite': { limit: 5, windowMs: 15 * 60 * 1000 },
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

  // A headless scheduler carrying the right bearer for a known cron endpoint gets past the SESSION
  // gate — and only that. The route still checks the same secret and its own role requirement.
  if (isAuthorizedCron(pathname, req.headers.get('authorization'))) {
    return NextResponse.next();
  }

  const session = req.auth;
  if (!session?.user) {
    // Unauthenticated — redirect HTML requests to /login, return
    // 401 for API routes.
    if (pathname.startsWith('/api/')) {
      // `code` is not optional. CLAUDE.md: "EVERY error response MUST include both `error` and
      // `code` fields", and every one of the 250 route handlers behind this middleware obeys it —
      // 2,525 error responses, all conforming. This layer, which fronts all of them and answers
      // FIRST for any caller without a session, did not: a client switching on `code` fell through
      // to its default on the single most common failure in the product. The rate-limit branches
      // above already carried `RATE_LIMITED`, which is what shows this was an oversight and not a
      // decision. Codes match the handlers' own vocabulary so a caller needs one branch, not two.
      return NextResponse.json(
        { error: 'unauthenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const loginUrl = new URL('/login', req.nextUrl);
    // Preserve the full path INCLUDING the query string. A deep-link like
    // /go?tenant=beacon-labs&task=… carries its target in the query; dropping
    // it (from=pathname only) would strand a multi-membership recipient at the
    // dispatcher after login instead of their intended company/queue.
    loginUrl.searchParams.set('from', pathname + req.nextUrl.search);
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
        { error: 'password change required', code: 'PASSWORD_CHANGE_REQUIRED' },
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
        return NextResponse.json({ error: 'forbidden', code: 'FORBIDDEN' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/', req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
