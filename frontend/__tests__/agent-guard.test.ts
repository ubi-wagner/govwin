/**
 * Unified AI spend guard (lib/ai/agent-guard.ts).
 *
 * Covers the cost-control rails the live product-AI surfaces (Draft
 * tool, Compliance route) now share with the Python AgentFabric:
 *   - computeCostUsd: per-model pricing + unknown-model fallback
 *   - AiRateLimitError / AiBudgetExceededError: status + code
 *   - assertAgentBudget: within-limit, rate-exceeded, budget disabled,
 *     budget exceeded, default-budget, and FAIL-CLOSED on DB error
 *   - recordAgentSpend: cost computed + best-effort (never throws)
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));

import {
  assertAgentBudget,
  recordAgentSpend,
  computeCostUsd,
  AiRateLimitError,
  AiBudgetExceededError,
  RATE_LIMIT_PER_HOUR,
  DEFAULT_MONTHLY_BUDGET_USD,
} from '@/lib/ai/agent-guard';

const TENANT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('computeCostUsd', () => {
  it('prices Sonnet at $3/$15 per 1M', () => {
    expect(computeCostUsd('claude-sonnet-4-20250514', 1_000_000, 1_000_000)).toBeCloseTo(18, 6);
  });

  it('prices Haiku 4.5 at $1/$5 per 1M', () => {
    expect(computeCostUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBeCloseTo(6, 6);
  });

  it('falls back to Sonnet pricing for an unknown model', () => {
    expect(computeCostUsd('some-future-model', 1_000_000, 0)).toBeCloseTo(3, 6);
  });

  it('is zero for zero tokens', () => {
    expect(computeCostUsd('claude-haiku-4-5-20251001', 0, 0)).toBe(0);
  });
});

describe('guard error types', () => {
  it('AiRateLimitError is a 429 / AI_RATE_LIMITED', () => {
    const e = new AiRateLimitError();
    expect(e.httpStatus).toBe(429);
    expect(e.code).toBe('AI_RATE_LIMITED');
  });

  it('AiBudgetExceededError is a 402 / AI_BUDGET_EXCEEDED', () => {
    const e = new AiBudgetExceededError();
    expect(e.httpStatus).toBe(402);
    expect(e.code).toBe('AI_BUDGET_EXCEEDED');
  });
});

// Query order inside assertAgentBudget:
//   1. platform_agent_config (best-effort)
//   2. tenant_agent_config   (fail closed)
//   3. hourly count          (fail closed)
//   4. tenant month sum      (fail closed)
//   5. platform cap sum      (only when a cap is set; fail closed)
const platformRow = (over: Record<string, unknown> = {}) => [
  { aiEnabled: true, defaultMonthlyBudget: '50.00', defaultRateLimitPerHour: 50, platformMonthlyCap: null, ...over },
];
const tenantRow = (over: Record<string, unknown> = {}) => [
  { monthlyBudget: '50.00', rateLimitPerHour: null, ...over },
];

describe('assertAgentBudget', () => {
  it('resolves when under the hourly limit and the monthly budget', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockResolvedValueOnce(tenantRow())
      .mockResolvedValueOnce([{ cnt: '10' }])
      .mockResolvedValueOnce([{ total: '5.00' }]);
    await expect(assertAgentBudget(TENANT)).resolves.toBeUndefined();
    expect(sqlMock).toHaveBeenCalledTimes(4);
  });

  it('throws AiRateLimitError at the platform-default hourly limit', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockResolvedValueOnce(tenantRow())
      .mockResolvedValueOnce([{ cnt: String(RATE_LIMIT_PER_HOUR) }]);
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('honors a per-tenant rate-limit override below the default', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow()) // default 50
      .mockResolvedValueOnce(tenantRow({ rateLimitPerHour: 5 })) // tenant capped at 5
      .mockResolvedValueOnce([{ cnt: '5' }]);
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('throws AiBudgetExceededError when the tenant budget is 0 (AI disabled)', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockResolvedValueOnce(tenantRow({ monthlyBudget: '0' }));
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
    // budget==0 short-circuits before any spend query.
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('throws AiBudgetExceededError when month-to-date cost >= budget', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockResolvedValueOnce(tenantRow())
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ total: '60.00' }]);
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it('falls back to the platform default budget when the tenant has no row', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockResolvedValueOnce([]) // no tenant row → platform default ($50)
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ total: String(DEFAULT_MONTHLY_BUDGET_USD - 1) }]);
    await expect(assertAgentBudget(TENANT)).resolves.toBeUndefined();
  });

  it('throws AiBudgetExceededError when AI is disabled platform-wide', async () => {
    sqlMock.mockResolvedValueOnce(platformRow({ aiEnabled: false }));
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('throws AiBudgetExceededError when the platform monthly cap is reached', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow({ platformMonthlyCap: '100.00' }))
      .mockResolvedValueOnce(tenantRow())
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ total: '10.00' }]) // tenant under its own budget
      .mockResolvedValueOnce([{ total: '100.00' }]); // platform total hits the cap
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(sqlMock).toHaveBeenCalledTimes(5);
  });

  it('does NOT deny when the platform config is absent (uses constants)', async () => {
    sqlMock
      .mockRejectedValueOnce(new Error('relation does not exist')) // pre-migration
      .mockResolvedValueOnce(tenantRow())
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ total: '5.00' }]);
    await expect(assertAgentBudget(TENANT)).resolves.toBeUndefined();
  });

  it('FAILS CLOSED (denies) when the tenant config query errors', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockRejectedValueOnce(new Error('db down'));
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it('FAILS CLOSED (denies) when the rate-limit query errors', async () => {
    sqlMock
      .mockResolvedValueOnce(platformRow())
      .mockResolvedValueOnce(tenantRow())
      .mockRejectedValueOnce(new Error('db down'));
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiRateLimitError);
  });
});

describe('recordAgentSpend', () => {
  it('inserts a ledger row and returns the per-model cost', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const cost = await recordAgentSpend({
      tenantId: TENANT,
      agentRole: 'section_drafter',
      taskType: 'proposal.draft_section',
      model: 'claude-sonnet-4-20250514',
      inputTokens: 1_000_000,
      outputTokens: 0,
      durationMs: 1234,
    });
    expect(cost).toBeCloseTo(3, 6);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('is best-effort — never throws if the INSERT fails', async () => {
    sqlMock.mockRejectedValueOnce(new Error('insert failed'));
    const cost = await recordAgentSpend({
      tenantId: TENANT,
      agentRole: 'compliance_reviewer',
      taskType: 'proposal.compliance_check',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      durationMs: 500,
    });
    expect(cost).toBeCloseTo(6, 6);
  });
});
