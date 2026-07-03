'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Atom library — browse/facet the tenant's atoms, approve drafts, and compose a group
 * from selected existing atoms (cross-atom grouping, e.g. pick 4 bios → "Team"). Reads
 * the S2 atom API.
 */

interface Atom {
  id: string; grain: string; title: string | null; summary: string | null;
  word_count: number; status: string; creator_kind: string; source: string;
  member_count: number; child_count: number; tags: string[];
}

export function AtomLibrary({ tenantSlug }: { tenantSlug: string }) {
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [q, setQ] = useState('');
  const [grain, setGrain] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (grain) qs.set('grain', grain);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/atoms?${qs}`);
      if (res.ok) setAtoms((await res.json()).data?.atoms ?? []);
    } catch { /* keep */ }
  }, [tenantSlug, q, grain]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const approve = useCallback(async (id: string) => {
    setBusy(true);
    try { await fetch(`/api/portal/${tenantSlug}/atoms/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) }); await load(); }
    finally { setBusy(false); }
  }, [tenantSlug, load]);

  const groupSelected = useCallback(async () => {
    if (sel.size < 2) return;
    setBusy(true);
    try {
      await fetch(`/api/portal/${tenantSlug}/atoms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grain: 'group', title: groupTitle.trim() || 'Group', memberAtomIds: [...sel], status: 'approved', source: 'manual' }),
      });
      setSel(new Set()); setGroupTitle(''); await load();
    } finally { setBusy(false); }
  }, [tenantSlug, sel, groupTitle, load]);

  const grainColor: Record<string, string> = { primitive: 'bg-teal-100 text-teal-700', group: 'bg-purple-100 text-purple-700', reference: 'bg-gray-100 text-gray-500' };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / summary…" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-72" />
        <select value={grain} onChange={(e) => setGrain(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="">all grains</option><option value="primitive">primitive</option><option value="group">group</option><option value="reference">reference</option>
        </select>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Refresh</button>
        <span className="text-xs text-gray-400 ml-auto">{atoms.length} atoms</span>
      </div>

      {sel.size >= 2 && (
        <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-purple-700">{sel.size} selected →</span>
          <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Group name (e.g. Team for Army)" className="border border-purple-200 rounded px-2 py-1 text-sm flex-1 min-w-[12rem]" />
          <button onClick={groupSelected} disabled={busy} className="text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded px-3 py-1.5 disabled:opacity-50">Group into new atom</button>
        </div>
      )}

      <div className="space-y-2">
        {atoms.map((a) => (
          <div key={a.id} className="border border-gray-200 rounded-lg p-3 bg-white flex items-start gap-3">
            <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mt-1" disabled={a.grain === 'reference'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${grainColor[a.grain] ?? 'bg-gray-100'}`}>{a.grain}</span>
                <span className="text-sm font-medium text-gray-800 truncate">{a.title || 'Untitled atom'}</span>
                <span className="text-[11px] text-gray-400">{a.word_count} words</span>
                {a.member_count > 0 && <span className="text-[11px] text-purple-500">{a.member_count} members</span>}
                {a.child_count > 0 && <span className="text-[11px] text-blue-500">{a.child_count} children</span>}
                <span className="text-[10px] text-gray-400 ml-auto">{a.creator_kind} · {a.source}</span>
              </div>
              {a.summary && <p className="text-xs text-gray-500 truncate mt-0.5">{a.summary}</p>}
              {a.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {a.tags.slice(0, 8).map((t) => <span key={t} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1 py-0.5">{t}</span>)}
                </div>
              )}
            </div>
            {a.status !== 'approved' ? (
              <button onClick={() => approve(a.id)} disabled={busy} className="text-xs font-medium text-green-700 border border-green-200 rounded px-2 py-1 hover:bg-green-50">Approve</button>
            ) : <span className="text-[10px] text-green-600 mt-1">approved</span>}
          </div>
        ))}
        {atoms.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No atoms yet — shred a document in the Atomize tab.</p>}
      </div>
    </div>
  );
}
