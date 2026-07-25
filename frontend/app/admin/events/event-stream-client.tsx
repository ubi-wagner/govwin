'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { describeEvent as describeEventLabel } from '@/lib/event-labels';

export type SerializedEvent = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  parentEventId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
};

export type SerializedAgentLog = {
  id: string;
  tenantId: string | null;
  agentRole: string;
  taskType: string;
  status: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCallsCount: number | null;
  durationMs: number | null;
  costUsd: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

const NAMESPACES = ['all', 'finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool'] as const;

const NAMESPACE_COLORS: Record<string, string> = {
  identity: 'border-blue-400 bg-blue-50',
  finder: 'border-indigo-400 bg-indigo-50',
  capture: 'border-green-400 bg-green-50',
  library: 'border-teal-400 bg-teal-50',
  proposal: 'border-purple-400 bg-purple-50',
  system: 'border-yellow-400 bg-yellow-50',
  tool: 'border-orange-400 bg-orange-50',
};

const NAMESPACE_ICONS: Record<string, string> = {
  identity: '🔑',
  finder: '🔍',
  capture: '💳',
  library: '📚',
  proposal: '📝',
  tool: '🔧',
  system: '⚙️',
};

const TIME_RANGES = [
  { label: '1h', value: '1' },
  { label: '6h', value: '6' },
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
  { label: '30d', value: '720' },
];

const AGENT_STATUSES = ['', 'running', 'completed', 'failed'];

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function PhaseBadge({ phase }: { phase: string | null }) {
  if (!phase) return <span className="text-gray-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    start: 'bg-blue-100 text-blue-700',
    end: 'bg-green-100 text-green-700',
    single: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colors[phase] ?? 'bg-gray-100 text-gray-600'}`}>
      {phase}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-gray-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function ActorIcon({ actorType }: { actorType: string | null }) {
  const icons: Record<string, string> = { user: '👤', agent: '🤖', system: '⚙️', pipeline: '🔄' };
  return <span title={actorType ?? 'unknown'}>{icons[actorType ?? ''] ?? '•'}</span>;
}

type GroupedEvent = { event: SerializedEvent; childEvent?: SerializedEvent };

function groupEvents(events: SerializedEvent[]): GroupedEvent[] {
  const byId = new Map<string, SerializedEvent>();
  for (const ev of events) byId.set(ev.id, ev);
  const childIds = new Set<string>();
  const parentToChild = new Map<string, SerializedEvent>();
  for (const ev of events) {
    if (ev.parentEventId && byId.has(ev.parentEventId)) {
      childIds.add(ev.id);
      parentToChild.set(ev.parentEventId, ev);
    }
  }
  return events
    .filter((ev) => !childIds.has(ev.id))
    .map((ev) => ({ event: ev, childEvent: parentToChild.get(ev.id) }));
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function EventStreamClient({
  events,
  agentLogs,
  tenants,
  currentNamespace,
  currentType,
  currentHours,
  currentErrorsOnly,
  currentTenantId,
  currentTab,
  currentOffset,
  total,
  pageSize,
  isMasterAdmin,
}: {
  events: SerializedEvent[];
  agentLogs: SerializedAgentLog[];
  tenants: { id: string; name: string; slug: string }[];
  currentNamespace: string;
  currentType: string;
  currentHours: string;
  currentErrorsOnly: boolean;
  currentTenantId: string;
  currentTab: string;
  currentOffset: number;
  total: number;
  pageSize: number;
  isMasterAdmin: boolean;
}) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [typeSearch, setTypeSearch] = useState(currentType);

  const buildUrl = useCallback(
    (overrides: {
      ns?: string; hours?: string; type?: string; errorsOnly?: boolean;
      tenantId?: string; tab?: string; offset?: number;
    }) => {
      const p = new URLSearchParams();
      const tab = overrides.tab ?? currentTab;
      const ns = overrides.ns ?? currentNamespace;
      const h = overrides.hours ?? currentHours;
      const t = overrides.type ?? currentType;
      const err = overrides.errorsOnly ?? currentErrorsOnly;
      const tid = overrides.tenantId ?? currentTenantId;
      const off = overrides.offset ?? 0;

      if (tab && tab !== 'events') p.set('tab', tab);
      if (ns && ns !== 'all') p.set('namespace', ns);
      if (h && h !== '24') p.set('hours', h);
      if (t) p.set('type', t);
      if (err) p.set('errorsOnly', '1');
      if (tid) p.set('tenantId', tid);
      if (off > 0) p.set('offset', String(off));
      const qs = p.toString();
      return '/admin/events' + (qs ? '?' + qs : '');
    },
    [currentTab, currentNamespace, currentHours, currentType, currentErrorsOnly, currentTenantId],
  );

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  useEffect(() => {
    const errorIds = events.filter((ev) => ev.error != null).map((ev) => ev.id);
    if (errorIds.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const id of errorIds) next.add(id);
        return next;
      });
    }
  }, [events]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const grouped = useMemo(() => groupEvents(events), [events]);
  const hasPrev = currentOffset > 0;
  const hasNext = currentOffset + pageSize < total;

  /* ---------------------------------------------------------------- */
  /*  Shared filter bar                                                */
  /* ---------------------------------------------------------------- */

  const FilterBar = () => (
    <div className="space-y-3 mb-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 pb-0">
        {[
          { label: 'System Events', value: 'events' },
          { label: 'AI Executions', value: 'agents' },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => router.push(buildUrl({ tab: t.value, offset: 0 }))}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              currentTab === t.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        {currentTab === 'events' && (
          <>
            <label className="text-xs font-medium text-gray-500 uppercase">Namespace</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
              value={currentNamespace || 'all'}
              onChange={(e) => router.push(buildUrl({ ns: e.target.value, offset: 0 }))}
            >
              {NAMESPACES.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>

            <label className="text-xs font-medium text-gray-500 uppercase ml-2">Type</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={typeSearch}
                onChange={(e) => setTypeSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(buildUrl({ type: typeSearch, offset: 0 }));
                }}
                placeholder="Filter type..."
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-40"
              />
              <button
                onClick={() => router.push(buildUrl({ type: typeSearch, offset: 0 }))}
                className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100"
              >
                Go
              </button>
              {currentType && (
                <button
                  onClick={() => { setTypeSearch(''); router.push(buildUrl({ type: '', offset: 0 })); }}
                  className="px-2 py-1 text-xs rounded border border-red-200 bg-red-50 text-red-600"
                >
                  ✕
                </button>
              )}
            </div>
          </>
        )}

        {currentTab === 'agents' && (
          <>
            <label className="text-xs font-medium text-gray-500 uppercase">Role</label>
            <div className="flex gap-1">
              <input
                type="text"
                value={typeSearch}
                onChange={(e) => setTypeSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(buildUrl({ ns: typeSearch, offset: 0 }));
                }}
                placeholder="Agent role..."
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-40"
              />
              <button
                onClick={() => router.push(buildUrl({ ns: typeSearch, offset: 0 }))}
                className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100"
              >
                Go
              </button>
            </div>

            <label className="text-xs font-medium text-gray-500 uppercase ml-2">Status</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
              value={currentType}
              onChange={(e) => router.push(buildUrl({ type: e.target.value, offset: 0 }))}
            >
              {AGENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s || 'all'}</option>
              ))}
            </select>
          </>
        )}

        {/* Tenant filter (master_admin only) */}
        {isMasterAdmin && (
          <>
            <label className="text-xs font-medium text-gray-500 uppercase ml-2">Tenant</label>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white max-w-[180px]"
              value={currentTenantId}
              onChange={(e) => router.push(buildUrl({ tenantId: e.target.value, offset: 0 }))}
            >
              <option value="">All tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </>
        )}

        {/* Errors only toggle (events tab) */}
        {currentTab === 'events' && (
          <button
            onClick={() => router.push(buildUrl({ errorsOnly: !currentErrorsOnly, offset: 0 }))}
            className={`ml-2 px-2 py-1 text-xs rounded border font-medium transition-colors ${
              currentErrorsOnly
                ? 'bg-red-500 text-white border-red-500'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-red-50 hover:border-red-300'
            }`}
          >
            🔴 Errors only
          </button>
        )}

        {/* Time range */}
        <label className="text-xs font-medium text-gray-500 uppercase ml-auto">Time</label>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => router.push(buildUrl({ hours: tr.value, offset: 0 }))}
              className={`px-2 py-1 text-xs rounded border ${
                currentHours === tr.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Auto-refresh */}
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`w-10 h-5 rounded-full relative transition-colors ml-2 ${autoRefresh ? 'bg-green-500' : 'bg-gray-300'}`}
          title="Auto-refresh every 10s"
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  Pagination bar                                                   */
  /* ---------------------------------------------------------------- */

  const Pagination = () => (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
      <span>{total} total · page {Math.floor(currentOffset / pageSize) + 1} of {Math.ceil(total / pageSize) || 1}</span>
      <div className="flex gap-2">
        <button
          disabled={!hasPrev}
          onClick={() => router.push(buildUrl({ offset: currentOffset - pageSize }))}
          className={`px-3 py-1 rounded border text-xs ${hasPrev ? 'bg-white border-gray-300 hover:bg-gray-100' : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'}`}
        >
          ← Previous
        </button>
        <button
          disabled={!hasNext}
          onClick={() => router.push(buildUrl({ offset: currentOffset + pageSize }))}
          className={`px-3 py-1 rounded border text-xs ${hasNext ? 'bg-white border-gray-300 hover:bg-gray-100' : 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed'}`}
        >
          Next →
        </button>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  System Events timeline                                           */
  /* ---------------------------------------------------------------- */

  if (currentTab === 'agents') {
    return (
      <div>
        <FilterBar />
        {agentLogs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No AI executions found for the selected filters.</div>
        ) : (
          <>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Agent Role</th>
                    <th className="px-3 py-2 font-medium">Task Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Duration</th>
                    <th className="px-3 py-2 font-medium">Tokens In/Out</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                    <th className="px-3 py-2 font-medium">Tenant</th>
                    <th className="px-3 py-2 font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {agentLogs.map((log) => {
                    const isExpanded = expandedIds.has(log.id);
                    return (
                      <tr key={log.id} className={`border-t border-gray-100 hover:bg-gray-50 ${log.error ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap" title={absoluteTime(log.createdAt)}>
                          {relativeTime(log.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-gray-700">{log.agentRole}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{log.taskType}</td>
                        <td className="px-3 py-2"><StatusBadge status={log.status} /></td>
                        <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                          {log.durationMs != null ? `${(log.durationMs / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                          {log.inputTokens != null ? `${log.inputTokens.toLocaleString()}` : '—'}
                          {log.outputTokens != null ? ` / ${log.outputTokens.toLocaleString()}` : ''}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                          {log.costUsd != null ? `$${log.costUsd.toFixed(4)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                          {log.tenantId ? log.tenantId.slice(0, 8) + '…' : 'platform'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {log.error ? (
                            <button
                              onClick={() => toggleExpand(log.id)}
                              className="text-red-600 hover:underline"
                            >
                              {isExpanded ? 'collapse' : 'error ▾'}
                            </button>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                          {isExpanded && log.error && (
                            <pre className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 overflow-auto max-h-32 whitespace-pre-wrap">
                              {log.error}
                            </pre>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination />
          </>
        )}
      </div>
    );
  }

  /* System Events timeline (default tab) */
  return (
    <div>
      <FilterBar />
      {grouped.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No events found for the selected filters.
        </div>
      ) : (
        <>
          <div className="relative">
            <div className="absolute left-[139px] top-0 bottom-0 w-px bg-gray-200" />
            <div className="space-y-0">
              {grouped.map(({ event: ev, childEvent }) => {
                const isExpanded = expandedIds.has(ev.id);
                const hasError = ev.error != null;
                const nsColor = NAMESPACE_COLORS[ev.namespace] ?? 'border-gray-300 bg-gray-50';
                const nsIcon = NAMESPACE_ICONS[ev.namespace] ?? '•';
                const label = describeEventLabel({
                  namespace: ev.namespace,
                  type: ev.type,
                  phase: ev.phase,
                  payload: ev.payload,
                  durationMs: ev.durationMs,
                });

                return (
                  <div key={ev.id} className="relative flex gap-4 py-2 group">
                    {/* Timestamp gutter */}
                    <div className="w-[120px] flex-shrink-0 text-right pr-4 pt-1" title={absoluteTime(ev.createdAt)}>
                      <span className="text-xs text-gray-400">{relativeTime(ev.createdAt)}</span>
                    </div>

                    {/* Timeline dot */}
                    <div className="flex-shrink-0 relative z-10 mt-1.5">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] ${
                        hasError ? 'border-red-500 bg-red-100' : 'border-gray-300 bg-white group-hover:border-blue-400'
                      }`}>
                        <span>{nsIcon}</span>
                      </div>
                    </div>

                    {/* Event card */}
                    <div className="flex-1 min-w-0 pb-2">
                      <div className={`rounded-lg border-l-4 p-3 transition-shadow hover:shadow-sm ${hasError ? 'border-l-red-500 bg-red-50' : nsColor}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-800">{label}</span>
                            <PhaseBadge phase={ev.phase} />
                            {ev.durationMs != null && ev.phase === 'end' && (
                              <span className="text-xs text-gray-400 font-mono">{ev.durationMs}ms</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {isMasterAdmin && ev.tenantId && (
                              <span className="text-xs text-gray-400 font-mono">{ev.tenantId.slice(0, 8)}…</span>
                            )}
                            <button
                              onClick={() => toggleExpand(ev.id)}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              {isExpanded ? 'collapse' : 'expand'}
                            </button>
                          </div>
                        </div>

                        {/* Sub-line: type + actor */}
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-400 font-mono">{ev.namespace}.{ev.type}</span>
                          <span className="text-xs text-gray-500">
                            <ActorIcon actorType={ev.actorType} />
                            {' '}{ev.actorEmail ?? ev.actorId ?? ev.actorType ?? '—'}
                          </span>
                        </div>

                        {/* Error */}
                        {hasError && (
                          <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs">
                            <span className="font-medium text-red-700">Error: </span>
                            <pre className="mt-1 text-red-600 overflow-auto max-h-32 whitespace-pre-wrap">
                              {JSON.stringify(ev.error, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Expanded payload */}
                        {isExpanded && ev.payload && (
                          <div className="mt-2">
                            <pre className="p-2 bg-white/70 border border-gray-200 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap font-mono text-gray-600">
                              {JSON.stringify(ev.payload, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Correlated child event */}
                        {childEvent && (
                          <div className="mt-2 ml-4 pl-3 border-l-2 border-gray-300">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-gray-500">
                                {describeEventLabel({ namespace: childEvent.namespace, type: childEvent.type, phase: childEvent.phase, payload: childEvent.payload, durationMs: childEvent.durationMs })}
                              </span>
                              <PhaseBadge phase={childEvent.phase} />
                              {childEvent.durationMs != null && (
                                <span className="text-xs text-gray-400 font-mono">{childEvent.durationMs}ms</span>
                              )}
                            </div>
                            {childEvent.error != null && (
                              <div className="mt-1 p-2 bg-red-100 border border-red-200 rounded text-xs">
                                <span className="font-medium text-red-700">Error: </span>
                                <pre className="mt-1 text-red-600 overflow-auto max-h-32 whitespace-pre-wrap">
                                  {JSON.stringify(childEvent.error, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <Pagination />
        </>
      )}
    </div>
  );
}
