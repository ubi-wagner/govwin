/**
 * GET /api/portal/[tenantSlug]/agents/usage — customer AI usage view.
 *
 * Verifies: role gate (tenant_admin+), effective-limit resolution
 * (tenant override → platform default), the AI-disabled signal, and that
 * NO pricing/$ data is ever returned (RATE_MONITORING §7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  getTenantBySlugMock: vi.fn(),
  verifyTenantAccessMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));

import { GET } from '@/app/api/portal/[tenantSlug]/agents/usage/route';
import { NextRequest } from 'next/server';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';

function session(role: string) {
  return { user: { id: USER, email: 'u@example.com', role } };
}
const ctx = { params: Promise.resolve({ tenantSlug: 'acme' }) };
const req = () => new NextRequest('http://t/api/portal/acme/agents/usage?period=30d');

// Keyed sql mock — many queries hit agent_task_log, so match on distinctive text.
function wireSql(opts: {
  totalCalls?: number; totalCost?: string;
  tenantBudget?: string | null; tenantRate?: number | null;
  platformBudget?: string; platformRate?: number; aiEnabled?: boolean;
  callsThisHour?: number;
}) {
  const o = {
    totalCalls: 5, totalCost: '25.00',
    tenantBudget: '100.00', tenantRate: 10,
    platformBudget: '50.00', platformRate: 50, aiEnabled: true,
    callsThisHour: 3,
    ...opts,
  };
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const q = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (q.includes('total_calls')) return Promise.resolve([{ totalCalls: o.totalCalls, totalCostUsd: o.totalCost }]);
    if (q.includes('FROM tenant_agent_config')) return Promise.resolve([{ monthlyBudget: o.tenantBudget, rateLimitPerHour: o.tenantRate }]);
    if (q.includes('FROM platform_agent_config')) return Promise.resolve([{ defaultMonthlyBudget: o.platformBudget, defaultRateLimitPerHour: o.platformRate, aiEnabled: o.aiEnabled }]);
    if (q.includes('calls_this_hour')) return Promise.resolve([{ callsThisHour: o.callsThisHour }]);
    if (q.includes('GROUP BY agent_role')) return Promise.resolve([{ agentRole: 'section_drafter', calls: 4, lastUsed: '2026-06-01T00:00:00Z' }]);
    if (q.includes('LIMIT 20')) return Promise.resolve([{ agentRole: 'section_drafter', taskType: 'proposal.draft_section', createdAt: '2026-06-01T00:00:00Z', durationMs: 1000, humanAccepted: null }]);
    return Promise.resolve([]);
  });
}

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset().mockResolvedValue([]);
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
});

describe('GET portal agents/usage', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(req(), ctx);
    expect(res.status).toBe(401);
  });

  it('403 for tenant_user (tenant_admin+ required)', async () => {
    authMock.mockResolvedValue(session('tenant_user'));
    const res = await GET(req(), ctx);
    expect(res.status).toBe(403);
  });

  it('resolves the effective rate limit + budget from the tenant override', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    wireSql({ tenantBudget: '100.00', tenantRate: 10, totalCost: '25.00', callsThisHour: 3 });
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.summary.budgetUsedPct).toBe(25);          // 25 / 100
    expect(json.data.summary.callsRemainingThisHour).toBe(7);    // 10 - 3 (override, not 50)
    expect(json.data.summary.rateLimitPerHour).toBe(10);
    expect(json.data.summary.aiEnabled).toBe(true);
    expect(json.data.byAgent[0].displayName).toBe('Section Drafter');
  });

  it('falls back to the platform default rate when the tenant has no override', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    wireSql({ tenantRate: null, platformRate: 50, callsThisHour: 2 });
    const res = await GET(req(), ctx);
    const json = await res.json();
    expect(json.data.summary.rateLimitPerHour).toBe(50);
    expect(json.data.summary.callsRemainingThisHour).toBe(48);
  });

  it('signals AI disabled when the tenant budget is 0', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    wireSql({ tenantBudget: '0', tenantRate: null });
    const res = await GET(req(), ctx);
    const json = await res.json();
    expect(json.data.summary.aiEnabled).toBe(false);
    expect(json.data.summary.budgetUsedPct).toBe(100);
  });

  it('never returns pricing/$ data (§7)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    wireSql({});
    const res = await GET(req(), ctx);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toMatch(/cost/i);
    expect(raw).not.toContain('$');
    expect(raw).not.toMatch(/usd/i);
  });
});
