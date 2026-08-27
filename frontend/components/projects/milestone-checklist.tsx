'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The checklist that makes a milestone a unit of work rather than a date.
 *
 * ── WHO MAY DO WHAT, AND WHY IT IS NOT ONE PERMISSION ────────────────────────────────────────
 * **Ticking a task off is open to anyone who can reach the project.** Adding tasks and closing the
 * milestone are `tenant_admin`. A checklist only a manager may tick is a status report they
 * maintain on everyone else's behalf — which is the thing this replaces.
 *
 * ── BLOCKED NEEDS A REASON ───────────────────────────────────────────────────────────────────
 * The server refuses a blocked task with no reason, and this asks for one first. A blocked task
 * nobody explained is a task nobody can unblock; it sits in the list looking like progress.
 */
export interface ChecklistTask {
  id: string;
  title: string;
  detail: string | null;
  assigneeEmail: string | null;
  assigneeRole: string | null;
  dueDate: string | null;
  status: 'open' | 'done' | 'blocked';
  blockedReason: string | null;
}

const DOT: Record<ChecklistTask['status'], string> = {
  done: 'bg-green-600 border-green-600',
  blocked: 'bg-amber-500 border-amber-500',
  open: 'bg-white border-gray-400',
};

export function MilestoneChecklist({
  milestoneId, tasks, basePath, canManage, milestoneMet,
}: {
  milestoneId: string;
  tasks: ChecklistTask[];
  basePath: string;
  canManage: boolean;
  milestoneMet: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  async function setStatus(task: ChecklistTask, next: ChecklistTask['status']) {
    let blockedReason: string | null = null;
    if (next === 'blocked') {
      blockedReason = window.prompt('What is blocking it?')?.trim() || null;
      if (!blockedReason) return;   // a blocked task with no reason is one nobody can unblock
    }
    setBusy(task.id);
    try {
      const res = await fetch(`${basePath}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, blockedReason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not update the task', 'error'); return; }
      toast(next === 'done' ? 'Task done' : next === 'blocked' ? 'Task blocked' : 'Task reopened', 'success');
      router.refresh();
    } catch {
      toast('Could not update the task', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function addTask() {
    if (!title.trim()) return;
    setBusy('new');
    try {
      const res = await fetch(`${basePath}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestoneId, title: title.trim(), dueDate: due || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not add the task', 'error'); return; }
      setTitle(''); setDue(''); setAdding(false);
      toast('Task added', 'success');
      router.refresh();
    } catch {
      toast('Could not add the task', 'error');
    } finally {
      setBusy(null);
    }
  }

  const done = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="mt-3">
      {tasks.length > 0 && (
        <div className="mb-2 text-xs text-gray-500">
          {done} of {tasks.length} done
        </div>
      )}

      <ul className="space-y-1.5 text-sm">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`}
              disabled={busy !== null || milestoneMet}
              onClick={() => void setStatus(t, t.status === 'done' ? 'open' : 'done')}
              className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border ${DOT[t.status]} disabled:opacity-50`}
            />
            <span className={t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}>
              {t.title}
            </span>
            {t.dueDate && (
              <span className="text-xs text-gray-500">due {String(t.dueDate).slice(0, 10)}</span>
            )}
            {(t.assigneeEmail || t.assigneeRole) && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                {t.assigneeEmail ?? t.assigneeRole}
              </span>
            )}
            {t.status === 'blocked' && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
                blocked — {t.blockedReason}
              </span>
            )}
            {!milestoneMet && t.status !== 'done' && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void setStatus(t, t.status === 'blocked' ? 'open' : 'blocked')}
                className="ml-auto rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {t.status === 'blocked' ? 'Unblock' : 'Block'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && !milestoneMet && (
        adding ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              aria-label="Task title"
              className="min-w-[14rem] flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Task due date"
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={busy !== null || !title.trim()}
              onClick={() => void addTask()}
              className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setTitle(''); setDue(''); }}
              className="text-xs text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 text-xs text-blue-700 hover:underline"
          >
            + Add task
          </button>
        )
      )}
    </div>
  );
}

