'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Role } from '@/lib/rbac';
import PurchaseModal from './purchase-modal';

interface Card {
  id: string;
  opportunityId: string;
  card: Record<string, unknown> | null;
  bridgeVersion: number;
  lifecycleStatus: string;
  submissionStage: string;
  pursuitStatus: string;
  isPinned: boolean;
  pinUpdateAvailable: boolean;
  /** Per-bucket ranking array — one card, N scoring lenses (mig 096 · bucket id·name·summary·score). */
  rankings?: { bucketId: string; name: string; summary: string | null; score: number }[];
  /** Latest opportunity_analyst assessment (its output.text is a match analysis); null until the agent runs. */
  fitOutput?: Record<string, unknown> | null;
}

/** Days until `dateStr` (negative if past); null when unparseable. */
const daysUntil = (dateStr: string | null): number | null => {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86_400_000) : null;
};
/** Urgency chip for the close date: red ≤3d, amber ≤14d, else gray; "Closed" once past. */
function closeChip(dateStr: string | null): { label: string; cls: string } | null {
  const d = daysUntil(dateStr);
  if (d === null) return null;
  if (d < 0) return { label: 'Closed', cls: 'bg-gray-100 text-gray-500' };
  if (d === 0) return { label: 'Closes today', cls: 'bg-rose-100 text-rose-700' };
  const label = `Closes in ${d}d`;
  if (d <= 3) return { label, cls: 'bg-rose-100 text-rose-700' };
  if (d <= 14) return { label, cls: 'bg-amber-100 text-amber-700' };
  return { label, cls: 'bg-gray-100 text-gray-500' };
}
/** Concise AI fit level from the analyst's output.text (matches its summarize_result buckets); null when absent. */
function fitFromOutput(out: unknown): { label: string; cls: string; full: string } | null {
  const text = out && typeof out === 'object' && typeof (out as { text?: unknown }).text === 'string' ? (out as { text: string }).text.trim() : '';
  if (!text) return null;
  if (/strong match/i.test(text)) return { label: 'Strong fit', cls: 'bg-emerald-100 text-emerald-700', full: text };
  if (/moderate match/i.test(text)) return { label: 'Moderate fit', cls: 'bg-blue-100 text-blue-700', full: text };
  if (/weak match/i.test(text)) return { label: 'Weak fit', cls: 'bg-amber-100 text-amber-700', full: text };
  if (/no match/i.test(text)) return { label: 'Low fit', cls: 'bg-gray-100 text-gray-500', full: text };
  return { label: 'AI fit noted', cls: 'bg-indigo-100 text-indigo-700', full: text };
}

type SortKey = 'pinned' | 'close' | 'agency' | 'title';
const SORT_LABELS: Record<SortKey, string> = { pinned: 'Pinned first', close: 'Close date', agency: 'Agency', title: 'Title' };

const str = (c: Card, k: string) => (c.card && typeof c.card[k] === 'string' ? (c.card[k] as string) : null);

/** Pinned cards always float to the top; then by the chosen key. */
function sortCards(cards: Card[], sortBy: SortKey): Card[] {
  return [...cards].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (sortBy === 'close') {
      const da = str(a, 'closeDate'); const db = str(b, 'closeDate');
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return new Date(da).getTime() - new Date(db).getTime();
    }
    if (sortBy === 'agency') return (str(a, 'agency') ?? '').localeCompare(str(b, 'agency') ?? '');
    if (sortBy === 'title') return (str(a, 'title') ?? '').localeCompare(str(b, 'title') ?? '');
    return 0;
  });
}

const STAGE_BADGE: Record<string, { label: string; cls: string }> = {
  nofo: { label: 'NOFO', cls: 'bg-slate-100 text-slate-600' },
  pre_release: { label: 'Pre-Release', cls: 'bg-indigo-100 text-indigo-700' },
  updated: { label: 'Updated', cls: 'bg-blue-100 text-blue-700' },
  closed: { label: 'Closed', cls: 'bg-amber-100 text-amber-700' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
};

export default function PipelineCards({ tenantSlug, role }: { tenantSlug: string; role: Role }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [includePassed, setIncludePassed] = useState(false);
  const [purchaseCard, setPurchaseCard] = useState<Card | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('pinned');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (includeClosed) qs.set('includeClosed', 'true');
      if (includePassed) qs.set('includePassed', 'true');
      const res = await fetch(`/api/portal/${tenantSlug}/cards${qs.toString() ? `?${qs}` : ''}`);
      if (res.ok) { setCards((await res.json()).data?.cards ?? []); setErr(null); }
      else setErr('Could not load your opportunity cards.');
    } catch { setErr('Could not load your opportunity cards.'); } finally { setLoading(false); }
  }, [tenantSlug, includeClosed, includePassed]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (opp: string, method: 'POST' | 'DELETE', qs = '') => {
    setBusy(opp); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/cards/${opp}/pin${qs}`, { method });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'That action could not be completed — please try again.');
        return;
      }
      await load();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(null); }
  }, [tenantSlug, load]);

  // Set pursuit intent — 'passed' = dismiss (drops out of the default feed), 'unreviewed' = restore.
  const setPursuit = useCallback(async (opp: string, status: string) => {
    setBusy(opp); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/cards/${opp}/pursuit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || 'That could not be completed — please try again.'); return; }
      await load();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(null); }
  }, [tenantSlug, load]);

  const sorted = useMemo(() => sortCards(cards, sortBy), [cards, sortBy]);

  return (
    <div>
      {err && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">{err}</div>
      )}
      <div className="flex items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed
        </label>
        <label className="flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={includePassed} onChange={(e) => setIncludePassed(e.target.checked)} /> Show passed
        </label>
        <button onClick={load} className="text-blue-600 hover:underline">Refresh</button>
        <span className="text-gray-400">· {cards.length} cards</span>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          aria-label="Sort opportunities"
          className="ml-auto text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-600"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>Sort: {SORT_LABELS[k]}</option>)}
        </select>
      </div>

      {loading && <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>}
      {!loading && cards.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No opportunities yet.</p>
          <p className="text-sm mt-1">Cards appear here as the RFP team releases opportunities.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((c) => (
          <div key={c.id} className={`border rounded-xl p-4 bg-white ${c.isPinned ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800">{str(c, 'title') ?? 'Untitled opportunity'}</h3>
              {STAGE_BADGE[c.submissionStage] && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${STAGE_BADGE[c.submissionStage].cls}`}>{STAGE_BADGE[c.submissionStage].label}</span>
              )}
            </div>
            <p className="text-xs text-gray-500">{str(c, 'agency') ?? '—'}{str(c, 'programType') ? ` · ${str(c, 'programType')}` : ''}</p>
            {(() => {
              const chip = closeChip(str(c, 'closeDate'));
              const fit = fitFromOutput(c.fitOutput);
              if (!chip && !fit) return null;
              return (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {chip && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${chip.cls}`} title={str(c, 'closeDate') ? `Closes ${new Date(str(c, 'closeDate') as string).toLocaleDateString()}` : undefined}>{chip.label}</span>}
                  {fit && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${fit.cls}`} title={fit.full}>✨ {fit.label}</span>}
                </div>
              );
            })()}
            {Array.isArray(c.rankings) && c.rankings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1" title="Ranked by your spotlight buckets">
                {c.rankings.slice(0, 4).map((r) => (
                  <span key={r.bucketId} title={r.summary ?? r.name}
                    className="inline-flex items-center gap-1 rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
                    <span className="font-medium text-gray-700">{r.name}</span>
                    <span className="tabular-nums text-gray-500">{Math.round(r.score)}</span>
                  </span>
                ))}
                {c.rankings.length > 4 && <span className="self-center text-[10px] text-gray-400">+{c.rankings.length - 4}</span>}
              </div>
            )}
            {c.pinUpdateAvailable && (
              <div className="mt-2 flex items-center justify-between rounded bg-amber-50 border border-amber-200 px-2 py-1">
                <span className="text-[11px] text-amber-700">Update available</span>
                <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'POST', '?action=resync')} className="text-[11px] font-medium text-amber-800 hover:underline">Resync</button>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              {c.isPinned ? (
                <>
                  <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 font-medium">Pinned</span>
                  <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'DELETE')} className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1">Unpin</button>
                  <button onClick={() => setPurchaseCard(c)} className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1">Purchase</button>
                </>
              ) : c.pursuitStatus === 'passed' ? (
                <>
                  <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500 font-medium">Passed</span>
                  <button disabled={busy === c.opportunityId} onClick={() => setPursuit(c.opportunityId, 'unreviewed')} className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2 py-1">Restore</button>
                </>
              ) : (
                <>
                  <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'POST')} className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1 disabled:opacity-50">
                    {busy === c.opportunityId ? '…' : 'Pin (copy docs)'}
                  </button>
                  <button disabled={busy === c.opportunityId} onClick={() => setPursuit(c.opportunityId, 'passed')} className="text-xs text-gray-400 hover:text-gray-700" title="Hide this from your feed — trains your matches">Not interested</button>
                </>
              )}
              <a href={`/portal/${tenantSlug}/portals?opp=${c.opportunityId}`} className="text-xs text-gray-600 hover:text-gray-900 ml-auto">Build →</a>
            </div>
          </div>
        ))}
      </div>

      {purchaseCard && (
        <PurchaseModal
          tenantSlug={tenantSlug}
          opportunityId={purchaseCard.opportunityId}
          title={str(purchaseCard, 'title') ?? 'Untitled opportunity'}
          onClose={() => setPurchaseCard(null)}
          onPurchased={() => {
            const opp = purchaseCard.opportunityId;
            setPurchaseCard(null);
            window.location.assign(`/portal/${tenantSlug}/portals?opp=${opp}`);
          }}
        />
      )}
    </div>
  );
}
