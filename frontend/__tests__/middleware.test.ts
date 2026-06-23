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
