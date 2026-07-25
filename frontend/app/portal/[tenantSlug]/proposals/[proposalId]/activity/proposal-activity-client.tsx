'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { describeEvent as describeEventLabel } from '@/lib/event-labels';
import { eventHref } from '@/lib/event-labels';
import type { ProposalActivityEvent } from './page';

const TIME_RANGES = [
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
  { label: '30d', value: '720' },
];

const NAMESPACE_COLORS: Record<string, string> = {
  identity: 'border-blue-400 bg-blue-50',
  finder: 'border-indigo-400 bg-indigo-50',
  capture: 'border-green-400 bg-green-50',
  library: 'border-teal-400 bg-teal-50',
  proposal: 'border-purple-400 bg-purple-50',
  tool: 'border-orange-400 bg-orange-50',
  system: 'border-gray-400 bg-gray-50',
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

const SOURCE_LABEL: Record<string, string> = {
  event: 'system event',
  log: 'workspace log',
};

function relativeTime(iso: string): string {
  const now = Date.now();
  const diff = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function PhaseBadge({ phase }: { phase: string | null }) {
  if (!phase) return null;
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

// Group start/end pairs
type GroupedEvent = { event: ProposalActivityEvent; childEvent?: ProposalActivityEvent };

function groupEvents(events: ProposalActivityEvent[]): GroupedEvent[] {
  const byId = new Map(events.map((ev) => [ev.id, ev]));
  const childIds = new Set<string>();
  const parentToChild = new Map<string, ProposalActivityEvent>();
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

export function ProposalActivityClient({
  events,
  currentHours,
  currentNs,
  basePath,
  tenantSlug,
}: {
  events: ProposalActivityEvent[];
  currentHours: string;
  currentNs: string;
  basePath: string;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'' | 'event' | 'log'>('');

  const buildUrl = useCallback(
    (overrides: { hours?: string; ns?: string }) => {
      const p = new URLSearchParams();
      const h = overrides.hours ?? currentHours;
      const ns = overrides.ns ?? currentNs;
      if (h && h !== '168') p.set('hours', h);
      if (ns) p.set('ns', ns);
      const qs = p.toString();
      return `${basePath}/activity${qs ? '?' + qs : ''}`;
    },
    [basePath, currentHours, currentNs],
  );

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  // Auto-expand errors
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

  const filtered = useMemo(() => {
    return sourceFilter ? events.filter((ev) => ev.source === sourceFilter) : events;
  }, [events, sourceFilter]);

  const grouped = useMemo(() => groupEvents(filtered), [filtered]);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 mb-4">
        {/* Source toggle */}
        <label className="text-xs font-medium text-gray-500 uppercase">Source</label>
        <div className="flex gap-1">
          {(['', 'event', 'log'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-2 py-1 text-xs rounded border ${
                sourceFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {s === '' ? 'All' : SOURCE_LABEL[s]}
            </button>
          ))}
        </div>

        {/* Namespace filter */}
        <label className="text-xs font-medium text-gray-500 uppercase ml-4">Namespace</label>
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          value={currentNs}
          onChange={(e) => router.push(buildUrl({ ns: e.target.value }))}
        >
          <option value="">All</option>
          {['proposal', 'tool', 'library', 'system', 'capture', 'identity'].map((ns) => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>

        {/* Time range */}
        <label className="text-xs font-medium text-gray-500 uppercase ml-4">Time</label>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => router.push(buildUrl({ hours: tr.value }))}
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
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500">Live</label>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`w-10 h-5 rounded-full relative transition-colors ${autoRefresh ? 'bg-green-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Summary counts */}
      <div className="flex gap-4 mb-4 text-xs text-gray-500">
        <span><strong className="text-gray-700">{grouped.length}</strong> entries shown</span>
        <span><strong className="text-gray-700">{events.filter((e) => e.source === 'event').length}</strong> system events</span>
        <span><strong className="text-gray-700">{events.filter((e) => e.source === 'log').length}</strong> workspace logs</span>
        <span><strong className="text-red-600">{events.filter((e) => e.error != null).length}</strong> errors</span>
      </div>

      {/* Timeline */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No activity found for the selected filters.</div>
      ) : (
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
              const href = ev.source === 'event'
                ? eventHref(tenantSlug, { namespace: ev.namespace, type: ev.type, phase: ev.phase, payload: ev.payload, durationMs: ev.durationMs })
                : ev.payload?.sectionId
                  ? `${basePath}/sections/${ev.payload.sectionId}`
                  : null;

              return (
                <div key={ev.id} className="relative flex gap-4 py-2 group">
                  <div className="w-[120px] flex-shrink-0 text-right pr-4 pt-1" title={absoluteTime(ev.createdAt)}>
                    <span className="text-xs text-gray-400">{relativeTime(ev.createdAt)}</span>
                  </div>

                  <div className="flex-shrink-0 relative z-10 mt-1.5">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] ${
                      hasError ? 'border-red-500 bg-red-100' : 'border-gray-300 bg-white group-hover:border-blue-400'
                    }`}>
                      <span>{nsIcon}</span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 pb-2">
                    <div className={`rounded-lg border-l-4 p-3 transition-shadow hover:shadow-sm ${hasError ? 'border-l-red-500 bg-red-50' : nsColor}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {href ? (
                            <a href={href} className="font-medium text-sm text-blue-700 hover:underline">{label}</a>
                          ) : (
                            <span className="font-medium text-sm text-gray-800">{label}</span>
                          )}
                          <PhaseBadge phase={ev.phase} />
                          {ev.durationMs != null && ev.phase === 'end' && (
                            <span className="text-xs text-gray-400 font-mono">{ev.durationMs}ms</span>
                          )}
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            ev.source === 'log' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {SOURCE_LABEL[ev.source]}
                          </span>
                        </div>
                        <button
                          onClick={() => toggleExpand(ev.id)}
                          className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
                        >
                          {isExpanded ? 'collapse' : 'expand'}
                        </button>
                      </div>

                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-400 font-mono">{ev.namespace}.{ev.type}</span>
                        <span className="text-xs text-gray-500">
                          {ev.actorEmail ?? ev.actorId ?? ev.actorType ?? '—'}
                        </span>
                      </div>

                      {hasError && (
                        <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs">
                          <span className="font-medium text-red-700">Error: </span>
                          <pre className="mt-1 text-red-600 overflow-auto max-h-32 whitespace-pre-wrap">
                            {JSON.stringify(ev.error, null, 2)}
                          </pre>
                        </div>
                      )}

                      {isExpanded && ev.payload && (
                        <div className="mt-2">
                          <pre className="p-2 bg-white/70 border border-gray-200 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap font-mono text-gray-600">
                            {JSON.stringify(ev.payload, null, 2)}
                          </pre>
                        </div>
                      )}

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
      )}
    </div>
  );
}
