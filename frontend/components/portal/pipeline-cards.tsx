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
  const [includeClosed, setIncludeClosed] = useState(false);
  const [purchaseCard, setPurchaseCard] = useState<Card | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('pinned');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/cards${includeClosed ? '?includeClosed=true' : ''}`);
      if (res.ok) setCards((await res.json()).data?.cards ?? []);
    } catch { /* keep */ } finally { setLoading(false); }
  }, [tenantSlug, includeClosed]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (opp: string, method: 'POST' | 'DELETE', qs = '') => {
    setBusy(opp);
    try {
      await fetch(`/api/portal/${tenantSlug}/cards/${opp}/pin${qs}`, { method });
      await load();
    } catch { /* ignore */ } finally { setBusy(null); }
  }, [tenantSlug, load]);

  const sorted = useMemo(() => sortCards(cards, sortBy), [cards, sortBy]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-1.5 text-gray-600">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed
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
            {str(c, 'closeDate') && <p className="text-[11px] text-gray-400 mt-1">Closes {new Date(str(c, 'closeDate') as string).toLocaleDateString()}</p>}
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
              ) : (
                <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'POST')} className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1 disabled:opacity-50">
                  {busy === c.opportunityId ? '…' : 'Pin (copy docs)'}
                </button>
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
