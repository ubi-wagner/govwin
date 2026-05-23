/**
 * GET /api/admin/agents/usage — Admin agent usage dashboard
 *
 * Returns comprehensive usage data for the admin dashboard:
 * summary stats, per-archetype breakdown, per-tenant breakdown,
 * daily trend, and pricing reference.
 *
 * Auth: master_admin or rfp_admin.
 * Query params: ?period=30d (default) | 7d | 90d
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

const VALID_PERIODS: Record<string, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

const DEFAULT_MONTHLY_BUDGET = 50.0;
const RATE_LIMIT = 50;
const PER_CALL_CEILING = 0.5;

const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-sonnet-4-20250514': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.25, outputPer1M: 1.25 },
};

export async function GET(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse period parameter ───────────────────────────────────
    const periodParam = request.nextUrl.searchParams.get('period') ?? '30d';
    const intervalStr = VALID_PERIODS[periodParam];
    if (!intervalStr) {
      return NextResponse.json(
        { error: 'Invalid period. Use 7d, 30d, or 90d.', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Summary stats ────────────────────────────────────────────
    const summaryRows = await sql<{
      totalCalls: number;
      totalInputTokens: string;
      totalOutputTokens: string;
      totalCostUsd: string;
      uniqueTenants: number;
    }[]>`
      SELECT
        COUNT(*)::int AS total_calls,
        COALESCE(SUM(input_tokens), 0)::text AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::text AS total_output_tokens,
        COALESCE(SUM(cost_usd), 0)::text AS total_cost_usd,
        COUNT(DISTINCT tenant_id)::int AS unique_tenants
      FROM agent_task_log
      WHERE created_at >= now() - ${intervalStr}::interval
    `;

    const summaryRow = summaryRows[0];
    const totalCalls = summaryRow?.totalCalls ?? 0;
    const totalCostUsd = parseFloat(summaryRow?.totalCostUsd ?? '0');

    const summary = {
      totalCalls,
      totalInputTokens: parseInt(summaryRow?.totalInputTokens ?? '0', 10),
      totalOutputTokens: parseInt(summaryRow?.totalOutputTokens ?? '0', 10),
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      uniqueTenants: summaryRow?.uniqueTenants ?? 0,
      avgCostPerCall: totalCalls > 0
        ? Math.round((totalCostUsd / totalCalls) * 10000) / 10000
        : 0,
    };

    // ── By archetype ─────────────────────────────────────────────
    const byArchetype = await sql<{
      agentRole: string;
      calls: number;
      inputTokens: string;
      outputTokens: string;
      costUsd: string;
      avgDurationMs: number;
      totalErrors: number;
    }[]>`
      SELECT
        agent_role,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens), 0)::text AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::text AS output_tokens,
        COALESCE(SUM(cost_usd), 0)::text AS cost_usd,
        COALESCE(AVG(duration_ms), 0)::int AS avg_duration_ms,
        COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS total_errors
      FROM agent_task_log
      WHERE created_at >= now() - ${intervalStr}::interval
      GROUP BY agent_role
      ORDER BY calls DESC
    `;

    const byArchetypeMapped = byArchetype.map((row) => ({
      agentRole: row.agentRole,
      calls: row.calls,
      inputTokens: parseInt(row.inputTokens, 10),
      outputTokens: parseInt(row.outputTokens, 10),
      costUsd: Math.round(parseFloat(row.costUsd) * 10000) / 10000,
      avgDurationMs: row.avgDurationMs,
      errorRate: row.calls > 0
        ? Math.round((row.totalErrors / row.calls) * 10000) / 10000
        : 0,
    }));

    // ── By tenant ────────────────────────────────────────────────
    const byTenant = await sql<{
      tenantId: string;
      tenantName: string;
      calls: number;
      costUsd: string;
      monthlyBudget: string | null;
    }[]>`
      SELECT
        atl.tenant_id,
        t.name AS tenant_name,
        COUNT(*)::int AS calls,
        COALESCE(SUM(atl.cost_usd), 0)::text AS cost_usd,
        tac.monthly_budget::text AS monthly_budget
      FROM agent_task_log atl
      JOIN tenants t ON t.id = atl.tenant_id
      LEFT JOIN tenant_agent_config tac ON tac.tenant_id = atl.tenant_id
      WHERE atl.created_at >= now() - ${intervalStr}::interval
      GROUP BY atl.tenant_id, t.name, tac.monthly_budget
      ORDER BY cost_usd DESC
    `;

    const byTenantMapped = byTenant.map((row) => {
      const costUsd = parseFloat(row.costUsd);
      const monthlyBudget = row.monthlyBudget
        ? parseFloat(row.monthlyBudget)
        : DEFAULT_MONTHLY_BUDGET;
      return {
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        calls: row.calls,
        costUsd: Math.round(costUsd * 10000) / 10000,
        monthlyBudget,
        budgetUsedPct: monthlyBudget > 0
          ? Math.round((costUsd / monthlyBudget) * 10000) / 100
          : 0,
      };
    });

    // ── Daily trend ──────────────────────────────────────────────
    const dailyTrend = await sql<{
      date: string;
      calls: number;
      costUsd: string;
    }[]>`
      SELECT
        date_trunc('day', created_at)::date::text AS date,
        COUNT(*)::int AS calls,
        COALESCE(SUM(cost_usd), 0)::text AS cost_usd
      FROM agent_task_log
      WHERE created_at >= now() - ${intervalStr}::interval
      GROUP BY date
      ORDER BY date
    `;

    const dailyTrendMapped = dailyTrend.map((row) => ({
      date: row.date,
      calls: row.calls,
      costUsd: Math.round(parseFloat(row.costUsd) * 10000) / 10000,
    }));

    // ── Response ─────────────────────────────────────────────────
    return NextResponse.json({
      data: {
        summary,
        byArchetype: byArchetypeMapped,
        byTenant: byTenantMapped,
        dailyTrend: dailyTrendMapped,
        pricing: {
          models: MODEL_PRICING,
          defaultMonthlyBudget: DEFAULT_MONTHLY_BUDGET,
          rateLimit: RATE_LIMIT,
          perCallCeiling: PER_CALL_CEILING,
        },
      },
    });
  } catch (err) {
    console.error('[admin/agents/usage] error:', err);
    return NextResponse.json(
      { error: 'Usage query failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
