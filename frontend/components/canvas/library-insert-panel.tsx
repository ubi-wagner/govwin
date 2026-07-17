'use client';

/**
 * Library Insert Panel — hand-pick atoms from the CANONICAL library (library_atoms)
 * to ground/build the current section, and insert their content as new canvas nodes.
 *
 * This is the manual counterpart to Draft-All's auto-selection, and it reads the
 * greenfield library (unlike the legacy per-node "Replace from Library" picker which
 * reads library_units). Candidates are context-ranked for this section; the user
 * multi-selects and inserts. On insert the parent records the exact picks as the
 * section's sourceAtomIds so lock-time harvest sets derived_from lineage to them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface InsertAtom { id: string; title: string | null; content: string }
interface Ranked { id: string; title: string | null; summary: string | null; content: string | null; grain: string; wordCount: number; ctxMatches: number; score: number }

const slugVol = (title: string) => title.toLowerCase().trim().replace(/^[0-9.\s]+/, '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

interface Props {
  tenantSlug: string;
  sectionTitle: string;
  sectionId?: string;
  context?: string[];
  onInsert: (atoms: InsertAtom[]) => void;
  onClose: () => void;
}

export function LibraryInsertPanel({ tenantSlug, sectionTitle, sectionId, context = [], onInsert, onClose }: Props) {
  const [atoms, setAtoms] = useState<Ranked[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Stable string key — `context` is often a fresh [] literal each render, which would
  // make the effect re-run forever if listed directly.
  const contextParam = context.join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ vol: slugVol(sectionTitle), limit: '30' });
        if (contextParam) qs.set('context', contextParam);
        const res = await fetch(`/api/portal/${tenantSlug}/atoms/select?${qs.toString()}`);
        if (!cancelled && res.ok) setAtoms((((await res.json()).data?.atoms ?? []) as Ranked[]).filter((a) => a.content && a.content.trim()));
      } catch { /* keep */ } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tenantSlug, sectionTitle, contextParam]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return atoms;
    return atoms.filter((a) => (a.title ?? '').toLowerCase().includes(needle) || (a.summary ?? '').toLowerCase().includes(needle) || (a.content ?? '').toLowerCase().includes(needle));
  }, [atoms, q]);

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const insert = useCallback(async () => {
    const chosen = atoms.filter((a) => sel.has(a.id));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      // record the exact picks as the section's source atoms (for lock-time lineage)
      if (sectionId) {
        try { await fetch(`/api/portal/${tenantSlug}/atoms/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sectionId, atomIds: chosen.map((a) => a.id) }) }); } catch { /* non-fatal */ }
      }
      onInsert(chosen.map((a) => ({ id: a.id, title: a.title, content: a.content as string })));
    } finally { setBusy(false); }
  }, [atoms, sel, sectionId, tenantSlug, onInsert]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Insert from Library</h4>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter candidates…" className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
      {loading && <p className="text-xs text-gray-400 py-3 text-center">Ranking your library…</p>}
      {!loading && filtered.length === 0 && <p className="text-xs text-gray-400 py-3 text-center">No matching atoms — upload a package or widen the filter.</p>}
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {filtered.map((a) => (
          <label key={a.id} className={`block w-full text-left p-2 border rounded cursor-pointer transition-colors ${sel.has(a.id) ? 'bg-indigo-50 border-indigo-300' : 'hover:bg-gray-50 border-gray-200'}`}>
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{a.title || 'Untitled atom'}</p>
                <p className="text-[11px] text-gray-500 line-clamp-2">{a.content?.slice(0, 120)}{(a.content?.length ?? 0) > 120 ? '…' : ''}</p>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                  <span>{a.wordCount} words</span>
                  {a.ctxMatches > 0 && <span className="text-emerald-600" title="shares this section's context">✦ {a.ctxMatches} context match{a.ctxMatches > 1 ? 'es' : ''}</span>}
                  {a.grain === 'group' && <span className="text-purple-500">group</span>}
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>
      <button onClick={insert} disabled={busy || sel.size === 0} className="w-full text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded px-3 py-2 disabled:opacity-50">
        {busy ? 'Inserting…' : `Insert ${sel.size || ''} atom${sel.size === 1 ? '' : 's'} into the canvas`}
      </button>
    </div>
  );
}
