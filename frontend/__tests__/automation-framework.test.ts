/**
 * Admin automation-framework API (#190 Phase D3): admin gate, GET, PATCH validation +
 * update. The "this changes the framework" control plane (RFP-Pipeline admin only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, emitEventSingleMock } = vi.hoisted(() => ({
  authMock: vi.fn(), sqlMock: vi.fn(), emitEventSingleMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitEventSingleMock }));

import { GET, PATCH } from '@/app/api/admin/automation-framework/route';

const FRAMEWORK = {
  curationSlaMinutes: 4320, defaultNudgeDays: [1, 3], defaultDueInMinutes: 4320,
  maxBucketsPerTenant: 12, maxNudgesPerGate: 3, agentMonthlyBudgetCeilingUsd: '200.00',
  agentAutoRunDefault: false, overlayFrameworks: [], updatedAt: '2026-07-22T00:00:00Z',
};
const session = (role: string) => ({ user: { id: 'u1', email: 'a@b.com', role } });
const patchReq = (body: unknown) =>
  new Request('http://t/api/admin/automation-framework', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset().mockResolvedValue([FRAMEWORK]);
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
});

describe('GET automation-framework', () => {
  it('403 for a tenant_admin (RFP-Pipeline admin only)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    expect((await GET()).status).toBe(403);
  });
  it('200 returns the framework for rfp_admin', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data.framework.curationSlaMinutes).toBe(4320);
  });
});

describe('PATCH automation-framework', () => {
  it('401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await PATCH(patchReq({ curationSlaMinutes: 5760 }))).status).toBe(401);
  });
  it('403 for tenant_admin', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    expect((await PATCH(patchReq({ curationSlaMinutes: 5760 }))).status).toBe(403);
  });
  it('422 for a non-positive integer field', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    expect((await PATCH(patchReq({ maxBucketsPerTenant: -1 }))).status).toBe(422);
  });
  it('422 for a negative agent budget ceiling', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    expect((await PATCH(patchReq({ agentMonthlyBudgetCeilingUsd: -5 }))).status).toBe(422);
  });
  it('400 when no valid fields provided', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    expect((await PATCH(patchReq({ bogus: 1 }))).status).toBe(400);
  });
  it('200 updates + emits the admin audit event', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    const res = await PATCH(patchReq({ curationSlaMinutes: 5760, agentAutoRunDefault: true }));
    expect(res.status).toBe(200);
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'system', type: 'automation_framework.updated', tenantId: null }),
    );
  });
});
