/**
 * Archive lifecycle (V1-11) — restore/delete route gating + the restore audit contract.
 * The FK-safe permanent delete transaction is proven by a live DB rollback test; here we cover auth,
 * validation, and that restore emits proposal:proposal.restored via the real restoreProposal helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, emitEventStartMock, emitEventEndMock, emitEventSingleMock } =
  vi.hoisted(() => {
    const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v, begin: vi.fn() });
    return {
      authMock: vi.fn(),
      sqlMock,
      getTenantBySlugMock: vi.fn(),
      verifyTenantAccessMock: vi.fn(),
      emitEventStartMock: vi.fn(),
      emitEventEndMock: vi.fn(),
      emitEventSingleMock: vi.fn(),
    };
  });

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
  systemActor: (id = 'system') => ({ type: 'system', id }),
}));

import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/archive/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROP_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function session(role: string) {
  return { user: { id: USER_ID, email: 'a@acme.com', role, tenantId: TENANT_ID } };
}
const ctx = () => ({ params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROP_ID }) });
const req = (body: unknown) =>
  new Request(`http://localhost/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(session('tenant_admin'));
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
  verifyTenantAccessMock.mockResolvedValue(true);
  emitEventStartMock.mockResolvedValue('evt');
  emitEventEndMock.mockResolvedValue(undefined);
  emitEventSingleMock.mockResolvedValue(undefined);
  sqlMock.mockResolvedValue([]);
});

describe('archive route', () => {
  it('rejects a tenant_user (403)', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    const res = await POST(req({ action: 'restore' }), ctx());
    expect(res.status).toBe(403);
  });

  it('rejects a bad action (400)', async () => {
    const res = await POST(req({ action: 'nope' }), ctx());
    expect(res.status).toBe(400);
  });

  it('restore → emits proposal:proposal.restored', async () => {
    // restoreProposal: UPDATE cas → [{id}], then stage_history INSERT → []
    sqlMock.mockResolvedValueOnce([{ id: PROP_ID }]);
    const res = await POST(req({ action: 'restore' }), ctx());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.restored).toBe(true);
    const arg = emitEventStartMock.mock.calls[0][0];
    expect(arg.namespace).toBe('proposal');
    expect(arg.type).toBe('proposal.restored');
    expect(arg.tenantId).toBe(TENANT_ID);
  });

  it('restore of a non-archived proposal → 409', async () => {
    sqlMock.mockResolvedValue([]); // UPDATE affected nothing
    const res = await POST(req({ action: 'restore' }), ctx());
    expect(res.status).toBe(409);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });
});
