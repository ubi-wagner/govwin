'use client';

/**
 * AssignTaskForm — delegate a job (J1). A manager assigns a contributor a task
 * with a title, optional description + due date, and an assignee (a named team
 * member or a role bucket). POSTs to /api/portal/<slug>/tasks/assign; the task
 * lands in the assignee's queue and is nudged by the sweep. Self-contained.
 */
import { useState } from 'react';

export interface AssigneeOption {
  userId: string | null;
  name: string | null;
  email: string;
}

export function AssignTaskForm({
  tenantSlug,
  entityType,
  entityId,
  assignees = [],
  onAssigned,
}: {
  tenantSlug: string;
  /** Optional entity the task is about (e.g. 'proposal' + proposalId). */
  entityType?: string;
  entityId?: string;
  /** Named team members to offer as specific assignees. */
  assignees?: AssigneeOption[];
  onAssigned?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // assignee select value: 'role:tenant_user' | 'role:partner_user' | 'user:<id>'
  const [assignee, setAssignee] = useState('role:tenant_user');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!title.trim()) {
      setMsg({ kind: 'err', text: 'A title is required.' });
      return;
    }
    const [kind, value] = assignee.split(':');
    const body: Record<string, unknown> = {
      taskType: 'delegated_task',
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeRole: kind === 'role' ? value : undefined,
      assigneeUserId: kind === 'user' ? value : undefined,
      entityType,
      entityId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      nudgeDays: [1, 3],
    };
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/tasks/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: 'err', text: json?.error || 'Failed to assign the task.' });
        return;
      }
      setMsg({ kind: 'ok', text: 'Task assigned.' });
      setTitle('');
      setDescription('');
      setDueAt('');
      onAssigned?.();
    } catch {
      setMsg({ kind: 'err', text: 'Network error — please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Task</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Draft the technical approach"
          className="w-full border border-gray-300 rounded px-2 py-1.5"
          maxLength={200}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Details (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded px-2 py-1.5"
          maxLength={2000}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Assign to</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="role:tenant_user">Anyone on the team</option>
            {assignees
              .filter((a) => a.userId)
              .map((a) => (
                <option key={a.userId} value={`user:${a.userId}`}>
                  {a.name || a.email}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Due (optional)</label>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded bg-indigo-600 text-white font-medium disabled:opacity-50"
        >
          {busy ? 'Assigning…' : 'Assign task'}
        </button>
        {msg && (
          <span className={msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}>{msg.text}</span>
        )}
      </div>
    </form>
  );
}
