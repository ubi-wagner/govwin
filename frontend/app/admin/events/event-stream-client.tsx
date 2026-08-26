'use client';

// The LEAF module, not '@/lib/events' — that one imports the database client, and a client
// component importing it pulls postgres and node:async_hooks into the browser bundle.
import { EVENT_NAMESPACES } from '@/lib/event-namespaces';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';

export type SerializedEvent = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  tenantName: string | null;
  durationMs: number | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

// The filter options, derived from the registry rather than repeated. This list was its own copy
// and went stale when `project` was added — so post-award delivery events existed in the database,
// were emitted correctly, and had NO OPTION in the filter that finds them. An events console that
// cannot show a namespace is a console that says it does not exist.
const NAMESPACES = ['all', ...EVENT_NAMESPACES] as const;
const PHASES = ['all', 'start', 'end', 'single', 'error'] as const;

const NAMESPACE_COLORS: Record<string, string> = {
  identity: 'text-blue-600 bg-blue-50',
  finder: 'text-indigo-600 bg-indigo-50',
  capture: 'text-green-600 bg-green-50',
  library: 'text-teal-600 bg-teal-50',
  proposal: 'text-purple-600 bg-purple-50',
  system: 'text-yellow-700 bg-yellow-50',
  tool: 'text-orange-600 bg-orange-50',
};

const TIME_RANGES = [
  { label: '1h', value: '1' },
  { label: '6h', value: '6' },
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
  { label: '30d', value: '720' },
];

type SortKey = 'time' | 'event' | 'phase' | 'actor' | 'tenant' | 'duration';

/**
 * "3m ago" — but only once we are on the client (bug log B79).
 *
 * This read `Date.now()` during render. On a server-rendered page that makes the cell a function of
 * WHEN IT RENDERED: the server wrote "2s ago", the client hydrated a beat later and computed
 * "4s ago", the text did not match, and React threw #418 — which does not degrade one cell, it
 * fails hydration for the subtree and takes the Event Stream down to the error boundary. The page
 * still answered HTTP 200 the whole time, so nothing watching status codes ever saw it.
 *
 * `now = null` until mounted, so the first paint (server AND client) is the deterministic UTC
 * timestamp, and the relative form appears on the next tick.
 */
function relativeTime(iso: string, now: number | null): string {
  if (now === null) return iso.slice(0, 19).replace('T', ' ') + 'Z';
  const diffSec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function truncatePayload(payload: Record<string, unknown> | null): string {
  if (!payload) return '-';
  const str = JSON.stringify(payload);
  return str.length <= 80 ? str : str.slice(0, 80) + '...';
}

function ActorIcon({ actorType }: { actorType: string | null }) {
  switch (actorType) {
    case 'user': return <span title="User">&#128100;</span>;
    case 'agent': return <span title="Agent">&#129302;</span>;
    case 'pipeline': return <span title="Pipeline">&#9881;&#65039;</span>;
    case 'system': return <span title="System">&#9881;&#65039;</span>;
    default: return <span title={actorType ?? 'unknown'}>&#8226;</span>;
  }
}

function PhaseBadge({ phase }: { phase: string | null }) {
  if (!phase) return <span className="text-gray-400">-</span>;
  const colors: Record<string, string> = {
    start: 'bg-blue-100 text-blue-700',
    end: 'bg-green-100 text-green-700',
    single: 'bg-gray-100 text-gray-700',
    error: 'bg-red-100 text-red-700',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[phase] ?? 'bg-gray-100 text-gray-600'}`}>{phase}</span>;
}

function sortValue(ev: SerializedEvent, key: SortKey): string | number {
  switch (key) {
    case 'time': return new Date(ev.createdAt).getTime();
    case 'event': return `${ev.namespace}.${ev.type}`;
    case 'phase': return ev.phase ?? '';
    case 'actor': return (ev.actorEmail ?? ev.actorId ?? '').toLowerCase();
    case 'tenant': return (ev.tenantName ?? ev.tenantId ?? '~system').toLowerCase();
    case 'duration': return ev.durationMs ?? -1;
  }
}

export function EventStreamClient({
  events,
  currentNamespace,
  currentType,
  currentPhase,
  currentHours,
}: {
  events: SerializedEvent[];
  currentNamespace: string;
  currentType: string;
  currentPhase: string;
  currentHours: string;
}) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [typeInput, setTypeInput] = useState(currentType);
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Null until mounted — see relativeTime(). Ticks so "2m ago" does not go stale on an open tab.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const buildUrl = useCallback(
    (over: { namespace?: string; hours?: string; phase?: string; type?: string } = {}) => {
      const p = new URLSearchParams();
      const ns = over.namespace ?? currentNamespace;
      const h = over.hours ?? currentHours;
      const ph = over.phase ?? currentPhase;
      const ty = over.type ?? currentType;
      if (ns && ns !== 'all') p.set('namespace', ns);
      if (ty) p.set('type', ty);
      if (ph && ph !== 'all') p.set('phase', ph);
      if (h && h !== '24') p.set('hours', h);
      const qs = p.toString();
      return '/admin/events' + (qs ? '?' + qs : '');
    },
    [currentNamespace, currentType, currentPhase, currentHours],
  );

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'time' || key === 'duration' ? 'desc' : 'asc'); }
  };

  const sorted = useMemo(() => {
    const arr = [...events];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [events, sortKey, sortDir]);

  const Th = ({ label, k, right }: { label: string; k?: SortKey; right?: boolean }) => (
    <th
      className={`px-3 py-2 font-medium ${k ? 'cursor-pointer select-none hover:text-gray-800' : ''} ${right ? 'text-right' : ''}`}
      onClick={k ? () => toggleSort(k) : undefined}
      title={k ? 'Click to sort' : undefined}
    >
      {label}
      {k && sortKey === k && <span className="ml-1 text-gray-400">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <label className="text-xs font-medium text-gray-500 uppercase">Namespace</label>
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          value={currentNamespace || 'all'}
          onChange={(e) => router.push(buildUrl({ namespace: e.target.value }))}
        >
          {NAMESPACES.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
        </select>

        <label className="text-xs font-medium text-gray-500 uppercase ml-2">Phase</label>
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          value={currentPhase || 'all'}
          onChange={(e) => router.push(buildUrl({ phase: e.target.value }))}
        >
          {PHASES.map((ph) => <option key={ph} value={ph}>{ph}</option>)}
        </select>

        <form
          className="flex items-center gap-1"
          onSubmit={(e) => { e.preventDefault(); router.push(buildUrl({ type: typeInput.trim() })); }}
        >
          <label className="text-xs font-medium text-gray-500 uppercase ml-2">Type</label>
          <input
            value={typeInput}
            onChange={(e) => setTypeInput(e.target.value)}
            placeholder="search e.g. partner."
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-40"
          />
          {currentType && (
            <button type="button" onClick={() => { setTypeInput(''); router.push(buildUrl({ type: '' })); }}
              className="text-xs text-gray-400 hover:text-gray-700" title="Clear">&#10005;</button>
          )}
        </form>

        <label className="text-xs font-medium text-gray-500 uppercase ml-2">Time</label>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => router.push(buildUrl({ hours: tr.value }))}
              className={`px-2 py-1 text-xs rounded border ${
                currentHours === tr.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {tr.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500">Live</label>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`w-10 h-5 rounded-full relative transition-colors ${autoRefresh ? 'bg-green-500' : 'bg-gray-300'}`}
            title="Auto-refresh every 10s"
          >
            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          {autoRefresh && <span className="text-xs text-green-600 font-medium">10s</span>}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No events found for the selected filters</div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <Th label="Time" k="time" />
                <Th label="Event" k="event" />
                <Th label="Phase" k="phase" />
                <Th label="Actor" k="actor" />
                <Th label="Tenant" k="tenant" />
                <Th label="Duration" k="duration" right />
                <Th label="Payload" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((ev) => {
                const nsColor = NAMESPACE_COLORS[ev.namespace] ?? 'text-gray-600 bg-gray-50';
                const isExpanded = expandedIds.has(ev.id);
                return (
                  <tr key={ev.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs" title={ev.createdAt}>{relativeTime(ev.createdAt, now)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${nsColor}`}>{ev.namespace}.{ev.type}</span>
                    </td>
                    <td className="px-3 py-2"><PhaseBadge phase={ev.phase} /></td>
                    <td className="px-3 py-2 text-xs">
                      <span className="mr-1"><ActorIcon actorType={ev.actorType} /></span>
                      <span className="text-gray-700">{ev.actorEmail ?? ev.actorId ?? '-'}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600" title={ev.tenantId ?? 'platform / system'}>
                      {ev.tenantName ?? (ev.tenantId ? <span className="font-mono text-gray-400">{ev.tenantId.slice(0, 8)}…</span> : <span className="text-gray-400">system</span>)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 text-right whitespace-nowrap">
                      {ev.durationMs != null ? `${ev.durationMs.toLocaleString()}ms` : '-'}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-xs">
                      <button onClick={() => toggleExpand(ev.id)} className="text-left font-mono text-gray-600 hover:text-gray-900">
                        {isExpanded ? 'collapse' : truncatePayload(ev.payload)}
                      </button>
                      {isExpanded && ev.payload && (
                        <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                          {JSON.stringify(ev.payload, null, 2)}
                        </pre>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
