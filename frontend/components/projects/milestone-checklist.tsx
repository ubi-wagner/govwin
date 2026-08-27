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
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  assigneeRole: string | null;
  dueDate: string | null;
  /** The assignee's OWN forecast. Free to run past the due date — that gap is the warning. */
  estimatedCompletion: string | null;
  status: 'open' | 'done' | 'blocked';
  blockedReason: string | null;
  attachments?: { id: string; filename: string }[];
}

/** Someone who can be given work: on the project, and therefore able to open it. */
export interface ChecklistMember { id: string; email: string }

/**
 * Is this task's own forecast later than the date it was promised for?
 *
 * Rendered as a warning rather than an error, and never blocked on save. A person telling you they
 * will be late is the most useful thing in the list, and a product that refused the entry would
 * only be told the date it wanted to hear.
 */
function slipDays(due: string | null, est: string | null): number {
  if (!due || !est) return 0;
  const a = Date.parse(`${String(due).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(est).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

const DOT: Record<ChecklistTask['status'], string> = {
  done: 'bg-green-600 border-green-600',
  blocked: 'bg-amber-500 border-amber-500',
  open: 'bg-white border-gray-400',
};

export function MilestoneChecklist({
  milestoneId, tasks, basePath, canManage, milestoneMet, members = [],
}: {
  /** NULL renders the standing project list — work that belongs to no phase (mig 221). */
  milestoneId: string | null;
  tasks: ChecklistTask[];
  basePath: string;
  canManage: boolean;
  milestoneMet: boolean;
  members?: ChecklistMember[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  /**
   * Rearranging a task — owner, dates, note — is open to ANYONE on the project, not just a manager.
   * Handing work to whoever is free is the team doing its job; a plan only a manager can rearrange
   * is stale by the next standup. Every change is audited server-side as its own event.
   */
  async function edit(taskId: string, patch: Record<string, string | null>) {
    setBusy(taskId);
    try {
      const res = await fetch(`${basePath}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not update the task', 'error'); return; }
      setEditing(null);
      toast('Task updated', 'success');
      router.refresh();
    } catch {
      toast('Could not update the task', 'error');
    } finally {
      setBusy(null);
    }
  }

  /** Attach a reference. It is a reference, NOT evidence of completion — status is untouched. */
  async function attach(taskId: string, file: File) {
    setBusy(taskId);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${basePath}/tasks/${taskId}/attachments`, { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not attach the file', 'error'); return; }
      toast('Reference attached', 'success');
      router.refresh();
    } catch {
      toast('Could not attach the file', 'error');
    } finally {
      setBusy(null);
    }
  }

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
        // `milestoneId: null` is standing project work, not a missing field — the server derives
        // the scope from it rather than taking a second, disagreeable input.
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
            {/* The assignee's own forecast, shown only when it DISAGREES with the promise. Agreement
                is the normal case and needs no ink; the gap is the whole signal. */}
            {slipDays(t.dueDate, t.estimatedCompletion) > 0 && t.status !== 'done' && (
              <span
                title={`Assignee expects ${String(t.estimatedCompletion).slice(0, 10)}`}
                className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30"
              >
                expects {slipDays(t.dueDate, t.estimatedCompletion)}d late
              </span>
            )}
            {t.status === 'blocked' && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
                blocked — {t.blockedReason}
              </span>
            )}
            {(t.attachments ?? []).map((a) => (
              <span key={a.id} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                📎 {a.filename}
              </span>
            ))}
            {!milestoneMet && t.status !== 'done' && (
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setEditing(editing === t.id ? null : t.id)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void setStatus(t, t.status === 'blocked' ? 'open' : 'blocked')}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t.status === 'blocked' ? 'Unblock' : 'Block'}
                </button>
              </span>
            )}

            {editing === t.id && (
              <div className="w-full rounded border border-gray-200 bg-gray-50 p-2">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[11px] text-gray-600">
                    Owner
                    <select
                      defaultValue={t.assigneeUserId ?? ''}
                      aria-label={`Owner of ${t.title}`}
                      onChange={(e) => void edit(t.id, { assigneeUserId: e.target.value || null })}
                      disabled={busy !== null}
                      className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Due
                    <input
                      type="date"
                      defaultValue={t.dueDate ? String(t.dueDate).slice(0, 10) : ''}
                      aria-label={`Due date of ${t.title}`}
                      onBlur={(e) => { if (e.target.value !== (t.dueDate ? String(t.dueDate).slice(0, 10) : '')) void edit(t.id, { dueDate: e.target.value || null }); }}
                      disabled={busy !== null}
                      className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-gray-600" title="Your own forecast — it may run past the due date, and saying so early is the point">
                    Expect
                    <input
                      type="date"
                      defaultValue={t.estimatedCompletion ? String(t.estimatedCompletion).slice(0, 10) : ''}
                      aria-label={`Expected completion of ${t.title}`}
                      onBlur={(e) => { if (e.target.value !== (t.estimatedCompletion ? String(t.estimatedCompletion).slice(0, 10) : '')) void edit(t.id, { estimatedCompletion: e.target.value || null }); }}
                      disabled={busy !== null}
                      className="mt-0.5 block rounded border border-gray-300 px-1.5 py-1 text-xs"
                    />
                  </label>
                  <label className="text-[11px] text-gray-600">
                    Reference
                    <input
                      type="file"
                      aria-label={`Attach a reference to ${t.title}`}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(t.id, f); e.target.value = ''; }}
                      disabled={busy !== null}
                      className="mt-0.5 block w-44 text-[11px]"
                    />
                  </label>
                </div>
                <textarea
                  defaultValue={t.detail ?? ''}
                  aria-label={`Notes on ${t.title}`}
                  placeholder="Notes"
                  rows={2}
                  onBlur={(e) => { if (e.target.value !== (t.detail ?? '')) void edit(t.id, { detail: e.target.value || null }); }}
                  disabled={busy !== null}
                  className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />
              </div>
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

