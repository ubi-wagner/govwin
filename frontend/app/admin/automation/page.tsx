import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';
import { AutomationClient } from './automation-client';
import { PolicyClient } from './policy-client';
import { StatCard, type StatPreview } from '@/components/admin/stat-card';

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

type FrameworkPolicy = {
  id: string;
  scope: string;
  triggerKey: string;
  enabled: boolean;
  recipientRoles: string[];
  nudgeDays: number[];
  dueInMinutes: number | null;
  channel: string;
  configuredAt: string | null;
  updatedAt: string;
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
  let frameworkPolicies: FrameworkPolicy[] = [];

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
    frameworkPolicies = await sql<FrameworkPolicy[]>`
      SELECT
        id, scope, trigger_key, enabled, recipient_roles, nudge_days,
        due_in_minutes, channel, configured_at, updated_at
      FROM tenant_automation_policies
      WHERE tenant_id IS NULL
      ORDER BY scope, trigger_key
    `;
  } catch (e) {
    console.error('[admin/automation] policies query failed:', e);
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

  const serializedPolicies = frameworkPolicies.map((p) => ({
    id: p.id,
    scope: p.scope,
    triggerKey: p.triggerKey,
    enabled: p.enabled,
    recipientRoles: Array.isArray(p.recipientRoles) ? p.recipientRoles : [],
    nudgeDays: Array.isArray(p.nudgeDays) ? p.nudgeDays : [],
    dueInMinutes: p.dueInMinutes ?? null,
    channel: p.channel,
    configuredAt: p.configuredAt ? String(p.configuredAt) : null,
    updatedAt: String(p.updatedAt),
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
        <StatCard label="Executions (24h)" value={<span className="text-blue-600">{stats.recentExecutions}</span>} href="/admin/events" />
      </div>

      <AutomationClient initialRules={serializedRules} />

      {/* Platform Automation Policies — framework defaults (tenant_id IS NULL) */}
      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Platform Automation Policies</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Per-trigger defaults. Every tenant rides these until they configure a tenant override.
              Toggling here affects ALL tenants without a tenant-specific row.
            </p>
          </div>
          <span className="text-xs text-gray-400">
            {serializedPolicies.length} framework row{serializedPolicies.length !== 1 ? 's' : ''}
          </span>
        </div>
        <PolicyClient initialPolicies={serializedPolicies} />
      </div>
    </div>
  );
}
