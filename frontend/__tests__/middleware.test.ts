/**
 * TEST-11 — middleware.ts role-guard behavior
 *
 * Strategy: The middleware is exported as the result of NextAuth(authConfig)(handler),
 * meaning the default export is itself an auth-wrapped handler. The `req.auth`
 * property carries the session. We can't import `middleware` directly without
 * pulling next-auth's edge runtime, so we test the internal logic by mocking
 * `next-auth`, `@/auth.config`, and `@/lib/rate-limit`, then importing the
 * middleware and calling it with synthetic request objects that carry `req.auth`.
 *
 * Key behaviors tested:
 *   (a) Public path → NextResponse.next() without auth check
 *   (b) Unauthenticated API request → 401 JSON
 *   (c) Unauthenticated HTML request → redirect to /login
 *   (d) tempPassword=true, non-change-password path → redirect to /change-password
 *   (e) tempPassword=true, API path → 403 JSON
 *   (f) partner_user hitting /admin → 403 (API) or redirect to /
 *   (g) tenant_user hitting /admin → 403 (API) or redirect to /
 *   (h) tenant_admin on /portal → allowed (NextResponse.next())
 *   (i) Invalid role → redirect to /login
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────────
const { checkRateLimitMock } = vi.hoisted(() => {
  return {
    checkRateLimitMock: vi.fn(),
  };
});

// The middleware creates `const { auth } = NextAuth(authConfig)` at module level.
// We mock NextAuth so that `auth(handler)` returns a function that calls
// handler(req) where req.auth is whatever we set on req.
vi.mock('next-auth', () => ({
  default: (_config: unknown) => ({
    auth: (handler: (req: unknown) => unknown) => handler,
  }),
}));

vi.mock('@/auth.config', () => ({
  authConfig: {},
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
}));

// Import after mocks
import middlewareDefault from '@/middleware';

// ─── Helpers ───────────────────────────────────────────────────────────────

type FakeSession = {
  user?: {
    id?: string;
    email?: string;
    role?: string;
    tenantId?: string | null;
    tempPassword?: boolean;
  };
} | null;

function makeReq(pathname: string, opts: { session?: FakeSession; method?: string; headers?: Record<string, string> } = {}) {
  const baseUrl = 'http://localhost:3000';
  const url = new URL(pathname, baseUrl);

  const headers = new Headers({
    host: 'localhost:3000',
    'x-real-ip': '1.2.3.4',
    ...(opts.headers ?? {}),
  });

  const req = {
    method: opts.method ?? 'GET',
    url: url.toString(),
    headers,
    nextUrl: url,
    auth: opts.session ?? null,
  };

  return req;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('middleware — rate limiting', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset();
    // Default: rate limit allows request
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
  });

  it('returns 429 when rate limit is exceeded on /api/applications', async () => {
    const resetAt = Date.now() + 60000;
    checkRateLimitMock.mockReturnValue({ allowed: false, remaining: 0, resetAt });

    const req = makeReq('/api/applications', { method: 'POST' });
    const res = await middlewareDefault(req as any, {} as any);

    expect(res).toBeDefined();
    expect((res as Response).status).toBe(429);
    const json = await (res as Response).json();
    expect(json.code).toBe('RATE_LIMITED');
  });

  it('passes through when rate limit is not exceeded', async () => {
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });

    // /api/applications is a PUBLIC_EXACT_PATH — must match exactly (not startsWith)
    const req = makeReq('/api/applications', { method: 'GET', session: null });
    const res = await middlewareDefault(req as any, {} as any);

    // exact match => public path => NextResponse.next()
    // The actual returned value is a NextResponse object
    expect(res).toBeDefined();
    // NextResponse.next() doesn't have status set to 429
    expect((res as Response).status).not.toBe(429);
  });
});

describe('middleware — public paths', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
  });

  it('allows / without auth', async () => {
    const req = makeReq('/', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    // Should not be a redirect to /login — public path passes through
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
    expect((res as Response).status).not.toBe(401);
  });

  it('allows /login without auth', async () => {
    const req = makeReq('/login', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
    expect((res as Response).status).not.toBe(401);
  });

  it('allows /api/stripe/webhook without auth', async () => {
    const req = makeReq('/api/stripe/webhook', { session: null, method: 'POST' });
    const res = await middlewareDefault(req as any, {} as any);
    expect((res as Response).status).not.toBe(401);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
  });

  it('allows /invite/* without auth', async () => {
    const req = makeReq('/invite/some-token', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
  });

  /**
   * The PAGE being public was already asserted above. Nothing asserted the API it depends on, and
   * it was not — so `/invite/<token>` rendered, its `GET /api/invite` fetch answered 401 into a
   * silent catch, and the POST that sets the invitee's password answered 401 too. The whole
   * collaborator-invite flow was dead for exactly the person it exists for: someone with no
   * account, for whom "log in first" is not a step they can take.
   *
   * The reason no test caught it is worth keeping: the page test and the route test each passed in
   * isolation, and the defect lived only in their COMPOSITION. Assert both halves together.
   */
  it('allows /api/invite without auth — the token IS the credential', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const req = makeReq('/api/invite', { session: null, method });
      const res = await middlewareDefault(req as any, {} as any);
      expect((res as Response).status).not.toBe(401);
    }
  });

  it('does NOT open /api/invite as a prefix — only the exact path', async () => {
    // PUBLIC_EXACT_PATHS, never a prefix: /api/invitations or /api/invite/admin must stay gated.
    const req = makeReq('/api/invite/anything-else', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    expect((res as Response).status).toBe(401);
  });

  /**
   * THE PASSWORD-RESET PAGES — the same defect as /api/invite, with a bigger blast radius.
   *
   * Every user can forget a password; only invited collaborators hit the invite path. And this one
   * was a closed loop: /login renders a "Forgot password?" link, clicking it redirected to /login,
   * and a reset EMAIL pointing at /reset-password?token=…&email=… bounced the same way, so the page
   * that consumes the token never ran.
   *
   * Nothing else in the flow was broken — both pages exist and read their query parameters, and
   * POST /api/auth/forgot-password answers 200 {"data":{"sent":true}} because /api/auth/* is
   * public. The API was reachable; the UI in front of it was not.
   *
   * `/change-password` is deliberately NOT here: it requires a session by design, and middleware
   * has its own tempPassword branch for it.
   */
  it('allows the password-reset pages without auth — they are for people who cannot log in', async () => {
    for (const p of ['/forgot-password', '/reset-password']) {
      const req = makeReq(p, { session: null });
      const res = await middlewareDefault(req as any, {} as any);
      const location = (res as Response).headers?.get('location') ?? '';
      expect(location, `${p} must not bounce to /login`).not.toContain('/login');
    }
  });

  it('/reset-password stays public WITH its token query — the emailed link is the real caller', async () => {
    const req = makeReq('/reset-password?token=abc&email=a%40b.com', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
  });

  it('/change-password still REQUIRES a session — it is not a reset page', async () => {
    const req = makeReq('/change-password', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).toContain('/login');
  });

  /**
   * THE DRIFT GUARD — enumerate the public trees from DISK and require middleware to agree.
   *
   * One sweep found three separate omissions from the public lists: `/api/invite`, the two
   * password-reset pages, and `/federal-rd-101` (linked from the homepage twice and sitting in the
   * site nav). Each was found by a different accident. The common cause is structural: a
   * hand-maintained array lives next to a DIRECTORY of public pages, and nothing compares them, so
   * every new marketing page is public-by-intent and gated-by-default until someone notices.
   *
   * Middleware runs on the Edge and cannot read the filesystem, so the array has to stay
   * hand-written. This test is the other half: it walks `app/(marketing)` and `app/(auth)`, drives
   * each route through the real middleware with no session, and fails on any that redirects to
   * /login. Adding a marketing page without listing it now breaks the suite instead of the site.
   *
   * `/change-password` is the one deliberate exception — it is in `(auth)` and legitimately needs a
   * session, which the test above pins from the other direction.
   */
  it('every page under app/(marketing) and app/(auth) is reachable without a session', async () => {
    const { readdirSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const APP = join(process.cwd(), 'app');
    const NEEDS_SESSION_BY_DESIGN = new Set(['/change-password']);

    const routes: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`);
        else if (e.name === 'page.tsx') {
          const r = rel.replace(/\/\([^)]+\)/g, '') || '/';
          // A dynamic segment needs a real value; substitute a plausible one.
          routes.push(r.replace(/\[\w+\]/g, 'sample-slug'));
        }
      }
    };
    for (const group of ['(marketing)', '(auth)']) {
      const d = join(APP, group);
      if (existsSync(d)) walk(d, '');
    }
    expect(routes.length, 'the walk found no pages — the test is not testing anything').toBeGreaterThan(15);

    const gated: string[] = [];
    for (const r of routes) {
      if (NEEDS_SESSION_BY_DESIGN.has(r)) continue;
      const res = await middlewareDefault(makeReq(r, { session: null }) as any, {} as any);
      const location = (res as Response).headers?.get('location') ?? '';
      if (location.includes('/login')) gated.push(r);
    }
    expect(gated, `these public pages redirect anonymous visitors to /login: ${gated.join(', ')}`).toEqual([]);
  });

  it('allows _next static paths without auth', async () => {
    const req = makeReq('/_next/static/chunks/main.js', { session: null });
    const res = await middlewareDefault(req as any, {} as any);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
  });
});

describe('middleware — unauthenticated access', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
  });

  it('returns 401 JSON for unauthenticated API request', async () => {
    const req = makeReq('/api/portal/acme/proposals', { session: null });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(401);
    const json = await (res as Response).json();
    expect(json.error).toBe('unauthenticated');
    // `code` is half the contract — see the envelope test below for why this line exists.
    expect(json.code).toBe('UNAUTHENTICATED');
  });

  /**
   * THE ENVELOPE, AT THE LAYER THAT ANSWERS FIRST.
   *
   * CLAUDE.md: "EVERY error response MUST include both `error` and `code` fields." All 250 route
   * handlers obey it — 2,525 error responses, every one conforming. This middleware fronts all of
   * them and answered `{error:'unauthenticated'}` with no `code` to every caller without a session,
   * which is the most common failure in the product. A client switching on `code` fell through to
   * its default there and nowhere else.
   *
   * It stayed invisible because of WHERE the checks looked: the api-contract lens drives every
   * route through a real logged-in session (deliberately — grading an authed route anonymously
   * answers the wrong question), so it never saw a middleware 401; and the assertions here checked
   * `error` and never `code`. Uncovered, not passing.
   *
   * The tell that it was an oversight rather than a decision: the two rate-limit branches in the
   * same file already carried `code: 'RATE_LIMITED'`.
   */
  it('every middleware error response carries BOTH error and code', async () => {
    const cases: Array<[string, FakeSession | null, number, string]> = [
      ['/api/portal/acme/proposals', null, 401, 'UNAUTHENTICATED'],
      ['/api/portal/acme/proposals', { user: { id: 'u1', role: 'tenant_admin', tempPassword: true } }, 403, 'PASSWORD_CHANGE_REQUIRED'],
      ['/api/admin/tenants', { user: { id: 'u1', role: 'tenant_user' } }, 403, 'FORBIDDEN'],
    ];
    for (const [path, session, status, code] of cases) {
      const req = makeReq(path, { session });
      const res = await middlewareDefault(req as any, {} as any);
      expect((res as Response).status).toBe(status);
      const json = await (res as Response).json();
      expect(typeof json.error, `${path} → error`).toBe('string');
      expect(json.code, `${path} → code`).toBe(code);
    }
  });

  it('redirects unauthenticated HTML request to /login with from param', async () => {
    const req = makeReq('/portal/acme/dashboard', { session: null });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(307); // Next.js redirect
    const location = (res as Response).headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('from=');
  });

  it('redirects unauthenticated admin request to /login', async () => {
    const req = makeReq('/admin/dashboard', { session: null });
    const res = await middlewareDefault(req as any, {} as any);

    const location = (res as Response).headers.get('location') ?? '';
    expect(location).toContain('/login');
  });
});

describe('middleware — tempPassword enforcement', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
  });

  it('redirects tempPassword=true user (HTML) to /change-password', async () => {
    const req = makeReq('/portal/acme/dashboard', {
      session: {
        user: { id: 'u1', email: 'alice@acme.com', role: 'tenant_admin', tempPassword: true },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(307);
    const location = (res as Response).headers.get('location') ?? '';
    expect(location).toContain('/change-password');
  });

  it('returns 403 for tempPassword=true user hitting an API route', async () => {
    const req = makeReq('/api/portal/acme/proposals', {
      session: {
        user: { id: 'u1', email: 'alice@acme.com', role: 'tenant_admin', tempPassword: true },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(403);
    const json = await (res as Response).json();
    expect(json.error).toContain('password change required');
  });

  it('allows tempPassword=true user through /change-password itself', async () => {
    const req = makeReq('/change-password', {
      session: {
        user: { id: 'u1', email: 'alice@acme.com', role: 'tenant_admin', tempPassword: true },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    // /change-password is not in PUBLIC_PATHS but tempPassword guard exempts it
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/change-password'); // no redirect loop
  });

  it('allows tempPassword=true user through /api/auth/change-password', async () => {
    const req = makeReq('/api/auth/change-password', {
      session: {
        user: { id: 'u1', email: 'alice@acme.com', role: 'tenant_admin', tempPassword: true },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    // /api/auth/* is a public path (startsWith /api/auth) — passes before tempPassword check
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/change-password');
    expect((res as Response).status).not.toBe(403);
  });
});

describe('middleware — role-based access control', () => {
  beforeEach(() => {
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60000 });
  });

  it('returns 403 when partner_user hits /api/admin', async () => {
    const req = makeReq('/api/admin/tenants', {
      session: {
        user: { id: 'u1', email: 'partner@acme.com', role: 'partner_user', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(403);
    const json = await (res as Response).json();
    expect(json.error).toBe('forbidden');
  });

  it('redirects partner_user from /admin to / (HTML)', async () => {
    const req = makeReq('/admin/dashboard', {
      session: {
        user: { id: 'u1', email: 'partner@acme.com', role: 'partner_user', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(307);
    const location = (res as Response).headers.get('location') ?? '';
    // Redirect goes to / (not /login) because they ARE authenticated
    expect(location).toMatch(/\/$|\/$/);
  });

  it('returns 403 when tenant_user hits /api/admin', async () => {
    const req = makeReq('/api/admin/rfps', {
      session: {
        user: { id: 'u1', email: 'user@acme.com', role: 'tenant_user', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(403);
    const json = await (res as Response).json();
    expect(json.error).toBe('forbidden');
  });

  it('allows rfp_admin on /api/admin routes', async () => {
    const req = makeReq('/api/admin/rfps', {
      session: {
        user: { id: 'u1', email: 'admin@gov.com', role: 'rfp_admin', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    // Not a 401/403 — should pass through
    expect((res as Response).status).not.toBe(401);
    expect((res as Response).status).not.toBe(403);
  });

  it('returns 403 when rfp_admin hits /api/admin/system (master_admin only)', async () => {
    const req = makeReq('/api/admin/system/migrations', {
      session: {
        user: { id: 'u1', email: 'admin@gov.com', role: 'rfp_admin', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).toBe(403);
    const json = await (res as Response).json();
    expect(json.error).toBe('forbidden');
  });

  it('allows master_admin on /api/admin/system routes', async () => {
    const req = makeReq('/api/admin/system/migrations', {
      session: {
        user: { id: 'u1', email: 'master@gov.com', role: 'master_admin', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).not.toBe(401);
    expect((res as Response).status).not.toBe(403);
  });

  it('allows tenant_admin on /portal routes', async () => {
    const req = makeReq('/portal/acme/dashboard', {
      session: {
        user: { id: 'u1', email: 'admin@acme.com', role: 'tenant_admin', tenantId: 't1', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).not.toBe(401);
    expect((res as Response).status).not.toBe(403);
    const location = (res as Response).headers?.get('location') ?? '';
    expect(location).not.toContain('/login');
  });

  it('allows partner_user on /portal routes (minimum role)', async () => {
    const req = makeReq('/portal/acme/proposals', {
      session: {
        user: { id: 'u1', email: 'partner@ext.com', role: 'partner_user', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    expect((res as Response).status).not.toBe(401);
    expect((res as Response).status).not.toBe(403);
  });

  it('redirects to /login when session user has unknown/invalid role', async () => {
    const req = makeReq('/admin/dashboard', {
      session: {
        user: { id: 'u1', email: 'hacker@evil.com', role: 'not_a_real_role', tempPassword: false },
      },
    });
    const res = await middlewareDefault(req as any, {} as any);

    const location = (res as Response).headers.get('location') ?? '';
    expect(location).toContain('/login');
  });
});
