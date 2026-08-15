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
import { taskCompleterKind, formFields, taskHref, taskChain, type ChainEntry } from '@/lib/tasks/completers';
import { resolveTaskWorkflow, type TaskWorkflowDef } from '@/lib/tasks/workflows';

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
  params?: Record<string, unknown> | null;
  /** For a broadcast: result.chain[] is the message thread. */
  result?: Record<string, unknown> | null;
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

export function TaskQueue({
  apiBase,
  title = 'Your To-Dos',
  emptyText = 'Nothing needs your attention right now.',
  tenantSlug,
}: {
  apiBase: string;
  title?: string;
  emptyText?: string;
  /** Enables the upload-completer CTA to route to the entity workspace. */
  tenantSlug?: string;
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
          const wf = resolveTaskWorkflow(t.taskType);
          return (
            <li
              key={t.id}
              className={`rounded-md border p-3 ${u === 'overdue' ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-900">{t.title}</span>
                <span
                  className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
                  title={wf.description}
                >
                  {wf.name}
                </span>
                {style.label && (
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.chip}`}>
                    {style.label}
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400">{dueLabel(t.dueAt, now)}</span>
              </div>
              <WorkflowTrail wf={wf} stepName={t.stepName} />
              {t.description && (
                <p className="mt-1 text-xs text-gray-500">{t.description}</p>
              )}
              <TaskCompleter
                task={t}
                workflow={wf}
                tenantSlug={tenantSlug}
                busy={!!busy[t.id]}
                onComplete={(decision) => complete(t.id, decision)}
                apiBase={apiBase}
                reload={load}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Workflow trail ──────────────────────────────────────────────────────────

/**
 * Renders the defined workflow this ToDo belongs to as a step trail — so a
 * reader sees the ToDo is one step in a real workflow, not a loose task. The
 * current step (the task's `step_name` if it matches, else the workflow's
 * `actionStep`) is bolded; earlier steps read as done.
 */
function WorkflowTrail({ wf, stepName }: { wf: TaskWorkflowDef; stepName: string | null }) {
  const named = stepName
    ? wf.steps.findIndex((s) => s.toLowerCase() === stepName.toLowerCase())
    : -1;
  const current = named >= 0 ? named : wf.actionStep;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-gray-400">
      {wf.steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">→</span>}
          <span
            className={
              i === current
                ? 'font-semibold text-indigo-700'
                : i < current
                  ? 'text-gray-400 line-through decoration-gray-300'
                  : 'text-gray-400'
            }
          >
            {s}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Typed completers (W-M) ──────────────────────────────────────────────────

function TaskCompleter({
  task,
  workflow,
  tenantSlug,
  busy,
  onComplete,
  apiBase,
  reload,
}: {
  task: QueueTask;
  workflow: TaskWorkflowDef;
  tenantSlug?: string;
  busy: boolean;
  onComplete: (decision: Record<string, unknown>) => void;
  apiBase: string;
  reload: () => void;
}) {
  // A manager-access request is NOT completed from the queue (the generic completer 409s) — it is
  // approved/declined on the company Team page. Route the human there instead. (HITL G6.)
  if (task.taskType === 'manager_request') return <ManagerRequestCompleter tenantSlug={tenantSlug} />;

  // "Open the thing this ToDo is about" deep-link (HITL P4) — shown on review/upload gates.
  const openHref = taskHref({ tenantSlug, entityType: task.entityType, entityId: task.entityId, params: task.params });

  // Explicit params.kind wins; otherwise the ToDo completes the way its defined
  // workflow prescribes (e.g. broadcast → acknowledge, review_section → review).
  const kind = taskCompleterKind(task.params, workflow.completer);
  // A group-chat THREAD posts to the message chain + reloads in place (never removes itself).
  if (kind === 'thread') return <ThreadCompleter task={task} apiBase={apiBase} reload={reload} />;
  if (kind === 'acknowledge') return <AcknowledgeCompleter busy={busy} onComplete={onComplete} />;
  if (kind === 'read_receipt') return <ReadReceiptCompleter busy={busy} onComplete={onComplete} />;
  if (kind === 'text_memo') return <TextMemoCompleter busy={busy} onComplete={onComplete} />;
  if (kind === 'form') return <FormCompleter task={task} busy={busy} onComplete={onComplete} />;
  if (kind === 'upload') {
    return <UploadCompleter openHref={openHref} busy={busy} onComplete={onComplete} />;
  }
  return <ReviewCompleter openHref={openHref} busy={busy} onComplete={onComplete} />;
}

/**
 * Broadcast with a READ RECEIPT (HITL): the recipient confirms receipt in one click; the completion
 * records who + when (the receipt the sender can see). Distinct from a bare acknowledge only in intent
 * + the receipt payload.
 */
function ReadReceiptCompleter({ busy, onComplete }: { busy: boolean; onComplete: (d: Record<string, unknown>) => void }) {
  return (
    <div className="mt-2">
      <button
        onClick={() => onComplete({ read: true, readAt: new Date().toISOString() })}
        disabled={busy}
        className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
      >
        {busy ? '…' : '✓ Confirm receipt'}
      </button>
    </div>
  );
}

/**
 * Free-text ToDo (inline chat + tasking): an optional memo response + a close DISPOSITION —
 * Completed / Delegated / Not completed. The disposition + memo land in the task result (and the
 * task.completed event) so later automation can trigger off them. All three CLOSE the ToDo.
 */
function TextMemoCompleter({ busy, onComplete }: { busy: boolean; onComplete: (d: Record<string, unknown>) => void }) {
  const [memo, setMemo] = useState('');
  const close = (disposition: 'completed' | 'delegated' | 'not_completed') =>
    onComplete({ disposition, memo: memo.trim() || null, respondedAt: new Date().toISOString() });
  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Add a text response (optional)…"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => close('completed')} disabled={busy}
          className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50">
          {busy ? '…' : 'Completed'}
        </button>
        <button onClick={() => close('delegated')} disabled={busy}
          className="rounded border border-blue-300 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          Delegated
        </button>
        <button onClick={() => close('not_completed')} disabled={busy}
          className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
          Not completed
        </button>
      </div>
    </div>
  );
}

/**
 * A broadcast GROUP CHAT (kind='thread'). Renders the message chain + a reply box; posting appends a
 * timestamped message and reloads in place. The thread never leaves anyone's queue and nobody is
 * required to respond. Entries are typed, so future workflows can render richer entry types here
 * (a proposed meeting time, an RSVP, a task) — this is the substrate those extensions plug into.
 */
function ThreadCompleter({ task, apiBase, reload }: { task: QueueTask; apiBase: string; reload: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chain = taskChain(task.result);
  const now = Date.now();
  async function post() {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, result: { memo: text.trim() } }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not post your message.'); return; }
      setText('');
      reload();
    } catch { setErr('Network error posting your message.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-2">
      <div className="rounded-md border border-gray-200 bg-gray-50/60">
        {chain.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">No messages yet — start the thread.</p>
        ) : (
          <ul className="max-h-52 overflow-y-auto divide-y divide-gray-100">
            {chain.map((e, i) => (
              <li key={i} className="px-3 py-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-gray-700">{e.name ?? 'Someone'}</span>
                  <span className="text-[10px] text-gray-400">{relTime(e.at, now)}</span>
                </div>
                {e.text
                  ? <p className="text-xs text-gray-600 whitespace-pre-wrap">{e.text}</p>
                  : <p className="text-[11px] italic text-gray-400">✓ acknowledged</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={1}
          maxLength={4000}
          placeholder="Message the group…"
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <button
          onClick={post}
          disabled={busy || !text.trim()}
          className="rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          {busy ? '…' : 'Post'}
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** Relative "3m ago" timestamp for a chain entry. */
function relTime(at: string | null, now: number): string {
  if (!at) return '';
  const t = new Date(at).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** manager_request routes to the Team page (its real approve/decline surface), not a queue completer. */
function ManagerRequestCompleter({ tenantSlug }: { tenantSlug?: string }) {
  if (!tenantSlug) return <div className="mt-2 text-xs text-gray-500">Approve or decline on the company Team page.</div>;
  return (
    <div className="mt-2">
      <a href={`/portal/${tenantSlug}/team`} className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
        Review on Team page &rarr;
      </a>
    </div>
  );
}

/**
 * The atomic completer: a broadcast note read and acknowledged in one click.
 * Accept-on-read — the smallest possible ToDo completion.
 */
function AcknowledgeCompleter({ busy, onComplete }: { busy: boolean; onComplete: (d: Record<string, unknown>) => void }) {
  return (
    <div className="mt-2">
      <button
        onClick={() => onComplete({ acknowledged: true })}
        disabled={busy}
        className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
      >
        {busy ? '…' : 'Acknowledge'}
      </button>
    </div>
  );
}

function ReviewCompleter({ openHref, busy, onComplete }: { openHref?: string | null; busy: boolean; onComplete: (d: Record<string, unknown>) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {openHref && (
        <a href={openHref} className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
          Open &rarr;
        </a>
      )}
      <button
        onClick={() => onComplete({ approved: true })}
        disabled={busy}
        className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        {busy ? '…' : 'Approve / Done'}
      </button>
      <button
        onClick={() => onComplete({ approved: false })}
        disabled={busy}
        className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
      >
        Dismiss
      </button>
    </div>
  );
}

function UploadCompleter({
  openHref,
  busy,
  onComplete,
}: {
  openHref?: string | null;
  busy: boolean;
  onComplete: (d: Record<string, unknown>) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      {openHref && (
        <a
          href={openHref}
          className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
        >
          Open to upload
        </a>
      )}
      <button
        onClick={() => onComplete({ uploaded: true })}
        disabled={busy}
        className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        {busy ? '…' : 'Mark uploaded'}
      </button>
    </div>
  );
}

function FormCompleter({
  task,
  busy,
  onComplete,
}: {
  task: QueueTask;
  busy: boolean;
  onComplete: (d: Record<string, unknown>) => void;
}) {
  const fields = formFields(task.params);
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  // No spec'd fields → degrade to a single freeform note so the task stays completable.
  const effective = fields.length > 0 ? fields : [{ name: 'note', label: 'Notes', type: 'textarea' as const, required: false }];

  function submit() {
    for (const f of effective) {
      if (f.required && !(values[f.name] ?? '').trim()) {
        setErr(`${f.label} is required.`);
        return;
      }
    }
    setErr(null);
    onComplete({ form: values });
  }

  return (
    <div className="mt-2 space-y-2">
      {effective.map((f) => (
        <div key={f.name}>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">
            {f.label}{f.required && <span className="text-red-500"> *</span>}
          </label>
          {f.type === 'textarea' ? (
            <textarea
              rows={2}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          ) : (
            <input
              type={f.type === 'number' ? 'number' : 'text'}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
            />
          )}
        </div>
      ))}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button
        onClick={submit}
        disabled={busy}
        className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        {busy ? '…' : 'Submit'}
      </button>
    </div>
  );
}
