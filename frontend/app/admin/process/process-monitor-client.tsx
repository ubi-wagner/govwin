'use client';

import { useRouter } from 'next/navigation';
import { TimeAgo, Elapsed } from '@/components/ui/time-ago';
import { useState, useEffect } from 'react';
import type {
  ActiveProcess,
  CompletedProcess,
  ErrorEvent,
  NamespaceStat,
  TenantActivity,
} from './page';

// The relative-time helpers that used to live here read the clock
// DURING RENDER — the server wrote one number, the client hydrated a beat later and wrote
// another, and React #418 took the whole page to its error boundary while the route kept
// answering 200. They are now <TimeAgo> / <Elapsed>, which own their own mount state.
// Bug log B82; the shared component is components/ui/time-ago.tsx.
const NAMESPACE_COLORS: Record<string, { badge: string; card: string }> = {
  identity: {
    badge: 'text-blue-600 bg-blue-50',
    card: 'border-blue-300 bg-blue-50 text-blue-800',
  },
  finder: {
    badge: 'text-indigo-600 bg-indigo-50',
    card: 'border-indigo-300 bg-indigo-50 text-indigo-800',
  },
  capture: {
    badge: 'text-green-600 bg-green-50',
    card: 'border-green-300 bg-green-50 text-green-800',
  },
  library: {
    badge: 'text-teal-600 bg-teal-50',
    card: 'border-teal-300 bg-teal-50 text-teal-800',
  },
  proposal: {
    badge: 'text-purple-600 bg-purple-50',
    card: 'border-purple-300 bg-purple-50 text-purple-800',
  },
  tool: {
    badge: 'text-orange-600 bg-orange-50',
    card: 'border-orange-300 bg-orange-50 text-orange-800',
  },
  system: {
    badge: 'text-gray-600 bg-gray-100',
    card: 'border-gray-300 bg-gray-50 text-gray-800',
  },
  agent: {
    badge: 'text-orange-600 bg-orange-50',
    card: 'border-orange-300 bg-orange-50 text-orange-800',
  },
};

function getNamespaceBadge(ns: string): string {
  return NAMESPACE_COLORS[ns]?.badge ?? 'text-gray-600 bg-gray-100';
}

function getNamespaceCard(ns: string): string {
  return NAMESPACE_COLORS[ns]?.card ?? 'border-gray-300 bg-gray-50 text-gray-800';
}

function describeEvent(namespace: string, type: string): string {
  const key = `${namespace}.${type}`;
  const descriptions: Record<string, string> = {
    'finder.rfp_discovered': 'RFP discovered',
    'finder.rfp_scored': 'RFP scored',
    'finder.rfp_enriched': 'RFP enriched',
    'finder.search_executed': 'Search executed',
    'capture.opportunity_saved': 'Opportunity saved',
    'capture.proposal_started': 'Proposal started',
    'capture.document_uploaded': 'Document uploaded',
    'identity.user_logged_in': 'User logged in',
    'identity.user_registered': 'User registered',
    'identity.session_created': 'Session created',
    'proposal.draft_created': 'Draft created',
    'proposal.section_generated': 'Section generated',
    'proposal.review_submitted': 'Review submitted',
    'library.content_created': 'Content created',
    'library.content_updated': 'Content updated',
    'tool.invocation_completed': 'Tool invocation completed',
    'tool.invocation_started': 'Tool invocation started',
    'system.health_check': 'Health check',
    'system.migration_run': 'Migration executed',
    'agent.task_assigned': 'Agent task assigned',
    'agent.task_completed': 'Agent task completed',
  };
  if (descriptions[key]) return descriptions[key];
  // Fallback: convert type from snake_case to readable
  const readable = type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return readable;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function actorLabel(actorType: string | null, actorEmail: string | null): string {
  if (actorEmail) return actorEmail;
  if (actorType) return actorType;
  return 'system';
}

function ActorIndicator({ actorType }: { actorType: string | null }) {
  switch (actorType) {
    case 'user':
      return <span className="inline-block w-4 h-4 rounded-full bg-blue-400 mr-1.5" title="User" />;
    case 'agent':
      return <span className="inline-block w-4 h-4 rounded-full bg-orange-400 mr-1.5" title="Agent" />;
    case 'system':
    case 'worker':
      return <span className="inline-block w-4 h-4 rounded-full bg-gray-400 mr-1.5" title={actorType} />;
    default:
      return <span className="inline-block w-4 h-4 rounded-full bg-gray-300 mr-1.5" title={actorType ?? 'unknown'} />;
  }
}

export function ProcessMonitorClient({
  activeProcesses,
  completions,
  errors,
  stats,
  tenantActivity,
}: {
  activeProcesses: ActiveProcess[];
  completions: CompletedProcess[];
  errors: ErrorEvent[];
  stats: NamespaceStat[];
  tenantActivity: TenantActivity[];
}) {
  const router = useRouter();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [errorsExpanded, setErrorsExpanded] = useState(errors.length > 0);
  const [, setTick] = useState(0);

  // Auto-refresh every 10s
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  // Tick every second to update elapsed times for active processes
  useEffect(() => {
    if (activeProcesses.length === 0) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [activeProcesses.length]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalEvents = stats.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-6">
      {/* Auto-refresh toggle */}
      <div className="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <span className="text-xs text-gray-500 uppercase font-medium">Auto-refresh</span>
        <button
          onClick={() => setAutoRefresh((v) => !v)}
          className={`w-10 h-5 rounded-full relative transition-colors ${
            autoRefresh ? 'bg-green-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              autoRefresh ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
        {autoRefresh && (
          <span className="text-xs text-green-600 font-medium">10s</span>
        )}
        <button
          onClick={() => router.refresh()}
          className="ml-2 px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-700"
        >
          Refresh now
        </button>
      </div>

      {/* (a) Stats bar — namespace cards */}
      <section>
        <div className="flex flex-wrap gap-3">
          {stats.map((s) => (
            <div
              key={s.namespace}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium ${getNamespaceCard(s.namespace)}`}
            >
              <span className="capitalize">{s.namespace}</span>
              <span className="font-bold text-lg">{s.count}</span>
            </div>
          ))}
          {stats.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700">
              <span>Total</span>
              <span className="font-bold text-lg">{totalEvents}</span>
            </div>
          )}
          {stats.length === 0 && (
            <p className="text-sm text-gray-400 italic">No events recorded in the last 24 hours.</p>
          )}
        </div>
      </section>

      {/* (b) Active Processes — "In Progress" panel */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">In Progress</h2>
        {activeProcesses.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            All processes idle
          </div>
        ) : (
          <div className="space-y-2">
            {activeProcesses.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-blue-200 bg-white p-4"
              >
                {/* Pulsing blue dot */}
                <span className="relative flex h-3 w-3 flex-shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500" />
                </span>

                {/* Namespace badge */}
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${getNamespaceBadge(p.namespace)}`}>
                  {p.namespace}
                </span>

                {/* Description */}
                <span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-900">
                  {describeEvent(p.namespace, p.type)}
                </span>

                {/* Actor — the SECOND row with this shape in this file. Fixing only the one the
                    probe named would have left the identical defect two hundred lines up, which is
                    how a fix becomes a whack-a-mole instead of a change. */}
                <span className="flex min-w-0 items-center text-xs text-gray-500 sm:ml-auto"
                      title={actorLabel(p.actorType, p.actorEmail)}>
                  <ActorIndicator actorType={p.actorType} />
                  <span className="truncate">{actorLabel(p.actorType, p.actorEmail)}</span>
                </span>

                {/* Elapsed time */}
                <span className="text-xs font-mono text-blue-600 flex-shrink-0 min-w-[60px] text-right">
                  <Elapsed iso={p.createdAt} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* (c) Recent Completions — vertical timeline */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Completions</h2>
        {completions.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            No completed processes in the last 24 hours
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
            {completions.map((c) => {
              const hasError = c.error !== null;
              const isExpanded = expandedIds.has(c.id);
              return (
                <div key={c.id} className="p-4">
                  {/* WRAPS, and the description may shrink. Six items — badge, description,
                      actor, duration, time, expand — of which five were `flex-shrink-0`, so the
                      row was 557px wide at a 390px viewport and MAIN clips: the timestamp and the
                      expand control were simply gone on a phone. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* Status indicator */}
                    {hasError ? (
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold">
                        x
                      </span>
                    ) : (
                      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-green-100 text-green-600 text-xs font-bold">
                        &#10003;
                      </span>
                    )}

                    {/* Namespace badge */}
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${getNamespaceBadge(c.namespace)}`}>
                      {c.namespace}
                    </span>

                    {/* Description */}
                    <span className="min-w-0 flex-1 break-words text-sm font-medium text-gray-900">
                      {describeEvent(c.namespace, c.type)}
                    </span>

                    {/* Actor */}
                    {/* The actor label is an EMAIL — arbitrary length, and `flex-shrink-0` on it
                        meant the row grew to fit rather than the label shrinking. `min-w-0` +
                        `truncate` with the full value in `title`: recoverable, which is the
                        difference between a deliberate truncation and text that is simply gone. */}
                    <span className="flex min-w-0 items-center text-xs text-gray-500 sm:ml-auto"
                          title={actorLabel(c.actorType, c.actorEmail)}>
                      <ActorIndicator actorType={c.actorType} />
                      <span className="truncate">{actorLabel(c.actorType, c.actorEmail)}</span>
                    </span>

                    {/* Duration */}
                    <span className="text-xs font-mono text-gray-600 flex-shrink-0 min-w-[60px] text-right">
                      {formatDuration(c.durationMs)}
                    </span>

                    {/* Time */}
                    <span className="text-xs text-gray-400 flex-shrink-0 min-w-[60px] text-right">
                      <TimeAgo iso={c.createdAt} />
                    </span>

                    {/* Expand button */}
                    {c.payload && (
                      <button
                        onClick={() => toggleExpand(c.id)}
                        className="text-xs text-blue-600 hover:underline flex-shrink-0"
                      >
                        {isExpanded ? 'hide' : 'details'}
                      </button>
                    )}
                  </div>

                  {/* Expanded payload */}
                  {isExpanded && c.payload && (
                    <pre className="mt-3 p-3 bg-gray-50 rounded text-xs overflow-auto max-h-48 text-gray-700">
                      {JSON.stringify(c.payload, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* (d) Errors section */}
      <section>
        <button
          onClick={() => setErrorsExpanded((v) => !v)}
          className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3"
        >
          <span className={`transition-transform ${errorsExpanded ? 'rotate-90' : ''}`}>
            &#9654;
          </span>
          <span>Errors</span>
          {errors.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {errors.length}
            </span>
          )}
          {errors.length === 0 && (
            <span className="text-sm font-normal text-gray-400 ml-1">None in the last 24h</span>
          )}
        </button>

        {errorsExpanded && (
          <>
            {errors.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
                No errors in the last 24 hours
              </div>
            ) : (
              <div className="space-y-3">
                {errors.map((err) => (
                  <div
                    key={err.id}
                    className="rounded-lg border border-red-200 bg-red-50 p-4"
                  >
                    {/* THIRD row of this shape in this file. The first two were named by the
                        probe; this one was found by grepping for the class rather than waiting to
                        be told, which is the difference between fixing a defect and fixing a
                        report. */}
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-red-500" />
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getNamespaceBadge(err.namespace)}`}>
                        {err.namespace}.{err.type}
                      </span>
                      <span className="flex min-w-0 items-center text-xs text-gray-500"
                            title={actorLabel(err.actorType, err.actorEmail)}>
                        <ActorIndicator actorType={err.actorType} />
                        <span className="truncate">{actorLabel(err.actorType, err.actorEmail)}</span>
                      </span>
                      {err.tenantId && (
                        <span className="text-xs text-gray-400 font-mono">
                          tenant: {err.tenantId.slice(0, 8)}...
                        </span>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">
                        <TimeAgo iso={err.createdAt} />
                      </span>
                    </div>
                    {err.error && (
                      <pre className="p-3 bg-red-100 rounded text-xs overflow-auto max-h-40 text-red-800 whitespace-pre-wrap">
                        {JSON.stringify(err.error, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* (e) Tenant Activity */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Tenant Activity (24h)</h2>
        {tenantActivity.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
            No tenant activity in the last 24 hours
          </div>
        ) : (
          // `overflow-x-auto`: a clipped table has no scrollbar, so its right columns cannot be read.
          <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase">Tenant</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase">Slug</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 text-xs uppercase">Events</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase">Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenantActivity.map((t) => {
                  const maxCount = tenantActivity[0]?.eventCount ?? 1;
                  const pct = Math.round((t.eventCount / maxCount) * 100);
                  return (
                    <tr key={t.tenantId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <a
                          href={`/admin/tenants/${t.tenantId}`}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {t.tenantName ?? 'Unknown'}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                        {t.tenantSlug ?? '--'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-900 font-medium">
                        {t.eventCount}
                      </td>
                      <td className="px-4 py-3 w-48">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
