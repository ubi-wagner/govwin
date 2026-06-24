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
vi.mock('@/lib/db', () => ({ sql: sqlMock }));

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

describe('assertAgentBudget', () => {
  it('resolves when under the hourly limit and the monthly budget', async () => {
    sqlMock
      .mockResolvedValueOnce([{ cnt: '10' }]) // hourly count
      .mockResolvedValueOnce([{ monthlyBudget: '50.00' }]) // config
      .mockResolvedValueOnce([{ total: '5.00' }]); // month-to-date cost
    await expect(assertAgentBudget(TENANT)).resolves.toBeUndefined();
    expect(sqlMock).toHaveBeenCalledTimes(3);
  });

  it('throws AiRateLimitError at the hourly limit (no budget query)', async () => {
    sqlMock.mockResolvedValueOnce([{ cnt: String(RATE_LIMIT_PER_HOUR) }]);
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiRateLimitError);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('throws AiBudgetExceededError when the tenant budget is 0 (AI disabled)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ monthlyBudget: '0' }]);
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
    // No month-to-date sum needed once we know AI is disabled.
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('throws AiBudgetExceededError when month-to-date cost >= budget', async () => {
    sqlMock
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ monthlyBudget: '50.00' }])
      .mockResolvedValueOnce([{ total: '60.00' }]);
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
  });

  it('uses the default budget when the tenant has no config row', async () => {
    sqlMock
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([]) // no config row → DEFAULT_MONTHLY_BUDGET_USD
      .mockResolvedValueOnce([{ total: String(DEFAULT_MONTHLY_BUDGET_USD - 1) }]);
    await expect(assertAgentBudget(TENANT)).resolves.toBeUndefined();
  });

  it('FAILS CLOSED (denies) when the rate-limit query errors', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('FAILS CLOSED (denies) when the budget query errors', async () => {
    sqlMock
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockRejectedValueOnce(new Error('db down'));
    await expect(assertAgentBudget(TENANT)).rejects.toBeInstanceOf(AiBudgetExceededError);
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
