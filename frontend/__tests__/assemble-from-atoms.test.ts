/**
 * atoms → groups → section, fitted by the intra-segment ruler.
 *
 * The assembly spine had both ends and no middle: `selectForSection` ranked atoms and
 * `assembleProposalDocument` concatenated finished sections, but nothing turned ranked atoms into
 * the `CanvasGroup[]` a `CanvasSection` is made of. The group layer the model has always carried
 * was unused, and with it three things: provenance (`atom_ref` / `source_atom_ids`), cohesion
 * (`keep_together` moving a figure and its caption as one), and budget fitting.
 *
 * The budget fit is why the ruler had to compose first. Fitting to a section's `page_budget` means
 * measuring a RUN of nodes rather than a document, which is what `sectionPageSpan` is.
 */
import { describe, it, expect } from 'vitest';
import { assembleSectionFromAtoms, assembleSections, type AssemblableAtom } from '@/lib/canvas/assemble-from-atoms';
import { CANVAS_PRESETS, sectionPageSpan, type CanvasNode } from '@/lib/types/canvas-document';

const CANVAS = CANVAS_PRESETS.letter_standard;
const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second, and '
  + 'formwork automation reduced on-site labour by sixty percent across the validated build. ';

const prose = (id: string, reps = 3): AssemblableAtom =>
  ({ id, title: `Atom ${id}`, content: PROSE.repeat(reps), canvasNodes: null });

const structured = (id: string, nodes: CanvasNode[]): AssemblableAtom =>
  ({ id, title: `Atom ${id}`, content: null, canvasNodes: nodes });

const figureWithCaption = (id: string) => structured(id, [
  { id: `${id}-img`, type: 'image', content: { storage_key: 'k.png', alt_text: 'a', width: 480, height: 300 } },
  { id: `${id}-cap`, type: 'caption', content: { prefix: 'Figure', number: 1, text: 'The gantry.' } },
] as unknown as CanvasNode[]);

describe('provenance', () => {
  it('every group records the atom it came from', () => {
    const r = assembleSectionFromAtoms([prose('a1'), prose('a2')], { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups.map((g) => g.atom_ref)).toEqual(['a1', 'a2']);
  });

  it('the section aggregates the atoms it was assembled from', () => {
    const r = assembleSectionFromAtoms([prose('a1'), prose('a2')], { title: 'Approach', canvas: CANVAS });
    expect(r.section.source_atom_ids).toEqual(['a1', 'a2']);
  });

  it('an atom that did not fit is NOT claimed as a source', () => {
    // The lineage must reflect what actually landed, or the harvest loop attributes content to an
    // atom that never contributed.
    const r = assembleSectionFromAtoms(
      [prose('fits', 1), prose('huge', 400)],
      { title: 'Approach', canvas: CANVAS, layout: { page_budget: 1 } },
    );
    expect(r.section.source_atom_ids).not.toContain('huge');
    expect(r.skipped.map((s) => s.id)).toContain('huge');
  });
});

describe('cohesion', () => {
  it('a figure with its caption is kept together', () => {
    const r = assembleSectionFromAtoms([figureWithCaption('f1')], { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups[0].keep_together).toBe(true);
  });

  it('a lone prose atom is not', () => {
    // keep_together is a claim about cohesion; asserting it everywhere would make it meaningless.
    const r = assembleSectionFromAtoms([prose('a1')], { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups[0].keep_together).toBe(false);
  });

  it('a structured atom carries its OWN nodes rather than being flattened to prose', () => {
    const r = assembleSectionFromAtoms([figureWithCaption('f1')], { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups[0].nodes.map((n) => n.type)).toEqual(['image', 'caption']);
  });
});

describe('budget fitting uses the intra-segment ruler', () => {
  it('stops at the page budget instead of overrunning it', () => {
    const atoms = Array.from({ length: 40 }, (_, i) => prose(`a${i}`, 4));
    const r = assembleSectionFromAtoms(atoms, { title: 'Approach', canvas: CANVAS, layout: { page_budget: 2 } });
    expect(r.pagesUsed).toBeLessThanOrEqual(2);
    expect(r.skipped.length).toBeGreaterThan(0);
    expect(r.skipped.every((s) => s.reason === 'page_budget' || s.reason === 'max_groups')).toBe(true);
  });

  it('reports pagesUsed as the ruler measures the assembled run', () => {
    // The assembler must not report its own arithmetic — the number has to be the ruler's, or the
    // section gauge and the compliance gate can disagree.
    const r = assembleSectionFromAtoms([prose('a1', 8), prose('a2', 8)], { title: 'Approach', canvas: CANVAS });
    const nodes = r.section.groups.flatMap((g) => g.nodes);
    expect(r.pagesUsed).toBe(sectionPageSpan(nodes, CANVAS));
  });

  it('honours a character budget where the agency measures characters', () => {
    const r = assembleSectionFromAtoms(
      [prose('a1', 1), prose('a2', 1), prose('a3', 1)],
      { title: 'Abstract', canvas: CANVAS, layout: { character_budget: 200 } },
    );
    expect(r.charactersUsed).toBeLessThanOrEqual(200);
    expect(r.skipped.some((s) => s.reason === 'character_budget')).toBe(true);
  });

  it('an unbudgeted section takes everything offered', () => {
    const atoms = Array.from({ length: 5 }, (_, i) => prose(`a${i}`));
    const r = assembleSectionFromAtoms(atoms, { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups).toHaveLength(5);
    expect(r.skipped).toHaveLength(0);
  });
});

describe('honesty about the library', () => {
  it('an atom with neither nodes nor prose is skipped, not emitted blank', () => {
    const r = assembleSectionFromAtoms(
      [{ id: 'empty', title: null, content: '   ', canvasNodes: null }],
      { title: 'Approach', canvas: CANVAS },
    );
    expect(r.section.groups).toHaveLength(0);
    expect(r.skipped).toEqual([{ id: 'empty', reason: 'empty' }]);
  });

  it('a thin library yields a thin section rather than invented filler', () => {
    const r = assembleSectionFromAtoms([prose('only', 1)], { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups).toHaveLength(1);
    expect(r.pagesUsed).toBe(1);
  });

  it('nothing offered yields an empty section, not a throw', () => {
    const r = assembleSectionFromAtoms([], { title: 'Approach', canvas: CANVAS });
    expect(r.section.groups).toHaveLength(0);
    expect(r.pagesUsed).toBe(0);
  });
});

describe('document roll-up', () => {
  it('sums the per-section spans from one measurement pass', () => {
    const spec = (t: string) => ({ atoms: [prose(`${t}1`, 6), prose(`${t}2`, 6)], opts: { title: t, canvas: CANVAS } });
    const out = assembleSections([spec('A'), spec('B'), spec('C')]);
    expect(out.sections).toHaveLength(3);
    expect(out.totalPages).toBe(out.perSection.reduce((a, r) => a + r.pagesUsed, 0));
    expect(out.totalCharacters).toBeGreaterThan(0);
  });
});
