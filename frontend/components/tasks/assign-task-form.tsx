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
  // assignee select value: 'broadcast' (everyone in the tenant) | 'user:<id>' (one named member).
  // Those are the only two targeting modes in the tenant portal — a broadcast to all, or a named
  // person. (Role buckets stay for engine-produced ToDos, but a human never composes to one.)
  const [assignee, setAssignee] = useState('broadcast');
  // how the assignee completes it (W-M typed completer): a plain review
  // (approve/dismiss), an upload (go do it then mark done), a small form, or a
  // broadcast note (read + acknowledge — the atomic ToDo).
  const [completion, setCompletion] = useState<'review' | 'upload' | 'form' | 'read_receipt' | 'text_memo' | 'thread'>('review');
  // for completion='form': comma-separated field names → params.spec.fields.
  const [formFieldsRaw, setFormFieldsRaw] = useState('');
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
    // A group thread is inherently a broadcast (everyone in the company can post).
    const broadcast = assignee === 'broadcast' || completion === 'thread';
    const namedUserId = completion === 'thread' ? null : (assignee.startsWith('user:') ? assignee.slice('user:'.length) : null);
    // Map the completion choice to the task's params.kind (the queue renders the
    // matching completer). 'review' is the default — send no params so the task
    // uses the plain approve/dismiss completer.
    let params: Record<string, unknown> | undefined;
    // A broadcast note is its own defined workflow; the others are delegated_task variants selected
    // by params.kind. read_receipt = a broadcast whose completion captures a read receipt; text_memo
    // = a free-text ToDo answered with an optional memo + a close disposition.
    let taskType = 'delegated_task';
    if (completion === 'thread') {
      // A persistent group chat: broadcast to all, a message chain, never closes, no trigger.
      taskType = 'broadcast';
      params = { kind: 'thread' };
    } else if (completion === 'read_receipt') {
      taskType = 'broadcast';
      params = { kind: 'read_receipt' };
    } else if (completion === 'text_memo') {
      params = { kind: 'text_memo' };
    } else if (completion === 'upload') {
      params = { kind: 'upload' };
    } else if (completion === 'form') {
      const fields = formFieldsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name, label: name }));
      if (fields.length === 0) {
        setMsg({ kind: 'err', text: 'Add at least one field name for a form task.' });
        return;
      }
      params = { kind: 'form', spec: { fields } };
    }
    const body: Record<string, unknown> = {
      taskType,
      title: title.trim(),
      description: description.trim() || undefined,
      broadcast: broadcast || undefined,
      assigneeUserId: namedUserId ?? undefined,
      entityType,
      entityId,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      nudgeDays: [1, 3],
      ...(params ? { params } : {}),
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
      setCompletion('review');
      setFormFieldsRaw('');
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
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Assign to</label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="broadcast">Everyone in the company (broadcast)</option>
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
          <label className="block text-xs font-medium text-gray-500 mb-1">Completion</label>
          <select
            value={completion}
            onChange={(e) => setCompletion(e.target.value as 'review' | 'upload' | 'form' | 'read_receipt' | 'text_memo' | 'thread')}
            className="w-full border border-gray-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="review">Review &amp; approve</option>
            <option value="text_memo">Text response (memo + Completed/Delegated/Not-completed)</option>
            <option value="read_receipt">Read receipt (acknowledge)</option>
            <option value="thread">Group thread (chat — everyone can post)</option>
            <option value="upload">Upload a file</option>
            <option value="form">Fill a form</option>
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
      {completion === 'form' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Form fields <span className="text-gray-400">(comma-separated)</span>
          </label>
          <input
            value={formFieldsRaw}
            onChange={(e) => setFormFieldsRaw(e.target.value)}
            placeholder="e.g. Past performance ref, Contract value, POC email"
            className="w-full border border-gray-300 rounded px-2 py-1.5"
            maxLength={500}
          />
        </div>
      )}
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
