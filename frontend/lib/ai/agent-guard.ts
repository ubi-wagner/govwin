/**
 * Unified AI spend guard + ledger for the LIVE (frontend) product-AI
 * surfaces.
 *
 * The Draft tool (lib/tools/proposal-draft-section.ts) and the
 * Compliance route (api/portal/.../ai/compliance) call Claude directly
 * from Next.js. Without this guard they bypass the cost controls that
 * the Python AgentFabric enforces for pipeline agents
 * (pipeline/src/agents/fabric.py::invoke_agent) — so a "crazy reprompt"
 * customer could spend unbounded $ on those two surfaces.
 *
 * This module makes `agent_task_log` the SINGLE source of truth for ALL
 * tenant AI spend: every Claude call that bills a tenant — pipeline OR
 * product — lands here. The same table is read by the per-tenant budget
 * check below, by fabric.py::_check_budget, and by the admin usage
 * dashboard (api/admin/agents/usage). One ledger, one cap, no matter
 * which surface the tenant hammers.
 *
 * Mirrors fabric.py exactly:
 *   - RATE_LIMIT_PER_HOUR = 50         calls/hour/tenant
 *   - DEFAULT_MONTHLY_BUDGET_USD = 50  per tenant
 *   - tenant_agent_config.monthly_budget == 0  → AI disabled
 *   - sum(cost_usd) for the calendar month vs the budget
 *   - FAIL CLOSED: any error verifying the limit DENIES the call
 */

import { sql } from '@/lib/db';
import { AppError } from '@/lib/errors';

// ─── Constants (keep in sync with fabric.py) ────────────────────────

export const RATE_LIMIT_PER_HOUR = 50;
export const DEFAULT_MONTHLY_BUDGET_USD = 50.0;
/** Per-call ceiling fabric.py enforces mid tool-loop. Exported for parity;
 *  the single-shot frontend calls never approach it. */
export const PER_CALL_CEILING_USD = 0.5;

/**
 * Per-model Claude pricing (USD per 1M tokens). Keep in sync with
 * pipeline/src/agents/fabric.py::MODEL_PRICING and the admin usage
 * dashboard (api/admin/agents/usage/route.ts).
 */
export const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-sonnet-4-20250514': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-4-5-20251001': { inputPer1M: 1.0, outputPer1M: 5.0 },
};

/** Fallback when a model id isn't in the table — Sonnet (the fabric
 *  default) so an unknown model is costed conservatively, never free. */
const DEFAULT_PRICING = { inputPer1M: 3.0, outputPer1M: 15.0 };

/** Compute the USD cost of a call, priced per-model. */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (
    (inputTokens * p.inputPer1M) / 1_000_000 +
    (outputTokens * p.outputPer1M) / 1_000_000
  );
}

// ─── Typed guard errors (AppError → mapped by withHandler + registry) ─

/** 429 — tenant exceeded the hourly AI call rate limit. */
export class AiRateLimitError extends AppError {
  constructor(message = 'AI hourly rate limit exceeded', details?: unknown) {
    super(message, 'AI_RATE_LIMITED', 429, details);
  }
}

/** 402 — tenant exhausted (or disabled) their monthly AI budget. */
export class AiBudgetExceededError extends AppError {
  constructor(message = 'AI monthly budget exhausted', details?: unknown) {
    super(message, 'AI_BUDGET_EXCEEDED', 402, details);
  }
}

// ─── Effective limits (tenant override → platform default → constant) ─

interface PlatformConfig {
  aiEnabled: boolean;
  defaultMonthlyBudget: number;
  defaultRateLimit: number;
  platformMonthlyCap: number | null;
}

/**
 * Read the pipeline-wide config singleton. BEST-EFFORT: a missing table or
 * row (e.g. pre-migration) is treated as "use the hardcoded constants" — a
 * config *absence*, not a spend-verification failure, so it must NOT deny AI.
 * (Spend checks below still fail closed on DB error.)
 */
async function loadPlatformConfig(): Promise<PlatformConfig> {
  try {
    const [row] = await sql<{
      defaultMonthlyBudget: string;
      defaultRateLimitPerHour: number;
      platformMonthlyCap: string | null;
      aiEnabled: boolean;
    }[]>`
      SELECT default_monthly_budget, default_rate_limit_per_hour,
             platform_monthly_cap, ai_enabled
      FROM platform_agent_config
      WHERE id = TRUE
    `;
    return {
      aiEnabled: row?.aiEnabled ?? true,
      defaultMonthlyBudget:
        row?.defaultMonthlyBudget != null ? parseFloat(row.defaultMonthlyBudget) : DEFAULT_MONTHLY_BUDGET_USD,
      defaultRateLimit:
        row?.defaultRateLimitPerHour != null ? Number(row.defaultRateLimitPerHour) : RATE_LIMIT_PER_HOUR,
      platformMonthlyCap:
        row?.platformMonthlyCap != null ? parseFloat(row.platformMonthlyCap) : null,
    };
  } catch {
    // Config absent → fall back to constants (do not deny on absence).
    return {
      aiEnabled: true,
      defaultMonthlyBudget: DEFAULT_MONTHLY_BUDGET_USD,
      defaultRateLimit: RATE_LIMIT_PER_HOUR,
      platformMonthlyCap: null,
    };
  }
}

// ─── The guard ──────────────────────────────────────────────────────

/**
 * Throw if AI is disabled, the tenant hit its hourly rate limit or monthly
 * budget, or the platform monthly cap is reached. Call this BEFORE spending.
 *
 * Effective limits resolve as: tenant override → platform default → constant.
 * Fails CLOSED: if a spend check can't be verified (DB error), the call is
 * denied — identical to fabric.py's contract.
 *
 * @throws AiRateLimitError      hourly limit reached / unverifiable
 * @throws AiBudgetExceededError budget/cap reached, AI disabled, or unverifiable
 */
export async function assertAgentBudget(tenantId: string): Promise<void> {
  const platform = await loadPlatformConfig();

  // ── Master switch: AI disabled pipeline-wide ────────────────────
  if (!platform.aiEnabled) {
    throw new AiBudgetExceededError('AI is currently disabled.', { aiEnabled: false });
  }

  // ── Resolve tenant overrides (fail closed if unreadable) ────────
  let tenantBudget: number | null = null;
  let tenantRate: number | null = null;
  let tenantRowExists = false;
  try {
    const [cfg] = await sql<{ monthlyBudget: string | null; rateLimitPerHour: number | null }[]>`
      SELECT monthly_budget, rate_limit_per_hour
      FROM tenant_agent_config
      WHERE tenant_id = ${tenantId}::uuid
    `;
    if (cfg) {
      tenantRowExists = true;
      tenantBudget = cfg.monthlyBudget != null ? parseFloat(cfg.monthlyBudget) : null;
      tenantRate = cfg.rateLimitPerHour != null ? Number(cfg.rateLimitPerHour) : null;
    }
  } catch (err) {
    console.error('[agent-guard] tenant config read failed, denying call:', err);
    throw new AiBudgetExceededError('AI config check unavailable; call denied');
  }

  const effectiveRate = tenantRate ?? platform.defaultRateLimit;
  const effectiveBudget =
    tenantRowExists && tenantBudget != null ? tenantBudget : platform.defaultMonthlyBudget;

  // Explicit zero budget means AI is disabled for this tenant.
  if (effectiveBudget === 0) {
    throw new AiBudgetExceededError('AI is disabled for this account.', { monthlyBudget: 0 });
  }

  // ── Rate limit: calls in the last rolling hour ──────────────────
  let hourCount: number;
  try {
    const [row] = await sql<{ cnt: string }[]>`
      SELECT COUNT(*)::text AS cnt
      FROM agent_task_log
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at > now() - interval '1 hour'
    `;
    hourCount = parseInt(row?.cnt ?? '0', 10);
  } catch (err) {
    console.error('[agent-guard] rate-limit check failed, denying call:', err);
    throw new AiRateLimitError('AI rate-limit check unavailable; call denied');
  }
  if (hourCount >= effectiveRate) {
    throw new AiRateLimitError(
      `Hourly AI limit reached (${effectiveRate}/hour). Please try again shortly.`,
      { limit: effectiveRate, used: hourCount },
    );
  }

  // ── Per-tenant budget: sum(cost_usd) this calendar month ────────
  let monthCost: number;
  try {
    const [usage] = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(cost_usd), 0)::text AS total
      FROM agent_task_log
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at >= date_trunc('month', now())
    `;
    monthCost = parseFloat(usage?.total ?? '0');
  } catch (err) {
    console.error('[agent-guard] budget check failed, denying call:', err);
    throw new AiBudgetExceededError('AI budget check unavailable; call denied');
  }
  if (monthCost >= effectiveBudget) {
    throw new AiBudgetExceededError(
      `Monthly AI budget of $${effectiveBudget.toFixed(2)} reached.`,
      { monthlyBudget: effectiveBudget, used: monthCost },
    );
  }

  // ── Platform-wide cap: total spend across ALL tenants + admin ───
  if (platform.platformMonthlyCap != null) {
    let platformCost: number;
    try {
      const [usage] = await sql<{ total: string }[]>`
        SELECT COALESCE(SUM(cost_usd), 0)::text AS total
        FROM agent_task_log
        WHERE created_at >= date_trunc('month', now())
      `;
      platformCost = parseFloat(usage?.total ?? '0');
    } catch (err) {
      console.error('[agent-guard] platform-cap check failed, denying call:', err);
      throw new AiBudgetExceededError('AI platform-cap check unavailable; call denied');
    }
    if (platformCost >= platform.platformMonthlyCap) {
      throw new AiBudgetExceededError(
        `Platform AI monthly cap of $${platform.platformMonthlyCap.toFixed(2)} reached.`,
        { platformMonthlyCap: platform.platformMonthlyCap, used: platformCost },
      );
    }
  }
}

// ─── The ledger writer ──────────────────────────────────────────────

export interface RecordAgentSpendParams {
  tenantId: string;
  /** Role label for the dashboard rollup — use the archetype that owns
   *  the same model (e.g. 'section_drafter', 'compliance_reviewer'). */
  agentRole: string;
  taskType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  proposalId?: string | null;
  sectionId?: string | null;
  triggerEvent?: string | null;
  toolCallsCount?: number;
  error?: string | null;
}

/**
 * Append one row to agent_task_log — the unified AI billing/audit
 * ledger. The cost is computed per-model. Returns the computed cost.
 *
 * Best-effort: a logging failure must NOT fail the user's request after
 * Claude already produced output (mirrors fabric.py's wrapped
 * _log_task). The row both (a) bills cost_usd toward the monthly budget
 * and (b) counts as one call toward the hourly rate limit.
 */
export async function recordAgentSpend(
  params: RecordAgentSpendParams,
): Promise<number> {
  const costUsd = computeCostUsd(
    params.model,
    params.inputTokens,
    params.outputTokens,
  );
  try {
    await sql`
      INSERT INTO agent_task_log
        (tenant_id, agent_role, task_type, trigger_event,
         proposal_id, section_id, input_tokens, output_tokens,
         tool_calls_count, duration_ms, cost_usd, error)
      VALUES (
        ${params.tenantId}::uuid,
        ${params.agentRole},
        ${params.taskType},
        ${params.triggerEvent ?? null},
        ${params.proposalId ?? null},
        ${params.sectionId ?? null},
        ${params.inputTokens},
        ${params.outputTokens},
        ${params.toolCallsCount ?? 0},
        ${params.durationMs},
        ${costUsd},
        ${params.error ?? null}
      )
    `;
  } catch (err) {
    // Best-effort — never throw from the ledger writer.
    console.error('[agent-guard] recordAgentSpend failed:', err);
  }
  return costUsd;
}
