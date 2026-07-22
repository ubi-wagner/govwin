/**
 * Tenant automation-policies API (#190 Phase D2): auth gates, GET catalog merge,
 * PATCH validation (unknown trigger / bad role / bad channel), and a valid upsert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, emitEventSingleMock, withTenantMock, txMock } = vi.hoisted(() => {
  const tx = Object.assign(vi.fn(), { array: (a: unknown) => a });
  return {
    authMock: vi.fn(), sqlMock: vi.fn(), getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(), emitEventSingleMock: vi.fn(),
    withTenantMock: vi.fn(), txMock: tx,
  };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ sql: sqlMock, getTenantBySlug: getTenantBySlugMock, verifyTenantAccess: verifyTenantAccessMock }));
vi.mock('@/lib/rls', () => ({ withTenant: withTenantMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { GET, PATCH } from '@/app/api/portal/[tenantSlug]/automation-policies/route';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const session = (role: string) => ({ user: { id: USER, email: 'a@b.com', role } });
const ctx = { params: Promise.resolve({ tenantSlug: 'acme' }) };
const patchReq = (body: unknown) =>
  new Request('http://t/api/portal/acme/automation-policies', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

beforeEach(() => {
  authMock.mockReset();
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
  txMock.mockReset().mockResolvedValue([]);
  withTenantMock.mockReset().mockImplementation(async (_tid: string, fn: (tx: unknown) => Promise<unknown>) => fn(txMock));
});

describe('GET automation-policies', () => {
  it('403 for tenant_user (tenant_admin+ required)', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    expect((await GET(new Request('http://t'), ctx)).status).toBe(403);
  });

  it('401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(new Request('http://t'), ctx)).status).toBe(401);
  });

  it('returns the full catalog with configured flags merged', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    txMock.mockResolvedValueOnce([
      { scope: 'build', triggerKey: 'proposal:document.locked', enabled: true, recipientRoles: ['tenant_admin'], recipientUsers: [], recipientFlags: [], dueInMinutes: null, nudgeDays: [1, 3], channel: 'email', cooldownMinutes: 0, maxFiresPerHour: 0, configuredAt: '2026-07-01T00:00:00Z' },
    ]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.policies.length).toBeGreaterThanOrEqual(6); // whole catalog
    const docLocked = json.data.policies.find((p: { triggerKey: string }) => p.triggerKey === 'proposal:document.locked');
    expect(docLocked.configured).toBe(true);
    const priorityOpp = json.data.policies.find((p: { triggerKey: string }) => p.triggerKey === 'capture:card.applied');
    expect(priorityOpp.configured).toBe(false); // not in the returned rows
  });
});

describe('PATCH automation-policies', () => {
  it('401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await PATCH(patchReq({ scope: 'build', triggerKey: 'proposal:document.locked' }), ctx)).status).toBe(401);
  });

  it('422 for an unknown / non-tunable trigger (e.g. the framework-hard curation SLA)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    expect((await PATCH(patchReq({ scope: 'build', triggerKey: 'proposal_setup' }), ctx)).status).toBe(422);
  });

  it('422 for an invalid recipient role', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const res = await PATCH(patchReq({ scope: 'build', triggerKey: 'proposal:document.locked', recipientRoles: ['god'] }), ctx);
    expect(res.status).toBe(422);
  });

  it('422 for an invalid channel', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const res = await PATCH(patchReq({ scope: 'build', triggerKey: 'proposal:document.locked', channel: 'carrier_pigeon' }), ctx);
    expect(res.status).toBe(422);
  });

  it('422 for a non-UUID recipient user (not a 500 on the uuid[] bind)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const res = await PATCH(patchReq({ scope: 'build', triggerKey: 'proposal:document.locked', recipientUsers: ['not-a-uuid'] }), ctx);
    expect(res.status).toBe(422);
  });

  it('upserts a valid policy and emits the audit event', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    txMock.mockResolvedValueOnce([
      { scope: 'build', triggerKey: 'proposal:document.locked', enabled: true, recipientRoles: ['tenant_admin'], recipientUsers: [], recipientFlags: [], dueInMinutes: null, nudgeDays: [2], channel: 'both', cooldownMinutes: 30, maxFiresPerHour: 4, configuredAt: '2026-07-22T00:00:00Z' },
    ]);
    const res = await PATCH(patchReq({ scope: 'build', triggerKey: 'proposal:document.locked', enabled: true, recipientRoles: ['tenant_admin'], nudgeDays: [2], channel: 'both', cooldownMinutes: 30, maxFiresPerHour: 4 }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.policy.channel).toBe('both');
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'capture', type: 'automation_preferences.updated' }),
    );
  });
});
