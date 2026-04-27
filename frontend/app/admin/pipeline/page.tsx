import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

type JobRow = {
  id: string;
  source: string;
  kind: string;
  status: string;
  metadata: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

type ScheduleRow = {
  id: string;
  source: string;
  cronExpression: string;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
};

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: Date | null, completedAt: Date | null, status: string): string {
  if (!startedAt) return '—';
  if (status === 'running') return 'running...';
  if (!completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    queued: 'bg-gray-100 text-gray-700',
    running: 'bg-blue-100 text-blue-700 animate-pulse',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status}
    </span>
  );
}

function typeBadge(source: string, kind: string) {
  const colors: Record<string, string> = {
    shred_solicitation: 'bg-purple-100 text-purple-700',
    sam: 'bg-indigo-100 text-indigo-700',
    sbir: 'bg-blue-100 text-blue-700',
    grants: 'bg-teal-100 text-teal-700',
    ingest: 'bg-amber-100 text-amber-700',
  };
  const label = kind === 'ingest' ? source : kind;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[label] ?? colors[kind] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {label}
    </span>
  );
}

export default async function PipelinePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    redirect('/admin');
  }

  let jobs: JobRow[] = [];
  let schedules: ScheduleRow[] = [];
  let jobsError: string | null = null;
  let schedulesError: string | null = null;

  try {
    jobs = await sql<JobRow[]>`
      SELECT id, source, kind, status, metadata, result, error,
             created_at, started_at, completed_at
      FROM pipeline_jobs
      ORDER BY created_at DESC
      LIMIT 50
    `;
  } catch (e) {
    console.error('[admin/pipeline] jobs query failed:', e);
    jobsError = 'Could not load pipeline jobs. The table may not exist yet.';
  }

  try {
    schedules = await sql<ScheduleRow[]>`
      SELECT id, source, cron_expression, enabled, last_run_at, next_run_at
      FROM pipeline_schedules
      ORDER BY source
    `;
  } catch (e) {
    console.error('[admin/pipeline] schedules query failed:', e);
    schedulesError = 'Could not load pipeline schedules. The table may not exist yet.';
  }

  const runningCount = jobs.filter((j) => j.status === 'running').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Pipeline Monitor</h1>
        <p className="text-sm text-gray-500 mt-1">
          {jobs.length} recent jobs
          {runningCount > 0 && <> &middot; <span className="text-blue-600 font-medium">{runningCount} running</span></>}
          {failedCount > 0 && <> &middot; <span className="text-red-600 font-medium">{failedCount} failed</span></>}
          {' '}&middot; {schedules.length} schedules configured
        </p>
      </header>

      {/* ─── Active Schedules ─────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-3">Active Schedules</h2>
        {schedulesError ? (
          <p className="text-sm text-amber-600 italic">{schedulesError}</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No schedules configured.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Source</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Cron Expression</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Enabled</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Last Run</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Next Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {schedules.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.source}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{s.cronExpression}</td>
                    <td className="px-4 py-3">
                      {s.enabled ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {s.lastRunAt ? relativeTime(s.lastRunAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {s.nextRunAt
                        ? new Date(s.nextRunAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Recent Jobs ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">Recent Jobs</h2>
        {jobsError ? (
          <p className="text-sm text-amber-600 italic">{jobsError}</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No jobs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Duration</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Details</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {relativeTime(job.createdAt)}
                    </td>
                    <td className="px-4 py-3">{typeBadge(job.source, job.kind)}</td>
                    <td className="px-4 py-3">{statusBadge(job.status)}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                      {formatDuration(job.startedAt, job.completedAt, job.status)}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {job.metadata || job.result ? (
                        <details className="cursor-pointer">
                          <summary className="text-xs text-blue-600 hover:underline">
                            {job.metadata ? 'metadata' : ''}{job.metadata && job.result ? ' + ' : ''}{job.result ? 'result' : ''}
                          </summary>
                          <div className="mt-1 space-y-1">
                            {job.metadata && (
                              <pre className="text-xs bg-gray-50 rounded p-2 overflow-x-auto max-h-40 text-gray-700">
                                {JSON.stringify(job.metadata, null, 2)}
                              </pre>
                            )}
                            {job.result && (
                              <pre className="text-xs bg-green-50 rounded p-2 overflow-x-auto max-h-40 text-gray-700">
                                {JSON.stringify(job.result, null, 2)}
                              </pre>
                            )}
                          </div>
                        </details>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {job.error ? (
                        <span className="text-xs text-red-600 break-words">{job.error}</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
