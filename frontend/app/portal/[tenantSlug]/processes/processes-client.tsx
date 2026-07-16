'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  classifyProcessHealth,
  healthSortWeight,
  type ProcessHealth,
} from '@/lib/process/health';

export interface ProcessRow {
  id: string;
  workflowName: string;
  status: string;
  currentStep: string | null;
  stepStatus: Record<string, string> | null;
  deadline: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  lastErrorStep: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  createdAt: string;
}

const HEALTH_STYLES: Record<ProcessHealth, { dot: string; chip: string; label: string }> = {
  failing: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'Failing' },
  stalled: { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Stalled' },
  waiting: { dot: 'bg-yellow-500', chip: 'bg-yellow-50 text-yellow-800 border-yellow-200', label: 'Awaiting input' },
  running: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Running' },
  done: { dot: 'bg-gray-400', chip: 'bg-gray-50 text-gray-600 border-gray-200', label: 'Done' },
};

function formatWorkflowName(name: string): string {
  return name.replace(/^On/, '').replace(/([A-Z])/g, ' $1').trim();
}
function formatStepName(name: string | null): string {
  if (!name) return '—';
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
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

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500', failed: 'bg-red-500', paused: 'bg-yellow-500',
  running: 'bg-blue-500', retrying: 'bg-blue-500', cancelled: 'bg-gray-400', pending: 'bg-gray-400',
};

/** The process_instance_transitions timeline — lets a customer/shadow admin watch
 *  their own workflow's steps execute (tenant-scoped detail route). */
function TransitionTimeline({ state }: { state: Transition[] | 'loading' | 'error' }) {
  if (state === 'loading') return <p className="mt-3 text-xs text-gray-400">Loading steps…</p>;
  if (state === 'error') return <p className="mt-3 text-xs text-red-500">Couldn&apos;t load the step timeline.</p>;
  if (state.length === 0) return <p className="mt-3 text-xs text-gray-400">No steps recorded yet.</p>;
  return (
    <ol className="relative mt-3 ml-1 space-y-2.5 border-l border-gray-200 py-1">
      {state.map((t) => (
        <li key={t.id} className="ml-4">
          <span className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full ${STATUS_DOT[t.toStatus] ?? 'bg-gray-400'}`} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {t.stepName && <span className="font-mono text-gray-700">{formatStepName(t.stepName)}</span>}
            <span className="text-gray-400">
              {t.fromStatus ? `${t.fromStatus} → ` : ''}
              <span className="font-medium text-gray-600">{t.toStatus}</span>
            </span>
            {t.actor && <span className="text-gray-400">· {t.actor}</span>}
            <span className="ml-auto text-gray-400">{relativeTime(t.createdAt)}</span>
          </div>
          {t.reason && <p className="mt-0.5 text-[11px] text-gray-500">{t.reason}</p>}
        </li>
      ))}
    </ol>
  );
}

export function ProcessesClient({
  rows,
  loadError,
  canAdvance,
  tenantSlug,
}: {
  rows: ProcessRow[];
  loadError: boolean;
  canAdvance: boolean;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<'health' | 'recent'>('health');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [timelines, setTimelines] = useState<Record<string, Transition[] | 'loading' | 'error'>>({});
  const [openTimelines, setOpenTimelines] = useState<Set<string>>(new Set());

  // Live-ish: refresh every 10s so stall/fail badges stay current.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [router]);

  const decorated = useMemo(() => {
    const withHealth = rows.map((r) => ({ row: r, health: classifyProcessHealth(r) }));
    withHealth.sort((a, b) => {
      if (sortBy === 'health') {
        const d = healthSortWeight(a.health) - healthSortWeight(b.health);
        if (d !== 0) return d;
      }
      const at = a.row.updatedAt ? new Date(a.row.updatedAt).getTime() : 0;
      const bt = b.row.updatedAt ? new Date(b.row.updatedAt).getTime() : 0;
      return bt - at;
    });
    return withHealth;
  }, [rows, sortBy]);

  const counts = useMemo(() => {
    const c: Record<ProcessHealth, number> = { failing: 0, stalled: 0, waiting: 0, running: 0, done: 0 };
    for (const d of decorated) c[d.health] += 1;
    return c;
  }, [decorated]);

  const handleAdvance = useCallback(
    async (row: ProcessRow) => {
      const ok = window.confirm(
        `Override the "${formatStepName(row.currentStep)}" gate and move this process to its next step?`,
      );
      if (!ok) return;
      setBusy((p) => ({ ...p, [row.id]: true }));
      setErrors((p) => {
        const n = { ...p };
        delete n[row.id];
        return n;
      });
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/processes/${row.id}/advance`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: 'Advanced from the tenant process ledger' }),
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: 'Request failed' }));
          setErrors((p) => ({ ...p, [row.id]: j.error ?? 'Advance failed' }));
        } else {
          router.refresh();
        }
      } catch {
        setErrors((p) => ({ ...p, [row.id]: 'Network error' }));
      } finally {
        setBusy((p) => ({ ...p, [row.id]: false }));
      }
    },
    [router, tenantSlug],
  );

  // Lazy-load a process's step timeline (process_instance_transitions) from the
  // tenant-scoped detail route, so a customer/shadow admin can watch their own
  // workflow execute. Re-fetches on open to stay live.
  const toggleTimeline = useCallback(
    async (id: string) => {
      const isOpen = openTimelines.has(id);
      setOpenTimelines((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(id);
        else next.add(id);
        return next;
      });
      if (isOpen) return;
      setTimelines((prev) => ({ ...prev, [id]: 'loading' }));
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/processes/${id}`);
        const body = await res.json().catch(() => ({}));
        const transitions = body?.data?.transitions;
        setTimelines((prev) => ({
          ...prev,
          [id]: Array.isArray(transitions) ? (transitions as Transition[]) : 'error',
        }));
      } catch {
        setTimelines((prev) => ({ ...prev, [id]: 'error' }));
      }
    },
    [openTimelines, tenantSlug],
  );

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Couldn&apos;t load your processes right now. This is a system error, not an
        empty list — please retry shortly.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
        No processes yet. Automation will appear here as you upload RFPs and advance proposals.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + sort */}
      <div className="flex flex-wrap items-center gap-2">
        {(['failing', 'stalled', 'waiting', 'running', 'done'] as ProcessHealth[])
          .filter((h) => counts[h] > 0)
          .map((h) => (
            <span
              key={h}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${HEALTH_STYLES[h].chip}`}
            >
              <span className={`h-2 w-2 rounded-full ${HEALTH_STYLES[h].dot}`} />
              {HEALTH_STYLES[h].label} {counts[h]}
            </span>
          ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          <span>Sort</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'health' | 'recent')}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
          >
            <option value="health">Needs attention</option>
            <option value="recent">Most recent</option>
          </select>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {decorated.map(({ row, health }) => {
          const style = HEALTH_STYLES[health];
          const showAdvance = canAdvance && row.status === 'paused';
          return (
            <div
              key={row.id}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${style.dot}`} />
                <span className="text-sm font-semibold text-gray-900">
                  {formatWorkflowName(row.workflowName)}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.chip}`}>
                  {style.label}
                </span>
                {row.currentStep && (
                  <span className="font-mono text-xs text-gray-500">
                    {formatStepName(row.currentStep)}
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">
                  {relativeTime(row.updatedAt)}
                </span>
                {showAdvance && (
                  <button
                    onClick={() => handleAdvance(row)}
                    disabled={busy[row.id]}
                    title="Override this human gate and continue the process"
                    className="rounded border border-yellow-400 bg-white px-2.5 py-1 text-xs font-medium text-yellow-800 hover:bg-yellow-50 disabled:opacity-50"
                  >
                    {busy[row.id] ? '...' : 'Move to next gate'}
                  </button>
                )}
                <button
                  onClick={() => toggleTimeline(row.id)}
                  className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                >
                  {openTimelines.has(row.id) ? 'Hide steps' : 'Steps'}
                </button>
              </div>

              {health === 'failing' && row.lastError && (
                <p className="mt-2 text-xs text-red-600">
                  {row.lastErrorStep ? `${formatStepName(row.lastErrorStep)}: ` : ''}
                  {row.lastError}
                </p>
              )}
              {health === 'stalled' && row.status === 'paused' && (
                <p className="mt-2 text-xs text-orange-600">
                  This step has been waiting past its deadline — it may need an admin to advance it.
                </p>
              )}
              {errors[row.id] && (
                <p className="mt-2 text-xs text-red-600">{errors[row.id]}</p>
              )}
              {openTimelines.has(row.id) && (
                <TransitionTimeline state={timelines[row.id] ?? 'loading'} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
