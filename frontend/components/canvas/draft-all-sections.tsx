'use client';

/**
 * Draft All Sections — the "easy-bake-oven" button.
 *
 * When a proposal is provisioned with empty sections, this component
 * shows a "Draft All Sections" button that:
 *   1. For each empty section, ranks the tenant's library atoms with the
 *      scored selector (/atoms/select — scope by vol/kind, boost by context)
 *   2. Calls Claude to draft content using the selected atoms + RFP context
 *   3. Inserts the drafted nodes into each section's canvas
 *   4. Updates each section's status to 'ai_drafted'
 *
 * The user sees: sections filling up one-by-one with AI-drafted
 * content (yellow "AI draft" badges). Then they review + revise.
 */

import { useState } from 'react';
import { useTool } from '@/lib/hooks/use-tool';
import type { CanvasNode } from '@/lib/types/canvas-document';

// ─── Section title → unified-taxonomy vol (mig 101/102) ──────────────
// Map common RFP section titles to a canonical `vol` so the scored atom
// selector scopes to atoms from the same section family. Unmapped titles
// fall through to a slugified value (which matches no seeded vol → the
// section simply drafts without library atoms — the same graceful fallback
// the old keyword search had when nothing matched).

const SECTION_VOL_MAP: Record<string, string> = {
  'technical proposal': 'technical', 'technical approach': 'technical', 'technical volume': 'technical',
  'key personnel': 'key_personnel', 'personnel': 'key_personnel', 'staffing plan': 'key_personnel', 'qualifications': 'key_personnel',
  'principal investigator': 'principal_investigator',
  'past performance': 'past_performance', 'relevant experience': 'past_performance', 'corporate experience': 'past_performance',
  'commercialization': 'commercialization', 'commercialization plan': 'commercialization', 'commercialization strategy': 'commercialization',
  'facilities': 'facilities', 'facilities and equipment': 'facilities', 'equipment': 'equipment',
  'management approach': 'management', 'management plan': 'management',
  'cost proposal': 'cost', 'cost volume': 'cost', 'budget': 'cost',
  'abstract': 'abstract', 'summary': 'summary', 'project summary': 'summary',
  'statement of work': 'statement_of_work', 'work plan': 'work_plan',
  'milestones': 'milestones', 'schedule': 'milestones',
  'transition plan': 'transition_plan', 'objectives': 'objectives',
};

// Distinctive atom kinds per vol — kinds that unambiguously belong to that
// section, used to broaden recall past the vol tag. Left empty where the vol
// tag alone is the right scope (a generic 'narrative' kind would over-match
// every section, since the selector's kind clause is an OR against the vol).
const VOL_DEFAULT_KINDS: Record<string, string[]> = {
  key_personnel: ['bio', 'resume', 'headshot'],
  principal_investigator: ['bio', 'resume'],
  past_performance: ['past_perf_blurb'],
  cost: ['budget_data', 'table'],
};

function sectionToVol(title: string): string {
  const normalized = title.toLowerCase().trim();
  return SECTION_VOL_MAP[normalized] ?? normalized.replace(/\s+/g, '_');
}

interface Section {
  id: string;
  title: string;
  status: string;
  nodeCount: number;
  pageLimit?: number;
  requiredSubsections?: string[];
  // Expert's curation note for this section (the "blank mold + prompt"). Passed to
  // the drafter as the grounding instruction so a section with no atoms can still
  // draft from the expert's prompt + the fallback all-proposal atoms.
  expertNotes?: string;
}

interface Props {
  proposalId: string;
  tenantSlug: string;
  sections: Section[];
  rfpExcerpt?: string;
  evaluationCriteria?: string[];
  // Opportunity context slugs (agency/program/phase/tech) that boost atom ranking.
  context?: string[];
  onSectionDrafted: (sectionId: string, nodes: CanvasNode[]) => void;
  onComplete: () => void;
}

export function DraftAllSections({
  proposalId,
  tenantSlug,
  sections,
  rfpExcerpt,
  evaluationCriteria,
  context = [],
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
        // Pull the best-matching library atoms via the scored selector
        // (scope by vol/kind, boost by shared opportunity context, tie-break
        // on outcome/usage/recency). Groups return their members' assembled
        // content. Feeds the drafter's <library_atoms>. Non-fatal on failure.
        let libraryAtoms: Array<{ id: string; content: string; category: string; tags?: string[] }> = [];
        try {
          const vol = sectionToVol(sec.title);
          const kinds = VOL_DEFAULT_KINDS[vol] ?? [];
          const qs = new URLSearchParams({ vol, limit: '5', sectionId: sec.id });
          if (kinds.length) qs.set('kinds', kinds.join(','));
          if (context.length) qs.set('context', context.join(','));
          // sectionId lets the selector record these as the section's source atoms,
          // so the atom return at lock can set lineage back to them.
          const res = await fetch(`/api/portal/${tenantSlug}/atoms/select?${qs.toString()}`);
          if (res.ok) {
            const ranked = ((await res.json()).data?.atoms ?? []) as Array<{ id: string; content: string | null }>;
            libraryAtoms = ranked
              .filter((a) => a.content && a.content.trim())
              .map((a) => ({ id: a.id, content: a.content as string, category: vol }));
          }
        } catch {
          // Library selection failure is non-fatal — draft without library context
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
          instruction: sec.expertNotes?.trim() || undefined,
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
