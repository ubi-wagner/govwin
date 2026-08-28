'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

/**
 * The risk and issue register.
 *
 * ── SORTED BY WHAT WOULD HURT, NOT BY WHEN IT WAS TYPED ──────────────────────────────────────
 * Open items first, worst score first — the order the server already returns. A register sorted by
 * creation date is one nobody reads past row three, which is the same as not having one.
 *
 * ── SCORE IS SHOWN AS A BAND, NOT A NUMBER ALONE ─────────────────────────────────────────────
 * "12" means nothing without the scale beside it. The colour band carries the judgement and the
 * number carries the precision, so a reader scanning the list gets the first without doing
 * arithmetic and a reader stopping on a row gets the second.
 *
 * ── AN ISSUE KEEPS ITS SCORE ─────────────────────────────────────────────────────────────────
 * It reads oddly — the thing happened, so probability is moot — but "we rated this a 20 and it
 * landed" is exactly what a program review wants to see, and blanking it would erase the register's
 * only claim to having been useful.
 *
 * Mobile-first, like the rest of the workspace.
 */
export interface RegisterRisk {
  id: string;
  title: string;
  detail: string | null;
  kind: 'risk' | 'issue';
  status: 'open' | 'closed';
  probability: number;
  impact: number;
  score: number;
  ownerEmail: string | null;
  mitigation: string | null;
  contingency: string | null;
  reviewOn: string | null;
  closedNote: string | null;
}

/** 1–25. The bands are the ones a program review argues in, not an even split. */
function band(score: number): { label: string; cls: string } {
  if (score >= 15) return { label: 'high', cls: 'bg-red-50 text-red-800 ring-red-600/30' };
  if (score >= 8) return { label: 'medium', cls: 'bg-amber-50 text-amber-900 ring-amber-600/30' };
  return { label: 'low', cls: 'bg-gray-100 text-gray-700 ring-gray-500/20' };
}

export function RiskRegister({
  risks, members, basePath, canClose,
}: {
  risks: RegisterRisk[];
  members: { id: string; email: string }[];
  basePath: string;
  canClose: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [probability, setProbability] = useState('3');
  const [impact, setImpact] = useState('3');
  const [owner, setOwner] = useState('');
  const [mitigation, setMitigation] = useState('');
  const [asIssue, setAsIssue] = useState(false);

  async function post(path: string, body: unknown, method: 'POST' | 'PATCH', okMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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

  async function raise() {
    if (!title.trim()) return;
    const ok = await post(`${basePath}/risks`, {
      title: title.trim(), probability: Number(probability), impact: Number(impact),
      ownerUserId: owner || null, mitigation: mitigation.trim() || null, asIssue,
    }, 'POST', asIssue ? 'Issue logged' : 'Risk raised');
    if (ok) { setAdding(false); setTitle(''); setOwner(''); setMitigation(''); setAsIssue(false); }
  }

  const open = risks.filter((r) => r.status === 'open');
  const closed = risks.filter((r) => r.status === 'closed');

  const row = (r: RegisterRisk) => {
    const b = band(r.score);
    return (
      <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
        <span
          title={`probability ${r.probability} × impact ${r.impact}`}
          className={`inline-flex shrink-0 items-center gap-1 self-start rounded px-1.5 py-0.5 text-[11px] tabular-nums ring-1 ring-inset ${b.cls}`}
        >
          {r.score} · {b.label}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`text-sm ${r.status === 'closed' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
              {r.title}
            </span>
            {r.kind === 'issue' && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-800 ring-1 ring-inset ring-red-600/30">
                it happened
              </span>
            )}
            {r.ownerEmail && (
              <span title={r.ownerEmail} className="max-w-[11rem] truncate rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 sm:max-w-none">
                {r.ownerEmail}
              </span>
            )}
            {r.reviewOn && (
              <span className="text-[11px] text-gray-500">review {String(r.reviewOn).slice(0, 10)}</span>
            )}
          </div>
          {r.mitigation && <p className="text-xs text-gray-600">Mitigation: {r.mitigation}</p>}
          {r.closedNote && <p className="text-xs text-gray-500">Closed: {r.closedNote}</p>}
        </div>
        {r.status === 'open' && (
          <span className="flex shrink-0 flex-wrap gap-2">
            {r.kind === 'risk' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void post(`${basePath}/risks/${r.id}`, { action: 'raise_issue' }, 'PATCH', 'Logged as an issue')}
                className="rounded border border-red-700 px-1.5 py-0.5 text-[11px] text-red-800 hover:bg-red-50 disabled:opacity-50"
              >
                It happened
              </button>
            )}
            {canClose && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const note = window.prompt('Closing note — what changed?')?.trim();
                  if (note === undefined) return;
                  void post(`${basePath}/risks/${r.id}`, { action: 'close', note: note || null }, 'PATCH', 'Closed');
                }}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Close
              </button>
            )}
          </span>
        )}
      </li>
    );
  };

  return (
    <div>
      {open.length === 0 && closed.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
          Nothing on the register. A risk raised early is cheaper than an issue found late.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {open.map(row)}
          {closed.map(row)}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What could go wrong?"
            aria-label="Risk title"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
            <label className="text-[11px] text-gray-600">
              Probability
              <select
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
                aria-label="Probability, 1 to 5"
                className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-gray-600">
              Impact
              <select
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                aria-label="Impact, 1 to 5"
                className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-gray-600">
              Owner
              <select
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                aria-label="Who watches this risk"
                className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs sm:w-auto"
              >
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
            </label>
            {/* The score, live. It is `probability × impact` on the server too — a GENERATED
                column — so this cannot drift from what gets stored. */}
            <span className="self-end text-[11px] text-gray-500">
              score <span className="font-medium tabular-nums">{Number(probability) * Number(impact)}</span>
              {' · '}{band(Number(probability) * Number(impact)).label}
            </span>
          </div>
          <input
            value={mitigation}
            onChange={(e) => setMitigation(e.target.value)}
            placeholder="What would stop it?"
            aria-label="Mitigation"
            className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-xs"
          />
          <label className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
            <input type="checkbox" checked={asIssue} onChange={(e) => setAsIssue(e.target.checked)} />
            This has already happened — log it as an issue
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => void raise()}
              className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {asIssue ? 'Log the issue' : 'Raise the risk'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 text-xs text-blue-700 hover:underline">
          + Raise a risk or log an issue
        </button>
      )}
    </div>
  );
}
