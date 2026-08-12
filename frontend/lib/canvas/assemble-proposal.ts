/**
 * Whole-proposal document assembly (fluid-canvas F1).
 *
 * Concatenates every section's canvas into ONE continuous CanvasDocument so the proposal
 * reads as a single fluid document (each section introduced by its title heading — the
 * "boundary", inline, not a box) instead of the section-by-section card layout. Every
 * assembled node is re-keyed to stay unique across sections and mapped back to its owning
 * section (`sectionOf`) so a cross-section selection can route an action (atomize /
 * regenerate) to the right section. `outline` drives the left navigation rail.
 *
 * Pure + framework-free (parses `content` via coerceJsonb) so it is unit-testable and can
 * run server-side to hand the client a ready assembled doc.
 */
import { coerceJsonb } from '@/lib/jsonb';
import { CANVAS_PRESETS, docNodes, type CanvasDocument, type CanvasNode, type CanvasRules } from '@/lib/types/canvas-document';

export interface ProposalSectionInput {
  id: string;
  title: string | null;
  content: string | null | Record<string, unknown>;
  volumeName?: string | null;
}

export interface AssembledProposal {
  doc: CanvasDocument;
  /** assembled node id → its owning section (for routing a selection's action). */
  sectionOf: Record<string, { id: string; title: string }>;
  /** the navigation rail: each section + the id of its inline title heading (scroll anchor). */
  outline: Array<{ sectionId: string; title: string; anchorNodeId: string; volumeName?: string | null }>;
}

const anchorId = (sectionId: string) => `sec:${sectionId}`;

/** Assemble a proposal's sections into one continuous, section-tagged document. */
export function assembleProposalDocument(sections: ProposalSectionInput[]): AssembledProposal {
  const nodes: CanvasNode[] = [];
  const sectionOf: AssembledProposal['sectionOf'] = {};
  const outline: AssembledProposal['outline'] = [];
  let canvas: CanvasRules = CANVAS_PRESETS.letter_standard;

  for (const s of sections) {
    const parsed = coerceJsonb<CanvasDocument | null>(s.content, null);
    if (parsed?.canvas && parsed.canvas.format !== 'spreadsheet' && !parsed.canvas.format?.startsWith('slide')) {
      canvas = parsed.canvas; // adopt a real narrative section's frame (margins/header/font)
    }
    const title = (s.title && s.title.trim()) || 'Untitled section';
    const aId = anchorId(s.id);

    // Inline section-title heading = the fluid "boundary" + the outline scroll anchor.
    nodes.push({
      id: aId, type: 'heading',
      content: { level: 1, text: title },
      style: { color: '1F4E79', space_before: 18 },
      provenance: { source: 'template' }, history: [], library_eligible: false,
    } as unknown as CanvasNode);
    sectionOf[aId] = { id: s.id, title };
    outline.push({ sectionId: s.id, title, anchorNodeId: aId, volumeName: s.volumeName ?? null });

    for (const n of parsed ? docNodes(parsed) : []) {
      const reId = `${s.id}__${n.id}`;             // unique across sections
      nodes.push({ ...n, id: reId });
      sectionOf[reId] = { id: s.id, title };
    }
  }

  const doc: CanvasDocument = {
    version: 1,
    document_id: 'proposal-fluid',
    canvas,
    nodes,
    metadata: {
      title: 'Proposal', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted',
    },
  };
  return { doc, sectionOf, outline };
}
