/**
 * Amendment fan-out engine (M3) — audit contracts across the three routes.
 *
 * Verifies the admin gate + the namespaced start/end (and single) events for the whole chain:
 *   log      → finder:amendment.detected
 *   confirm  → finder:amendment.confirmed + one capture:amendment.flagged per affected tenant
 *   acknowledge → proposal:amendment.acknowledged
 * The real lib/amendments helpers run against mocked @/lib/events + @/lib/db — the audit guarantee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock,
  emitEventStartMock, emitEventEndMock, emitEventSingleMock,
} = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
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
}));

import { POST as logPost } from '@/app/api/admin/rfp-curation/[solId]/amendments/route';
import { POST as actPost } from '@/app/api/admin/rfp-curation/[solId]/amendments/[amendmentId]/route';
import { POST as ackPost } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/amendments/route';

const SOL_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const AMD_ID = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TENANT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROP_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FLAG_ID = '99999999-9999-4999-8999-999999999999';

function adminSession(role: string) {
  return { user: { id: ADMIN_ID, email: 'rfp@pipeline.com', role } };
}

beforeEach(() => {
  vi.clearAllMocks();
  emitEventStartMock.mockResolvedValue('evt-start');
  emitEventEndMock.mockResolvedValue(undefined);
  emitEventSingleMock.mockResolvedValue(undefined);
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
  verifyTenantAccessMock.mockResolvedValue(true);
  sqlMock.mockResolvedValue([]);
});

describe('amendment engine — audit contracts', () => {
  it('log rejects a tenant_admin (403)', async () => {
    authMock.mockResolvedValue(adminSession('tenant_admin'));
    const req = new Request(`http://localhost/x`, { method: 'POST', body: JSON.stringify({ label: 'A', summary: 'B' }) });
    const res = await logPost(req, { params: Promise.resolve({ solId: SOL_ID }) });
    expect(res.status).toBe(403);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('log → emits finder:amendment.detected', async () => {
    authMock.mockResolvedValue(adminSession('rfp_admin'));
    // existence check, then the INSERT RETURNING id
    sqlMock.mockResolvedValueOnce([{ id: SOL_ID }]).mockResolvedValueOnce([{ id: AMD_ID }]);
    const req = new Request(`http://localhost/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Amendment 0002', summary: 'page limit changed', severity: 'critical', complianceDelta: [{ change: 'changed', requirement: 'page limit', detail: '15→20' }] }),
    });
    const res = await logPost(req, { params: Promise.resolve({ solId: SOL_ID }) });
    expect(res.status).toBe(200);
    const arg = emitEventStartMock.mock.calls[0][0];
    expect(arg.namespace).toBe('finder');
    expect(arg.type).toBe('amendment.detected');
    expect(arg.payload.severity).toBe('critical');
  });

  it('confirm → finder:amendment.confirmed + one capture:amendment.flagged per tenant', async () => {
    authMock.mockResolvedValue(adminSession('rfp_admin'));
    // confirmAmendment: UPDATE cas → [{id}], then INSERT...SELECT fan-out → tenant rows (t1 twice, t2 once)
    sqlMock
      .mockResolvedValueOnce([{ id: AMD_ID }])
      .mockResolvedValueOnce([{ tenantId: 't1' }, { tenantId: 't1' }, { tenantId: 't2' }]);
    const req = new Request(`http://localhost/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    const res = await actPost(req, { params: Promise.resolve({ solId: SOL_ID, amendmentId: AMD_ID }) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.flagged).toBe(3);
    expect(j.data.tenants).toBe(2);
    // admin audit
    const confirmEvt = emitEventStartMock.mock.calls[0][0];
    expect(confirmEvt.namespace).toBe('finder');
    expect(confirmEvt.type).toBe('amendment.confirmed');
    // one customer event per DISTINCT tenant
    const flaggedTypes = emitEventSingleMock.mock.calls.map((c) => c[0]);
    expect(flaggedTypes).toHaveLength(2);
    expect(flaggedTypes.every((e) => e.namespace === 'capture' && e.type === 'amendment.flagged')).toBe(true);
    expect(new Set(flaggedTypes.map((e) => e.tenantId))).toEqual(new Set(['t1', 't2']));
  });

  it('acknowledge rejects a tenant_user (403)', async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: 'u@acme.com', role: 'tenant_user' } });
    const req = new Request(`http://localhost/x`, { method: 'POST', body: JSON.stringify({ flagId: FLAG_ID }) });
    const res = await ackPost(req, { params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROP_ID }) });
    expect(res.status).toBe(403);
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  it('acknowledge → proposal:amendment.acknowledged', async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: 'a@acme.com', role: 'tenant_admin' } });
    sqlMock.mockResolvedValueOnce([{ amendmentId: AMD_ID }]); // the UPDATE RETURNING
    const req = new Request(`http://localhost/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flagId: FLAG_ID }),
    });
    const res = await ackPost(req, { params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROP_ID }) });
    expect(res.status).toBe(200);
    const evt = emitEventSingleMock.mock.calls[0][0];
    expect(evt.namespace).toBe('proposal');
    expect(evt.type).toBe('amendment.acknowledged');
    expect(evt.tenantId).toBe(TENANT_ID);
  });
});
