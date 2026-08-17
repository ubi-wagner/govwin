/**
 * Revoke partner-manager (CAP-2) — DELETE /api/portal/[t]/managers/[membershipId].
 *
 * Pins the destructive-capability contract: tenant_admin+ only; a compare-and-swap that flips ONLY
 * an active partner_manager membership for THIS tenant (a double-revoke → 404); and the
 * finder:partner.manager_revoked audit event on success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getTenantMock, verifyMock, sqlBypassMock, emitMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getTenantMock: vi.fn(),
  verifyMock: vi.fn(),
  sqlBypassMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ getTenantBySlug: getTenantMock, verifyTenantAccess: verifyMock, sqlBypass: sqlBypassMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitMock, userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));

import { DELETE } from '@/app/api/portal/[tenantSlug]/managers/[membershipId]/route';

const TENANT_ID = '17780cad-76c0-4cef-95ec-2a536bcf5c8f';
const MEMBERSHIP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ctx = () => ({ params: Promise.resolve({ tenantSlug: 'foundation', membershipId: MEMBERSHIP }) });
const req = () => new Request(`http://localhost/api/portal/foundation/managers/${MEMBERSHIP}`, { method: 'DELETE' });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', email: 'kate@foundation3dp.com', role: 'tenant_admin' } });
  getTenantMock.mockResolvedValue({ id: TENANT_ID });
  verifyMock.mockResolvedValue(true);
  emitMock.mockResolvedValue(undefined);
});

describe('DELETE managers/[membershipId] — revoke partner-manager', () => {
  it('revokes an active membership + emits finder:partner.manager_revoked', async () => {
    sqlBypassMock.mockResolvedValue([{ userId: 'partner-9' }]);
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.revoked).toBe(true);
    expect(sqlBypassMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledTimes(1);
    const evt = emitMock.mock.calls[0][0];
    expect(evt.namespace).toBe('finder');
    expect(evt.type).toBe('partner.manager_revoked');
    expect(evt.tenantId).toBe(TENANT_ID);
    expect(evt.payload.revokedUserId).toBe('partner-9');
  });

  it('404s a double-revoke (CAS matched 0 rows) — no event', async () => {
    sqlBypassMock.mockResolvedValue([]);
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('rejects a tenant_user (403) — no DB write, no event', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', email: 'x@y.z', role: 'tenant_user' } });
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(403);
    expect(sqlBypassMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('400s an invalid membership id', async () => {
    const badCtx = () => ({ params: Promise.resolve({ tenantSlug: 'foundation', membershipId: 'not-a-uuid' }) });
    const res = await DELETE(req(), badCtx());
    expect(res.status).toBe(400);
    expect(sqlBypassMock).not.toHaveBeenCalled();
  });
});
