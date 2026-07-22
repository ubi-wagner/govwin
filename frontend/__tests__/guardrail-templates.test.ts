/**
 * Portal guardrail-templates API (the config-templates capability): auth gate, GET list shape,
 * POST validation (name required, config validated against the framework caps), valid save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, emitMock, getLimitsMock, validateMock } = vi.hoisted(() => ({
  authMock: vi.fn(), sqlMock: vi.fn(), getTenantBySlugMock: vi.fn(),
  verifyTenantAccessMock: vi.fn(), emitMock: vi.fn(), getLimitsMock: vi.fn(), validateMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ sql: Object.assign(sqlMock, { json: (x: unknown) => x }), getTenantBySlug: getTenantBySlugMock, verifyTenantAccess: verifyTenantAccessMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitMock, userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));
vi.mock('@/lib/portal-workflow', () => ({ getGuardrailLimits: getLimitsMock, validateGuardrailConfig: validateMock }));

import { GET, POST } from '@/app/api/portal/[tenantSlug]/guardrail-templates/route';

const USER = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const session = (role: string) => ({ user: { id: USER, email: 'a@b.com', role } });
const ctx = { params: Promise.resolve({ tenantSlug: 'acme' }) };
const post = (body: unknown) => new Request('http://t', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const CONFIG = { nudgeDays: [5, 2, 1], stages: [{ key: 'draft', todos: [{ type: 'acknowledge' }] }] };

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset().mockResolvedValue([]);
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  emitMock.mockReset().mockResolvedValue(undefined);
  getLimitsMock.mockReset().mockResolvedValue({ maxStages: 3, maxCollaborators: 25, maxManagers: 25, maxNudges: 3 });
  validateMock.mockReset().mockReturnValue({ ok: true, errors: [] });
});

describe('guardrail-templates', () => {
  it('403 for tenant_user (tenant_admin+ required)', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    expect((await GET(new Request('http://t'), ctx)).status).toBe(403);
  });

  it('GET returns the platform∪tenant template list', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    sqlMock.mockResolvedValueOnce([
      { id: 'd', name: 'System Defaults', description: null, config: {}, isDefault: true, scope: 'platform', updatedAt: 't' },
      { id: 'u', name: 'USAF CSO STTR', description: null, config: CONFIG, isDefault: false, scope: 'tenant', updatedAt: 't' },
    ]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.templates.map((t: { name: string }) => t.name)).toContain('USAF CSO STTR');
  });

  it('POST 422 without a name', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    expect((await POST(post({ config: CONFIG }), ctx)).status).toBe(422);
  });

  it('POST 422 for a whitespace-only name', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    expect((await POST(post({ name: '   ', config: CONFIG }), ctx)).status).toBe(422);
  });

  it('POST 422 for a name over 120 chars', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    expect((await POST(post({ name: 'x'.repeat(121), config: CONFIG }), ctx)).status).toBe(422);
  });

  it('POST 422 when config is an array, a string, or null (not a config object)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    for (const bad of [[], 'nope', null, 42]) {
      expect((await POST(post({ name: 'X', config: bad }), ctx)).status).toBe(422);
    }
  });

  it('POST 401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(post({ name: 'X', config: CONFIG }), ctx)).status).toBe(401);
  });

  it('POST still 200 when the audit-event emit throws (best-effort)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    emitMock.mockRejectedValue(new Error('bus down'));
    sqlMock.mockResolvedValueOnce([{ id: 'n', name: 'X', description: null, config: CONFIG, isDefault: false, scope: 'tenant', updatedAt: 't' }]);
    expect((await POST(post({ name: 'X', config: CONFIG }), ctx)).status).toBe(200);
  });

  it('GET 500 with error+code when the query throws', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('DB_ERROR');
  });

  it('POST 422 when the config fails the framework-cap validation', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    validateMock.mockReturnValue({ ok: false, errors: ['too many stages (max 3)'] });
    expect((await POST(post({ name: 'X', config: CONFIG }), ctx)).status).toBe(422);
  });

  it('POST saves a valid named template', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    sqlMock.mockResolvedValueOnce([{ id: 'new', name: 'USAF CSO STTR', description: null, config: CONFIG, isDefault: false, scope: 'tenant', updatedAt: 't' }]);
    const res = await POST(post({ name: 'USAF CSO STTR', config: CONFIG }), ctx);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.template.name).toBe('USAF CSO STTR');
    expect(emitMock).toHaveBeenCalled();
  });
});
