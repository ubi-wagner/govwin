/**
 * Customer automation preferences API (Phase 3, C3 increment 1):
 * auth gate, GET defaults, PATCH validation + save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, emitEventSingleMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  getTenantBySlugMock: vi.fn(),
  verifyTenantAccessMock: vi.fn(),
  emitEventSingleMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { GET, PATCH } from '@/app/api/portal/[tenantSlug]/automation-preferences/route';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const session = (role: string) => ({ user: { id: USER, email: 'a@b.com', role } });
const ctx = { params: Promise.resolve({ tenantSlug: 'acme' }) };
const patchReq = (body: unknown) =>
  new Request('http://t/api/portal/acme/automation-preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset().mockResolvedValue([]);
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
});

describe('GET automation-preferences', () => {
  it('403 for tenant_user (tenant_admin+ required)', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    expect((await GET(new Request('http://t'), ctx)).status).toBe(403);
  });

  it('returns conservative defaults when no row exists', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    sqlMock.mockResolvedValueOnce([]); // no row
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.preferences.aiReviewOnAdvance).toBe(true);
    expect(json.data.preferences.autoAdvanceWhenAllLocked).toBe(false);
    expect(json.data.configured).toBe(false);
  });
});

describe('PATCH automation-preferences', () => {
  it('401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await PATCH(patchReq({ aiReviewOnAdvance: false }), ctx)).status).toBe(401);
  });

  it('422 for a non-boolean toggle', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const res = await PATCH(patchReq({ aiReviewOnAdvance: 'yes' }), ctx);
    expect(res.status).toBe(422);
  });

  it('400 when no recognized fields are provided', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const res = await PATCH(patchReq({ bogus: true }), ctx);
    expect(res.status).toBe(400);
  });

  it('saves provided toggles and marks configured', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('UPDATE tenant_automation_preferences')) {
        return Promise.resolve([{
          notifyTeamOnDocumentLocked: true,
          notifyCollaboratorsGetReady: true,
          notifyOnStageAdvanced: true,
          notifyOnNewPriorityOpp: true,
          aiReviewOnAdvance: false,
          autoAdvanceWhenAllLocked: true,
          configuredAt: '2026-06-25T00:00:00Z',
        }]);
      }
      return Promise.resolve([]);
    });
    const res = await PATCH(patchReq({ aiReviewOnAdvance: false, autoAdvanceWhenAllLocked: true }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.configured).toBe(true);
    expect(json.data.preferences.aiReviewOnAdvance).toBe(false);
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'capture', type: 'automation_preferences.updated' }),
    );
  });

  it('dual-writes autoAdvanceWhenAllLocked to tenant_automation_policies', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const policyUpserts: string[] = [];
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('INSERT INTO tenant_automation_policies')) {
        policyUpserts.push(q);
        return Promise.resolve([]);
      }
      if (q.includes('UPDATE tenant_automation_preferences')) {
        return Promise.resolve([{
          notifyTeamOnDocumentLocked: true,
          notifyCollaboratorsGetReady: true,
          notifyOnStageAdvanced: true,
          notifyOnNewPriorityOpp: true,
          aiReviewOnAdvance: true,
          autoAdvanceWhenAllLocked: true,
          configuredAt: '2026-06-25T00:00:00Z',
        }]);
      }
      return Promise.resolve([]);
    });
    const res = await PATCH(patchReq({ autoAdvanceWhenAllLocked: true }), ctx);
    expect(res.status).toBe(200);
    // auto_advance_when_all_locked must be dual-written to the new policies table
    expect(policyUpserts.length).toBeGreaterThanOrEqual(1);
  });
});
