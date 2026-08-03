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
  /** Soft-archive watermark (mig 148) — non-null ⇔ archived. Null/absent in the active view. */
  archivedAt?: string | null;
  /** Per-bucket ranking array — one card, N scoring lenses (mig 096 · bucket id·name·summary·score). */
  rankings?: { bucketId: string; name: string; summary: string | null; score: number }[];
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
  const [showArchived, setShowArchived] = useState(false);
  const [purchaseCard, setPurchaseCard] = useState<Card | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('pinned');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Soft-archive is its own axis: the Archived view (?archived=true) shows ONLY archived
      // cards; the active view hides them. `includeClosed` (opp lifecycle) only applies to active.
      const qs = new URLSearchParams();
      if (showArchived) qs.set('archived', 'true');
      else if (includeClosed) qs.set('includeClosed', 'true');
      const q = qs.toString();
      const res = await fetch(`/api/portal/${tenantSlug}/cards${q ? `?${q}` : ''}`);
      if (res.ok) { setCards((await res.json()).data?.cards ?? []); setErr(null); }
      else setErr('Could not load your opportunity cards.');
    } catch { setErr('Could not load your opportunity cards.'); } finally { setLoading(false); }
  }, [tenantSlug, includeClosed, showArchived]);

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

  /** Soft-archive / restore a card (tenant_admin+). Reversible, per docs/ARCHIVABLE_CONTRACT.md. */
  const archiveAct = useCallback(async (opp: string, action: 'archive' | 'restore') => {
    setBusy(opp); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/cards/${opp}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'That action could not be completed — please try again.');
        return;
      }
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
        <div className="inline-flex rounded-md border border-gray-200 overflow-hidden" role="group" aria-label="View active or archived opportunities">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            aria-pressed={!showArchived}
            className={`px-2.5 py-1 text-xs font-medium ${!showArchived ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >Active</button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            aria-pressed={showArchived}
            className={`px-2.5 py-1 text-xs font-medium border-l border-gray-200 ${showArchived ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >Archived</button>
        </div>
        {!showArchived && (
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include closed
          </label>
        )}
        <button onClick={load} className="text-blue-600 hover:underline">Refresh</button>
        <span className="text-gray-400">· {cards.length} {showArchived ? 'archived' : 'cards'}</span>
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
          <p className="text-lg">{showArchived ? 'No archived opportunities.' : 'No opportunities yet.'}</p>
          <p className="text-sm mt-1">{showArchived ? 'Cards you archive are hidden from your active pipeline and can be restored here anytime.' : 'Cards appear here as the RFP team releases opportunities.'}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((c) => (
          <div key={c.id} className={`border rounded-xl p-4 bg-white ${showArchived ? 'opacity-80 border-gray-200' : c.isPinned ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'}`}>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800">{str(c, 'title') ?? 'Untitled opportunity'}</h3>
              {STAGE_BADGE[c.submissionStage] && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${STAGE_BADGE[c.submissionStage].cls}`}>{STAGE_BADGE[c.submissionStage].label}</span>
              )}
            </div>
            <p className="text-xs text-gray-500">{str(c, 'agency') ?? '—'}{str(c, 'programType') ? ` · ${str(c, 'programType')}` : ''}</p>
            {str(c, 'closeDate') && <p className="text-[11px] text-gray-400 mt-1">Closes {new Date(str(c, 'closeDate') as string).toLocaleDateString()}</p>}
            {showArchived && c.archivedAt && <p className="text-[11px] text-gray-400 mt-1">Archived {new Date(c.archivedAt).toLocaleDateString()}</p>}
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
            {!showArchived && c.pinUpdateAvailable && (
              <div className="mt-2 flex items-center justify-between rounded bg-amber-50 border border-amber-200 px-2 py-1">
                <span className="text-[11px] text-amber-700">Update available</span>
                <button disabled={busy === c.opportunityId} onClick={() => act(c.opportunityId, 'POST', '?action=resync')} className="text-[11px] font-medium text-amber-800 hover:underline">Resync</button>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              {showArchived ? (
                <button
                  disabled={busy === c.opportunityId}
                  onClick={() => archiveAct(c.opportunityId, 'restore')}
                  className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1 disabled:opacity-50"
                >{busy === c.opportunityId ? '…' : 'Restore'}</button>
              ) : c.isPinned ? (
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
              {!showArchived && (
                <button
                  disabled={busy === c.opportunityId}
                  onClick={() => archiveAct(c.opportunityId, 'archive')}
                  title="Archive — hide from your active pipeline (reversible)"
                  className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1"
                >Archive</button>
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
