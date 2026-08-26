/**
 * The missing middle of the assembly spine: ATOMS → GROUPS → SECTION.
 *
 * The two ends already existed. `selectForSection` (lib/atoms.ts) ranks a tenant's library atoms
 * for a section and returns each with its real `canvasNodes`, so a structured atom — an image, a
 * table, a chart — travels intact rather than being flattened to prose. `assembleProposalDocument`
 * (lib/canvas/assemble-proposal.ts) concatenates finished sections into one fluid document. What
 * sat between them was nothing: no step turned ranked atoms into the `CanvasGroup[]` a
 * `CanvasSection` is made of, so the group layer — which the model has always had — was unused.
 *
 * WHY THE GROUP LAYER EARNS ITS KEEP. A group is the unit an author thinks in and the unit the
 * paginator respects. Three things ride on it:
 *
 *   PROVENANCE   `atom_ref` records which library atom a run of nodes came from, and the section's
 *                `source_atom_ids` aggregates them. That is what makes the harvest-with-lineage
 *                loop possible: content assembled from the library can be traced back to it, and
 *                a later edit can be offered back as a new atom.
 *   COHESION     `keep_together` moves a whole group across a page edge rather than splitting it.
 *                A figure and its caption are one thought; so are a table and the sentence that
 *                introduces it. Node-level atomicity cannot express that — an image is atomic on
 *                its own, but nothing stops its caption landing on the next page without it.
 *   BUDGET       a section carries a soft `page_budget`, and fitting to it requires measuring a
 *                RUN of nodes, not a document. That is exactly what `sectionPageSpan` is, and it
 *                is why the ruler had to compose before this could be written: the assembler asks
 *                "how many pages am I at?" after each group and stops when the budget is met.
 *
 * The assembler never invents content. Every node comes from an atom the selector returned — an
 * atom's own `canvasNodes` when it has them, else its prose as a text_block. A thin library
 * therefore yields a thin section, which is the honest signal about retrieval rather than a
 * flattering one.
 */
import {
  sectionPageSpan, countCharacters,
  type CanvasDocument, type CanvasGroup, type CanvasNode, type CanvasSection, type SectionLayout,
} from '@/lib/types/canvas-document';

/** The slice of a ranked atom this needs — structurally compatible with `RankedAtom`. */
export interface AssemblableAtom {
  id: string;
  title: string | null;
  content: string | null;
  canvasNodes: CanvasNode[] | null;
}

export interface AssembleOptions {
  /** The section being built. */
  title: string;
  section_type?: string;
  /** Page/character budgets and break intent. `page_budget` drives the fit below. */
  layout?: Partial<SectionLayout>;
  /** The frame the budget is measured against — margins and page size come from here. */
  canvas: CanvasDocument['canvas'];
  /** Hard ceiling on groups regardless of budget, so a huge library cannot produce a huge section. */
  maxGroups?: number;
}

export interface AssembleResult {
  section: CanvasSection;
  /** Atoms that were offered but did not fit the budget — surfaced, never silently dropped. */
  skipped: Array<{ id: string; reason: 'page_budget' | 'character_budget' | 'max_groups' | 'empty' }>;
  /** Pages the assembled section occupies, by the same ruler the compliance gate uses. */
  pagesUsed: number;
  charactersUsed: number;
}

/** Node types that must not be separated from what follows them (a figure from its caption). */
const BINDS_FORWARD = new Set<CanvasNode['type']>(['image', 'chart', 'table']);

let gseq = 0;
const gid = (atomId: string) => `g-${atomId.slice(0, 8)}-${++gseq}`;

/**
 * One atom → the nodes it contributes. A structured atom brings its own; a prose atom becomes a
 * text_block. Returns [] when the atom carries neither, which the caller records as `skipped:empty`
 * rather than emitting a blank group.
 */
function nodesForAtom(atom: AssemblableAtom): CanvasNode[] {
  if (atom.canvasNodes?.length) return atom.canvasNodes;
  const text = (atom.content ?? '').trim();
  if (!text) return [];
  return [{
    id: `n-${atom.id.slice(0, 8)}`,
    type: 'text_block',
    content: { text },
  } as unknown as CanvasNode];
}

/**
 * Should this group move as one? True when it leads with something that binds to what follows —
 * a figure, chart or table whose caption or explanatory sentence must not be orphaned onto the
 * next page. Node-level atomicity keeps the IMAGE intact; only the group keeps the PAIR intact.
 */
function bindsTogether(nodes: CanvasNode[]): boolean {
  if (nodes.length < 2) return false;
  return nodes.some((n, i) => BINDS_FORWARD.has(n.type) && i < nodes.length - 1);
}

/**
 * Assemble a section from ranked atoms, fitting to the section's page budget with the same ruler
 * the compliance gate enforces.
 *
 * Atoms are consumed in the order given — the selector has already ranked them, and re-sorting
 * here would silently override retrieval. The fit is greedy and CONSERVATIVE: a group is added,
 * the run re-measured, and if that pushed the section past its budget the group is removed again
 * and recorded as skipped. Measuring after the fact rather than predicting is the only way to be
 * right about a run whose margins collapse and whose atomic nodes reflow.
 */
export function assembleSectionFromAtoms(
  atoms: AssemblableAtom[],
  opts: AssembleOptions,
): AssembleResult {
  const groups: CanvasGroup[] = [];
  const sourceAtomIds: string[] = [];
  const skipped: AssembleResult['skipped'] = [];
  const maxGroups = opts.maxGroups ?? 24;
  const pageBudget = opts.layout?.page_budget ?? null;
  const charBudget = opts.layout?.character_budget ?? null;

  const flat = () => groups.flatMap((g) => g.nodes);

  for (const atom of atoms) {
    if (groups.length >= maxGroups) { skipped.push({ id: atom.id, reason: 'max_groups' }); continue; }

    const nodes = nodesForAtom(atom);
    if (!nodes.length) { skipped.push({ id: atom.id, reason: 'empty' }); continue; }

    const group: CanvasGroup = {
      id: gid(atom.id),
      label: atom.title ?? undefined,
      atom_ref: atom.id,
      keep_together: bindsTogether(nodes),
      nodes,
    };
    groups.push(group);

    // Measure AFTER adding — margins collapse and atomic nodes reflow, so a predicted height is a
    // guess and a measured one is not.
    if (charBudget != null && countCharacters(flat()) > charBudget) {
      groups.pop();
      skipped.push({ id: atom.id, reason: 'character_budget' });
      continue;
    }
    if (pageBudget != null && sectionPageSpan(flat(), opts.canvas) > pageBudget) {
      groups.pop();
      skipped.push({ id: atom.id, reason: 'page_budget' });
      continue;
    }
    sourceAtomIds.push(atom.id);
  }

  const nodes = flat();
  return {
    section: {
      id: `s-${(opts.section_type ?? opts.title).toLowerCase().replace(/\W+/g, '-').slice(0, 32)}`,
      title: opts.title,
      section_type: opts.section_type,
      layout: { mode: 'flow', ...opts.layout } as SectionLayout,
      groups,
      source_atom_ids: sourceAtomIds,
    },
    skipped,
    pagesUsed: nodes.length ? sectionPageSpan(nodes, opts.canvas) : 0,
    charactersUsed: countCharacters(nodes),
  };
}

/**
 * Assemble several sections and report the document-level roll-up.
 *
 * The per-section spans are computed by the intra-segment ruler and the total by the same one, so
 * a caller can show "§2 is 3 of its 4 pages · the volume is 11 of 15" from one measurement pass —
 * the compositionality the ruler work exists to provide.
 */
export function assembleSections(
  specs: Array<{ atoms: AssemblableAtom[]; opts: AssembleOptions }>,
): { sections: CanvasSection[]; perSection: AssembleResult[]; totalPages: number; totalCharacters: number } {
  const perSection = specs.map((s) => assembleSectionFromAtoms(s.atoms, s.opts));
  return {
    sections: perSection.map((r) => r.section),
    perSection,
    // Sum of section spans, NOT a document pagination: sections may share a page, so this is an
    // upper bound the caller can present per-section. `paginate()` remains the authority on the
    // document's real page count.
    totalPages: perSection.reduce((a, r) => a + r.pagesUsed, 0),
    totalCharacters: perSection.reduce((a, r) => a + r.charactersUsed, 0),
  };
}
