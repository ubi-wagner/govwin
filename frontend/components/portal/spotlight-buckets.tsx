'use client';

import { useCallback, useEffect, useState } from 'react';

interface Bucket { id: string; name: string; description: string | null; criteria: Record<string, unknown> }
interface RankedRow { opportunityId: string; score: number; factors: Record<string, number>; card: Record<string, unknown> | null; isPinned: boolean }

export default function SpotlightBuckets({ tenantSlug, canEdit }: { tenantSlug: string; canEdit: boolean }) {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [ranked, setRanked] = useState<RankedRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // create form
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [agencies, setAgencies] = useState('');
  const [programTypes, setProgramTypes] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/buckets`);
      if (res.ok) setBuckets((await res.json()).data?.buckets ?? []);
    } catch { /* keep */ }
  }, [tenantSlug]);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    const criteria = {
      keywords: keywords.split(',').map((s) => s.trim()).filter(Boolean),
      agencies: agencies.split(',').map((s) => s.trim()).filter(Boolean),
      programTypes: programTypes.split(',').map((s) => s.trim()).filter(Boolean),
      useTimeline: true,
    };
    try {
      await fetch(`/api/portal/${tenantSlug}/buckets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, criteria }) });
      setName(''); setKeywords(''); setAgencies(''); setProgramTypes('');
      await load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [tenantSlug, name, keywords, agencies, programTypes, load]);

  const rank = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/portal/${tenantSlug}/buckets/${id}?action=rank`, { method: 'POST' });
      const res = await fetch(`/api/portal/${tenantSlug}/buckets/${id}`);
      if (res.ok) { setRanked((await res.json()).data?.ranked ?? []); setOpenId(id); }
    } catch { /* ignore */ } finally { setBusy(false); }
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
            <button disabled={busy || !name.trim()} onClick={create} className="w-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1.5 disabled:opacity-50">Create</button>
          </div>
        )}
        <div className="space-y-2">
          {buckets.map((b) => (
            <div key={b.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">{b.name}</span>
                <button disabled={busy} onClick={() => rank(b.id)} className="text-xs font-medium text-blue-600 hover:underline">Rank →</button>
              </div>
            </div>
          ))}
          {buckets.length === 0 && <p className="text-xs text-gray-400">No buckets yet.</p>}
        </div>
      </div>

      <div className="lg:col-span-2">
        {ranked == null ? (
          <p className="text-sm text-gray-400 py-8 text-center">Rank a bucket to see your pipeline ordered.</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400 mb-2">{ranked.length} opportunities ranked{openId ? ` · bucket ${buckets.find((b) => b.id === openId)?.name}` : ''}</p>
            {ranked.map((r, i) => (
              <div key={r.opportunityId} className="flex items-center gap-3 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <span className="text-xs font-bold text-gray-400 w-6">#{i + 1}</span>
                <span className="flex-1 text-sm text-gray-800 truncate">{str(r.card, 'title') ?? r.opportunityId}</span>
                {r.isPinned && <span className="text-[10px] text-blue-600">pinned</span>}
                <span className="text-sm font-semibold text-gray-700 w-10 text-right">{r.score}</span>
              </div>
            ))}
            {ranked.length === 0 && <p className="text-sm text-gray-400">No cards to rank yet — releases populate the pipeline.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
