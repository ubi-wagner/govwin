'use client';

/**
 * Tenant Workflow Setup — the editor (TW-6, docs/TENANT_WORKFLOW_SETUP_DESIGN.md §6).
 * Required "Accept & Start" on a new portal (recommend-but-require), then the same surface for all later
 * editing. Timeline of dated stages · per-stage gate closer (Human | AI-manager) · per-ToDo owner (a real
 * person or a role) + date + nudge · portal nudge cadence · one-click rebaseline. Wires PATCH/POST
 * /workflow (proven backend).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export interface Member { id: string; name: string | null; email: string; role: string }
interface Todo { type: string; title?: string; assigneeRole?: string | null; assigneeUserId?: string | null; dueDate?: string | null; nudgeDays?: number[] }
interface Stage { key: string; label?: string; dueDate?: string | null; gateCloser?: 'human' | 'agent_manager'; agentManagerKey?: string | null; todos?: Todo[]; defaultAssigneeUserId?: string | null }
interface Config { stages?: Stage[]; collaborators?: unknown[]; nudgeDays?: number[]; _setup?: { status?: string } }

const TODO_TYPES = [
  { v: 'acknowledge', label: 'Acknowledge / review' },
  { v: 'complete_sections', label: 'Draft sections' },
  { v: 'upload_documents', label: 'Upload documents' },
];
const AGENT_MANAGERS = [
  { v: 'advisory_manager', label: 'Advisory manager (full review cohort)' },
  { v: 'color_team_reviewer', label: 'Color-team reviewer' },
];
const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
const fromDateInput = (d: string): string | null => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : null);

export function WorkflowSetupClient({
  tenantSlug, portalId, oppTitle, statusLabel, accepted, recommendationBasis, limits, members, initialConfig,
}: {
  tenantSlug: string; portalId: string; oppTitle: string; statusLabel: string; accepted: boolean;
  recommendationBasis: string | null; limits: { maxStages: number; maxNudges: number };
  members: Member[]; initialConfig: Config;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<Config>(() => JSON.parse(JSON.stringify(initialConfig)) as Config);
  const [busy, setBusy] = useState(false);
  const [shift, setShift] = useState(7);

  const stages = config.stages ?? [];
  const setStages = (next: Stage[]) => setConfig((c) => ({ ...c, stages: next }));
  const patchStage = (i: number, p: Partial<Stage>) => setStages(stages.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  const patchTodo = (si: number, ti: number, p: Partial<Todo>) =>
    setStages(stages.map((s, idx) => (idx === si ? { ...s, todos: (s.todos ?? []).map((t, tj) => (tj === ti ? { ...t, ...p } : t)) } : s)));

  const missing = useMemo(() => {
    const m: string[] = [];
    if (stages.length < 1) m.push('at least one stage');
    stages.forEach((s, i) => {
      const label = s.label || s.key || `stage ${i + 1}`;
      if (!s.dueDate) m.push(`a date for "${label}"`);
      if ((s.gateCloser ?? 'human') === 'agent_manager') { if (!s.agentManagerKey) m.push(`an AI manager for "${label}"`); }
      else {
        const todos = s.todos ?? [];
        if (todos.length < 1) m.push(`a to-do for "${label}"`);
        else if (!s.defaultAssigneeUserId && !todos.some((t) => t.assigneeUserId || t.assigneeRole)) m.push(`an owner for "${label}"`);
      }
    });
    return m;
  }, [stages]);

  async function save(acceptNow: boolean) {
    if (acceptNow && missing.length) { toast(`Complete the setup first — need ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`, 'error'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/portals/${portalId}/workflow`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, accept: acceptNow }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j?.error ? `Save failed: ${j.error}` : 'Save failed', 'error'); return; }
      toast.success(acceptNow ? 'Workflow accepted & started.' : 'Workflow saved.');
      router.refresh();
    } catch { toast('Save failed — please retry.', 'error'); } finally { setBusy(false); }
  }

  async function rebaseline(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/portals/${portalId}/workflow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rebaseline', ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast(j?.error ? `Rebaseline failed: ${j.error}` : 'Rebaseline failed', 'error'); return; }
      toast.success('Timeline rebaselined.');
      router.refresh();
    } catch { toast('Rebaseline failed.', 'error'); } finally { setBusy(false); }
  }

  const assigneeValue = (t: Todo) => (t.assigneeUserId ? `user:${t.assigneeUserId}` : t.assigneeRole ? `role:${t.assigneeRole}` : '');
  const setAssignee = (si: number, ti: number, v: string) => {
    if (v.startsWith('user:')) patchTodo(si, ti, { assigneeUserId: v.slice(5), assigneeRole: null });
    else if (v.startsWith('role:')) patchTodo(si, ti, { assigneeUserId: null, assigneeRole: v.slice(5) });
    else patchTodo(si, ti, { assigneeUserId: null, assigneeRole: null });
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold min-w-0 truncate">Workflow setup</h1>
        <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{statusLabel}</span>
      </div>
      <p className="text-sm text-gray-500 mb-5 truncate">{oppTitle}</p>

      {!accepted && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">Review &amp; accept your build workflow to get started.</p>
          <p className="text-xs text-amber-800 mt-1">
            {recommendationBasis
              ? <>Pre-filled from your prior <span className="font-medium">{recommendationBasis}</span> — adjust the dates, owners &amp; reminders, then Accept &amp; Start.</>
              : <>Pre-filled with a recommended plan — adjust the dates, owners &amp; reminders, then Accept &amp; Start.</>}
          </p>
        </div>
      )}

      {/* Stages */}
      <div className="space-y-4">
        {stages.map((s, si) => {
          const closer = s.gateCloser ?? 'human';
          return (
            <section key={si} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-gray-400">STAGE {si + 1}</span>
                <input value={s.label ?? ''} onChange={(e) => patchStage(si, { label: e.target.value })}
                  placeholder="Stage name" className="flex-1 min-w-[8rem] border border-gray-300 rounded px-2 py-1 text-sm font-medium" />
                <label className="text-xs text-gray-500">Due</label>
                <input type="date" value={toDateInput(s.dueDate)} onChange={(e) => patchStage(si, { dueDate: fromDateInput(e.target.value) })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm" />
                <select value={closer} onChange={(e) => patchStage(si, { gateCloser: e.target.value as Stage['gateCloser'] })}
                  className="border border-gray-300 rounded px-2 py-1 text-sm" title="Who closes this stage's gate">
                  <option value="human">Closed by: Human</option>
                  <option value="agent_manager">Closed by: AI manager</option>
                </select>
                {stages.length > 1 && (
                  <button onClick={() => setStages(stages.filter((_, idx) => idx !== si))} className="text-xs text-red-600 hover:underline">remove</button>
                )}
              </div>

              {closer === 'agent_manager' ? (
                <div className="pl-2">
                  <label className="text-xs text-gray-500 mr-2">AI manager</label>
                  <select value={s.agentManagerKey ?? ''} onChange={(e) => patchStage(si, { agentManagerKey: e.target.value || null })}
                    className="border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="">Choose a manager…</option>
                    {AGENT_MANAGERS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">The cohort lands + the adversarial review passes, then the stage advances. (Auto-advance ships next.)</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(s.todos ?? []).map((t, ti) => (
                    <div key={ti} className="flex flex-wrap items-center gap-2 text-sm">
                      <select value={t.type} onChange={(e) => patchTodo(si, ti, { type: e.target.value })} className="border border-gray-300 rounded px-1.5 py-1">
                        {TODO_TYPES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                      </select>
                      <input value={t.title ?? ''} onChange={(e) => patchTodo(si, ti, { title: e.target.value })} placeholder="To-do title"
                        className="flex-1 min-w-[8rem] border border-gray-300 rounded px-2 py-1" />
                      <select value={assigneeValue(t)} onChange={(e) => setAssignee(si, ti, e.target.value)} className="border border-gray-300 rounded px-1.5 py-1" title="Owner">
                        <option value="">Unassigned</option>
                        <optgroup label="Role">
                          <option value="role:tenant_admin">Any admin</option>
                          <option value="role:tenant_user">Any contributor</option>
                        </optgroup>
                        <optgroup label="Person">
                          {members.map((m) => <option key={m.id} value={`user:${m.id}`}>{m.name || m.email}</option>)}
                        </optgroup>
                      </select>
                      <input type="date" value={toDateInput(t.dueDate)} onChange={(e) => patchTodo(si, ti, { dueDate: fromDateInput(e.target.value) })}
                        className="border border-gray-300 rounded px-1.5 py-1" title="Optional per-to-do date (else the stage date)" />
                      <button onClick={() => patchStage(si, { todos: (s.todos ?? []).filter((_, tj) => tj !== ti) })} className="text-xs text-red-600 hover:underline">×</button>
                    </div>
                  ))}
                  <button onClick={() => patchStage(si, { todos: [...(s.todos ?? []), { type: 'acknowledge', title: '' }] })} className="text-xs text-blue-600 hover:underline">+ add to-do</button>
                </div>
              )}
            </section>
          );
        })}
        {stages.length < limits.maxStages && (
          <button onClick={() => setStages([...stages, { key: `stage_${stages.length + 1}_${Date.now().toString(36)}`, label: 'New stage', todos: [] }])}
            className="text-sm text-blue-600 hover:underline">+ add stage ({stages.length}/{limits.maxStages})</button>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Owners are your team members and collaborators.{' '}
        <a href={`/portal/${tenantSlug}/team`} className="text-blue-600 hover:underline">Add or manage people →</a>
      </p>

      {/* Nudges */}
      <section className="bg-white border border-gray-200 rounded-lg p-4 mt-5">
        <h2 className="text-sm font-semibold mb-2">Reminders (days before a to-do is due)</h2>
        <input value={(config.nudgeDays ?? []).join(', ')} onChange={(e) => {
          const arr = e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0).slice(0, limits.maxNudges);
          setConfig((c) => ({ ...c, nudgeDays: arr }));
        }} placeholder="e.g. 5, 2, 1" className="border border-gray-300 rounded px-2 py-1 text-sm w-48" />
        <span className="text-xs text-gray-400 ml-2">up to {limits.maxNudges}; the last is the final notice (also to your managers)</span>
      </section>

      {/* Low-lift actions + save */}
      <section className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-5 flex flex-wrap items-center gap-3">
        <button onClick={() => rebaseline({ shiftDays: shift })} disabled={busy} className="text-sm px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50">
          Shift timeline
        </button>
        <input type="number" value={shift} onChange={(e) => setShift(Number(e.target.value) || 0)} className="w-16 border border-gray-300 rounded px-2 py-1 text-sm" /> <span className="text-xs text-gray-500 -ml-1">days</span>
        <button onClick={() => rebaseline({ fromSolicitation: true })} disabled={busy} className="text-sm px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50">
          Set deadline from solicitation
        </button>
        <div className="flex-1" />
        {missing.length > 0 && <span className="text-xs text-amber-700">Missing: {missing.slice(0, 2).join(', ')}{missing.length > 2 ? '…' : ''}</span>}
        <button onClick={() => save(!accepted)} disabled={busy || (!accepted && missing.length > 0)}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded">
          {busy ? 'Saving…' : accepted ? 'Save' : 'Accept & Start'}
        </button>
      </section>
    </div>
  );
}
