'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import type { WorkflowInstance, WorkflowStats } from './page';
import { WorkflowMap } from './workflow-map';
import { WorkflowGraph, WorkflowGraphLegend } from './workflow-graph';
import { buildGraphFromStatus } from './workflow-shapes';

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

interface Transition {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  stepName: string | null;
  actor: string | null;
  reason: string | null;
  createdAt: string;
}

/** The process_instance_transitions timeline for one workflow instance — the
 *  drill-through that lets an admin watch a workflow's actual step execution. */
function TransitionTimeline({ state }: { state: Transition[] | 'loading' | 'error' }) {
  if (state === 'loading') return <p className="text-xs text-gray-400">Loading steps…</p>;
  if (state === 'error') return <p className="text-xs text-red-500">Could not load the step timeline.</p>;
  if (state.length === 0) return <p className="text-xs text-gray-400">No transitions recorded yet.</p>;
  return (
    <ol className="relative border-l border-gray-200 ml-1 space-y-2.5 py-1">
      {state.map((t) => {
        const style = getStyle(t.toStatus);
        return (
          <li key={t.id} className="ml-4">
            <span className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full ${style.dot}`} />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {t.stepName && <span className="font-mono text-gray-700">{formatStepName(t.stepName)}</span>}
              <span className="text-gray-400">
                {t.fromStatus ? `${t.fromStatus} → ` : ''}
                <span className={`font-medium ${style.text}`}>{t.toStatus}</span>
              </span>
              {t.actor && <span className="text-gray-400">· {t.actor}</span>}
              <span className="text-gray-400 ml-auto">{relativeTime(t.createdAt)}</span>
            </div>
            {t.reason && <p className="text-[11px] text-gray-500 mt-0.5">{t.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** The live DAG for one instance — the template's designed flow with each step
 *  coloured by this instance's actual run status (step_status). Sits above the
 *  textual transition timeline so an admin can SEE where a workflow is. */
function InstanceStepGraph({
  workflowName,
  stepStatus,
  status,
}: {
  workflowName: string;
  stepStatus: Record<string, string>;
  status: string;
}) {
  const { nodes, edges } = buildGraphFromStatus(workflowName, stepStatus, status);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Flow</span>
        <WorkflowGraphLegend live />
      </div>
      <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-2">
        <WorkflowGraph nodes={nodes} edges={edges} live compact />
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export function WorkflowMonitorClient({
  active,
  recent,
  stats,
  rangeLabel = '24h',
}: {
  active: WorkflowInstance[];
  recent: WorkflowInstance[];
  stats: WorkflowStats;
  rangeLabel?: string;
}) {
  const router = useRouter();
  const [, setTick] = useState(0);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  // Filter / sort / live controls — the "workflow treatment" mirroring the Event Stream.
  const [liveOn, setLiveOn] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'time' | 'workflow' | 'status' | 'tenant' | 'duration'>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Auto-refresh every 10 seconds while Live is on (toggleable, so an admin can freeze the view).
  useEffect(() => {
    if (!liveOn) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [router, liveOn]);

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

  // Lazy-loaded per-instance step timeline (process_instance_transitions) — the
  // drill-through the API already served but no UI rendered. Re-fetches on open
  // so the monitor shows the live transition history.
  const [timelines, setTimelines] = useState<Record<string, Transition[] | 'loading' | 'error'>>({});
  const [openTimelines, setOpenTimelines] = useState<Set<string>>(new Set());

  const toggleTimeline = useCallback(async (id: string) => {
    const isOpen = openTimelines.has(id);
    setOpenTimelines((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isOpen) return; // closing — nothing to fetch
    setTimelines((prev) => ({ ...prev, [id]: 'loading' }));
    try {
      const res = await fetch(`/api/admin/workflows/${id}`);
      const body = await res.json().catch(() => ({}));
      const transitions = body?.data?.transitions;
      setTimelines((prev) => ({
        ...prev,
        [id]: Array.isArray(transitions) ? (transitions as Transition[]) : 'error',
      }));
    } catch {
      setTimelines((prev) => ({ ...prev, [id]: 'error' }));
    }
  }, [openTimelines]);

  // ── Filter + sort (client-side, over the loaded active/recent lists) ──────────
  const tenantOf = (w: WorkflowInstance) =>
    (w.tenantName ?? w.tenantSlug ?? (w.tenantId ? w.tenantId.slice(0, 8) : '~platform')).toLowerCase();
  const matches = (w: WorkflowInstance) =>
    (statusFilter === 'all' || w.status === statusFilter) &&
    (sourceFilter === 'all' || w.source === sourceFilter) &&
    (search.trim() === '' ||
      formatWorkflowName(w.workflowName).toLowerCase().includes(search.trim().toLowerCase()) ||
      w.workflowName.toLowerCase().includes(search.trim().toLowerCase()));
  const sortVal = (w: WorkflowInstance): string | number => {
    switch (sortKey) {
      case 'time': return new Date(w.completedAt ?? w.startedAt ?? 0).getTime();
      case 'workflow': return formatWorkflowName(w.workflowName).toLowerCase();
      case 'status': return w.status;
      case 'tenant': return tenantOf(w);
      case 'duration': return w.durationMs ?? -1;
    }
  };
  const sortList = (list: WorkflowInstance[]) =>
    [...list].sort((a, b) => {
      const av = sortVal(a), bv = sortVal(b);
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? c : -c;
    });
  const filteredActive = sortList(active.filter(matches));
  const filteredRecent = sortList(recent.filter(matches));
  const failedInView = filteredRecent.filter((w) => w.status === 'failed');
  // Retry every failed instance currently in view — loops the existing per-instance retry route
  // (no new endpoint). One filtered "retry all" instead of N single clicks during an outage.
  const retryAllFailed = async () => {
    if (failedInView.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkMsg(null);
    const outcomes = await Promise.allSettled(
      failedInView.map((w) => fetch(`/api/admin/workflows/${w.id}/retry`, { method: 'POST' }).then((r) => r.ok)),
    );
    const ok = outcomes.filter((o) => o.status === 'fulfilled' && o.value === true).length;
    setBulkMsg(`Retried ${ok}/${failedInView.length} failed.`);
    setBulkBusy(false);
    router.refresh();
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
          <span>Completed {rangeLabel}</span>
          <span className="font-bold text-lg">{stats.completedLast24h}</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-sm font-medium text-red-700">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          <span>Failed {rangeLabel}</span>
          <span className="font-bold text-lg">{stats.failedLast24h}</span>
        </div>
      </section>

      {/* ── Filter · sort · live controls (the workflow treatment) ────── */}
      <section className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <label className="text-xs font-medium text-gray-500 uppercase">Status</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
          {['all', 'running', 'paused', 'pending', 'retrying', 'completed', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label className="text-xs font-medium text-gray-500 uppercase ml-2">Source</label>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
          {['all', 'pipeline', 'cms'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search workflow…" className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-44 ml-2" />
        <label className="text-xs font-medium text-gray-500 uppercase ml-2">Sort</label>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as typeof sortKey)} className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
          <option value="time">Time</option>
          <option value="workflow">Workflow</option>
          <option value="status">Status</option>
          <option value="tenant">Tenant</option>
          <option value="duration">Duration</option>
        </select>
        <button onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))} className="px-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100" title="Toggle sort direction">
          {sortDir === 'asc' ? '▲ Asc' : '▼ Desc'}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500">Live</label>
          <button onClick={() => setLiveOn((v) => !v)} className={`w-10 h-5 rounded-full relative transition-colors ${liveOn ? 'bg-green-500' : 'bg-gray-300'}`} title="Auto-refresh every 10s">
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${liveOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          {liveOn && <span className="text-xs text-green-600 font-medium">10s</span>}
        </div>
      </section>

      {/* ── Workflow Catalog (all templates + activation switch) ─────── */}
      <WorkflowMap />

      {/* ── Active Workflows ───────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Active Workflows ({filteredActive.length})</h2>
        {filteredActive.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            No active workflows{active.length > 0 ? ' match the current filters' : ''}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredActive.map((w) => {
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

                    <span className="text-xs text-gray-500" title={w.tenantId ?? 'platform (rfp-pipeline)'}>
                      {w.tenantId
                        ? <>tenant: <span className="font-medium text-gray-700">{w.tenantName ?? w.tenantSlug ?? `${w.tenantId.slice(0, 8)}…`}</span></>
                        : <span className="font-medium text-indigo-600">Platform</span>}
                    </span>

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
                      <button
                        onClick={() => toggleTimeline(w.id)}
                        className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                      >
                        {openTimelines.has(w.id) ? 'Hide steps' : 'Steps'}
                      </button>
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

                  {openTimelines.has(w.id) && (
                    <div className="mt-3 pl-1 space-y-3">
                      <InstanceStepGraph workflowName={w.workflowName} stepStatus={w.stepStatus} status={w.status} />
                      <TransitionTimeline state={timelines[w.id] ?? 'loading'} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recent History ─────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Recent History ({rangeLabel}) · {filteredRecent.length} shown</h2>
          {failedInView.length > 0 && (
            <div className="flex items-center gap-2">
              {bulkMsg && <span className="text-xs text-gray-500">{bulkMsg}</span>}
              <button onClick={retryAllFailed} disabled={bulkBusy} className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                {bulkBusy ? 'Retrying…' : `Retry all failed (${failedInView.length})`}
              </button>
            </div>
          )}
        </div>
        {filteredRecent.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            No completed workflows{recent.length > 0 ? ' match the current filters' : ` in the last ${rangeLabel}`}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {filteredRecent.map((w) => {
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

                    <span className="text-xs text-gray-500" title={w.tenantId ?? 'platform (rfp-pipeline)'}>
                      {w.tenantId
                        ? <>tenant: <span className="font-medium text-gray-700">{w.tenantName ?? w.tenantSlug ?? `${w.tenantId.slice(0, 8)}…`}</span></>
                        : <span className="font-medium text-indigo-600">Platform</span>}
                    </span>

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

                    <button
                      onClick={() => toggleTimeline(w.id)}
                      className="text-xs text-blue-600 hover:underline flex-shrink-0"
                    >
                      {openTimelines.has(w.id) ? 'hide steps' : 'steps'}
                    </button>
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

                  {openTimelines.has(w.id) && (
                    <div className="mt-3 pl-1 space-y-3">
                      <InstanceStepGraph workflowName={w.workflowName} stepStatus={w.stepStatus} status={w.status} />
                      <TransitionTimeline state={timelines[w.id] ?? 'loading'} />
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
