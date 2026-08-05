import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import Link from 'next/link';
import { WorkflowMonitorClient } from './workflow-monitor-client';
import { LaunchContentClient } from './launch-content-client';
import { LaunchCollaborationClient } from './launch-collaboration-client';

export const dynamic = 'force-dynamic';

export type WorkflowInstance = {
  id: string;
  workflowName: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'retrying';
  currentStep: string | null;
  currentStepIndex: number;
  totalSteps: number;
  stepStatus: Record<string, string>;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  source: string;
  retryCount: number;
  lastError: string | null;
  lastErrorStep: string | null;
  recoveredFrom: string | null;
  durationMs: number | null;
};

export type WorkflowStats = {
  running: number;
  paused: number;
  completedLast24h: number;
  failedLast24h: number;
};

type WorkflowInstanceRow = {
  id: string;
  workflowName: string;
  status: string;
  currentStep: string | null;
  currentStepIndex: number;
  stepStatus: Record<string, string> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastHeartbeatAt: Date | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  source: string;
  retryCount: number;
  lastError: string | null;
  lastErrorStep: string | null;
  recoveredFrom: string | null;
  durationMs: number | null;
};

type StatsRow = {
  running: number;
  paused: number;
  completed24h: number;
  failed24h: number;
};

function mapRow(r: WorkflowInstanceRow): WorkflowInstance {
  return {
    id: r.id,
    workflowName: r.workflowName,
    status: r.status as WorkflowInstance['status'],
    currentStep: r.currentStep,
    currentStepIndex: r.currentStepIndex ?? 0,
    totalSteps: r.stepStatus ? Object.keys(r.stepStatus).length : 0,
    stepStatus: r.stepStatus ?? {},
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    lastHeartbeatAt: r.lastHeartbeatAt ? r.lastHeartbeatAt.toISOString() : null,
    tenantId: r.tenantId,
    tenantName: r.tenantName ?? null,
    tenantSlug: r.tenantSlug ?? null,
    source: r.source ?? 'pipeline',
    retryCount: r.retryCount ?? 0,
    lastError: r.lastError,
    lastErrorStep: r.lastErrorStep,
    recoveredFrom: r.recoveredFrom,
    durationMs: r.durationMs ? Number(r.durationMs) : null,
  };
}

// Completed/failed history lookback for the cross-tenant rollup. Allowlisted (no injection);
// the interval string is bound as a parameter (`${interval}::interval`). process_instances are
// retained indefinitely (no purge), so 7d/30d/90d surface last week's/month's completed runs.
const RANGE_MAP: Record<string, { interval: string; label: string; limit: number }> = {
  '24h': { interval: '24 hours', label: '24h', limit: 100 },
  '7d': { interval: '7 days', label: '7d', limit: 300 },
  '30d': { interval: '30 days', label: '30d', limit: 500 },
  '90d': { interval: '90 days', label: '90d', limit: 500 },
  '180d': { interval: '180 days', label: '180d', limit: 800 },
  '365d': { interval: '365 days', label: '365d', limit: 1000 },
};
// Quick chips, in order. A custom From→To (bookend) overrides these when set.
const RANGE_CHIPS: Array<{ key: string; label: string }> = [
  { key: '24h', label: '24h' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' }, { key: '180d', label: '180 days' }, { key: '365d', label: '1 year' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function WorkflowMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/');
  }

  const sp = await searchParams;
  // Custom bookend range (From [→ To]); From alone = "since <date> to present". Overrides the chips.
  const fromDate = sp?.from && DATE_RE.test(sp.from) ? sp.from : null;
  const toDate = sp?.to && DATE_RE.test(sp.to) ? sp.to : null;
  const custom = fromDate !== null;
  const range = sp?.range && RANGE_MAP[sp.range] ? sp.range : '24h';
  const { interval: lookback, label: quickLabel, limit: quickLimit } = RANGE_MAP[range];
  const recentLimit = custom ? 1000 : quickLimit;
  const rangeLabel = custom ? (toDate ? `${fromDate} → ${toDate}` : `since ${fromDate}`) : quickLabel;
  // Reusable time-filter fragments (recent list filters pi.created_at; the stat tiles filter completed_at).
  // Date bounds are bound as ::date params (injection-safe) and validated as YYYY-MM-DD above.
  const recentTime = custom
    ? (toDate
        ? sql`pi.created_at >= ${fromDate}::date AND pi.created_at < (${toDate}::date + interval '1 day')`
        : sql`pi.created_at >= ${fromDate}::date`)
    : sql`pi.created_at > NOW() - ${lookback}::interval`;
  const completedTime = custom
    ? (toDate
        ? sql`completed_at >= ${fromDate}::date AND completed_at < (${toDate}::date + interval '1 day')`
        : sql`completed_at >= ${fromDate}::date`)
    : sql`completed_at > NOW() - ${lookback}::interval`;

  let active: WorkflowInstance[] = [];
  let recent: WorkflowInstance[] = [];
  let stats: WorkflowStats = { running: 0, paused: 0, completedLast24h: 0, failedLast24h: 0 };
  let migrationRequired = false;

  // (a) Active workflow instances
  try {
    const rows = await sql<WorkflowInstanceRow[]>`
      SELECT pi.id, pi.workflow_name, pi.status, pi.current_step, pi.current_step_index,
             pi.step_status, pi.started_at, pi.completed_at, pi.last_heartbeat_at,
             pi.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
             pi.source, pi.retry_count, pi.last_error, pi.last_error_step,
             pi.recovered_from,
             CASE WHEN pi.completed_at IS NOT NULL AND pi.started_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (pi.completed_at - pi.started_at)) * 1000
                  ELSE NULL END as duration_ms
      FROM process_instances pi
      LEFT JOIN tenants t ON t.id = pi.tenant_id
      WHERE pi.status IN ('running', 'paused', 'pending', 'retrying')
        AND pi.archived_at IS NULL
      ORDER BY pi.started_at DESC NULLS LAST
      LIMIT 50
    `;
    active = rows.map(mapRow);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      migrationRequired = true;
    } else {
      console.error('[admin/workflows] active instances query failed:', e);
    }
  }

  // (b) Recent instances (last 24h, completed/failed/cancelled)
  if (!migrationRequired) {
    try {
      const rows = await sql<WorkflowInstanceRow[]>`
        SELECT pi.id, pi.workflow_name, pi.status, pi.current_step, pi.current_step_index,
               pi.step_status, pi.started_at, pi.completed_at, pi.last_heartbeat_at,
               pi.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
               pi.source, pi.retry_count, pi.last_error, pi.last_error_step,
               pi.recovered_from,
               CASE WHEN pi.completed_at IS NOT NULL AND pi.started_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (pi.completed_at - pi.started_at)) * 1000
                    ELSE NULL END as duration_ms
        FROM process_instances pi
        LEFT JOIN tenants t ON t.id = pi.tenant_id
        WHERE ${recentTime}
          AND pi.status NOT IN ('running', 'paused', 'pending', 'retrying')
          AND pi.archived_at IS NULL
        ORDER BY pi.completed_at DESC NULLS LAST
        LIMIT ${recentLimit}
      `;
      recent = rows.map(mapRow);
    } catch (e) {
      console.error('[admin/workflows] recent instances query failed:', e);
    }
  }

  // (c) Stats
  if (!migrationRequired) {
    try {
      const rows = await sql<StatsRow[]>`
        SELECT
          COUNT(*) FILTER (WHERE status = 'running') as running,
          COUNT(*) FILTER (WHERE status = 'paused') as paused,
          COUNT(*) FILTER (WHERE status = 'completed' AND ${completedTime}) as completed_24h,
          COUNT(*) FILTER (WHERE status = 'failed' AND ${completedTime}) as failed_24h
        FROM process_instances
        WHERE archived_at IS NULL
      `;
      if (rows.length > 0) {
        stats = {
          running: Number(rows[0].running) || 0,
          paused: Number(rows[0].paused) || 0,
          completedLast24h: Number(rows[0].completed24h) || 0,
          failedLast24h: Number(rows[0].failed24h) || 0,
        };
      }
    } catch (e) {
      console.error('[admin/workflows] stats query failed:', e);
    }
  }

  if (migrationRequired) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Workflow Monitor</h1>
            <p className="text-sm text-gray-500 mt-1">
              Workflow instance tracking and management
            </p>
          </div>
          <Link href="/admin/dashboard" className="text-sm text-blue-600 hover:underline">
            Back to Dashboard
          </Link>
        </div>
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-8 text-center">
          <h2 className="text-lg font-semibold text-yellow-800 mb-2">Migration Required</h2>
          <p className="text-sm text-yellow-700">
            The <code className="font-mono bg-yellow-100 px-1 rounded">process_instances</code> table
            does not exist yet. Run the workflow migration to create it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflow Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Workflow instance tracking and management
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/admin/process" className="text-sm text-blue-600 hover:underline">
            Process Monitor
          </Link>
          <Link href="/admin/dashboard" className="text-sm text-blue-600 hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
      <LaunchContentClient />
      <LaunchCollaborationClient />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Completed/failed history:</span>
        {RANGE_CHIPS.map((c) => (
          <Link
            key={c.key}
            href={`/admin/workflows?range=${c.key}`}
            className={`px-2.5 py-1 rounded border ${
              !custom && range === c.key
                ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {c.label}
          </Link>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        {/* Custom bookend range (server-rendered GET form; From alone = since-date to present) */}
        <form method="get" action="/admin/workflows" className="flex items-center gap-1.5">
          <label className="text-gray-500">From</label>
          <input type="date" name="from" defaultValue={fromDate ?? ''} required
            className="border border-gray-300 rounded px-2 py-1 text-xs" />
          <label className="text-gray-500">to</label>
          <input type="date" name="to" defaultValue={toDate ?? ''}
            className="border border-gray-300 rounded px-2 py-1 text-xs" />
          <button type="submit"
            className={`px-2.5 py-1 rounded border ${custom ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-400 bg-white text-gray-700 hover:bg-gray-100'}`}>
            Apply
          </button>
        </form>
        {custom && (
          <>
            <span className="text-gray-600">showing <span className="font-medium">{rangeLabel}</span></span>
            <Link href="/admin/workflows?range=24h" className="text-blue-600 hover:underline">clear</Link>
          </>
        )}
      </div>
      <WorkflowMonitorClient
        active={active}
        recent={recent}
        stats={stats}
        rangeLabel={rangeLabel}
      />
    </div>
  );
}
