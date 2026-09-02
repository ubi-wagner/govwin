'use client';

import { useRouter } from 'next/navigation';
import { TimeAgo, Elapsed } from '@/components/ui/time-ago';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { describeEvent as describeEventLabel, describeActor } from '@/lib/event-labels';
import { fmtDateTime } from '@/lib/fmt';

export type SerializedActivityEvent = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorId: string | null;
  actorEmail: string | null;
  actorName?: string | null;
  parentEventId: string | null;
  payload: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
};

/* ------------------------------------------------------------------ */
/*  Namespace config                                                   */
/* ------------------------------------------------------------------ */

// The relative-time helpers that used to live here read the clock
// DURING RENDER — the server wrote one number, the client hydrated a beat later and wrote
// another, and React #418 took the whole page to its error boundary while the route kept
// answering 200. They are now <TimeAgo> / <Elapsed>, which own their own mount state.
// Bug log B82; the shared component is components/ui/time-ago.tsx.
const NAMESPACE_TABS = [
  { label: 'All', value: '' },
  { label: 'Proposal', value: 'proposal' },
  { label: 'Library', value: 'library' },
  { label: 'Capture', value: 'capture' },
  { label: 'Tool', value: 'tool' },
  { label: 'Identity', value: 'identity' },
  { label: 'Finder', value: 'finder' },
  { label: 'System', value: 'system' },
] as const;

const NAMESPACE_COLORS: Record<string, string> = {
  identity: 'border-blue-400 bg-blue-50',
  finder: 'border-indigo-400 bg-indigo-50',
  capture: 'border-green-400 bg-green-50',
  library: 'border-teal-400 bg-teal-50',
  proposal: 'border-purple-400 bg-purple-50',
  tool: 'border-orange-400 bg-orange-50',
  system: 'border-gray-400 bg-gray-50',
  agent: 'border-amber-400 bg-amber-50',
};

const NAMESPACE_ICONS: Record<string, string> = {
  identity: '\u{1F511}',   // key
  finder: '\u{1F50D}',     // magnifying glass
  capture: '\u{1F4B3}',    // credit card
  library: '\u{1F4DA}',    // books
  proposal: '\u{1F4DD}',   // memo
  tool: '\u{1F527}',       // wrench
  system: '⚙️',  // gear
  agent: '\u{1F916}',      // robot
};

const TIME_RANGES = [
  { label: '1h', value: '1' },
  { label: '6h', value: '6' },
  { label: '24h', value: '24' },
  { label: '7d', value: '168' },
  { label: '30d', value: '720' },
];

/* ------------------------------------------------------------------ */
/*  Human-readable event descriptions                                  */
/* ------------------------------------------------------------------ */

function describeEvent(
  namespace: string,
  type: string,
  phase: string | null,
  payload: Record<string, unknown> | null,
  durationMs: number | null,
): string {
  // Delegate to the canonical label map (keyed on the real emitted `type`,
  // which already includes the entity — the old `${namespace}.${type}` keys
  // never matched). The shared module also handles tool + system events.
  return describeEventLabel({ namespace, type, phase, payload, durationMs });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function absoluteTime(iso: string): string {
  return fmtDateTime(iso);
}

function PhaseBadge({ phase }: { phase: string | null }) {
  if (!phase) return null;
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

function ActorDisplay({
  actorType,
  actorEmail,
  actorId,
  actorName,
}: {
  actorType: string | null;
  actorEmail: string | null;
  actorId: string | null;
  actorName?: string | null;
}) {
  const icons: Record<string, string> = {
    user: '\u{1F464}',
    agent: '\u{1F916}',
    system: '⚙️',
    pipeline: '\u{1F504}',
  };
  const icon = actorType ? (icons[actorType] ?? '•') : '•';
  // `describeActor`, not `actorEmail ?? actorId ?? actorType` — that chain rendered a raw UUID and
  // then a raw `workflow_manager` to a CUSTOMER, one line below the describeEvent call that had
  // already been fixed for exactly this reason. The identifier is kept in `title`, where support
  // can still read it and prose cannot. See lib/event-labels.ts.
  const { label, title } = describeActor({ actorType, actorEmail, actorId, actorName });

  return (
    <span className="text-xs text-gray-500 min-w-0 inline-flex items-center max-w-full">
      <span className="mr-1 shrink-0">{icon}</span>
      <span className="truncate" title={title ?? undefined}>{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Correlation grouping                                               */
/* ------------------------------------------------------------------ */

type GroupedEvent = {
  event: SerializedActivityEvent;
  childEvent?: SerializedActivityEvent;
};

function groupEvents(events: SerializedActivityEvent[]): GroupedEvent[] {
  // Build a map: id -> event (for start events)
  const byId = new Map<string, SerializedActivityEvent>();
  for (const ev of events) {
    byId.set(ev.id, ev);
  }

  // Track which events are children (end events with parentEventId matching a start)
  const childIds = new Set<string>();
  const parentToChild = new Map<string, SerializedActivityEvent>();

  for (const ev of events) {
    if (ev.parentEventId && byId.has(ev.parentEventId)) {
      childIds.add(ev.id);
      parentToChild.set(ev.parentEventId, ev);
    }
  }

  const grouped: GroupedEvent[] = [];
  for (const ev of events) {
    if (childIds.has(ev.id)) continue; // skip children, they'll be nested
    grouped.push({
      event: ev,
      childEvent: parentToChild.get(ev.id),
    });
  }

  return grouped;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ActivityStreamClient({
  events,
  currentNamespace,
  currentType,
  currentHours,
  basePath,
}: {
  events: SerializedActivityEvent[];
  currentNamespace: string;
  currentType: string;
  currentHours: string;
  basePath: string;
}) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [typeSearch, setTypeSearch] = useState(currentType);

  const buildUrl = useCallback(
    (overrides: { ns?: string; hours?: string; type?: string }) => {
      const p = new URLSearchParams();
      const nsVal = overrides.ns !== undefined ? overrides.ns : currentNamespace;
      const hVal =
        overrides.hours !== undefined ? overrides.hours : currentHours;
      const tVal =
        overrides.type !== undefined ? overrides.type : currentType;
      if (nsVal) p.set('namespace', nsVal);
      if (tVal) p.set('type', tVal);
      if (hVal && hVal !== '168') p.set('hours', hVal);
      const qs = p.toString();
      return `${basePath}/activity${qs ? '?' + qs : ''}`;
    },
    [currentNamespace, currentType, currentHours, basePath],
  );

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      router.refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, router]);

  // Expand error events by default
  useEffect(() => {
    const errorIds = new Set<string>();
    for (const ev of events) {
      if (ev.error != null) {
        errorIds.add(ev.id);
      }
    }
    if (errorIds.size > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const eid of errorIds) next.add(eid);
        return next;
      });
    }
  }, [events]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const grouped = useMemo(() => groupEvents(events), [events]);

  const handleTypeSearch = () => {
    router.push(buildUrl({ type: typeSearch }));
  };

  const handleTypeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTypeSearch();
    }
  };

  return (
    <div>
      {/* -------- Filter bar -------- */}
      <div className="mb-4 space-y-3">
        {/* Namespace tabs */}
        <div className="flex flex-wrap gap-1">
          {NAMESPACE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => router.push(buildUrl({ ns: tab.value }))}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                currentNamespace === tab.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Type search + time range + auto-refresh */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          {/* Type search */}
          <label className="text-xs font-medium text-gray-500 uppercase">
            Type
          </label>
          <div className="flex gap-1">
            <input
              type="text"
              value={typeSearch}
              onChange={(e) => setTypeSearch(e.target.value)}
              onKeyDown={handleTypeKeyDown}
              placeholder="Search event types..."
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-48"
            />
            <button
              onClick={handleTypeSearch}
              className="px-2 py-1 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
            >
              Filter
            </button>
            {currentType && (
              <button
                onClick={() => {
                  setTypeSearch('');
                  router.push(buildUrl({ type: '' }));
                }}
                className="px-2 py-1 text-xs rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
              >
                Clear
              </button>
            )}
          </div>

          {/* Time range */}
          <label className="text-xs font-medium text-gray-500 uppercase ml-4">
            Time
          </label>
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
      </div>

      {/* -------- Timeline -------- */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No events found for the selected filters.
        </div>
      ) : (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[139px] top-0 bottom-0 w-px bg-gray-200" />

          <div className="space-y-0">
            {grouped.map(({ event: ev, childEvent }) => {
              const isExpanded = expandedIds.has(ev.id);
              const hasError = ev.error != null;
              const nsColor =
                NAMESPACE_COLORS[ev.namespace] ?? 'border-gray-300 bg-gray-50';
              const nsIcon = NAMESPACE_ICONS[ev.namespace] ?? '•';
              const description = describeEvent(
                ev.namespace,
                ev.type,
                ev.phase,
                ev.payload,
                ev.durationMs,
              );

              return (
                <div key={ev.id} className="relative flex gap-4 py-2 group">
                  {/* Left gutter: timestamp */}
                  {/* The gutter narrows on a phone. A fixed 120px column plus a 16px gap leaves
                      254px for the whole event card at 390px, which is what pushed the row past
                      the viewport — and MAIN clips, so the overflow was unreachable rather than
                      scrollable. The absolute time stays in the `title` either way. */}
                  <div
                    className="w-16 flex-shrink-0 text-right pr-2 pt-1 sm:w-[120px] sm:pr-4"
                    title={absoluteTime(ev.createdAt)}
                  >
                    <span className="text-xs text-gray-400">
                      <TimeAgo iso={ev.createdAt} />
                    </span>
                  </div>

                  {/* Timeline dot */}
                  <div className="flex-shrink-0 relative z-10 mt-1.5">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] ${
                        hasError
                          ? 'border-red-500 bg-red-100'
                          : 'border-gray-300 bg-white group-hover:border-blue-400'
                      }`}
                    >
                      <span>{nsIcon}</span>
                    </div>
                  </div>

                  {/* Event card */}
                  <div className="flex-1 min-w-0 pb-2">
                    <div
                      className={`rounded-lg border-l-4 p-3 transition-shadow hover:shadow-sm ${
                        hasError ? 'border-l-red-500 bg-red-50' : nsColor
                      }`}
                    >
                      {/* Header row */}
                      {/* `min-w-0` on both, and the description allowed to BREAK. `flex-wrap` on
                          the row was already here and did nothing: a flex item's default
                          `min-width: auto` refuses to shrink below its content, so a long event
                          description pushed the row to 430px in a 390px viewport and the overflow
                          was then clipped — unreachable, on the tenant's own activity feed. */}
                      <div className="flex items-start justify-between gap-2 min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 break-words font-medium text-sm text-gray-800">
                            {description}
                          </span>
                          <PhaseBadge phase={ev.phase} />
                          {ev.durationMs != null && ev.phase === 'end' && (
                            <span className="text-xs text-gray-400 font-mono">
                              {ev.durationMs}ms
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => toggleExpand(ev.id)}
                          className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
                        >
                          {isExpanded ? 'collapse' : 'expand'}
                        </button>
                      </div>

                      {/* Subline: namespace.type + actor */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 min-w-0">
                        <span className="text-xs text-gray-400 font-mono break-all">
                          {ev.namespace}.{ev.type}
                        </span>
                        <ActorDisplay
                          actorType={ev.actorType}
                          actorEmail={ev.actorEmail}
                          actorId={ev.actorId}
                          actorName={ev.actorName}
                        />
                      </div>

                      {/* Error display (expanded by default) */}
                      {hasError && (
                        <div className="mt-2 p-2 bg-red-100 border border-red-200 rounded text-xs">
                          <span className="font-medium text-red-700">
                            Error:{' '}
                          </span>
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
                          {/* WRAPS. This row is already indented (ml-4 pl-3), so at 390px it has
                              ~40px less than the parent, and a non-wrapping flex put the phase
                              badge and the duration past the viewport edge as soon as the child's
                              label got longer — which happened when the unlabelled event types
                              were given real sentences. min-w-0 lets the label shrink instead of
                              forcing its siblings out. */}
                          <div className="flex flex-wrap items-center gap-2 gap-y-1 min-w-0">
                            <span className="text-xs text-gray-500 min-w-0 break-words">
                              {describeEvent(
                                childEvent.namespace,
                                childEvent.type,
                                childEvent.phase,
                                childEvent.payload,
                                childEvent.durationMs,
                              )}
                            </span>
                            <PhaseBadge phase={childEvent.phase} />
                            {childEvent.durationMs != null && (
                              <span className="text-xs text-gray-400 font-mono">
                                {childEvent.durationMs}ms
                              </span>
                            )}
                            <span
                              className="text-xs text-gray-400"
                              title={absoluteTime(childEvent.createdAt)}
                            >
                              <TimeAgo iso={childEvent.createdAt} />
                            </span>
                          </div>
                          {childEvent.error != null && (
                            <div className="mt-1 p-2 bg-red-100 border border-red-200 rounded text-xs">
                              <span className="font-medium text-red-700">
                                Error:{' '}
                              </span>
                              <pre className="mt-1 text-red-600 overflow-auto max-h-32 whitespace-pre-wrap">
                                {JSON.stringify(childEvent.error, null, 2)}
                              </pre>
                            </div>
                          )}
                          {isExpanded && childEvent.payload && (
                            <pre className="mt-1 p-2 bg-white/70 border border-gray-200 rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap font-mono text-gray-600">
                              {JSON.stringify(childEvent.payload, null, 2)}
                            </pre>
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
