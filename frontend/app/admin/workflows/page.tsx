import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';
import { WorkflowMonitorClient } from './workflow-monitor-client';

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
    source: r.source ?? 'pipeline',
    retryCount: r.retryCount ?? 0,
    lastError: r.lastError,
    lastErrorStep: r.lastErrorStep,
    recoveredFrom: r.recoveredFrom,
    durationMs: r.durationMs ? Number(r.durationMs) : null,
  };
}

export default async function WorkflowMonitorPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  let active: WorkflowInstance[] = [];
  let recent: WorkflowInstance[] = [];
  let stats: WorkflowStats = { running: 0, paused: 0, completedLast24h: 0, failedLast24h: 0 };
  let migrationRequired = false;

  // (a) Active workflow instances
  try {
    const rows = await sql<WorkflowInstanceRow[]>`
      SELECT id, workflow_name, status, current_step, current_step_index,
             step_status, started_at, completed_at, last_heartbeat_at,
             tenant_id, source, retry_count, last_error, last_error_step,
             recovered_from,
             CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
                  ELSE NULL END as duration_ms
      FROM process_instances
      WHERE status IN ('running', 'paused', 'pending', 'retrying')
      ORDER BY started_at DESC NULLS LAST
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
        SELECT id, workflow_name, status, current_step, current_step_index,
               step_status, started_at, completed_at, last_heartbeat_at,
               tenant_id, source, retry_count, last_error, last_error_step,
               recovered_from,
               CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
                    ELSE NULL END as duration_ms
        FROM process_instances
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND status NOT IN ('running', 'paused', 'pending', 'retrying')
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 100
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
          COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours') as completed_24h,
          COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours') as failed_24h
        FROM process_instances
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
      <WorkflowMonitorClient
        active={active}
        recent={recent}
        stats={stats}
      />
    </div>
  );
}
