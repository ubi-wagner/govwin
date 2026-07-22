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

  it('rolls up coverage (default-ON vs catalog), totals, the task board, and each portal config', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    // Route runs FOUR tx queries in order: policyRows, taskRows, totals, portalRows.
    txMock
      .mockResolvedValueOnce([{ scope: 'build', enabled: 2, disabled: 1, total: 3 }]) // policyRows: 3 build rows, 1 explicitly disabled
      .mockResolvedValueOnce([{ id: 't1', title: 'Review draft', taskType: 'review_section', status: 'open', assigneeRole: 'tenant_admin', dueAt: null, nudgeSchedule: [1, 3], nudgesSent: 1, entityType: 'section', entityId: 's1', stepName: null }]) // taskRows
      .mockResolvedValueOnce([{ openTotal: 1, escalatedTotal: 0 }]) // totals (true count over ALL open, not the capped list)
      .mockResolvedValueOnce([{ id: 'p1', label: 'Navy STTR', status: 'launched', currentStageIndex: 1, guardrailConfig: { agentFirst: true, rfpOversight: false, stages: [{}, {}], nudgeDays: [5, 2], collaborators: [{ role: 'manager' }, { role: 'collaborator' }] } }]); // portalRows
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Default-ON (F3): enabled = catalogTotal − explicit disables, NOT the enabled-row count.
    // build: catalog total 5, 1 disabled → enabled 4; configured=3 (tenant rows).
    const build = json.data.coverage.find((c: { scope: string }) => c.scope === 'build');
    expect(build).toMatchObject({ enabled: 4, configured: 3, total: 5 });
    // discovery has no tenant rows → nothing disabled → all catalog triggers on (enabled = total 1).
    const discovery = json.data.coverage.find((c: { scope: string }) => c.scope === 'discovery');
    expect(discovery).toMatchObject({ enabled: 1, configured: 0, total: 1 });
    // Headline totals (F4) are the TRUE counts, passed straight through from the totals query.
    expect(json.data.openTotal).toBe(1);
    expect(json.data.escalatedTotal).toBe(0);
    // task board carries the raw nudge schedule
    expect(json.data.tasks[0].nudgeSchedule).toEqual([1, 3]);
    // portal config read back from guardrail_config
    expect(json.data.portals[0]).toMatchObject({ agentFirst: true, rfpOversight: false, stageCount: 2, managerCount: 1, nudgeDays: [5, 2] });
  });

  it('empty tenant → 200, default-ON coverage (all catalog triggers on), zeroed tasks/portals', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    txMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ openTotal: 0, escalatedTotal: 0 }]).mockResolvedValueOnce([]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.tasks).toEqual([]);
    expect(json.data.portals).toEqual([]);
    // Default-ON: an un-configured tenant has NOTHING disabled, so EVERY catalog trigger is on
    // (enabled = total). configured=0. This is the F3 fix — the old code showed 0/N-on here.
    expect(json.data.coverage.find((c: { scope: string }) => c.scope === 'discovery')).toMatchObject({ enabled: 1, configured: 0, total: 1 });
    expect(json.data.coverage.find((c: { scope: string }) => c.scope === 'build')).toMatchObject({ enabled: 5, configured: 0, total: 5 });
    expect(json.data.openTotal).toBe(0);
    expect(json.data.escalatedTotal).toBe(0);
  });

  it('malformed / legacy guardrail_config → safe defaults, never throws', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    txMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ openTotal: 0, escalatedTotal: 0 }]) // totals
      .mockResolvedValueOnce([
        { id: 'p1', label: null, status: 'launched', currentStageIndex: 0, guardrailConfig: null },                 // null config
        { id: 'p2', label: 'Legacy', status: 'launched', currentStageIndex: 0, guardrailConfig: '{}' },              // jsonb-as-string
        { id: 'p3', label: 'Partial', status: 'launched', currentStageIndex: 0, guardrailConfig: { agentFirst: 'yes' } }, // wrong types / missing arrays
      ]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const [p1, p2, p3] = (await res.json()).data.portals;
    expect(p1).toMatchObject({ label: 'Untitled portal', agentFirst: false, rfpOversight: true, stageCount: 0, managerCount: 0, nudgeDays: [] });
    expect(p2).toMatchObject({ stageCount: 0, managerCount: 0 });
    expect(p3.agentFirst).toBe(false); // 'yes' is not === true
  });

  it('degenerate task rows (null dueAt, empty/overrun nudges) coerce safely', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    txMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 't1', title: 'A', taskType: 'x', status: 'open', assigneeRole: null, dueAt: null, nudgeSchedule: null, nudgesSent: 0, entityType: null, entityId: null, stepName: null },
        { id: 't2', title: 'B', taskType: 'x', status: 'open', assigneeRole: null, dueAt: '2020-01-01T00:00:00Z', nudgeSchedule: [], nudgesSent: 9, entityType: null, entityId: null, stepName: null },
      ])
      .mockResolvedValueOnce([{ openTotal: 2, escalatedTotal: 1 }]) // totals: t2 is overdue → escalated
      .mockResolvedValueOnce([]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body.tasks[0].nudgeSchedule).toEqual([]); // null coerced to []
    expect(body.tasks[1].nudgeSchedule).toEqual([]);
    expect(body.openTotal).toBe(2);
    expect(body.escalatedTotal).toBe(1);
  });

  it('DB error → 500 with error+code (never leaks / never throws)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    withTenantMock.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBe('DB_ERROR');
  });

  it('wrong-tenant access denied (verifyTenantAccess=false → 403)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    verifyTenantAccessMock.mockResolvedValue(false);
    expect((await GET(new Request('http://t'), ctx)).status).toBe(403);
  });
});
