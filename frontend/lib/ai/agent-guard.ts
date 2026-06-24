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

// ─── The guard ──────────────────────────────────────────────────────

/**
 * Throw if the tenant has hit the hourly rate limit OR the monthly
 * budget. Call this BEFORE spending on Claude. Fails CLOSED: if either
 * check cannot be verified (DB error), the call is denied — identical
 * to fabric.py's _check_rate_limit / _check_budget contract.
 *
 * @throws AiRateLimitError      hourly limit reached / unverifiable
 * @throws AiBudgetExceededError monthly budget reached / AI disabled / unverifiable
 */
export async function assertAgentBudget(tenantId: string): Promise<void> {
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
    // FAIL CLOSED — same as fabric.py::_check_rate_limit.
    console.error('[agent-guard] rate-limit check failed, denying call:', err);
    throw new AiRateLimitError('AI rate-limit check unavailable; call denied');
  }
  if (hourCount >= RATE_LIMIT_PER_HOUR) {
    throw new AiRateLimitError(
      `Hourly AI limit reached (${RATE_LIMIT_PER_HOUR}/hour). Please try again shortly.`,
      { limit: RATE_LIMIT_PER_HOUR, used: hourCount },
    );
  }

  // ── Budget: monthly_budget vs sum(cost_usd) this calendar month ──
  let monthlyBudget: number;
  let monthCost: number;
  try {
    const [cfg] = await sql<{ monthlyBudget: string | null }[]>`
      SELECT monthly_budget::text AS "monthlyBudget"
      FROM tenant_agent_config
      WHERE tenant_id = ${tenantId}::uuid
    `;
    monthlyBudget =
      cfg?.monthlyBudget != null
        ? parseFloat(cfg.monthlyBudget)
        : DEFAULT_MONTHLY_BUDGET_USD;

    // Explicit zero budget means AI is disabled for this tenant.
    if (monthlyBudget === 0) {
      throw new AiBudgetExceededError('AI is disabled for this account.', {
        monthlyBudget: 0,
      });
    }

    const [usage] = await sql<{ total: string }[]>`
      SELECT COALESCE(SUM(cost_usd), 0)::text AS total
      FROM agent_task_log
      WHERE tenant_id = ${tenantId}::uuid
        AND created_at >= date_trunc('month', now())
    `;
    monthCost = parseFloat(usage?.total ?? '0');
  } catch (err) {
    // Preserve the intentional "AI disabled" signal; fail closed on the rest.
    if (err instanceof AppError) throw err;
    console.error('[agent-guard] budget check failed, denying call:', err);
    throw new AiBudgetExceededError('AI budget check unavailable; call denied');
  }
  if (monthCost >= monthlyBudget) {
    throw new AiBudgetExceededError(
      `Monthly AI budget of $${monthlyBudget.toFixed(2)} reached.`,
      { monthlyBudget, used: monthCost },
    );
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
