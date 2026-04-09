/**
 * /admin/system — master_admin dashboard showing:
 *   - queue depth (agent_task_queue pending count)
 *   - event rates (events + errors in the last hour)
 *   - tool invocation stats for the last 24 hours
 *   - recent error events
 *   - registered tool catalog (proves the dual-use framework is live)
 *
 * Server component — reads lib/capacity + lib/tools directly via
 * the same functions the /api/admin/system endpoint uses. Access is
 * gated by middleware (`{prefix: '/admin', role: 'rfp_admin'}`) AND
 * by a manual role check in this component for defense in depth —
 * the data exposed is master_admin-only even though rfp_admin can
 * hit the /admin/* tree generally.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  eventRates,
  queueDepth,
  recentErrors,
  recentToolStats,
} from '@/lib/capacity';
import { list as listTools } from '@/lib/tools';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function SystemAdminPage() {
  const session = await auth();
  const sessionUser = session?.user as
    | { id?: string; role?: unknown; tenantSlug?: string | null }
    | undefined;
  if (!sessionUser?.id || !isRole(sessionUser.role)) {
    redirect('/login');
  }
  if (!hasRoleAtLeast(sessionUser.role, 'master_admin')) {
    redirect('/');
  }

  // Fetch everything in parallel so the page renders quickly.
  const [depth, rates, toolStats, errors] = await Promise.all([
    queueDepth(),
    eventRates(),
    recentToolStats(24),
    recentErrors(20),
  ]);

  const tools = listTools();

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-gray-900">System Health</h1>
        <p className="text-sm text-gray-500 mt-1">
          Master admin view of platform metrics. Data as of{' '}
          {new Date().toISOString()}.
        </p>
      </header>

      {/* ─── Top-line metrics ────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-4">
        <MetricCard label="Queue depth" value={depth.toLocaleString()} hint="agent_task_queue pending rows" />
        <MetricCard label="Events (1h)" value={rates.eventsLastHour.toLocaleString()} hint="system_events rows in the last hour" />
        <MetricCard
          label="Errors (1h)"
          value={rates.errorsLastHour.toLocaleString()}
          hint="system_events rows with error IS NOT NULL in the last hour"
          emphasis={rates.errorsLastHour > 0 ? 'danger' : 'ok'}
        />
      </section>

      {/* ─── Tool stats ──────────────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">
          Tool invocations (last 24h)
        </h2>
        {toolStats.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No tool invocations recorded yet. Call a tool via /api/tools/[name]
            or the admin invoke form to populate metrics.
          </p>
        ) : (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Tool</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2 text-right">p50 ms</th>
                <th className="px-3 py-2 text-right">p95 ms</th>
              </tr>
            </thead>
            <tbody>
              {toolStats.map((row) => (
                <tr key={row.toolName} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{row.toolName}</td>
                  <td className="px-3 py-2 text-right">{row.totalCalls}</td>
                  <td
                    className={`px-3 py-2 text-right ${
                      row.errorCalls > 0 ? 'text-red-600 font-medium' : ''
                    }`}
                  >
                    {row.errorCalls}
                  </td>
                  <td className="px-3 py-2 text-right">{row.p50DurationMs}</td>
                  <td className="px-3 py-2 text-right">{row.p95DurationMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ─── Registered tool catalog ─────────────────────────────── */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">
          Registered tools ({tools.length})
        </h2>
        <p className="text-sm text-gray-500 mb-3">
          Every tool below is invokable via the dual-use entry points: direct
          in-process call, <code className="text-xs">POST /api/tools/[name]</code>,
          or (Phase 4) the pipeline dispatcher.
        </p>
        {tools.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No tools registered.</p>
        ) : (
          <div className="space-y-2">
            {tools.map((t) => (
              <div key={t.name} className="border border-gray-200 rounded p-3">
                <div className="flex items-center justify-between">
                  <code className="text-sm font-mono font-semibold">{t.name}</code>
                  <span className="text-xs text-gray-500">
                    {t.namespace}
                    {t.tenantScoped ? ' · tenant-scoped' : ''}
                    {t.requiredRole ? ` · ${t.requiredRole}+` : ''}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{t.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Recent errors ───────────────────────────────────────── */}
      <section>
        <h2 className="text-xl font-semibold text-gray-900 mb-3">
          Recent errors ({errors.length})
        </h2>
        {errors.length === 0 ? (
          <p className="text-sm text-gray-500 italic">
            No errors recorded. That&apos;s good.
          </p>
        ) : (
          <div className="space-y-2">
            {errors.map((e) => {
              const errorMessage =
                e.error && typeof e.error === 'object' && 'message' in e.error
                  ? String(e.error.message)
                  : 'unknown error';
              return (
                <div
                  key={e.id}
                  className="border border-red-200 bg-red-50 rounded p-3 text-xs"
                >
                  <div className="flex items-center justify-between font-mono">
                    <span>
                      <span className="font-semibold">{e.namespace}</span>.
                      {e.type}
                    </span>
                    <span className="text-gray-500">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-red-700">{errorMessage}</p>
                  <p className="text-gray-500 mt-1">
                    actor: {e.actorType}:{e.actorId}
                    {e.tenantId ? ` · tenant: ${e.tenantId}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Helper component ─────────────────────────────────────────────

function MetricCard({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: 'ok' | 'danger';
}) {
  const valueClass =
    emphasis === 'danger'
      ? 'text-red-600'
      : emphasis === 'ok'
        ? 'text-green-600'
        : 'text-gray-900';
  return (
    <div className="border border-gray-200 rounded p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${valueClass}`}>{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
