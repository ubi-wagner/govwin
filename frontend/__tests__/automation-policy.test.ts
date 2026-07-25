/**
 * Unit tests for the automation-policy resolver (#190 Phase B).
 * Covers the four-tier precedence, the framework-hard curation-SLA pin, the
 * nudge-count cap, enabled=false safe-skip, and the fail-safe fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));
// withTenant passthrough → the tenant-policy read goes through sqlMock (call #2) as before.
vi.mock('@/lib/rls', () => ({ withTenant: (_t: string, fn: (tx: unknown) => unknown) => fn(sqlMock) }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn(), info: vi.fn() }) }),
}));

import { resolveGatePolicy } from '@/lib/automation/policy';

const TID = '11111111-1111-4111-8111-111111111111';
const FRAMEWORK = { curationSlaMinutes: 4320, defaultNudgeDays: [1, 3], defaultDueInMinutes: 4320, maxNudgesPerGate: 3 };
const GATE = { assigneeRole: 'rfp_admin', nudgeDays: [1, 3], dueInMinutes: 4320 };

beforeEach(() => sqlMock.mockReset());

describe('resolveGatePolicy', () => {
  it('no tenant policy → gate defaults verbatim (regression-safe)', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]).mockResolvedValueOnce([]); // framework, then no policy
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'admin_review', gateDefaults: GATE });
    expect(r.assigneeRole).toBe('rfp_admin');
    expect(r.nudgeDays).toEqual([1, 3]);
    expect(r.dueInMinutes).toBe(4320);
    expect(r.enabled).toBe(true);
    expect(r.source.tenantPolicy).toBe(false);
  });

  it('tenant policy overrides nudges / due / channel / caps', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]).mockResolvedValueOnce([
      { enabled: true, nudgeDays: [2], dueInMinutes: 1440, channel: 'both', cooldownMinutes: 60, maxFiresPerHour: 5 },
    ]);
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'admin_review', gateDefaults: GATE });
    expect(r.nudgeDays).toEqual([2]);
    expect(r.dueInMinutes).toBe(1440);
    expect(r.channel).toBe('both');
    expect(r.cooldownMinutes).toBe(60);
    expect(r.maxFiresPerHour).toBe(5);
    expect(r.source.tenantPolicy).toBe(true);
  });

  it('tenant recipient_roles drives the assignee — first role wins (A3)', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]).mockResolvedValueOnce([
      { enabled: true, recipientRoles: ['tenant_user', 'partner_user'], nudgeDays: null, dueInMinutes: null, channel: null, cooldownMinutes: 0, maxFiresPerHour: 0 },
    ]);
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'section_review', gateDefaults: GATE });
    expect(r.assigneeRole).toBe('tenant_user'); // NOT the gate default 'rfp_admin'
  });

  it('empty recipient_roles leaves the gate-default assignee (regression-safe)', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]).mockResolvedValueOnce([
      { enabled: true, recipientRoles: [], nudgeDays: null, dueInMinutes: null, channel: null, cooldownMinutes: 0, maxFiresPerHour: 0 },
    ]);
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'section_review', gateDefaults: GATE });
    expect(r.assigneeRole).toBe('rfp_admin');
  });

  it('curation SLA is framework-HARD: tenant due is ignored when pinned (⑦)', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]).mockResolvedValueOnce([
      { enabled: true, nudgeDays: [5], dueInMinutes: 99999, channel: null, cooldownMinutes: 0, maxFiresPerHour: 0 },
    ]);
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'proposal_setup', gateDefaults: GATE, pinnedToCurationSla: true });
    expect(r.dueInMinutes).toBe(4320);            // framework SLA, NOT the tenant's 99999
    expect(r.source.frameworkPinned).toBe(true);
    expect(r.nudgeDays).toEqual([5]);             // nudges are still tenant-tunable (only due is pinned)
  });

  it('framework caps the nudge count at maxNudgesPerGate', async () => {
    sqlMock.mockResolvedValueOnce([{ ...FRAMEWORK, maxNudgesPerGate: 2 }]).mockResolvedValueOnce([
      { enabled: true, nudgeDays: [1, 2, 3, 4], dueInMinutes: null, channel: null, cooldownMinutes: 0, maxFiresPerHour: 0 },
    ]);
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'admin_review', gateDefaults: GATE });
    expect(r.nudgeDays).toEqual([1, 2]);
  });

  it('enabled=false from policy → safe-skip signal', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]).mockResolvedValueOnce([
      { enabled: false, nudgeDays: null, dueInMinutes: null, channel: null, cooldownMinutes: 0, maxFiresPerHour: 0 },
    ]);
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'admin_review', gateDefaults: GATE });
    expect(r.enabled).toBe(false);
  });

  it('DB error → gate defaults (fail-safe, never throws)', async () => {
    // reject each of the two reads (framework, tenant policy) exactly once so nothing floats
    sqlMock.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('db down'));
    const r = await resolveGatePolicy({ tenantId: TID, scope: 'build', triggerKey: 'admin_review', gateDefaults: GATE });
    expect(r.assigneeRole).toBe('rfp_admin');
    expect(r.nudgeDays).toEqual([1, 3]);
    expect(r.dueInMinutes).toBe(4320);
    expect(r.enabled).toBe(true);
  });

  it('null tenantId (admin gate) → framework/gate defaults, no policy read', async () => {
    sqlMock.mockResolvedValueOnce([FRAMEWORK]);
    const r = await resolveGatePolicy({ tenantId: null, scope: 'build', triggerKey: 'admin_review', gateDefaults: GATE });
    expect(r.source.tenantPolicy).toBe(false);
    expect(sqlMock).toHaveBeenCalledTimes(1); // framework only; tenant policy read skipped
  });
});
