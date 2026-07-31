/**
 * PATCH /api/portal/[tenantSlug]/team/[userId] — change a member's role.
 *
 * Locks in the Phase-2 capability (promote/demote, previously impossible) and its guards:
 *   (a) 403 for a non-admin caller
 *   (b) 400 for an out-of-set role
 *   (c) 400 when changing your own role (no self-lockout)
 *   (d) 400 when demoting the last active admin
 *   (e) 200 demote when another admin remains (+ role_changed event)
 *   (f) 200 promote tenant_user → tenant_admin (no admin-count check)
 *   (g) 404 when the member has no home/manual membership
 *   (h) 200 no-op when the role is unchanged (no UPDATE, no event)
 *
 * Mocked: @/auth, @/lib/db (sql + getTenantBySlug + verifyTenantAccess), @/lib/events,
 *         @/lib/validation. Real: @/lib/rbac (isRole + hasRoleAtLeast) — the gate.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, emitEventSingleMock, isValidUUIDMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  getTenantBySlugMock: vi.fn(),
  verifyTenantAccessMock: vi.fn(),
  emitEventSingleMock: vi.fn(),
  isValidUUIDMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));
vi.mock('@/lib/validation', () => ({ isValidUUID: isValidUUIDMock }));

import { PATCH } from '@/app/api/portal/[tenantSlug]/team/[userId]/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TARGET_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function ctx(userId = TARGET_ID) {
  return { params: Promise.resolve({ tenantSlug: 'acme-navy-systems', userId }) };
}
function req(body: unknown) {
  return new Request(`http://localhost/api/portal/acme-navy-systems/team/${TARGET_ID}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: ADMIN_ID, email: 'admin@acme.test', role: 'tenant_admin' } });
  sqlMock.mockReset();
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT_ID, slug: 'acme-navy-systems' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
  isValidUUIDMock.mockReset().mockReturnValue(true);
});

describe('PATCH team role', () => {
  it('(a) 403 for a non-admin caller', async () => {
    authMock.mockResolvedValue({ user: { id: ADMIN_ID, email: 'u@x.test', role: 'tenant_user' } });
    const res = await PATCH(req({ role: 'tenant_admin' }), ctx());
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('(b) 400 for an out-of-set role', async () => {
    const res = await PATCH(req({ role: 'owner' }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('(c) 400 when changing your own role', async () => {
    const res = await PATCH(req({ role: 'tenant_user' }), ctx(ADMIN_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/your own role/i);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('(d) 400 when demoting the last active admin', async () => {
    sqlMock
      .mockResolvedValueOnce([{ role: 'tenant_admin' }]) // current role
      .mockResolvedValueOnce([{ admins: 0 }]);           // no other admins
    const res = await PATCH(req({ role: 'tenant_user' }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/last active admin/i);
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  it('(e) 200 demote when another admin remains + emits role_changed', async () => {
    sqlMock
      .mockResolvedValueOnce([{ role: 'tenant_admin' }]) // current
      .mockResolvedValueOnce([{ admins: 1 }])            // another admin exists
      .mockResolvedValueOnce([{ role: 'tenant_user' }]); // update returning
    const res = await PATCH(req({ role: 'tenant_user' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ role: 'tenant_user', changed: true });
    expect(emitEventSingleMock).toHaveBeenCalledOnce();
    const ev = emitEventSingleMock.mock.calls[0][0];
    expect(ev.type).toBe('team_member.role_changed');
    expect(ev.payload).toMatchObject({ fromRole: 'tenant_admin', toRole: 'tenant_user' });
  });

  it('(f) 200 promote tenant_user → tenant_admin (no admin-count check)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ role: 'tenant_user' }]) // current
      .mockResolvedValueOnce([{ role: 'tenant_admin' }]); // update returning
    const res = await PATCH(req({ role: 'tenant_admin' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.role).toBe('tenant_admin');
    expect(sqlMock).toHaveBeenCalledTimes(2); // no last-admin count query on promote
  });

  it('(g) 404 when the member has no home/manual membership', async () => {
    sqlMock.mockResolvedValueOnce([]); // no current membership
    const res = await PATCH(req({ role: 'tenant_admin' }), ctx());
    expect(res.status).toBe(404);
  });

  it('(h) 200 no-op when the role is unchanged (no UPDATE, no event)', async () => {
    sqlMock.mockResolvedValueOnce([{ role: 'tenant_admin' }]); // current already admin
    const res = await PATCH(req({ role: 'tenant_admin' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ role: 'tenant_admin', changed: false });
    expect(sqlMock).toHaveBeenCalledTimes(1); // only the current-role read
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});
