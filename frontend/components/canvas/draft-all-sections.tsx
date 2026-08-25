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
import { createEmptyCanvas, CANVAS_PRESETS, getNodeText, type CanvasNode } from '@/lib/types/canvas-document';

/**
 * An atom's body as text the drafter can read, whether it is prose or structure.
 *
 * `content` holds prose; `canvasNodes` holds the real nodes for a table, schedule, figure or list.
 * Flattening the latter with the canvas's own `getNodeText` keeps ONE definition of "the words in
 * this node" — a second extractor here would drift from the one the rest of the canvas uses.
 */
function atomText(a: { content: string | null; canvasNodes: CanvasNode[] | null }): string {
  if (a.content && a.content.trim()) return a.content.trim();
  const fromNodes = (a.canvasNodes ?? []).map(getNodeText).filter((t) => t && t.trim()).join('\n');
  return fromNodes.trim();
}

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
  /** The VOLUME's page cap, stamped on the section's canvas at provision — NOT the section's
   *  own share (`pageLimit`). An AI-draft landing must preserve it. */
  canvasMaxPages?: number | null;
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
          // Scale retrieval to the section's ALLOWANCE. A flat 5 atoms was the same budget for a one-page
        // abstract and a ten-page technical volume, so the long section ran out of material to write
        // from and stopped at a fraction of its page envelope (measured: 60%% of a 10-page volume,
        // with the ranker returning nothing further). ~4 atoms per allowed page, floored at 5 so
        // short sections behave exactly as before and capped at 40 to bound the prompt.
          const atomLimit = Math.min(40, Math.max(5, (sec.pageLimit ?? 1) * 4));
          const qs = new URLSearchParams({ vol, limit: String(atomLimit), sectionId: sec.id });
          if (kinds.length) qs.set('kinds', kinds.join(','));
          if (context.length) qs.set('context', context.join(','));
          // the section title is the semantic query — ranks atoms by MEANING when embeddings are on
          if (sec.title) qs.set('text', sec.title);
          // sectionId lets the selector record these as the section's source atoms,
          // so the atom return at lock can set lineage back to them.
          const res = await fetch(`/api/portal/${tenantSlug}/atoms/select?${qs.toString()}`);
          if (res.ok) {
            const ranked = ((await res.json()).data?.atoms ?? []) as Array<{
              id: string; content: string | null; canvasNodes: CanvasNode[] | null;
            }>;
            // A STRUCTURED ATOM IS NOT AN EMPTY ONE. An atom's body lives in `content` when it is
            // prose and in `canvasNodes` when it is a table, a schedule, a figure or a list — and
            // this filtered on `content` alone, so every structured atom was dropped on the way to
            // the drafter. Measured on this box: 699 of 2,148 approved atoms (30% of one tenant's
            // library, 69% of another's) carry their body only in canvasNodes.
            //
            // The consequence was not "slightly less context." The drafter has no retrieval of its
            // own — `libraryAtoms` is an INPUT — so a section whose best material is a schedule
            // table got an empty list and correctly answered "No approved library content was
            // retrieved", while a dozen relevant atoms sat one field away. The selector already
            // returns canvasNodes for exactly this reason ("so structured atoms insert
            // faithfully"); only this bridge ignored them.
            libraryAtoms = ranked
              .map((a) => ({ id: a.id, category: vol, content: atomText(a) }))
              .filter((a) => a.content.length > 0);
          }
        } catch {
          // Library selection failure is non-fatal — draft without library context
        }

        // Draft the section
        const result = await invoke<{ nodes: CanvasNode[] }>('proposal.draft_section', {
          proposalId,
          sectionId: sec.id,
          sectionTitle: sec.title,
          pageLimit: sec.pageLimit,
          requiredSubsections: sec.requiredSubsections,
          evaluationCriteria,
          rfpExcerpt: rfpExcerpt?.slice(0, 10000),
          libraryAtoms,
          instruction: sec.expertNotes?.trim() || undefined,
        });

        if (result.nodes && result.nodes.length > 0) {
          // PERSIST the drafted nodes. The draft tool is pure (returns nodes, writes
          // no SQL), so without this PUT the content is discarded on the next
          // router.refresh() and the section reopens empty. Wrap the nodes in a valid
          // CanvasDocument (the section editor requires a `version` field) and save
          // through the same route the canvas editor uses — which archives a version,
          // sets status='ai_drafted', and emits section.saved. Draft-All only targets
          // genuinely-empty sections, so there is no prior canvas content to preserve.
          const now = new Date().toISOString();
          // Preserve the VOLUME's page cap, which provisioning stamped onto this section's canvas
          // and the sections list returns as `canvasMaxPages`. It is NOT the section's own share
          // (page_allocation, carried separately as layout.page_budget at assembly), and it is not
          // the preset's hard-coded 15 — rebuilding from the bare preset made the compliance floor
          // measure against a limit the solicitation never gave.
          const doc = createEmptyCanvas({
            documentId: sec.id,
            canvas: sec.canvasMaxPages != null && sec.canvasMaxPages > 0
              ? { ...CANVAS_PRESETS.letter_sbir_phase1, max_pages: sec.canvasMaxPages }
              : CANVAS_PRESETS.letter_sbir_phase1,
            metadata: {
              title: sec.title,
              volume_id: '',
              required_item_id: '',
              proposal_id: proposalId,
              solicitation_id: '',
              created_at: now,
              last_modified_at: now,
              last_modified_by: '',
              version_number: 1,
              status: 'ai_drafted',
            },
          });
          doc.nodes = result.nodes;
          const saveRes = await fetch(
            `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sec.id}/save`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: doc, status: 'ai_drafted', source: 'ai_draft' }),
            },
          );
          if (saveRes.ok) {
            onSectionDrafted(sec.id, result.nodes);
            setProgress((prev) => ({ ...prev, [sec.id]: 'done' }));
          } else {
            setProgress((prev) => ({ ...prev, [sec.id]: 'failed' }));
          }
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
