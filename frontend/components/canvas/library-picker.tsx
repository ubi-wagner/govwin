'use client';

/**
 * Library Picker — shows candidate library atoms for replacing a
 * selected canvas node. Atoms are ranked by outcome_score so content
 * from winning proposals surfaces first.
 *
 * Used in the canvas sidebar "Node" tab as a "Replace from Library"
 * action. When the user clicks a candidate atom, the parent receives
 * the atom data via onSelect and can replace the node content +
 * set provenance.source = 'library'.
 */

import { useState, useEffect } from 'react';
import { useTool } from '@/lib/hooks/use-tool';

export interface LibraryAtomCandidate {
  id: string;
  content: string;
  category: string;
  tags: string[];
  outcomeScore: number | null;
  outcome: string | null;
  usageCount: number;
}

interface Props {
  /** Category to search for (derived from section title) */
  category: string;
  /** Optional text query to narrow results */
  query?: string;
  /** Called when the user selects an atom to replace with */
  onSelect: (atom: LibraryAtomCandidate) => void;
  /** Called when the user closes the picker */
  onClose: () => void;
}

export function LibraryPicker({ category, query, onSelect, onClose }: Props) {
  const { invoke, loading, error } = useTool();
  const [atoms, setAtoms] = useState<LibraryAtomCandidate[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function search() {
      try {
        // Search by category first
        const result = await invoke<{
          atoms: LibraryAtomCandidate[];
          total: number;
        }>('library.search_atoms', {
          category,
          limit: 10,
        });

        if (cancelled) return;
        let found = result.atoms ?? [];

        // If few results, supplement with text search
        if (found.length < 5 && query) {
          const textResult = await invoke<{
            atoms: LibraryAtomCandidate[];
          }>('library.search_atoms', {
            query: query.slice(0, 200),
            limit: 10 - found.length,
          });
          if (!cancelled) {
            const existingIds = new Set(found.map((a) => a.id));
            for (const atom of textResult.atoms ?? []) {
              if (!existingIds.has(atom.id)) found.push(atom);
            }
          }
        }

        if (!cancelled) {
          setAtoms(found);
          setSearched(true);
        }
      } catch {
        if (!cancelled) setSearched(true);
      }
    }

    search();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Library Atoms
        </h4>
        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>

      {loading && !searched && (
        <div className="text-xs text-gray-400 py-4 text-center">
          Searching library...
        </div>
      )}

      {searched && atoms.length === 0 && (
        <div className="text-xs text-gray-400 py-4 text-center">
          No matching atoms found in the library for &ldquo;{category}&rdquo;.
        </div>
      )}

      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {atoms.map((atom) => (
          <button
            key={atom.id}
            onClick={() => onSelect(atom)}
            className="w-full text-left p-2 border rounded hover:bg-indigo-50 hover:border-indigo-200 transition-colors group"
          >
            {/* Content preview */}
            <p className="text-xs text-gray-700 line-clamp-2 group-hover:text-indigo-900">
              {atom.content.slice(0, 100)}
              {atom.content.length > 100 ? '...' : ''}
            </p>

            {/* Metadata row */}
            <div className="flex items-center gap-2 mt-1">
              {/* Category badge */}
              <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                {atom.category}
              </span>

              {/* Outcome indicator */}
              {atom.outcome === 'awarded' && (
                <span className="text-[10px] text-amber-600" title="From awarded proposal">
                  &#x1F3C6;
                </span>
              )}
              {atom.outcome === 'rejected' && (
                <span className="text-[10px] text-gray-400" title="From rejected proposal">
                  &#x25CB;
                </span>
              )}

              {/* Usage count */}
              {atom.usageCount > 0 && (
                <span className="text-[10px] text-gray-400" title={`Used ${atom.usageCount} time(s)`}>
                  {atom.usageCount}x used
                </span>
              )}

              {/* Score */}
              {atom.outcomeScore !== null && atom.outcomeScore > 0.5 && (
                <span className="text-[10px] text-green-600 ml-auto">
                  {Math.round(atom.outcomeScore * 100)}%
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
