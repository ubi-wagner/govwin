'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import type { WorkflowInstance, WorkflowStats } from './page';

// ─── Status styles ─────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { border: string; bg: string; dot: string; text: string }> = {
  running:   { border: 'border-l-blue-500',   bg: 'bg-blue-50',   dot: 'bg-blue-500',   text: 'text-blue-700' },
  paused:    { border: 'border-l-yellow-500',  bg: 'bg-yellow-50', dot: 'bg-yellow-500',  text: 'text-yellow-700' },
  pending:   { border: 'border-l-gray-400',    bg: 'bg-gray-50',   dot: 'bg-gray-400',    text: 'text-gray-600' },
  retrying:  { border: 'border-l-orange-500',  bg: 'bg-orange-50', dot: 'bg-orange-500',  text: 'text-orange-700' },
  completed: { border: 'border-l-green-500',   bg: 'bg-green-50',  dot: 'bg-green-500',   text: 'text-green-700' },
  failed:    { border: 'border-l-red-500',     bg: 'bg-red-50',    dot: 'bg-red-500',     text: 'text-red-700' },
  cancelled: { border: 'border-l-gray-400',    bg: 'bg-gray-50',   dot: 'bg-gray-400',    text: 'text-gray-500' },
};

function getStyle(status: string) {
  return STATUS_STYLES[status] ?? STATUS_STYLES.pending;
}

// ─── Formatting helpers ─────────────────────────────────────────────

function formatWorkflowName(name: string): string {
  return name
    .replace(/^On/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return '--';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '--';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatStepName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function stepSummary(instance: WorkflowInstance): string {
  const stepStatus = instance.stepStatus;
  const total = instance.totalSteps || Object.keys(stepStatus).length || 0;
  const completed = Object.values(stepStatus).filter((s) => s === 'completed').length;
  const failed = Object.values(stepStatus).filter((s) => s === 'failed').length;

  if (instance.status === 'failed' && instance.lastErrorStep) {
    return `Failed at step ${instance.currentStepIndex + 1}: ${instance.lastErrorStep}`;
  }
  if (instance.status === 'completed') {
    return `${completed}/${total} completed`;
  }
  if (failed > 0) {
    return `${completed}/${total} completed, ${failed} failed`;
  }
  return `${completed}/${total} completed`;
}

// ─── Components ─────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const style = getStyle(status);
  if (status === 'running') {
    return (
      <span className="relative flex h-3 w-3 flex-shrink-0">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.dot} opacity-75`} />
        <span className={`relative inline-flex h-3 w-3 rounded-full ${style.dot}`} />
      </span>
    );
  }
  return <span className={`inline-flex h-3 w-3 rounded-full flex-shrink-0 ${style.dot}`} />;
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 font-mono whitespace-nowrap">
        Step {current}/{total}
      </span>
      <div className="h-1.5 w-20 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors =
    source === 'pipeline'
      ? 'bg-indigo-50 text-indigo-600'
      : source === 'cms'
        ? 'bg-teal-50 text-teal-600'
        : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors}`}>
      {source}
    </span>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function WorkflowMonitorClient({
  active,
  recent,
  stats,
}: {
  active: WorkflowInstance[];
  recent: WorkflowInstance[];
  stats: WorkflowStats;
}) {
  const router = useRouter();
  const [, setTick] = useState(0);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [router]);

  // Tick every second to update elapsed times for active workflows
  useEffect(() => {
    if (active.length === 0) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [active.length]);

  const handleRetry = useCallback(async (instanceId: string) => {
    setActionLoading((prev) => ({ ...prev, [instanceId]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });

    try {
      const res = await fetch(`/api/admin/workflows/${instanceId}/retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setActionErrors((prev) => ({ ...prev, [instanceId]: body.error ?? 'Retry failed' }));
      } else {
        router.refresh();
      }
    } catch {
      setActionErrors((prev) => ({ ...prev, [instanceId]: 'Network error' }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [instanceId]: false }));
    }
  }, [router]);

  const handleCancel = useCallback(async (instanceId: string) => {
    setActionLoading((prev) => ({ ...prev, [instanceId]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });

    try {
      const res = await fetch(`/api/admin/workflows/${instanceId}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setActionErrors((prev) => ({ ...prev, [instanceId]: body.error ?? 'Cancel failed' }));
      } else {
        router.refresh();
      }
    } catch {
      setActionErrors((prev) => ({ ...prev, [instanceId]: 'Network error' }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [instanceId]: false }));
    }
  }, [router]);

  // Force-advance a paused (HITL-waiting) instance — admin acts as the human
  // the workflow was parked for. Mirrors handleCancel/handleRetry.
  const handleAdvance = useCallback(async (instanceId: string) => {
    setActionLoading((prev) => ({ ...prev, [instanceId]: true }));
    setActionErrors((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });

    try {
      const res = await fetch(`/api/admin/workflows/${instanceId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Advanced from the workflow monitor' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setActionErrors((prev) => ({ ...prev, [instanceId]: body.error ?? 'Advance failed' }));
      } else {
        router.refresh();
      }
    } catch {
      setActionErrors((prev) => ({ ...prev, [instanceId]: 'Network error' }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [instanceId]: false }));
    }
  }, [router]);

  const toggleError = (id: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Stats bar ──────────────────────────────────────────────── */}
      <section className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
          </span>
          <span>Running</span>
          <span className="font-bold text-lg">{stats.running}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-yellow-200 bg-yellow-50 text-sm font-medium text-yellow-700">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-yellow-500" />
          <span>Paused</span>
          <span className="font-bold text-lg">{stats.paused}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-green-200 bg-green-50 text-sm font-medium text-green-700">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          <span>Completed 24h</span>
          <span className="font-bold text-lg">{stats.completedLast24h}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-700">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          <span>Failed 24h</span>
          <span className="font-bold text-lg">{stats.failedLast24h}</span>
        </div>
      </section>

      {/* ── Active Workflows ───────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Active Workflows</h2>
        {active.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            No active workflows
          </div>
        ) : (
          <div className="space-y-2">
            {active.map((w) => {
              const style = getStyle(w.status);
              const isLoading = actionLoading[w.id] ?? false;
              const error = actionErrors[w.id];
              const completedSteps = Object.values(w.stepStatus).filter((s) => s === 'completed').length;

              return (
                <div
                  key={w.id}
                  className={`rounded-lg border-l-4 ${style.border} ${style.bg} border border-gray-200 p-4`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusDot status={w.status} />

                    <span className="text-sm font-semibold text-gray-900">
                      {formatWorkflowName(w.workflowName)}
                    </span>

                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.text} ${style.bg}`}>
                      {w.status}
                    </span>

                    {w.currentStep && (
                      <span className="text-xs text-gray-500 font-mono">
                        {formatStepName(w.currentStep)}
                      </span>
                    )}

                    <ProgressBar current={completedSteps} total={w.totalSteps} />

                    <SourceBadge source={w.source} />

                    {w.tenantId && (
                      <span className="text-xs text-gray-400 font-mono">
                        tenant: {w.tenantId.slice(0, 8)}...
                      </span>
                    )}

                    {w.retryCount > 0 && (
                      <span className="text-xs text-orange-600 font-medium">
                        retry #{w.retryCount}
                      </span>
                    )}

                    <span className="text-xs font-mono text-blue-600 ml-auto flex-shrink-0">
                      {formatElapsed(w.startedAt)}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {w.status === 'paused' && (
                        <button
                          onClick={() => handleAdvance(w.id)}
                          disabled={isLoading}
                          title="Advance this step as the human reviewer (HITL override)"
                          className="px-2.5 py-1 text-xs font-medium rounded border border-yellow-400 bg-white text-yellow-700 hover:bg-yellow-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isLoading ? '...' : 'Advance'}
                        </button>
                      )}
                      <button
                        onClick={() => handleCancel(w.id)}
                        disabled={isLoading}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? '...' : 'Cancel'}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <p className="mt-2 text-xs text-red-600">{error}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recent History ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent History (24h)</h2>
        {recent.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            No completed workflows in the last 24 hours
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {recent.map((w) => {
              const style = getStyle(w.status);
              const isLoading = actionLoading[w.id] ?? false;
              const error = actionErrors[w.id];
              const hasError = w.lastError !== null && w.lastError !== undefined;
              const isErrorExpanded = expandedErrors.has(w.id);

              return (
                <div key={w.id} className="p-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusDot status={w.status} />

                    <span className="text-sm font-medium text-gray-900">
                      {formatWorkflowName(w.workflowName)}
                    </span>

                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.text} ${style.bg}`}>
                      {w.status}
                    </span>

                    <span className="text-xs text-gray-500">
                      {stepSummary(w)}
                    </span>

                    <SourceBadge source={w.source} />

                    {w.retryCount > 0 && (
                      <span className="text-xs text-orange-600 font-medium">
                        retry #{w.retryCount}
                      </span>
                    )}

                    {w.recoveredFrom && (
                      <span className="text-xs text-purple-600 font-medium">
                        recovered
                      </span>
                    )}

                    <span className="text-xs font-mono text-gray-600 ml-auto flex-shrink-0">
                      {formatDuration(w.durationMs)}
                    </span>

                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {relativeTime(w.completedAt)}
                    </span>

                    {/* Retry button for failed workflows */}
                    {w.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(w.id)}
                        disabled={isLoading}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-orange-300 bg-white text-orange-700 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {isLoading ? '...' : 'Retry'}
                      </button>
                    )}

                    {/* Expand error details */}
                    {hasError && (
                      <button
                        onClick={() => toggleError(w.id)}
                        className="text-xs text-blue-600 hover:underline flex-shrink-0"
                      >
                        {isErrorExpanded ? 'hide' : 'error'}
                      </button>
                    )}
                  </div>

                  {/* Inline action error */}
                  {error && (
                    <p className="mt-2 text-xs text-red-600">{error}</p>
                  )}

                  {/* Expanded error message */}
                  {isErrorExpanded && w.lastError && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
                      {w.lastErrorStep && (
                        <p className="text-xs text-red-700 font-medium mb-1">
                          Failed at: <span className="font-mono">{w.lastErrorStep}</span>
                        </p>
                      )}
                      <pre className="text-xs text-red-800 font-mono whitespace-pre-wrap overflow-auto max-h-40">
                        {w.lastError}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
