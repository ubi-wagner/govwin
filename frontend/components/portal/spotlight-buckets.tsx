'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Bucket { id: string; name: string; description: string | null; criteria: Record<string, unknown> }
interface RankedRow { opportunityId: string; score: number; factors: Record<string, number>; card: Record<string, unknown> | null; isPinned: boolean }

export default function SpotlightBuckets({ tenantSlug, canEdit }: { tenantSlug: string; canEdit: boolean }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [ranked, setRanked] = useState<RankedRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reranking, setReranking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  // Tracks which bucket the pipeline poll should still write to, so switching
  // buckets (or deleting the open one) cancels stale in-flight refreshes.
  const activeRef = useRef<string | null>(null);
  // create form
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [agencies, setAgencies] = useState('');
  const [programTypes, setProgramTypes] = useState('');
  const [naics, setNaics] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets`);
      if (res.ok) setBuckets((await res.json()).data?.buckets ?? []);
      else setErr('Could not load your buckets.');
    } catch { setErr('Could not load your buckets.'); } finally { setLoading(false); }
  }, [tenantSlug]);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    const criteria = {
      keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
      agencies: agencies.split(',').map((s) => s.trim()).filter(Boolean),
      programTypes: programTypes.split(',').map((s) => s.trim()).filter(Boolean),
      naics: naics.split(',').map((s) => s.trim()).filter(Boolean),
      includeClosed,
      useTimeline: true,
    };
    setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, criteria }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not create the bucket.'); return; }
      setName(''); setKeywords(''); setAgencies(''); setProgramTypes(''); setNaics(''); setIncludeClosed(false);
      await load(); router.refresh(); // refresh the console's bucket count
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [tenantSlug, name, keywords, agencies, programTypes, naics, includeClosed, load, router]);

  const del = useCallback(async (id: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not delete the bucket.'); return; }
      if (openId === id) { setRanked(null); setOpenId(null); activeRef.current = null; setReranking(false); }
      await load(); router.refresh();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [tenantSlug, openId, load, router]);

  const rank = useCallback(async (id: string) => {
    setBusy(true);
    setReranking(true);
    activeRef.current = id;
    setOpenId(id);
    const loadRanked = async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/buckets/${id}`);
        if (res.ok && activeRef.current === id) setRanked((await res.json()).data?.ranked ?? []);
      } catch { /* ignore */ }
    };
    try {
      // Ranking is async — the POST emits buckets.updated and the pipeline
      // OnBucketsUpdated workflow rescores tenant-side. Show what's there now,
      // then poll a few times to pick up the fresh scores as they land.
      await fetch(`/api/portal/${tenantSlug}/buckets/${id}?action=rank`, { method: 'POST' });
      await loadRanked();
    } catch { /* ignore */ } finally { setBusy(false); }
    for (const delay of [1500, 2000, 2500]) {
      await new Promise((r) => setTimeout(r, delay));
      if (activeRef.current !== id) return; // user switched buckets — abandon this poll
      await loadRanked();
    }
    if (activeRef.current === id) setReranking(false);
  }, [tenantSlug]);

  const str = (c: Record<string, unknown> | null, k: string) => (c && typeof c[k] === 'string' ? (c[k] as string) : null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {canEdit && (
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold mb-2">New bucket</h3>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. AF Autonomy)" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="keywords, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={agencies} onChange={(e) => setAgencies(e.target.value)} placeholder="agencies, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={programTypes} onChange={(e) => setProgramTypes(e.target.value)} placeholder="program types (SBIR, STTR)" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="NAICS codes, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              Include closed opportunities
            </label>
            <button disabled={busy || !name.trim()} onClick={create} className="w-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:opacity-50">Create</button>
          </div>
        )}
        <div className="space-y-2">
          {buckets.map((b) => (
            <div key={b.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800 truncate">{b.name}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <button disabled={busy} onClick={() => rank(b.id)} className="text-xs font-medium text-blue-600 hover:underline">Rank →</button>
                  {canEdit && (
                    <button disabled={busy} onClick={() => del(b.id)} title="Delete bucket" className="text-xs text-gray-300 hover:text-rose-600">✕</button>
                  )}
                </span>
              </div>
            </div>
          ))}
          {err && <p className="text-xs text-rose-600">{err}</p>}
          {buckets.length === 0 && !err && <p className="text-xs text-gray-400">{loading ? 'Loading buckets…' : 'No buckets yet.'}</p>}
        </div>
      </div>

      <div className="lg:col-span-2">
        {reranking && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" aria-hidden />
            Rescore queued — scores refresh as the pipeline processes.
          </div>
        )}
        {ranked == null ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            {reranking ? 'Ranking…' : 'Rank a bucket to see your pipeline ordered.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400 mb-2">{ranked.length} opportunities ranked{openId ? ` · bucket ${buckets.find((b) => b.id === openId)?.name}` : ''}</p>
            {ranked.map((r, i) => (
              <div key={r.opportunityId} className="border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-6">#{i + 1}</span>
                  <span className="flex-1 text-sm text-gray-800 truncate">{str(r.card, 'title') ?? r.opportunityId}</span>
                  {r.isPinned && <span className="text-[10px] text-blue-600">pinned</span>}
                  <span className="text-sm font-semibold text-gray-700 w-10 text-right">{r.score}</span>
                </div>
                {r.factors && Object.keys(r.factors).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1 pl-9">
                    {Object.entries(r.factors).map(([k, v]) => (
                      <span key={k} className="text-[9px] bg-gray-100 text-gray-500 rounded px-1 py-0.5">{k} {v}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {ranked.length === 0 && <p className="text-sm text-gray-400">No cards to rank yet — releases populate the pipeline.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
