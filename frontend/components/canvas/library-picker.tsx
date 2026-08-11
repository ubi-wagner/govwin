'use client';

/**
 * Library Picker — candidate atoms for replacing a selected canvas node, read from
 * the CANONICAL library (library_atoms via /atoms/select), context-ranked for the
 * section. Used by the canvas sidebar "Node" tab as "Replace from Library". When the
 * user clicks a candidate the parent receives it via onSelect and replaces the node
 * content + sets provenance.source = 'library'.
 */

import { useState, useEffect, useMemo } from 'react';

export interface LibraryAtomCandidate {
  id: string;
  content: string;
  category: string;
  subcategory?: string | null;
  tags: string[];
  outcomeScore: number | null;
  outcome: string | null;
  usageCount: number;
}

interface RankedAtom {
  id: string; title: string | null; summary: string | null; content: string | null; grain: string;
  wordCount: number; charCount: number; outcomeScore: number; usageCount: number; ctxMatches: number; score: number;
}

type SortKey = 'outcome' | 'usage' | 'recent';

const slugVol = (s: string) => s.toLowerCase().trim().replace(/^[0-9.\s]+/, '').replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

interface Props {
  /** Category/section title — slugified to a `vol` scope for ranking. */
  category: string;
  query?: string;
  /** Portal context: scopes candidates to the tenant's canonical library. */
  tenantSlug?: string;
  sectionId?: string;
  proposalId?: string;
  onSelect: (atom: LibraryAtomCandidate) => void;
  onClose: () => void;
}

export function LibraryPicker({ category, tenantSlug, sectionId, onSelect, onClose }: Props) {
  const [atoms, setAtoms] = useState<LibraryAtomCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [sort, setSort] = useState<SortKey>('outcome');
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!tenantSlug) { setSearched(true); return; }
    let cancelled = false;
    (async () => {
      setFetching(true);
      try {
        const qs = new URLSearchParams({ vol: slugVol(category), limit: '15' });
        if (category) qs.set('text', category); // semantic query (section context) for the vector axis
        if (sectionId) qs.set('sectionId', sectionId);
        const res = await fetch(`/api/portal/${tenantSlug}/atoms/select?${qs.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          const ranked = ((await res.json()).data?.atoms ?? []) as RankedAtom[];
          setAtoms(ranked
            .filter((a) => a.content && a.content.trim())
            .map((a) => ({
              id: a.id, content: a.content as string, category: slugVol(category), tags: [],
              outcomeScore: a.outcomeScore ?? null, outcome: null, usageCount: a.usageCount ?? 0,
            })));
        }
      } catch { /* leave atoms as-is */ } finally { if (!cancelled) { setSearched(true); setFetching(false); } }
    })();
    return () => { cancelled = true; };
  }, [category, tenantSlug, sectionId]);

  const sorted = useMemo(() => {
    const a = [...atoms];
    if (sort === 'usage') a.sort((x, y) => y.usageCount - x.usageCount);
    else if (sort === 'outcome') a.sort((x, y) => (y.outcomeScore ?? 0) - (x.outcomeScore ?? 0));
    return a; // 'recent' keeps the selector's score order
  }, [atoms, sort]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Library Atoms</h4>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
      </div>

      <div className="flex items-center justify-end gap-2">
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="text-[10px] border rounded px-1 py-0.5 text-gray-600">
            <option value="outcome">Best match</option>
            <option value="usage">Most used</option>
            <option value="recent">Most recent</option>
          </select>
        </label>
      </div>

      {fetching && !searched && <div className="text-xs text-gray-400 py-4 text-center">Searching library…</div>}
      {searched && sorted.length === 0 && (
        <div className="text-xs text-gray-400 py-4 text-center">No matching atoms in your library yet — upload a package or shred a document.</div>
      )}

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {sorted.map((atom) => (
          <button key={atom.id} onClick={() => onSelect(atom)} className="w-full text-left p-2 border rounded hover:bg-indigo-50 hover:border-indigo-200 transition-colors group">
            <p className="text-xs text-gray-700 line-clamp-2 group-hover:text-indigo-900">
              {atom.content.slice(0, 100)}{atom.content.length > 100 ? '…' : ''}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{atom.category}</span>
              {atom.usageCount > 0 && <span className="text-[10px] text-gray-400" title={`Used ${atom.usageCount} time(s)`}>{atom.usageCount}x used</span>}
              {atom.outcomeScore !== null && atom.outcomeScore > 0.5 && (
                <span className="text-[10px] text-green-600 ml-auto">{Math.round(atom.outcomeScore * 100)}%</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
