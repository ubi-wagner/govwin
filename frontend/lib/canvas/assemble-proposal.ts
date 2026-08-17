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

/**
 * Per-section save metadata for the EDITABLE fluid surface (F2). The document GET route
 * returns one of these per section alongside the assembled `doc`; the fluid view reconstructs
 * an edited section's flat save-doc from the assembled doc + this section's own `canvas` frame +
 * `metadata`, then PUTs it through the per-section save route (which owns the canvas_versions
 * CAS + lock/stage/access enforcement). `editable` mirrors resolveUserAccess.editableSections
 * exactly, so the surface never offers an edit the API will 423.
 */
export interface FluidSectionMeta {
  id: string;
  title: string | null;
  volumeName: string | null;
  version: number;
  isLocked: boolean;
  editable: boolean;
  status: string;
  completedStage: string | null;
  /** the section's OWN canvas frame (margins/format) — a reconstructed save-doc must carry it. */
  canvas: unknown | null;
  /** the section's OWN document metadata (title/status). */
  metadata: unknown | null;
}

const anchorId = (sectionId: string) => `sec:${sectionId}`;

/** Recover the in-section node id from an assembled id (`${sectionId}__${nodeId}`). */
export function originalNodeId(assembledId: string, sectionId: string): string {
  return assembledId.startsWith(`${sectionId}__`) ? assembledId.slice(sectionId.length + 2) : assembledId;
}

/**
 * Reconstruct a SINGLE section's own flat save-doc from the (edited) assembled document — the
 * inverse of the concatenation `assembleProposalDocument` performs. Used by the editable fluid
 * surface (F2) to PUT one section through the per-section save route: take the assembled nodes
 * that belong to `sectionId` (via `sectionOf`), drop the synthetic `sec:` boundary heading,
 * un-prefix their ids back to the in-section ids, and wrap them in the section's OWN frame +
 * metadata (NOT the assembled doc's adopted single frame). Pure + order-preserving.
 */
export function reconstructSectionDoc(
  assembledDoc: CanvasDocument,
  sectionOf: Record<string, { id: string; title: string }>,
  sectionId: string,
  frame: CanvasDocument['canvas'],
  metadata: CanvasDocument['metadata'],
): CanvasDocument {
  const nodes = assembledDoc.nodes
    .filter((n) => !n.id.startsWith('sec:') && sectionOf[n.id]?.id === sectionId)
    .map((n) => ({ ...n, id: originalNodeId(n.id, sectionId) }));
  return {
    version: 1,
    document_id: `section-${sectionId}`,
    canvas: frame,
    metadata,
    nodes,
  } as CanvasDocument;
}

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
