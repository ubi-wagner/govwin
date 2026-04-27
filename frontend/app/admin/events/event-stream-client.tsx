'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';

export type SerializedEvent = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  tenantId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

const NAMESPACES = [
  'all',
  'identity',
  'finder',
  'capture',
  'admin',
  'library',
  'proposal',
  'agent',
  'cms',
] as const;

const NAMESPACE_COLORS: Record<string, string> = {
  identity: 'text-blue-600 bg-blue-50',
  finder: 'text-indigo-600 bg-indigo-50',
  capture: 'text-green-600 bg-green-50',
  admin: 'text-yellow-700 bg-yellow-50',
  library: 'text-teal-600 bg-teal-50',
  proposal: 'text-purple-600 bg-purple-50',
  agent: 'text-orange-600 bg-orange-50',
  cms: 'text-pink-600 bg-pink-50',
};

const TIME_RANGES = [
  { label: '1h', value: '1' },
  { label: '6h', value: '6' },
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
];

function relativeTime(iso: string): string {
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

function truncatePayload(payload: Record<string, unknown> | null): string {
  if (!payload) return '-';
  const str = JSON.stringify(payload);
  if (str.length <= 80) return str;
  return str.slice(0, 80) + '...';
}

function ActorIcon({ actorType }: { actorType: string | null }) {
  switch (actorType) {
    case 'user':
      return <span title="User">&#128100;</span>;
    case 'agent':
      return <span title="Agent">&#129302;</span>;
    case 'system':
      return <span title="System">&#9881;&#65039;</span>;
    case 'worker':
      return <span title="Worker">&#9881;&#65039;</span>;
    default:
      return <span title={actorType ?? 'unknown'}>&#8226;</span>;
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
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[phase] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {phase}
    </span>
  );
}

export function EventStreamClient({
  events,
  currentNamespace,
  currentType,
  currentHours,
}: {
  events: SerializedEvent[];
  currentNamespace: string;
  currentType: string;
  currentHours: string;
}) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);

  const buildUrl = useCallback(
    (ns?: string, hours?: string) => {
      const p = new URLSearchParams();
      const nsVal = ns !== undefined ? ns : currentNamespace;
      const hVal = hours !== undefined ? hours : currentHours;
      if (nsVal && nsVal !== 'all') p.set('namespace', nsVal);
      if (currentType) p.set('type', currentType);
      if (hVal && hVal !== '24') p.set('hours', hVal);
      const qs = p.toString();
      return '/admin/events' + (qs ? '?' + qs : '');
    },
    [currentNamespace, currentType, currentHours],
  );

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        {/* Namespace */}
        <label className="text-xs font-medium text-gray-500 uppercase">Namespace</label>
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          value={currentNamespace || 'all'}
          onChange={(e) => router.push(buildUrl(e.target.value))}
        >
          {NAMESPACES.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>

        {/* Time range */}
        <label className="text-xs font-medium text-gray-500 uppercase ml-4">Time</label>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => router.push(buildUrl(undefined, tr.value))}
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
          <label className="text-xs text-gray-500">Auto-refresh</label>
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
        </div>
      </div>

      {/* Events table */}
      {events.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No events found for the selected filters
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Phase</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Tenant</th>
                <th className="px-3 py-2 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const nsColor = NAMESPACE_COLORS[ev.namespace] ?? 'text-gray-600 bg-gray-50';
                const isExpanded = expandedIds.has(ev.id);
                return (
                  <tr key={ev.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                      {relativeTime(ev.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${nsColor}`}>
                        {ev.namespace}.{ev.type}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <PhaseBadge phase={ev.phase} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="mr-1"><ActorIcon actorType={ev.actorType} /></span>
                      <span className="text-gray-700">
                        {ev.actorEmail ?? ev.actorId ?? '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                      {ev.tenantId ? ev.tenantId.slice(0, 8) + '...' : 'system'}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-xs">
                      <button
                        onClick={() => toggleExpand(ev.id)}
                        className="text-left font-mono text-gray-600 hover:text-gray-900"
                      >
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
