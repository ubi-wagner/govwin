'use client';

/**
 * TaskQueue — the in-app ToDo queue + nudge surface, mounted on landing pages.
 *
 * Reads the actor's open tasks from `apiBase` (GET) and completes them (POST).
 * Urgency is the nudge: overdue and due-soon tasks are visually escalated and
 * sorted first, so a deadline approaching is felt on the landing page without
 * an email. Reused on the tenant dashboard (apiBase=/api/portal/<slug>/tasks)
 * and the admin dashboard (apiBase=/api/admin/tasks).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Urgency, urgencyOf, sortByUrgency } from '@/lib/tasks/urgency';

export interface QueueTask {
  id: string;
  taskType: string;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  stepName: string | null;
  dueAt: string | null;
  tenantId: string | null;
}

const URGENCY_STYLE: Record<Urgency, { chip: string; label: string }> = {
  overdue: { chip: 'bg-red-50 text-red-700 border-red-200', label: 'Overdue' },
  soon: { chip: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Due soon' },
  normal: { chip: 'bg-gray-50 text-gray-600 border-gray-200', label: '' },
};

function dueLabel(dueAt: string | null, now: number): string {
  if (!dueAt) return 'No due date';
  const diff = new Date(dueAt).getTime() - now;
  const absH = Math.abs(diff) / 3600000;
  if (diff < 0) {
    return absH < 24 ? `${Math.ceil(absH)}h overdue` : `${Math.ceil(absH / 24)}d overdue`;
  }
  return absH < 24 ? `due in ${Math.floor(absH)}h` : `due in ${Math.floor(absH / 24)}d`;
}

function prettyType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TaskQueue({
  apiBase,
  title = 'Your To-Dos',
  emptyText = 'Nothing needs your attention right now.',
}: {
  apiBase: string;
  title?: string;
  emptyText?: string;
}) {
  const [tasks, setTasks] = useState<QueueTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { cache: 'no-store' });
      if (!res.ok) {
        setError('Could not load your to-dos.');
        return;
      }
      const json = await res.json();
      setTasks(json.data?.tasks ?? []);
      setError(null);
    } catch {
      setError('Could not load your to-dos.');
    }
  }, [apiBase]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000); // keep urgency fresh
    return () => clearInterval(id);
  }, [load]);

  const now = Date.now();
  const sorted = useMemo(() => (tasks ? sortByUrgency(tasks, now) : []), [tasks, now]);

  const complete = useCallback(
    async (taskId: string, decision: Record<string, unknown>) => {
      setBusy((p) => ({ ...p, [taskId]: true }));
      try {
        const res = await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, result: decision }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({ error: 'Failed' }));
          setError(j.error ?? 'Could not complete the task.');
        } else {
          setTasks((prev) => (prev ? prev.filter((t) => t.id !== taskId) : prev));
        }
      } catch {
        setError('Network error completing the task.');
      } finally {
        setBusy((p) => ({ ...p, [taskId]: false }));
      }
    },
    [apiBase],
  );

  const overdueCount = sorted.filter((t) => urgencyOf(t.dueAt, now) === 'overdue').length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">
          {title}
          {tasks && tasks.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">{tasks.length}</span>
          )}
        </h2>
        {overdueCount > 0 && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            {overdueCount} overdue
          </span>
        )}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {tasks === null && !error && (
        <p className="text-sm text-gray-400">Loading…</p>
      )}

      {tasks && sorted.length === 0 && (
        <p className="text-sm text-gray-400">{emptyText}</p>
      )}

      <ul className="space-y-2">
        {sorted.map((t) => {
          const u = urgencyOf(t.dueAt, now);
          const style = URGENCY_STYLE[u];
          return (
            <li
              key={t.id}
              className={`rounded-md border p-3 ${u === 'overdue' ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{t.title}</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {prettyType(t.taskType)}
                </span>
                {style.label && (
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.chip}`}>
                    {style.label}
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">{dueLabel(t.dueAt, now)}</span>
              </div>
              {t.description && (
                <p className="mt-1 text-xs text-gray-500">{t.description}</p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => complete(t.id, { approved: true })}
                  disabled={busy[t.id]}
                  className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                >
                  {busy[t.id] ? '…' : 'Approve / Done'}
                </button>
                <button
                  onClick={() => complete(t.id, { approved: false })}
                  disabled={busy[t.id]}
                  className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
