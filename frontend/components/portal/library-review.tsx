'use client';

/**
 * Library Review — the deterministic librarian, surfaced. Fetches /atoms/review and shows
 * DUPLICATES (with a one-click "archive the extras") and QUALITY flags (empty / tiny /
 * untagged / unconfirmed), so a tenant can de-bloat + quality-gate the library in one place.
 * Cleanup reuses the audited archive route (POST …/atoms/[id]/archive), so every action posts
 * a library:atom.archived event. Read-only compute; nothing is auto-deleted (soft-archive).
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import type { LibraryReview as Review, FlagKind, LibrarianAction } from '@/lib/atom-review';

const FLAG_META: Record<FlagKind, { label: string; tone: string; archivable: boolean }> = {
  empty:       { label: 'Empty',        tone: 'text-rose-700 bg-rose-50 border-rose-200',      archivable: true },
  tiny:        { label: 'Too short',    tone: 'text-amber-700 bg-amber-50 border-amber-200',   archivable: true },
  untagged:    { label: 'Untagged',     tone: 'text-indigo-700 bg-indigo-50 border-indigo-200', archivable: false },
  unconfirmed: { label: 'Unconfirmed tags', tone: 'text-sky-700 bg-sky-50 border-sky-200',     archivable: false },
};

const ACTION_META: Record<LibrarianAction, { label: string; tone: string }> = {
  keep:   { label: 'keep',   tone: 'bg-emerald-100 text-emerald-700' },
  retag:  { label: 'retag',  tone: 'bg-indigo-100 text-indigo-700' },
  merge:  { label: 'merge',  tone: 'bg-amber-100 text-amber-700' },
  reject: { label: 'reject', tone: 'bg-rose-100 text-rose-700' },
};
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export function LibraryReview({ tenantSlug }: { tenantSlug: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/atoms/review`, { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.data) { setState('error'); return; }
      setReview(j.data as Review);
      setState('ready');
    } catch { setState('error'); }
  }, [tenantSlug]);

  useEffect(() => { load(); }, [load]);

  const archive = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    let ok = 0;
    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch(`/api/portal/${tenantSlug}/atoms/${id}/archive`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }),
        });
        if (r.ok) ok++;
      } catch { /* keep going */ }
    }
    setBusy(false);
    if (ok) { toast.success(`Archived ${ok} atom${ok > 1 ? 's' : ''}.`); load(); }
    else toast.error('Nothing was archived.');
  }, [tenantSlug, load]);

  if (state === 'loading') return <div className="py-16 text-center text-sm text-gray-400 animate-pulse">Reviewing your library…</div>;
  if (state === 'error') return <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center text-sm text-rose-600">Could not review the library. Try reloading.</div>;
  if (!review) return null;

  const { duplicateGroups, flags, stats, librarian } = review;
  const flagsByKind = (['empty', 'tiny', 'untagged', 'unconfirmed'] as FlagKind[])
    .map((k) => ({ kind: k, items: flags.filter((f) => f.kind === k) }))
    .filter((g) => g.items.length > 0);
  const nothing = duplicateGroups.length === 0 && flags.length === 0 && !librarian;

  return (
    <div className="space-y-6">
      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: stats.total, l: 'Atoms', c: 'text-gray-900' },
          { n: stats.duplicateAtoms, l: 'Duplicate copies', c: stats.duplicateAtoms ? 'text-amber-600' : 'text-gray-400' },
          { n: stats.flagged, l: 'Quality flags', c: stats.flagged ? 'text-rose-600' : 'text-gray-400' },
          { n: stats.clean, l: 'Clean', c: 'text-emerald-600' },
        ].map((s) => (
          <div key={s.l} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className={`text-2xl font-bold tabular-nums ${s.c}`}>{s.n}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Librarian — the pipeline agent's richer AI catalog, when a result has been persisted. */}
      {librarian && (
        <section className="border border-violet-200 bg-violet-50/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-violet-900">✦ Librarian — AI catalog
              <span className="ml-2 text-[11px] font-normal text-violet-500">{librarian.assessments.length} assessed · advisory</span>
            </h3>
            {librarian.recommendedRejectIds.length > 0 && (
              <button onClick={() => archive(librarian.recommendedRejectIds)} disabled={busy}
                className="text-xs px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                Archive {librarian.recommendedRejectIds.length} recommended reject{librarian.recommendedRejectIds.length > 1 ? 's' : ''}
              </button>
            )}
          </div>
          {librarian.packageNotes && <p className="text-xs text-violet-800 mb-2 italic">“{librarian.packageNotes}”</p>}
          <ul className="space-y-1.5">
            {librarian.assessments.slice(0, 40).map((a) => {
              const meta = a.action ? ACTION_META[a.action] : null;
              return (
                <li key={a.atomId} className="bg-white border border-violet-100 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    {meta && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${meta.tone}`}>{meta.label}</span>}
                    <span className="text-sm text-gray-800 truncate flex-1">{a.title || '(untitled)'}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0">Q {pct(a.qualityScore)} · R {pct(a.relevanceScore)}{a.freshness ? ` · ${a.freshness}` : ''}</span>
                    {a.action === 'reject' && <button onClick={() => archive([a.atomId])} disabled={busy} className="text-[11px] text-rose-600 hover:underline shrink-0">archive</button>}
                  </div>
                  {a.reason && <p className="text-[11px] text-gray-500 mt-0.5">{a.reason}</p>}
                </li>
              );
            })}
            {librarian.assessments.length > 40 && <li className="text-[11px] text-violet-400">+ {librarian.assessments.length - 40} more</li>}
          </ul>
          <p className="text-[10px] text-violet-400 mt-2">From the pipeline librarian agent · advisory only — nothing is applied automatically.</p>
        </section>
      )}

      {nothing && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-8 text-center">
          <div className="text-emerald-700 font-medium">Your library is clean.</div>
          <div className="text-sm text-emerald-600 mt-1">No duplicates or quality flags found.</div>
        </div>
      )}

      {/* Duplicates */}
      {duplicateGroups.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900">Duplicates <span className="text-gray-400 font-normal">· {duplicateGroups.length} group{duplicateGroups.length > 1 ? 's' : ''}</span></h3>
            <button
              onClick={() => archive(duplicateGroups.flatMap((g) => g.atoms.slice(1).map((a) => a.id)))}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >Archive all extras ({stats.duplicateAtoms})</button>
          </div>
          <div className="space-y-2">
            {duplicateGroups.map((g) => (
              <div key={g.key} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">{g.atoms.length} identical copies</span>
                  <button onClick={() => archive(g.atoms.slice(1).map((a) => a.id))} disabled={busy}
                    className="text-xs text-amber-700 hover:underline disabled:opacity-50">Keep the first, archive {g.atoms.length - 1}</button>
                </div>
                <ol className="space-y-1">
                  {g.atoms.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-2 text-sm">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${i === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{i === 0 ? 'keep' : 'extra'}</span>
                      <span className="truncate flex-1">{a.title || '(untitled)'}</span>
                      <span className="text-[11px] text-gray-400 tabular-nums">{a.wordCount}w · {a.status}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quality flags */}
      {flagsByKind.map(({ kind, items }) => {
        const meta = FLAG_META[kind];
        return (
          <section key={kind}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900">
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${meta.tone} mr-2`}>{meta.label}</span>
                <span className="text-gray-400 font-normal">{items.length}</span>
              </h3>
              {meta.archivable && (
                <button onClick={() => archive(items.map((f) => f.atomId))} disabled={busy}
                  className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">Archive all {items.length}</button>
              )}
            </div>
            <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {items.slice(0, 40).map((f) => (
                <li key={f.atomId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="truncate flex-1">{f.title || '(untitled)'}</span>
                  <span className="text-[11px] text-gray-400">{f.detail}</span>
                  {meta.archivable && (
                    <button onClick={() => archive([f.atomId])} disabled={busy} className="text-[11px] text-rose-600 hover:underline disabled:opacity-50">archive</button>
                  )}
                </li>
              ))}
              {items.length > 40 && <li className="px-3 py-2 text-[11px] text-gray-400">+ {items.length - 40} more</li>}
            </ul>
            {!meta.archivable && (
              <p className="text-[11px] text-gray-400 mt-1">These hold real content — tag them in the Library tab so they are findable and reusable.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
