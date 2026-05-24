/**
 * GET /api/portal/[tenantSlug]/agents/usage — Tenant agent usage
 *
 * Returns aggregate usage data for tenant admins (NO pricing data).
 * Shows call counts, budget utilization, rate limit status,
 * per-agent breakdown, and recent activity.
 *
 * Auth: tenant_admin or above with verified tenant access.
 * Query params: ?period=30d (default) | 7d | 90d
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

const VALID_PERIODS: Record<string, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

const DEFAULT_MONTHLY_BUDGET = 50.0;
const RATE_LIMIT_PER_HOUR = 50;

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  opportunity_analyst: 'Opportunity Analyst',
  scoring_strategist: 'Scoring Strategist',
  capture_strategist: 'Capture Strategist',
  proposal_architect: 'Proposal Architect',
  section_drafter: 'Section Drafter',
  compliance_reviewer: 'Compliance Reviewer',
  color_team_reviewer: 'Color Team Reviewer',
  librarian: 'Librarian',
  partner_coordinator: 'Partner Coordinator',
  packaging_specialist: 'Packaging Specialist',
};

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

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
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
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

    // ── Summary: total calls + budget used % ─────────────────────
    let totalCallsRows: { totalCalls: number; totalCostUsd: string }[];
    try {
      totalCallsRows = await sql<typeof totalCallsRows>`
        SELECT
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(cost_usd), 0)::text AS total_cost_usd
        FROM agent_task_log
        WHERE tenant_id = ${tenantId}::uuid
          AND created_at >= now() - ${intervalStr}::interval
      `;
    } catch (dbErr) {
      console.error('[portal/agents/usage] total calls query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    let budgetRows: { monthlyBudget: string | null }[];
    try {
      budgetRows = await sql<typeof budgetRows>`
        SELECT monthly_budget::text AS monthly_budget
        FROM tenant_agent_config
        WHERE tenant_id = ${tenantId}::uuid
      `;
    } catch (dbErr) {
      console.error('[portal/agents/usage] budget query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    const monthlyBudget = budgetRows[0]?.monthlyBudget
      ? parseFloat(budgetRows[0].monthlyBudget)
      : DEFAULT_MONTHLY_BUDGET;
    const totalCostThisMonth = parseFloat(totalCallsRows[0]?.totalCostUsd ?? '0');
    const budgetUsedPct = monthlyBudget > 0
      ? Math.round((totalCostThisMonth / monthlyBudget) * 10000) / 100
      : 0;

    // ── Calls remaining this hour ────────────────────────────────
    let hourlyRows: { callsThisHour: number }[];
    try {
      hourlyRows = await sql<typeof hourlyRows>`
        SELECT COUNT(*)::int AS calls_this_hour
        FROM agent_task_log
        WHERE tenant_id = ${tenantId}::uuid
          AND created_at > now() - interval '1 hour'
      `;
    } catch (dbErr) {
      console.error('[portal/agents/usage] hourly query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    const callsThisHour = hourlyRows[0]?.callsThisHour ?? 0;
    const callsRemainingThisHour = Math.max(0, RATE_LIMIT_PER_HOUR - callsThisHour);

    const summary = {
      totalCalls: totalCallsRows[0]?.totalCalls ?? 0,
      budgetUsedPct,
      callsRemainingThisHour,
    };

    // ── By agent (within the requested period) ───────────────────
    let byAgent: {
      agentRole: string;
      calls: number;
      lastUsed: string | null;
    }[];
    try {
      byAgent = await sql<typeof byAgent>`
        SELECT
          agent_role,
          COUNT(*)::int AS calls,
          MAX(created_at)::text AS last_used
        FROM agent_task_log
        WHERE tenant_id = ${tenantId}::uuid
          AND created_at >= now() - ${intervalStr}::interval
        GROUP BY agent_role
        ORDER BY calls DESC
      `;
    } catch (dbErr) {
      console.error('[portal/agents/usage] by agent query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    const byAgentMapped = byAgent.map((row) => ({
      agentRole: row.agentRole,
      displayName: AGENT_DISPLAY_NAMES[row.agentRole] ?? row.agentRole,
      calls: row.calls,
      lastUsed: row.lastUsed,
    }));

    // ── Recent activity ──────────────────────────────────────────
    let recentActivity: {
      agentRole: string;
      taskType: string;
      createdAt: string;
      durationMs: number | null;
      humanAccepted: boolean | null;
    }[];
    try {
      recentActivity = await sql<typeof recentActivity>`
        SELECT
          agent_role,
          task_type,
          created_at::text AS created_at,
          duration_ms,
          human_accepted
        FROM agent_task_log
        WHERE tenant_id = ${tenantId}::uuid
        ORDER BY created_at DESC
        LIMIT 20
      `;
    } catch (dbErr) {
      console.error('[portal/agents/usage] recent activity query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    const recentActivityMapped = recentActivity.map((row) => ({
      agentRole: row.agentRole,
      taskType: row.taskType,
      createdAt: row.createdAt,
      durationMs: row.durationMs ?? 0,
      humanAccepted: row.humanAccepted,
    }));

    // ── Response ─────────────────────────────────────────────────
    return NextResponse.json({
      data: {
        summary,
        byAgent: byAgentMapped,
        recentActivity: recentActivityMapped,
      },
    });
  } catch (err) {
    console.error('[portal/agents/usage] error:', err);
    return NextResponse.json(
      { error: 'Failed to query agent usage', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
