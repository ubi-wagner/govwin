'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Bucket { id: string; name: string; description: string | null; criteria: Record<string, unknown> }
interface RankedRow { opportunityId: string; score: number; factors: Record<string, number>; card: Record<string, unknown> | null; isPinned: boolean }

export default function SpotlightBuckets({ tenantSlug, canEdit }: { tenantSlug: string; canEdit: boolean }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [cap, setCap] = useState<number | null>(null);
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [agencies, setAgencies] = useState('');
  const [programTypes, setProgramTypes] = useState('');
  const [naics, setNaics] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets`);
      if (res.ok) {
        const d = (await res.json()).data;
        setBuckets(d?.buckets ?? []);
        if (typeof d?.cap === 'number') setCap(d.cap);
      } else setErr('Could not load your buckets.');
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

  const resetForm = useCallback(() => {
    setEditingId(null); setName(''); setKeywords(''); setAgencies(''); setProgramTypes(''); setNaics(''); setIncludeClosed(false); setErr(null);
  }, []);

  const startEdit = useCallback((b: Bucket) => {
    const c = (b.criteria ?? {}) as Record<string, unknown>;
    const arr = (k: string) => (Array.isArray(c[k]) ? (c[k] as unknown[]).filter((x): x is string => typeof x === 'string').join(', ') : '');
    setEditingId(b.id);
    setName(b.name);
    setKeywords(arr('keywords')); setAgencies(arr('agencies')); setProgramTypes(arr('programTypes')); setNaics(arr('naics'));
    setIncludeClosed(c.includeClosed === true);
    setErr(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !name.trim()) return;
    setBusy(true); setErr(null);
    // Full criteria set sent; the PATCH route MERGES so untouched keys (useTimeline/weights) survive.
    const criteria = {
      keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
      agencies: agencies.split(',').map((s) => s.trim()).filter(Boolean),
      programTypes: programTypes.split(',').map((s) => s.trim()).filter(Boolean),
      naics: naics.split(',').map((s) => s.trim()).filter(Boolean),
      includeClosed,
    };
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets/${editingId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, criteria }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? 'Could not save the bucket.'); return; }
      resetForm(); await load(); router.refresh();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }, [tenantSlug, editingId, name, keywords, agencies, programTypes, naics, includeClosed, load, router, resetForm]);

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
  const atCap = cap != null && buckets.length >= cap;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        {canEdit && (
          <div className="border border-gray-200 rounded-xl p-4 bg-white">
            <h3 className="text-sm font-semibold mb-2 flex items-center justify-between gap-2">
              <span>{editingId ? 'Edit bucket' : 'New bucket'}</span>
              {editingId
                ? <button onClick={resetForm} className="text-[11px] font-normal text-gray-400 hover:text-gray-600">Cancel</button>
                : cap != null && <span className={`text-[11px] font-normal ${atCap ? 'text-rose-600' : 'text-gray-400'}`}>{buckets.length}/{cap} used</span>}
            </h3>
            {atCap && !editingId && <p className="text-[11px] text-rose-600 mb-2">Bucket limit reached — delete one to add another.</p>}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. AF Autonomy)" disabled={atCap && !editingId} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2 disabled:bg-gray-50 disabled:text-gray-400" />
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="keywords, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={agencies} onChange={(e) => setAgencies(e.target.value)} placeholder="agencies, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={programTypes} onChange={(e) => setProgramTypes(e.target.value)} placeholder="program types (SBIR, STTR)" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <input value={naics} onChange={(e) => setNaics(e.target.value)} placeholder="NAICS codes, comma-sep" className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm mb-2" />
            <label className="flex items-center gap-2 text-xs text-gray-600 mb-2">
              <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
              Include closed opportunities
            </label>
            <button disabled={busy || !name.trim() || (atCap && !editingId)} onClick={editingId ? saveEdit : create} className="w-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed">{editingId ? 'Save changes' : 'Create'}</button>
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
                    <button disabled={busy} onClick={() => startEdit(b)} title="Edit bucket" className={`text-xs ${editingId === b.id ? 'text-blue-600' : 'text-gray-400 hover:text-blue-600'}`}>✎</button>
                  )}
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
