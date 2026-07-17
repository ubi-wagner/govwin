'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Atom library — browse/curate the tenant's atoms: filter by tag/status/grain,
 * see reuse (usage_count) + lineage, distinguish uploaded vs harvested (returned)
 * atoms, approve/archive, retag via the detail drawer, and compose a group from
 * selected atoms. Reads the canonical library_atoms API.
 */

interface Atom {
  id: string; grain: string; title: string | null; summary: string | null;
  word_count: number; status: string; creator_kind: string; source: string;
  usage_count: number; member_count: number; child_count: number; tags: string[];
  owner_name: string | null; owner_email: string | null; visibility: string; is_mine: boolean;
}
interface AtomDetail {
  id: string; content: string | null;
  tags: Array<{ dimension: string; value: string; is_other: boolean; confirmed: boolean }>;
  parents: Array<{ parent_atom_id: string; title: string | null }>;
  children: Array<{ child_atom_id: string; title: string | null }>;
}

const VIS_LABEL: Record<string, string> = { owner_only: 'private', admin_only: 'admin-only', shared_for_proposal: 'shared' };
// Where an atom came from — uploaded package vs harvested back from a locked draft.
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  upload: { label: 'uploaded', cls: 'bg-sky-100 text-sky-700' },
  download_derivative: { label: 'returned', cls: 'bg-emerald-100 text-emerald-700' },
  harvest: { label: 'returned', cls: 'bg-emerald-100 text-emerald-700' },
};

export function AtomLibrary({ tenantSlug }: { tenantSlug: string }) {
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [q, setQ] = useState('');
  const [grain, setGrain] = useState('');
  const [status, setStatus] = useState('');
  const [tagFilter, setTagFilter] = useState<{ dimension: string; value: string } | null>(null);
  const [mine, setMine] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AtomDetail | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (grain) qs.set('grain', grain);
    if (status) qs.set('status', status);
    if (mine) qs.set('mine', '1');
    if (tagFilter) { qs.set('dimension', tagFilter.dimension); qs.set('value', tagFilter.value); }
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/atoms?${qs}`);
      if (res.ok) setAtoms((await res.json()).data?.atoms ?? []);
    } catch { /* keep */ }
  }, [tenantSlug, q, grain, status, mine, tagFilter]);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const setStatusOf = useCallback(async (id: string, s: 'approved' | 'archived') => {
    setBusy(true);
    try { await fetch(`/api/portal/${tenantSlug}/atoms/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }) }); await load(); }
    finally { setBusy(false); }
  }, [tenantSlug, load]);

  const openDetail = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return; }
    setOpenId(id); setDetail(null);
    try { const res = await fetch(`/api/portal/${tenantSlug}/atoms/${id}`); if (res.ok) setDetail((await res.json()).data?.atom as AtomDetail); } catch { /* keep */ }
  }, [tenantSlug, openId]);

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
  const parseTag = (t: string): { dimension: string; value: string } => { const i = t.indexOf(':'); return { dimension: t.slice(0, i), value: t.slice(i + 1) }; };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title / summary…" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64" />
        <select value={grain} onChange={(e) => setGrain(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="">all grains</option><option value="primitive">primitive</option><option value="group">group</option><option value="reference">foundational</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
          <option value="">any status</option><option value="approved">approved</option><option value="draft">draft</option><option value="archived">archived</option>
        </select>
        <button onClick={() => setMine((m) => !m)} className={`text-xs font-medium rounded px-2.5 py-1.5 border ${mine ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {mine ? 'My atoms' : 'All atoms'}
        </button>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Refresh</button>
        <span className="text-xs text-gray-400 ml-auto">{atoms.length} atoms</span>
      </div>

      {tagFilter && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">filtered by</span>
          <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-700 rounded px-2 py-0.5 font-medium">
            {tagFilter.dimension}:{tagFilter.value}
            <button onClick={() => setTagFilter(null)} className="text-indigo-400 hover:text-rose-600">×</button>
          </span>
        </div>
      )}

      {sel.size >= 2 && (
        <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-purple-700">{sel.size} selected →</span>
          <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Group name (e.g. Team for Navy)" className="border border-purple-200 rounded px-2 py-1 text-sm flex-1 min-w-[12rem]" />
          <button onClick={groupSelected} disabled={busy} className="text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded px-3 py-1.5 disabled:opacity-50">Group into new atom</button>
        </div>
      )}

      <div className="space-y-2">
        {atoms.map((a) => {
          const badge = SOURCE_BADGE[a.source];
          return (
          <div key={a.id} className="border border-gray-200 rounded-lg bg-white">
            <div className="p-3 flex items-start gap-3">
              <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mt-1" disabled={a.grain === 'reference'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${grainColor[a.grain] ?? 'bg-gray-100'}`}>{a.grain === 'reference' ? 'foundational' : a.grain}</span>
                  <button onClick={() => openDetail(a.id)} className="text-sm font-medium text-gray-800 truncate hover:text-blue-600 hover:underline text-left">{a.title || 'Untitled atom'}</button>
                  <span className="text-[11px] text-gray-400">{a.word_count} words</span>
                  {a.usage_count > 0 && <span className="text-[11px] text-amber-600" title="reused in this many drafts (non-destructive)">↺ used {a.usage_count}×</span>}
                  {a.member_count > 0 && <span className="text-[11px] text-purple-500">{a.member_count} members</span>}
                  {a.child_count > 0 && <span className="text-[11px] text-blue-500">{a.child_count} derived</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    {badge && <span className={`text-[9px] uppercase tracking-wide rounded px-1 py-0.5 ${badge.cls}`}>{badge.label}</span>}
                    {a.visibility && a.visibility !== 'tenant' && <span className="text-[9px] uppercase tracking-wide bg-amber-100 text-amber-700 rounded px-1 py-0.5">{VIS_LABEL[a.visibility] ?? a.visibility}</span>}
                    {a.is_mine && <span className="text-[9px] uppercase bg-blue-100 text-blue-700 rounded px-1 py-0.5">mine</span>}
                    <span className="text-[10px] text-gray-400" title={a.owner_email ?? undefined}>{a.owner_name || a.creator_kind}</span>
                  </span>
                </div>
                {a.summary && <p className="text-xs text-gray-500 truncate mt-0.5">{a.summary}</p>}
                {a.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {a.tags.slice(0, 10).map((t) => (
                      <button key={t} onClick={() => setTagFilter(parseTag(t))} className="text-[10px] bg-gray-100 hover:bg-indigo-100 text-gray-600 hover:text-indigo-700 rounded px-1 py-0.5" title="filter by this tag">{t}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {a.status !== 'approved' ? (
                  <button onClick={() => setStatusOf(a.id, 'approved')} disabled={busy} className="text-xs font-medium text-green-700 border border-green-200 rounded px-2 py-1 hover:bg-green-50">Approve</button>
                ) : <span className="text-[10px] text-green-600">approved</span>}
                {a.status !== 'archived' && <button onClick={() => setStatusOf(a.id, 'archived')} disabled={busy} className="text-[10px] text-gray-400 hover:text-rose-600">archive</button>}
              </div>
            </div>
            {openId === a.id && (
              <div className="border-t border-gray-100 px-3 py-3 bg-gray-50 text-xs space-y-2">
                {!detail ? <p className="text-gray-400">Loading…</p> : (
                  <>
                    {detail.tags.length > 0 && (
                      <div>
                        <span className="text-gray-400">tags: </span>
                        {detail.tags.map((t, i) => (
                          <span key={i} className={`inline-block mr-1 mb-1 rounded px-1.5 py-0.5 ${t.confirmed ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-500'}`}>
                            {t.dimension}:{t.value}{t.is_other ? '*' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {(detail.parents.length > 0 || detail.children.length > 0) && (
                      <div className="text-gray-500">
                        {detail.parents.length > 0 && <div>↖ derived from: {detail.parents.map((p) => p.title || 'atom').join(', ')}</div>}
                        {detail.children.length > 0 && <div>↳ reused in: {detail.children.map((c) => c.title || 'atom').join(', ')}</div>}
                      </div>
                    )}
                    {detail.content && <p className="text-gray-600 whitespace-pre-wrap line-clamp-6 max-h-32 overflow-hidden">{detail.content.slice(0, 600)}{detail.content.length > 600 ? '…' : ''}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        );})}
        {atoms.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No atoms{tagFilter || status || q ? ' match these filters' : ' yet — upload a package or shred a document'}.</p>}
      </div>
    </div>
  );
}
