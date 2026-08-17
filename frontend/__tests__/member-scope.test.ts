/**
 * tenant_user per-proposal scoping (CAP-3) — PATCH /api/portal/[t]/members/[userId]/scope.
 *
 * Pins the ACL write contract: tenant_admin+ only; requested proposal ids are validated against
 * THIS tenant (a foreign id can't be smuggled into the scope); the write targets an active
 * tenant_user membership; and the capture:member.scope_updated audit event fires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getTenantMock, verifyMock, sqlBypassMock, emitMock } = vi.hoisted(() => {
  const sqlBypassMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  return { authMock: vi.fn(), getTenantMock: vi.fn(), verifyMock: vi.fn(), sqlBypassMock, emitMock: vi.fn() };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ getTenantBySlug: getTenantMock, verifyTenantAccess: verifyMock, sqlBypass: sqlBypassMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitMock, userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));

import { PATCH } from '@/app/api/portal/[tenantSlug]/members/[userId]/scope/route';

const TENANT_ID = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = '11111111-1111-4111-8111-111111111111';
const FOREIGN = '22222222-2222-4222-8222-222222222222';
const ctx = () => ({ params: Promise.resolve({ tenantSlug: 'foundation', userId: USER }) });
const req = (body: unknown) => new Request(`http://localhost/api/portal/foundation/members/${USER}/scope`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', email: 'kate@foundation3dp.com', role: 'tenant_admin' } });
  getTenantMock.mockResolvedValue({ id: TENANT_ID });
  verifyMock.mockResolvedValue(true);
  emitMock.mockResolvedValue(undefined);
});

describe('PATCH members/[userId]/scope — tenant_user per-proposal scoping', () => {
  it('scopes to only THIS tenant\'s proposals (foreign id dropped) + emits event', async () => {
    // 1st sqlBypass call = proposal validation (returns only P1), 2nd = the UPDATE (returns the row).
    sqlBypassMock.mockResolvedValueOnce([{ id: P1 }]).mockResolvedValueOnce([{ id: 'membership-1' }]);
    const res = await PATCH(req({ proposalScoped: true, proposals: [P1, FOREIGN] }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.proposalScoped).toBe(true);
    expect(json.data.proposals).toEqual([P1]); // FOREIGN dropped by tenant validation
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock.mock.calls[0][0].type).toBe('member.scope_updated');
  });

  it('unscope (proposalScoped:false) writes empty scope, no proposal validation query', async () => {
    sqlBypassMock.mockResolvedValueOnce([{ id: 'membership-1' }]); // only the UPDATE runs
    const res = await PATCH(req({ proposalScoped: false, proposals: [P1] }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.proposalScoped).toBe(false);
    expect(sqlBypassMock).toHaveBeenCalledTimes(1); // validation skipped when not scoped
  });

  it('404s when no active tenant_user membership matches', async () => {
    sqlBypassMock.mockResolvedValueOnce([{ id: P1 }]).mockResolvedValueOnce([]); // UPDATE matched nothing
    const res = await PATCH(req({ proposalScoped: true, proposals: [P1] }), ctx());
    expect(res.status).toBe(404);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('rejects a tenant_user caller (403) — no write, no event', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', email: 'x@y.z', role: 'tenant_user' } });
    const res = await PATCH(req({ proposalScoped: true, proposals: [P1] }), ctx());
    expect(res.status).toBe(403);
    expect(sqlBypassMock).not.toHaveBeenCalled();
  });
});
