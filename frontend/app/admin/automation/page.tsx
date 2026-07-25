import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import Link from 'next/link';
import { AutomationClient } from './automation-client';
import { StatCard, type StatPreview } from '@/components/admin/stat-card';
import { AutomationHealth, type AutomationHealthProps } from '@/components/admin/automation-health';

export const dynamic = 'force-dynamic';

type AutomationRuleRow = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerNamespace: string;
  triggerType: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type StatsRow = {
  total: number;
  active: number;
  inactive: number;
  recentExecutions: number;
};

export default async function AutomationPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  let rules: AutomationRuleRow[] = [];
  let stats: StatsRow = { total: 0, active: 0, inactive: 0, recentExecutions: 0 };

  try {
    rules = await sql<AutomationRuleRow[]>`
      SELECT id, name, description, is_active, trigger_namespace, trigger_type,
             action_type, action_config, created_by, created_at, updated_at
      FROM automation_rules
      ORDER BY created_at DESC
    `;
  } catch (e) {
    console.error('[admin/automation] rules query failed:', e);
  }

  try {
    const [statsRow] = await sql<{
      total: string;
      active: string;
      inactive: string;
      recentExecutions: string;
    }[]>`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active = false) as inactive,
        COALESCE((
          SELECT COUNT(*)::text FROM automation_log
          WHERE executed_at > NOW() - '24 hours'::interval
        ), '0') as recent_executions
      FROM automation_rules
    `;
    if (statsRow) {
      stats = {
        total: parseInt(statsRow.total, 10),
        active: parseInt(statsRow.active, 10),
        inactive: parseInt(statsRow.inactive, 10),
        recentExecutions: parseInt(statsRow.recentExecutions, 10),
      };
    }
  } catch (e) {
    console.error('[admin/automation] stats query failed:', e);
  }

  // ── Automation health roll-up (UI-gaps R2/R5/R11): fires/errors/todos/workflows +
  //    agent spend vs the framework ceiling + a correctly-statused firings log. ──
  let logStatus = { success: 0, error: 0, deferred: 0, skipped: 0, running: 0 };
  let openTodos = 0;
  let instances = { failed: 0, active: 0 };
  let agent: { spend: number; ceiling: number | null } = { spend: 0, ceiling: null };
  let firings: AutomationHealthProps['firings'] = [];
  try {
    const statusRows = await sql<Array<{ status: string; n: number }>>`
      SELECT status, count(*)::int AS n FROM automation_log
      WHERE executed_at > now() - '24 hours'::interval GROUP BY status`;
    for (const r of statusRows) {
      if (Object.prototype.hasOwnProperty.call(logStatus, r.status)) {
        (logStatus as Record<string, number>)[r.status] = r.n;
      }
    }
    const [todoRow] = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tasks WHERE status IN ('open', 'in_progress')`;
    openTodos = todoRow?.n ?? 0;
    const [instRow] = await sql<Array<{ failed: number; active: number }>>`
      SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed,
             count(*) FILTER (WHERE status IN ('running', 'retrying', 'paused'))::int AS active
      FROM process_instances`;
    if (instRow) instances = instRow;
    const [spendRow] = await sql<Array<{ spend: number; ceiling: number | null }>>`
      SELECT COALESCE((SELECT SUM(cost_usd) FROM agent_task_log WHERE created_at >= date_trunc('month', now())), 0)::float AS spend,
             (SELECT agent_monthly_budget_ceiling_usd FROM automation_framework WHERE id = 1)::float AS ceiling`;
    if (spendRow) agent = { spend: spendRow.spend ?? 0, ceiling: spendRow.ceiling ?? null };
    const logRows = await sql<Array<{ id: string; status: string; actionType: string; executedAt: string | Date | null; ruleName: string | null; result: Record<string, unknown> | null; errorMessage: string | null }>>`
      SELECT l.id, l.status, l.action_type AS "actionType", l.executed_at AS "executedAt",
             r.name AS "ruleName", l.result, l.error_message AS "errorMessage"
      FROM automation_log l LEFT JOIN automation_rules r ON r.id = l.rule_id
      ORDER BY COALESCE(l.executed_at, l.created_at) DESC LIMIT 15`;
    firings = logRows.map((l) => {
      const res = (l.result ?? {}) as Record<string, unknown>;
      const detail =
        (typeof res.error === 'string' && res.error) ||
        (typeof res.reason === 'string' && res.reason) ||
        l.errorMessage ||
        (typeof res.name === 'string' ? res.name : null);
      return {
        id: l.id, status: l.status, actionType: l.actionType,
        executedAt: l.executedAt instanceof Date ? l.executedAt.toISOString() : (l.executedAt as string | null),
        ruleName: l.ruleName, detail: (detail || null) as string | null,
      };
    });
  } catch (e) {
    console.error('[admin/automation] health query failed:', e);
  }

  const serializedRules = rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    triggerNamespace: r.triggerNamespace,
    triggerType: r.triggerType,
    actionType: r.actionType,
    actionConfig: r.actionConfig,
    createdBy: r.createdBy,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }));

  const ruleItem = (r: AutomationRuleRow) => ({
    left: r.name,
    sub: `${r.triggerNamespace}.${r.triggerType} → ${r.actionType}`,
    right: r.isActive ? 'active' : 'off',
  });
  const allRulesPreview: StatPreview = { title: 'Automation Rules', items: rules.slice(0, 6).map(ruleItem), emptyText: 'No rules yet' };
  const activeRulesPreview: StatPreview = { title: 'Active Rules', items: rules.filter((r) => r.isActive).slice(0, 6).map(ruleItem), emptyText: 'No active rules' };
  const inactiveRulesPreview: StatPreview = { title: 'Inactive Rules', items: rules.filter((r) => !r.isActive).slice(0, 6).map(ruleItem), emptyText: 'No inactive rules' };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automation Rules</h1>
          <p className="text-sm text-gray-500 mt-1">
            Event-driven automation rules that trigger actions on system events
          </p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Dashboard
        </Link>
      </div>

      {/* Stats bar — hover any card for the rules behind the number */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Rules" value={stats.total} preview={allRulesPreview} />
        <StatCard label="Active" value={<span className="text-green-600">{stats.active}</span>} preview={activeRulesPreview} />
        <StatCard label="Inactive" value={<span className="text-gray-400">{stats.inactive}</span>} preview={inactiveRulesPreview} />
        <StatCard label="Executions (24h)" value={<span className="text-blue-600">{stats.recentExecutions}</span>} href="#firings" />
      </div>

      <AutomationHealth logStatus={logStatus} openTodos={openTodos} instances={instances} agent={agent} firings={firings} />

      <AutomationClient initialRules={serializedRules} />
    </div>
  );
}
