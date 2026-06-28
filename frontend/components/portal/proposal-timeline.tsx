'use client';

import { useState } from 'react';
import { describeEvent as describeEventLabel } from '@/lib/event-labels';

type TimelineEvent = {
  id: string;
  namespace: string;
  type: string;
  phase: string;
  actorType: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
};

const EVENT_ICONS: Record<string, string> = {
  proposal: '\u{1F4CB}',
  capture: '\u{1F4B0}',
  tool: '\u{1F527}',
  library: '\u{1F4DA}',
  identity: '\u{1F511}',
  system: '⚙️',
  finder: '\u{1F50D}',
};

function describeEvent(ev: TimelineEvent): string {
  // Canonical label map (keyed on the real emitted `type` + phase + payload).
  return describeEventLabel(ev);
}

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

export function ProposalTimeline({ events }: { events: TimelineEvent[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        No activity recorded yet for this proposal.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="absolute left-6 top-0 bottom-0 w-px bg-gray-200" />

      <div className="space-y-0">
        {events.map((ev) => {
          const isExpanded = expandedIds.has(ev.id);
          const hasError = ev.error != null;
          const icon = EVENT_ICONS[ev.namespace] ?? '●';

          return (
            <div key={ev.id} className="relative flex gap-4 py-3">
              {/* Timeline dot */}
              <div className={`relative z-10 flex items-center justify-center w-12 h-8 rounded-full text-sm flex-shrink-0 ${
                hasError ? 'bg-red-100' : ev.phase === 'start' ? 'bg-blue-50' : ev.phase === 'end' ? 'bg-green-50' : 'bg-gray-50'
              }`}>
                {icon}
              </div>

              {/* Event card */}
              <div className={`flex-1 min-w-0 rounded-lg border p-3 ${
                hasError ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${hasError ? 'text-red-800' : 'text-gray-900'}`}>
                      {describeEvent(ev)}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      {/* Phase badge */}
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                        ev.phase === 'start' ? 'bg-blue-100 text-blue-700' :
                        ev.phase === 'end' ? 'bg-green-100 text-green-700' :
                        ev.phase === 'error' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {ev.phase}
                      </span>
                      {/* Actor */}
                      {ev.actorEmail && <span>{ev.actorEmail}</span>}
                      {!ev.actorEmail && ev.actorType && <span>{ev.actorType}</span>}
                      {/* Duration */}
                      {ev.durationMs != null && (
                        <span className="text-gray-400">{ev.durationMs}ms</span>
                      )}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0" title={new Date(ev.createdAt).toLocaleString()}>
                    {relativeTime(ev.createdAt)}
                  </span>
                </div>

                {/* Error display */}
                {hasError && (
                  <pre className="mt-2 p-2 bg-red-100 rounded text-xs text-red-800 overflow-auto max-h-32">
                    {JSON.stringify(ev.error, null, 2)}
                  </pre>
                )}

                {/* Expandable payload */}
                {ev.payload && Object.keys(ev.payload).length > 0 && (
                  <button
                    onClick={() => toggleExpand(ev.id)}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                  >
                    {isExpanded ? 'Hide details' : 'Show details'}
                  </button>
                )}
                {isExpanded && ev.payload && (
                  <pre className="mt-1 p-2 bg-gray-50 rounded text-xs text-gray-700 overflow-auto max-h-48">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
