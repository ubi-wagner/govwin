'use client';

/**
 * GuardrailEditor — author a proposal portal's build workflow before launch.
 *
 * Simple + extensible: the recommended 3-phase default (purchase → close → +30d) pre-fills
 * the form; the admin selects which phases to include (1–3), edits the HITL ToDos per phase,
 * designates managers (delegated, per portal — a teammate or one of our experts), and sets
 * the nudge cadence (≤3; the 3rd is the final notice that also pings the managers). Emits a
 * GuardrailConfig the accept route validates + instantiates. See lib/portal-workflow.ts and
 * docs/CUSTOMER_ADMIN_CONSOLE_DESIGN.md.
 */

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';

const TODO_TYPES = [
  { value: 'acknowledge', label: 'Acknowledge / review' },
  { value: 'complete_sections', label: 'Complete sections' },
  { value: 'upload_documents', label: 'Upload documents' },
];
const ROLE_OPTS = [
  { value: 'tenant_admin', label: 'Admin' },
  { value: 'tenant_user', label: 'Contributor' },
];

interface EditTodo { type: string; title: string; assigneeRole: string; dueDays: number }
interface EditStage { key: string; label: string; included: boolean; todos: EditTodo[] }

export interface GuardrailInitial {
  nudgeDays?: number[];
  collaborators?: { email: string; role: string }[];
  stages?: { key: string; label?: string; todos?: { type: string; title?: string; assigneeRole?: string | null; dueDays?: number }[] }[];
}

export function GuardrailEditor({
  open, onClose, initial, onLaunch, launching,
}: {
  open: boolean;
  onClose: () => void;
  initial: GuardrailInitial;
  onLaunch: (config: unknown) => void;
  launching: boolean;
}) {
  const [stages, setStages] = useState<EditStage[]>(() =>
    (initial.stages ?? []).map((s) => ({
      key: s.key,
      label: s.label ?? s.key,
      included: true,
      todos: (s.todos ?? []).map((t) => ({
        type: t.type, title: t.title ?? '', assigneeRole: t.assigneeRole ?? 'tenant_user', dueDays: t.dueDays ?? 7,
      })),
    })),
  );
  const [managers, setManagers] = useState<string[]>(
    (initial.collaborators ?? []).filter((c) => c.role === 'manager').map((c) => c.email),
  );
  const [nudges, setNudges] = useState<number[]>(initial.nudgeDays ?? [5, 2, 1]);
  const [newManager, setNewManager] = useState('');

  const included = stages.filter((s) => s.included);
  const valid = included.length >= 1 && included.every((s) => s.todos.length >= 1);

  const patchStage = (i: number, patch: Partial<EditStage>) =>
    setStages((cur) => cur.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const patchTodo = (si: number, ti: number, patch: Partial<EditTodo>) =>
    setStages((cur) => cur.map((s, idx) => idx !== si ? s : { ...s, todos: s.todos.map((t, j) => (j === ti ? { ...t, ...patch } : t)) }));
  const addTodo = (si: number) =>
    patchStage(si, { todos: [...stages[si].todos, { type: 'acknowledge', title: '', assigneeRole: 'tenant_user', dueDays: 7 }] });
  const removeTodo = (si: number, ti: number) =>
    setStages((cur) => cur.map((s, idx) => idx !== si ? s : { ...s, todos: s.todos.filter((_, j) => j !== ti) }));

  function launch() {
    const inc = stages.filter((s) => s.included);
    const config = {
      nudgeDays: nudges,
      collaborators: managers.filter((e) => e.trim()).map((email) => ({ email: email.trim(), role: 'manager', stages: inc.map((s) => s.key) })),
      stages: inc.map((s) => ({
        key: s.key,
        label: s.label,
        todos: s.todos.map((t) => ({ type: t.type, title: t.title || undefined, assigneeRole: t.assigneeRole, dueDays: t.dueDays })),
      })),
    };
    onLaunch(config);
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-3xl" ariaLabel="Configure the build workflow">
      <div className="p-5">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">Configure the build workflow</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Purchase → close → +30 days. Pick the phases, tune the ToDos, and set who gets nudged. Recommended defaults are filled in.</p>

        {/* Phases */}
        <div className="space-y-3">
          {stages.map((s, si) => (
            <div key={s.key} className={`rounded-xl border p-3 ${s.included ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50 opacity-70'}`}>
              <div className="flex items-center gap-2 mb-2">
                <input type="checkbox" checked={s.included} onChange={(e) => patchStage(si, { included: e.target.checked })} aria-label={`Include ${s.label}`} />
                <span className="text-[11px] font-bold text-gray-400">{si + 1}</span>
                <span className="text-sm font-semibold text-gray-900">{s.label}</span>
              </div>
              {s.included && (
                <div className="space-y-2 pl-6">
                  {s.todos.map((t, ti) => (
                    <div key={ti} className="flex flex-wrap items-center gap-1.5">
                      <select value={t.type} onChange={(e) => patchTodo(si, ti, { type: e.target.value })} className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white">
                        {TODO_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input value={t.title} onChange={(e) => patchTodo(si, ti, { title: e.target.value })} placeholder="ToDo title" className="flex-1 min-w-[160px] text-xs border border-gray-200 rounded px-2 py-1" />
                      <select value={t.assigneeRole} onChange={(e) => patchTodo(si, ti, { assigneeRole: e.target.value })} className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white">
                        {ROLE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <label className="text-[11px] text-gray-400 flex items-center gap-1">due
                        <input type="number" min={0} value={t.dueDays} onChange={(e) => patchTodo(si, ti, { dueDays: Math.max(0, Number(e.target.value) || 0) })} className="w-14 text-xs border border-gray-200 rounded px-1 py-1" />d
                      </label>
                      <button onClick={() => removeTodo(si, ti)} aria-label="Remove ToDo" className="text-gray-300 hover:text-rose-600 text-sm">✕</button>
                    </div>
                  ))}
                  {s.todos.length === 0 && <p className="text-[11px] text-rose-500">Add at least one ToDo (or drop this phase).</p>}
                  <button onClick={() => addTodo(si)} className="text-xs text-indigo-600 hover:underline">+ Add ToDo</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Managers */}
        <div className="mt-5">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Managers</h3>
          <p className="text-[11px] text-gray-400 mb-2">Your admins always get the final (3rd) nudge. Delegate it to more people per portal — a teammate or one of our experts (e.g. Econ-dev) — added or not, as many as you want.</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {managers.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700">
                {m}
                <button onClick={() => setManagers((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${m}`} className="text-indigo-300 hover:text-rose-600">✕</button>
              </span>
            ))}
            {managers.length === 0 && <span className="text-[11px] text-gray-400">No delegates yet — the final notice still goes to your admins.</span>}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newManager}
              onChange={(e) => setNewManager(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newManager.trim()) { setManagers((c) => [...c, newManager.trim()]); setNewManager(''); } }}
              placeholder="manager@company.com or expert@rfppipeline.com"
              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5"
            />
            <button onClick={() => { if (newManager.trim()) { setManagers((c) => [...c, newManager.trim()]); setNewManager(''); } }} className="text-xs font-medium px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200">Add manager</button>
          </div>
        </div>

        {/* Nudges */}
        <div className="mt-5">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Nudges</h3>
          <p className="text-[11px] text-gray-400 mb-2">Up to 3 reminders (days before due, at least 1). The last is the final notice — it goes to your admins plus any delegated managers. Leave empty for none.</p>
          <div className="flex items-center gap-1.5">
            {nudges.map((d, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <input type="number" min={1} value={d} onChange={(e) => setNudges((cur) => cur.map((v, j) => (j === i ? Math.max(1, Number(e.target.value) || 1) : v)))} className="w-14 text-xs border border-gray-200 rounded px-1 py-1" />
                <span className="text-[11px] text-gray-400">d{i === nudges.length - 1 ? ' · final' : ''}</span>
                <button onClick={() => setNudges((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove nudge" className="text-gray-300 hover:text-rose-600 text-sm">✕</button>
              </span>
            ))}
            {nudges.length < 3 && (
              <button onClick={() => setNudges((cur) => [...cur, 1])} className="text-xs text-indigo-600 hover:underline ml-1">+ Add nudge</button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded hover:bg-gray-50">Cancel</button>
          <button
            onClick={launch}
            disabled={launching || !valid}
            className="text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded px-4 py-1.5 disabled:opacity-50"
            title={valid ? undefined : 'Each included phase needs at least one ToDo'}
          >
            {launching ? 'Launching…' : 'Launch build'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
