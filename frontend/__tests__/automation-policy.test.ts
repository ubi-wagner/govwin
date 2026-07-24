/**
 * Unit tests for resolveAutomationPolicy (#190).
 * Covers: framework fallback, tenant override, condition predicate,
 * enabled=false propagation, and null (safe-skip) when nothing is seeded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));

import { resolveAutomationPolicy } from '@/lib/automation/policy';

const TENANT = '11111111-1111-4111-8111-111111111111';

// A minimal framework row matching the seeded constants
const FRAMEWORK_ROW = {
  enabled: true,
  recipient_roles: ['rfp_admin'],
  recipient_users: [],
  recipient_flags: [],
  condition: {},
  due_in_minutes: 4320,
  relative_anchor: null,
  relative_offset_minutes: null,
  nudge_days: [1, 3],
  channel: 'todo',
  cooldown_minutes: 0,
  max_fires_per_hour: 0,
};

beforeEach(() => {
  sqlMock.mockReset();
});

describe('resolveAutomationPolicy', () => {
  it('returns null when no rows found (safe-skip)', async () => {
    sqlMock.mockResolvedValue([]);
    const result = await resolveAutomationPolicy(TENANT, 'proposal:unknown.trigger');
    expect(result).toBeNull();
  });

  it('returns the framework row when no tenant override exists', async () => {
    sqlMock.mockResolvedValue([FRAMEWORK_ROW]);
    const result = await resolveAutomationPolicy(TENANT, 'proposal:proposal.created');
    expect(result).not.toBeNull();
    expect(result!.enabled).toBe(true);
    expect(result!.dueMinutes).toBe(4320);
    expect(result!.nudgeDays).toEqual([1, 3]);
    expect(result!.recipientRoles).toEqual(['rfp_admin']);
    expect(result!.channel).toBe('todo');
  });

  it('tenant row wins over framework for all set fields', async () => {
    const tenantRow = {
      ...FRAMEWORK_ROW,
      recipient_roles: ['tenant_admin'],
      due_in_minutes: 2880, // 48h override
      nudge_days: [2, 5],
      channel: 'email',
      cooldown_minutes: 60,
    };
    // rows[0]=tenant, rows[1]=framework (ORDER BY tenant_id NULLS LAST)
    sqlMock.mockResolvedValue([tenantRow, FRAMEWORK_ROW]);
    const result = await resolveAutomationPolicy(TENANT, 'proposal:proposal.created');
    expect(result!.dueMinutes).toBe(2880);
    expect(result!.nudgeDays).toEqual([2, 5]);
    expect(result!.recipientRoles).toEqual(['tenant_admin']);
    expect(result!.channel).toBe('email');
    expect(result!.cooldownMinutes).toBe(60);
  });

  it('tenant row falls back to framework for empty arrays', async () => {
    const tenantRow = {
      ...FRAMEWORK_ROW,
      recipient_roles: [],   // empty → use framework
      due_in_minutes: null,  // null → use framework
      nudge_days: [],        // empty → use framework
    };
    sqlMock.mockResolvedValue([tenantRow, FRAMEWORK_ROW]);
    const result = await resolveAutomationPolicy(TENANT, 'proposal:proposal.created');
    expect(result!.recipientRoles).toEqual(['rfp_admin']);
    expect(result!.dueMinutes).toBe(4320);
    expect(result!.nudgeDays).toEqual([1, 3]);
  });

  it('enabled=false propagates without merging further', async () => {
    const disabledRow = { ...FRAMEWORK_ROW, enabled: false };
    sqlMock.mockResolvedValue([disabledRow]);
    const result = await resolveAutomationPolicy(TENANT, 'proposal:proposal.created');
    expect(result!.enabled).toBe(false);
  });

  it('condition mismatch returns enabled=false (safe-skip)', async () => {
    const condRow = {
      ...FRAMEWORK_ROW,
      condition: { stage: 'review' }, // must match payload
    };
    sqlMock.mockResolvedValue([condRow]);
    const result = await resolveAutomationPolicy(
      TENANT,
      'proposal:proposal.advanced',
      { payload: { stage: 'draft' } },  // doesn't match
    );
    expect(result!.enabled).toBe(false);
  });

  it('condition match passes through with enabled=true', async () => {
    const condRow = {
      ...FRAMEWORK_ROW,
      condition: { stage: 'review' },
    };
    sqlMock.mockResolvedValue([condRow]);
    const result = await resolveAutomationPolicy(
      TENANT,
      'proposal:proposal.advanced',
      { payload: { stage: 'review' } },  // matches
    );
    expect(result!.enabled).toBe(true);
  });

  it('inherits framework condition when tenant row has empty condition', async () => {
    const tenantRow = { ...FRAMEWORK_ROW, condition: {}, recipient_roles: ['tenant_admin'] };
    const frameworkRow = { ...FRAMEWORK_ROW, condition: { stage: 'review' } };
    // rows[0]=tenant (empty condition), rows[1]=framework (has condition)
    sqlMock.mockResolvedValue([tenantRow, frameworkRow]);
    const mismatch = await resolveAutomationPolicy(
      TENANT, 'proposal:proposal.advanced', { payload: { stage: 'draft' } },
    );
    expect(mismatch!.enabled).toBe(false); // framework condition was inherited and failed
    const match = await resolveAutomationPolicy(
      TENANT, 'proposal:proposal.advanced', { payload: { stage: 'review' } },
    );
    expect(match!.enabled).toBe(true);
  });

  it('null tenantId resolves only the framework row', async () => {
    sqlMock.mockResolvedValue([FRAMEWORK_ROW]);
    const result = await resolveAutomationPolicy(null, 'proposal:proposal.created');
    expect(result!.recipientRoles).toEqual(['rfp_admin']);
    expect(result!.dueMinutes).toBe(4320);
  });

  it('returns null on DB error (safe-skip)', async () => {
    sqlMock.mockRejectedValue(new Error('connection refused'));
    const result = await resolveAutomationPolicy(TENANT, 'proposal:proposal.created');
    expect(result).toBeNull();
  });
});
