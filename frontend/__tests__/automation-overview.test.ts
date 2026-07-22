/**
 * Tenant automation-overview API (UI-gaps T2/T4/T5): auth gate + the coverage / task board /
 * per-portal config roll-up shape, including the guardrail_config read-back computation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getTenantBySlugMock, verifyTenantAccessMock, withTenantMock, txMock } = vi.hoisted(() => ({
  authMock: vi.fn(), getTenantBySlugMock: vi.fn(), verifyTenantAccessMock: vi.fn(),
  withTenantMock: vi.fn(), txMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ getTenantBySlug: getTenantBySlugMock, verifyTenantAccess: verifyTenantAccessMock }));
vi.mock('@/lib/rls', () => ({ withTenant: withTenantMock }));

import { GET } from '@/app/api/portal/[tenantSlug]/automation-overview/route';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const session = (role: string) => ({ user: { id: USER, role } });
const ctx = { params: Promise.resolve({ tenantSlug: 'acme' }) };

beforeEach(() => {
  authMock.mockReset();
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  txMock.mockReset();
  withTenantMock.mockReset().mockImplementation(async (_tid: string, fn: (tx: unknown) => Promise<unknown>) => fn(txMock));
});

describe('GET automation-overview', () => {
  it('403 for tenant_user (tenant_admin+ required)', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    expect((await GET(new Request('http://t'), ctx)).status).toBe(403);
  });

  it('401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(new Request('http://t'), ctx)).status).toBe(401);
  });

  it('rolls up coverage (vs catalog), the task board, and each portal config', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    txMock
      .mockResolvedValueOnce([{ scope: 'build', enabled: 2, total: 3 }]) // policyRows
      .mockResolvedValueOnce([{ id: 't1', title: 'Review draft', taskType: 'review_section', status: 'open', assigneeRole: 'tenant_admin', dueAt: null, nudgeSchedule: [1, 3], nudgesSent: 1, entityType: 'section', entityId: 's1', stepName: null }]) // taskRows
      .mockResolvedValueOnce([{ id: 'p1', label: 'Navy STTR', status: 'launched', currentStageIndex: 1, guardrailConfig: { agentFirst: true, rfpOversight: false, stages: [{}, {}], nudgeDays: [5, 2], collaborators: [{ role: 'manager' }, { role: 'collaborator' }] } }]); // portalRows
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    // coverage: build configured=3 (tenant rows), total=5 (catalog), enabled=2
    const build = json.data.coverage.find((c: { scope: string }) => c.scope === 'build');
    expect(build).toMatchObject({ enabled: 2, configured: 3, total: 5 });
    // discovery has no tenant rows → 0 configured but catalog total 1
    const discovery = json.data.coverage.find((c: { scope: string }) => c.scope === 'discovery');
    expect(discovery).toMatchObject({ enabled: 0, configured: 0, total: 1 });
    // task board carries the raw nudge schedule
    expect(json.data.tasks[0].nudgeSchedule).toEqual([1, 3]);
    // portal config read back from guardrail_config
    expect(json.data.portals[0]).toMatchObject({ agentFirst: true, rfpOversight: false, stageCount: 2, managerCount: 1, nudgeDays: [5, 2] });
  });
});
