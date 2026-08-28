'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The amendment history — and the only way to change a CLIN.
 *
 * ── WHAT A ROW HAS TO SHOW ───────────────────────────────────────────────────────────────────
 * Not "P00002 executed". Every change is rendered as **old → new**, because the question a person
 * brings to this panel is always some form of "when did the money change, and to what". A log that
 * shows only the current state is a log that answers nothing the CLIN table does not already.
 *
 * ── DRAFT LOOKS DIFFERENT, ON PURPOSE ────────────────────────────────────────────────────────
 * A draft is a proposal: nothing it says has happened. It sits above the executed ones with an
 * amber ring and an Execute button, and its change rows read as "will set", not "set". Making a
 * draft look like a record is how somebody comes to believe the contract already moved.
 *
 * ── AND EXECUTING ASKS FOR A DATE ────────────────────────────────────────────────────────────
 * Not `now()`. Mods are entered days or weeks after they are signed, and stamping the moment
 * somebody typed it in makes "when did the contract change" permanently unanswerable. The field
 * defaults to today and is editable, which is the honest arrangement.
 *
 * Mobile-first, like the rest of the workspace.
 */
export interface LoggedChange {
  id: string;
  action: 'amend' | 'add_clin';
  clinId: string | null;
  /** Optional because the lib's row type is: the LEFT JOIN can miss, and a change on a CLIN
   *  that was later deleted has no number. Widened rather than cast away at the call site —
   *  an `as unknown as` on the prop is how the date-type bug reached three of these panels. */
  clinNumber?: string | null;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  payload: Record<string, unknown>;
  appliedAt: string | null;
}

export interface LoggedModification {
  id: string;
  modNumber: string;
  title: string;
  description: string | null;
  kind: string;
  status: 'draft' | 'executed';
  executedOn: string | null;
  sourceDocId: string | null;
  changes?: LoggedChange[];
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  contract_type: 'Contract type',
  pop_start: 'Period start',
  pop_end: 'Period end',
  funded_amount: 'Funded amount',
};

const KIND_CLASS: Record<string, string> = {
  funding: 'bg-emerald-50 text-emerald-800 ring-emerald-600/30',
  scope: 'bg-indigo-50 text-indigo-800 ring-indigo-600/30',
  schedule: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  termination: 'bg-red-50 text-red-800 ring-red-600/30',
  administrative: 'bg-gray-100 text-gray-700 ring-gray-500/20',
};

/** Money as a person reads it; everything else as it was stored. */
function show(field: string | null, v: string | null): string {
  if (v === null || v === '') return '—';
  if (field === 'funded_amount') {
    const n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : v;
  }
  // A `date` column can arrive as a full timestamp; trim it to the day rather than showing a
  // person a time nobody entered. Never slice a Date's STRING form — these are text off the change
  // row, which is why a plain prefix test is safe here and is not elsewhere.
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : String(v);
}

export function ModificationLog({
  modifications, clins, documents, basePath, canAmend,
}: {
  modifications: LoggedModification[];
  clins: { id: string; clinNumber: string; title: string }[];
  documents: { id: string; filename: string }[];
  basePath: string;
  canAmend: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [modNumber, setModNumber] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('funding');
  const [sourceDocId, setSourceDocId] = useState('');
  const [clinId, setClinId] = useState('');
  const [field, setField] = useState('funded_amount');
  const [newValue, setNewValue] = useState('');
  // Executing is per-row, so the open date field is keyed by the mod it belongs to. One shared
  // `executeDate` would type into every row at once.
  const [executing, setExecuting] = useState<string | null>(null);
  const [executedOn, setExecutedOn] = useState('');

  async function send(path: string, body: unknown, method: 'POST' | 'PATCH' | 'DELETE', okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: method === 'DELETE' ? {} : { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json?.error ?? 'Could not do that', 'error'); return false; }
      toast(okMsg, 'success');
      router.refresh();
      return true;
    } catch {
      toast('Could not do that', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function draft() {
    if (!modNumber.trim() || !title.trim()) return;
    const changes = kind === 'administrative' || !clinId
      ? []
      : [{ action: 'amend' as const, clinId, field, newValue }];
    const ok = await send(`${basePath}/modifications`, {
      modNumber: modNumber.trim(), title: title.trim(), kind,
      sourceDocId: sourceDocId || null, changes,
    }, 'POST', 'Modification drafted — nothing has changed yet');
    if (ok) { setAdding(false); setModNumber(''); setTitle(''); setNewValue(''); setClinId(''); }
  }

  async function execute(id: string) {
    const ok = await send(`${basePath}/modifications`, {
      action: 'execute', modificationId: id, executedOn: executedOn || undefined,
    }, 'PATCH', 'Modification executed — the contract has moved');
    if (ok) { setExecuting(null); setExecutedOn(''); }
  }

  const drafts = modifications.filter((m) => m.status === 'draft');
  const executed = modifications.filter((m) => m.status === 'executed');

  const changeRow = (c: LoggedChange, applied: boolean) => (
    <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      {c.action === 'add_clin' ? (
        <>
          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-800 ring-1 ring-inset ring-indigo-600/30">
            {applied ? 'new CLIN' : 'will add CLIN'}
          </span>
          <span className="text-gray-900">
            {String(c.payload?.clinNumber ?? c.clinNumber ?? '')} — {String(c.payload?.title ?? '')}
          </span>
        </>
      ) : (
        <>
          <span className="text-gray-500">
            CLIN {c.clinNumber ?? '—'} · {FIELD_LABEL[c.field ?? ''] ?? c.field}
          </span>
          {/* Old → new. The whole reason a person opens this panel. On a draft there is no old
              value yet — it is read at execution, from whatever is standing then — so the row
              says what it WILL set rather than inventing a before. */}
          {applied ? (
            <span className="tabular-nums text-gray-900">
              <span className="text-gray-500 line-through">{show(c.field, c.oldValue)}</span>
              {' → '}
              <span className="font-medium">{show(c.field, c.newValue)}</span>
            </span>
          ) : (
            <span className="tabular-nums text-gray-700">will set {show(c.field, c.newValue)}</span>
          )}
        </>
      )}
    </li>
  );

  const card = (m: LoggedModification) => {
    const isDraft = m.status === 'draft';
    return (
      <li
        key={m.id}
        className={`space-y-2 rounded border px-3 py-3 ${
          isDraft ? 'border-amber-300 bg-amber-50/40 ring-1 ring-inset ring-amber-600/20' : 'border-gray-200'
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-sm font-medium text-gray-900">{m.modNumber}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${KIND_CLASS[m.kind] ?? KIND_CLASS.administrative}`}
          >
            {m.kind}
          </span>
          {isDraft ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900">
              draft — not yet in effect
            </span>
          ) : (
            <span className="text-[11px] text-gray-500">
              executed {String(m.executedOn ?? '').slice(0, 10)}
            </span>
          )}
        </div>

        <p className="text-sm text-gray-900">{m.title}</p>
        {m.description && <p className="text-xs text-gray-600">{m.description}</p>}

        {(m.changes?.length ?? 0) > 0 ? (
          <ul className="space-y-0.5 border-l-2 border-gray-200 pl-3">
            {m.changes!.map((c) => changeRow(c, !isDraft))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">No change to the contract line items.</p>
        )}

        {isDraft && canAmend && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {executing === m.id ? (
              <>
                <label className="text-[11px] text-gray-600">
                  Signed on
                  <input
                    type="date"
                    value={executedOn}
                    onChange={(e) => setExecutedOn(e.target.value)}
                    className="ml-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !executedOn}
                  onClick={() => void execute(m.id)}
                  className="rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  Execute
                </button>
                <button
                  type="button"
                  onClick={() => { setExecuting(null); setExecutedOn(''); }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setExecuting(m.id);
                    // Defaults to today and stays editable. A mod entered a fortnight after it was
                    // signed must carry the date it was signed, not the date it was typed.
                    setExecutedOn(new Date().toISOString().slice(0, 10));
                  }}
                  className="rounded border border-gray-900 px-2 py-1 text-xs text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                >
                  Execute…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Discard draft modification ${m.modNumber}?`)) return;
                    void send(`${basePath}/modifications?modificationId=${m.id}`, null, 'DELETE', 'Draft discarded');
                  }}
                  className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
                >
                  Discard
                </button>
              </>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">Contract modifications</h2>
          <p className="text-xs text-gray-500">
            The only way a CLIN changes. Executing applies the changes and cites the signed document.
          </p>
        </div>
        {canAmend && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {adding ? 'Cancel' : 'Record a modification'}
          </button>
        )}
      </header>

      {adding && canAmend && (
        <div className="space-y-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={modNumber}
              onChange={(e) => setModNumber(e.target.value)}
              placeholder="P00001"
              className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm sm:w-32"
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What the modification does"
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-40"
            >
              {['funding', 'scope', 'schedule', 'administrative', 'termination'].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={sourceDocId}
              onChange={(e) => setSourceDocId(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">Signed document — attach before executing</option>
              {documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </select>
          </div>

          {kind !== 'administrative' && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={clinId}
                onChange={(e) => setClinId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-48"
              >
                <option value="">Which CLIN…</option>
                {clins.map((c) => <option key={c.id} value={c.id}>{c.clinNumber} — {c.title}</option>)}
              </select>
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm sm:w-44"
              >
                {Object.entries(FIELD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                type={field === 'pop_start' || field === 'pop_end' ? 'date' : 'text'}
                placeholder="New value"
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !modNumber.trim() || !title.trim()}
              onClick={() => void draft()}
              className="rounded bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Save as draft
            </button>
            <span className="text-[11px] text-gray-500">
              Nothing changes until you execute it.
            </span>
          </div>
        </div>
      )}

      {modifications.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500">
          No modifications. The contract is as awarded.
        </p>
      ) : (
        <ul className="space-y-2 px-4 py-3">
          {drafts.map(card)}
          {executed.map(card)}
        </ul>
      )}
    </section>
  );
}
