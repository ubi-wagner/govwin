'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STAGE_LABEL, allowedTransitions, isSubmissionStage, type SubmissionStage } from '@/lib/lifecycle';

export interface MasterCard {
  opportunityId: string;
  title: string | null;
  agency: string | null;
  office: string | null;
  orgUnit: string | null;
  programType: string | null;
  solicitationNumber: string | null;
  topicNumber: string | null;
  lifecycleStatus: string | null;
  submissionStage: string | null;
  isActive: boolean;
  closeDate: string | null;
  postedDate: string | null;
  preReleaseDate: string | null;
  openDate: string | null;
  ingestedAt: string;
  oppUpdatedAt: string | null;
  releasedByEmail: string | null;
  releasedAt: string | null;
  expertNotes: string | null;
  solicitationId: string | null;
  curationStatus: string | null;
  namespace: string | null;
  curationUpdatedAt: string | null;
  pageLimitTechnical: number | null;
  pageLimitCost: number | null;
  submissionFormat: string | null;
  volumeCount: number;
  itemCount: number;
  bridgeVersion: number | null;
  lastPublishedAt: string | null;
  bridgeEvent: string | null;
  replicantCount: number;
  pinnedCount: number;
}

type SortKey = 'ingestedAt' | 'lastUpdate' | 'title' | 'curationStatus' | 'stage' | 'matrix' | 'bridgeVersion' | 'replicantCount' | 'closeDate';
type SortDir = 'asc' | 'desc';

const CURATION_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  claimed: 'bg-yellow-100 text-yellow-700',
  curation_in_progress: 'bg-orange-100 text-orange-700',
  review_requested: 'bg-purple-100 text-purple-700',
  approved: 'bg-teal-100 text-teal-700',
  pushed_to_pipeline: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-500',
};
const STAGE_COLORS: Record<string, string> = {
  nofo: 'bg-slate-100 text-slate-700',
  pre_release: 'bg-indigo-100 text-indigo-700',
  open: 'bg-green-100 text-green-700',
  updated: 'bg-blue-100 text-blue-700',
  closed: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
};
const STAGE_RANK: Record<string, number> = { nofo: 0, pre_release: 1, open: 2, updated: 3, closed: 4, archived: 5 };

const ms = (s: string | null): number => (s ? new Date(s).getTime() : 0);
const lastUpdateMs = (c: MasterCard): number => Math.max(ms(c.ingestedAt), ms(c.oppUpdatedAt), ms(c.curationUpdatedAt), ms(c.lastPublishedAt));
const fmtDate = (s: string | null): string => (s ? new Date(s).toLocaleDateString() : '—');
const fmtDateTime = (s: string | null): string => (s ? new Date(s).toLocaleString() : '—');
// ms-based formatters — guard against NaN/0 so a missing timestamp never throws (new Date(NaN).toISOString()).
const fmtMs = (n: number): string => (Number.isFinite(n) && n > 0 ? new Date(n).toLocaleDateString() : '—');
const fmtMsTime = (n: number): string => (Number.isFinite(n) && n > 0 ? new Date(n).toLocaleString() : '—');

export function MasterCards({ cards }: { cards: MasterCard[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('ingestedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Move a card through the canonical 6-state lifecycle. Fans out to tenant cards
  // server-side (lib/lifecycle transitions are enforced there too).
  const changeStage = useCallback(async (oppId: string, toStage: SubmissionStage) => {
    setBusy(oppId); setErr(null);
    try {
      const res = await fetch(`/api/admin/opportunities/${oppId}/lifecycle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_stage', toStage }),
      });
      if (res.ok) router.refresh();
      else { const j = await res.json().catch(() => ({})); setErr((j as { error?: string }).error || 'Stage change failed'); }
    } catch { setErr('Stage change failed'); } finally { setBusy(null); }
  }, [router]);

  // Auto-refresh every 30s (matches /admin/system-state) so the fan-out counts stay live.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  const toggleSort = useCallback((key: SortKey) => {
    // Pure setState calls — never nest setSortDir inside the setSortKey updater
    // (StrictMode double-invokes updaters, which would toggle the direction twice
    // and make a same-column re-sort a no-op in dev).
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      // New column: strings default asc, everything else desc (most-recent / most-first).
      setSortKey(key);
      setSortDir(key === 'title' || key === 'curationStatus' ? 'asc' : 'desc');
    }
  }, [sortKey]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? cards.filter((c) =>
          [c.title, c.agency, c.solicitationNumber, c.topicNumber, c.programType, c.namespace]
            .some((v) => v && v.toLowerCase().includes(needle)),
        )
      : cards.slice();

    const cmp = (a: MasterCard, b: MasterCard): number => {
      let d = 0;
      switch (sortKey) {
        case 'title': d = (a.title ?? '').localeCompare(b.title ?? ''); break;
        case 'curationStatus': d = (a.curationStatus ?? '').localeCompare(b.curationStatus ?? ''); break;
        case 'stage': d = (STAGE_RANK[a.submissionStage ?? ''] ?? -1) - (STAGE_RANK[b.submissionStage ?? ''] ?? -1); break;
        case 'matrix': d = (a.volumeCount * 1000 + a.itemCount) - (b.volumeCount * 1000 + b.itemCount); break;
        case 'bridgeVersion': d = (a.bridgeVersion ?? -1) - (b.bridgeVersion ?? -1); break;
        case 'replicantCount': d = a.replicantCount - b.replicantCount; break;
        case 'closeDate': d = ms(a.closeDate) - ms(b.closeDate); break;
        case 'lastUpdate': d = lastUpdateMs(a) - lastUpdateMs(b); break;
        case 'ingestedAt': default: d = ms(a.ingestedAt) - ms(b.ingestedAt); break;
      }
      return sortDir === 'asc' ? d : -d;
    };
    return filtered.sort(cmp);
  }, [cards, q, sortKey, sortDir]);

  const published = cards.filter((c) => c.bridgeVersion != null).length;
  const replicated = cards.filter((c) => c.replicantCount > 0).length;

  const Th = ({ label, k, className = '' }: { label: string; k?: SortKey; className?: string }) => (
    <th className={`px-3 py-2 font-medium ${k ? 'cursor-pointer select-none hover:text-gray-900' : ''} ${className}`} onClick={k ? () => toggleSort(k) : undefined}>
      {label}{k && sortKey === k && <span className="ml-1 text-gray-400">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by title, agency, solicitation #, topic, namespace…"
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-96 max-w-full"
        />
        <button onClick={() => router.refresh()} className="text-sm text-blue-600 hover:underline">Refresh</button>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          auto-refreshing 30s
        </span>
        <span className="text-xs text-gray-400 ml-auto">
          {rows.length} shown · {cards.length} total · {published} on bridge · {replicated} replicated
        </span>
      </div>
      {err && <p className="text-xs text-rose-600 -mt-1">{err}</p>}

      {cards.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">No opportunities ingested yet.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <Th label="Opportunity" k="title" />
                <Th label="Curation" k="curationStatus" />
                <Th label="Matrix" k="matrix" />
                <Th label="Bridge" k="bridgeVersion" />
                <Th label="Replicated" k="replicantCount" />
                <Th label="Stage" k="stage" />
                <Th label="Ingested" k="ingestedAt" className="whitespace-nowrap" />
                <Th label="Last update" k="lastUpdate" className="whitespace-nowrap" />
                <Th label="Close" k="closeDate" className="whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const cur = c.curationStatus ?? 'uncurated';
                const hasMatrix = c.volumeCount > 0 || c.itemCount > 0;
                return (
                  <tr key={c.opportunityId} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-3 py-2 max-w-xs">
                      <div className="font-medium text-gray-900 truncate" title={c.title ?? ''}>{c.title || 'Untitled'}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {[c.agency, c.office, c.orgUnit, c.programType].filter(Boolean).join(' · ') || '—'}
                        {c.topicNumber ? ` · ${c.topicNumber}` : c.solicitationNumber ? ` · ${c.solicitationNumber}` : ''}
                      </div>
                      {c.releasedByEmail && (
                        <div className="text-[10px] text-gray-400 truncate" title={`Released ${fmtDateTime(c.releasedAt)}`}>
                          released by {c.releasedByEmail}{c.releasedAt ? ` · ${fmtDate(c.releasedAt)}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${CURATION_COLORS[cur] ?? 'bg-gray-100 text-gray-500'}`}>
                        {cur.replace(/_/g, ' ')}
                      </span>
                      {c.namespace && <div className="text-[10px] text-gray-400 mt-0.5 font-mono truncate max-w-[9rem]" title={c.namespace}>{c.namespace}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {hasMatrix ? (
                        <div className="space-y-0.5">
                          <div>{c.volumeCount} vol · {c.itemCount} items</div>
                          {c.submissionFormat && <div className="text-gray-400">{c.submissionFormat}</div>}
                          {(c.pageLimitTechnical != null || c.pageLimitCost != null) && (
                            <div className="text-gray-400">≤{c.pageLimitTechnical ?? '–'}p tech / {c.pageLimitCost ?? '–'}p cost</div>
                          )}
                        </div>
                      ) : <span className="text-gray-300">— no matrix</span>}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {c.bridgeVersion != null
                        ? <span className="text-gray-700">v{c.bridgeVersion}<span className="text-gray-400"> · {c.bridgeEvent}</span></span>
                        : <span className="text-gray-300">not published</span>}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {c.replicantCount > 0
                        ? <span className="text-gray-700">{c.replicantCount} tenants{c.pinnedCount > 0 ? <span className="text-blue-600"> · {c.pinnedCount} pinned</span> : null}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const stage: SubmissionStage = isSubmissionStage(c.submissionStage) ? c.submissionStage : 'open';
                        const opts = allowedTransitions(stage);
                        return (
                          <div className="flex flex-col gap-1">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-600'}`}>{STAGE_LABEL[stage]}</span>
                            {opts.length > 0 && (
                              <select
                                aria-label="Change stage"
                                disabled={busy === c.opportunityId}
                                value=""
                                onChange={(e) => { if (isSubmissionStage(e.target.value)) changeStage(c.opportunityId, e.target.value); }}
                                className="text-[11px] border border-gray-200 rounded px-1 py-0.5 text-gray-500 max-w-[7.5rem] disabled:opacity-50"
                              >
                                <option value="">move →</option>
                                {opts.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                              </select>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap" title={fmtDateTime(c.ingestedAt)}>{fmtDate(c.ingestedAt)}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap" title={fmtMsTime(lastUpdateMs(c))}>{fmtMs(lastUpdateMs(c))}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(c.closeDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
