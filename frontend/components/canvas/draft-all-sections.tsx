'use client';

/**
 * Draft All Sections — the "easy-bake-oven" button.
 *
 * When a proposal is provisioned with empty sections, this component
 * shows a "Draft All Sections" button that:
 *   1. For each empty section, searches the library for relevant atoms
 *   2. Calls Claude to draft content using library + RFP context
 *   3. Inserts the drafted nodes into each section's canvas
 *   4. Updates each section's status to 'ai_drafted'
 *
 * The user sees: sections filling up one-by-one with AI-drafted
 * content (yellow "AI draft" badges). Then they review + revise.
 */

import { useState } from 'react';
import { useTool } from '@/lib/hooks/use-tool';
import type { CanvasNode } from '@/lib/types/canvas-document';

interface Section {
  id: string;
  title: string;
  status: string;
  nodeCount: number;
  pageLimit?: number;
  requiredSubsections?: string[];
}

interface Props {
  proposalId: string;
  sections: Section[];
  rfpExcerpt?: string;
  evaluationCriteria?: string[];
  onSectionDrafted: (sectionId: string, nodes: CanvasNode[]) => void;
  onComplete: () => void;
}

export function DraftAllSections({
  proposalId,
  sections,
  rfpExcerpt,
  evaluationCriteria,
  onSectionDrafted,
  onComplete,
}: Props) {
  const { invoke, loading, error } = useTool();
  const [progress, setProgress] = useState<Record<string, 'pending' | 'drafting' | 'done' | 'failed'>>({});
  const [started, setStarted] = useState(false);

  const emptySections = sections.filter((s) => s.status === 'empty' || s.nodeCount === 0);
  const allDone = Object.values(progress).length > 0 && Object.values(progress).every((s) => s === 'done' || s === 'failed');

  async function handleDraftAll() {
    setStarted(true);
    const initial: Record<string, 'pending'> = {};
    for (const sec of emptySections) initial[sec.id] = 'pending';
    setProgress(initial);

    for (const sec of emptySections) {
      setProgress((prev) => ({ ...prev, [sec.id]: 'drafting' }));

      try {
        // Search library for relevant atoms — try category match first,
        // then fall back to text search on the section title. This catches
        // atoms even when category slugs don't match exactly.
        let libraryAtoms: Array<{ id: string; content: string; category: string; tags?: string[] }> = [];
        try {
          const categorySlug = sec.title.toLowerCase().replace(/\s+/g, '_');
          const libResult = await invoke<{
            atoms: Array<{ id: string; content: string; category: string; tags?: string[] }>;
            total: number;
          }>('library.search_atoms', {
            category: categorySlug,
            limit: 5,
          });
          libraryAtoms = libResult.atoms ?? [];

          // If category match found few results, supplement with text search
          if (libraryAtoms.length < 3) {
            const textResult = await invoke<{
              atoms: Array<{ id: string; content: string; category: string; tags?: string[] }>;
            }>('library.search_atoms', {
              query: sec.title,
              limit: 5 - libraryAtoms.length,
            });
            const existingIds = new Set(libraryAtoms.map((a) => a.id));
            for (const atom of textResult.atoms ?? []) {
              if (!existingIds.has(atom.id)) libraryAtoms.push(atom);
            }
          }
        } catch {
          // Library search failure is non-fatal — draft without library context
        }

        // Draft the section
        const result = await invoke<{ nodes: CanvasNode[] }>('proposal.draft_section', {
          proposalId,
          sectionTitle: sec.title,
          pageLimit: sec.pageLimit,
          requiredSubsections: sec.requiredSubsections,
          evaluationCriteria,
          rfpExcerpt: rfpExcerpt?.slice(0, 10000),
          libraryAtoms,
        });

        if (result.nodes && result.nodes.length > 0) {
          onSectionDrafted(sec.id, result.nodes);
          setProgress((prev) => ({ ...prev, [sec.id]: 'done' }));
        } else {
          setProgress((prev) => ({ ...prev, [sec.id]: 'failed' }));
        }
      } catch {
        setProgress((prev) => ({ ...prev, [sec.id]: 'failed' }));
      }
    }

    onComplete();
  }

  if (emptySections.length === 0 && !started) {
    return null; // All sections already have content
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-sm text-indigo-900">AI Section Drafter</h3>
          <p className="text-xs text-indigo-700 mt-0.5">
            {emptySections.length} empty section{emptySections.length !== 1 ? 's' : ''} ready for AI drafting
          </p>
        </div>
        {!started && (
          <button
            onClick={handleDraftAll}
            disabled={loading || emptySections.length === 0}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
          >
            Draft All Sections
          </button>
        )}
      </div>

      {started && (
        <div className="space-y-1.5">
          {emptySections.map((sec) => {
            const status = progress[sec.id] ?? 'pending';
            return (
              <div key={sec.id} className="flex items-center gap-2 text-xs">
                <span className={`w-2 h-2 rounded-full ${
                  status === 'done' ? 'bg-green-500' :
                  status === 'drafting' ? 'bg-yellow-500 animate-pulse' :
                  status === 'failed' ? 'bg-red-500' :
                  'bg-gray-300'
                }`} />
                <span className={`${
                  status === 'done' ? 'text-green-700' :
                  status === 'drafting' ? 'text-yellow-700' :
                  status === 'failed' ? 'text-red-600' :
                  'text-gray-500'
                }`}>
                  {sec.title}
                  {status === 'drafting' && ' — drafting...'}
                  {status === 'done' && ' — drafted'}
                  {status === 'failed' && ' — failed (will retry)'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {allDone && (
        <p className="mt-3 text-xs text-indigo-700 font-medium">
          All sections drafted. Review each section and accept or revise the AI content.
        </p>
      )}

      {error && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
