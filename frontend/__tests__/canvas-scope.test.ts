/**
 * The scope ladder — one resolver, two surfaces.
 *
 * Grounding, before the code: the canvas overlays are CSS chips keyed off `data-node-id`. They SHOW
 * boundaries and compute nothing, so nothing could answer "what encloses this node". Two features
 * were stuck at fixed granularity as a result — the right-hand assist bar had no notion of level,
 * and colour-team review is hard-wired to SECTION (`agent_task_queue` carries proposal_id +
 * section_id, one task per section). A reviewer could not be pointed at a figure, a group or a page
 * range because there was no way to name them.
 *
 * The variety here is deliberate: flat documents and sectioned ones, prose-only and figure-heavy,
 * one section and many, short and multi-page. A resolver that only works on the shape it was
 * written against is not a resolver.
 */
import { describe, it, expect } from 'vitest';
import { resolveScope, focusOf, reviewableScopes, spanOfNodes, type Scope } from '@/lib/canvas/scope';
import { CANVAS_PRESETS, paginate, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

const CANVAS = CANVAS_PRESETS.letter_standard;
const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second and '
  + 'formwork automation reduced on-site labour by sixty percent across the validated build. ';

const n = (id: string, type: string, content: Record<string, unknown>) =>
  ({ id, type, content } as unknown as CanvasNode);
const text = (id: string, reps = 2) => n(id, 'text_block', { text: PROSE.repeat(reps) });
const figure = (id: string) => n(id, 'image', { storage_key: 'k.png', alt_text: 'a', width: 480, height: 300 });
const caption = (id: string) => n(id, 'caption', { prefix: 'Figure', number: 1, text: 'The gantry.' });

const grp = (id: string, nodes: CanvasNode[], atomRef?: string) =>
  ({ id, label: `Group ${id}`, atom_ref: atomRef, keep_together: false, nodes });

const sectioned = (spec: Array<{ id: string; title: string; groups: ReturnType<typeof grp>[]; atoms?: string[] }>) =>
  ({ version: 2, document_id: 'doc-1', canvas: CANVAS,
     sections: spec.map((s) => ({ id: s.id, title: s.title, layout: { mode: 'flow' },
       groups: s.groups, source_atom_ids: s.atoms ?? [] })) } as unknown as CanvasDocument);

const flat = (nodes: CanvasNode[]) =>
  ({ version: 2, document_id: 'flat-1', canvas: CANVAS, nodes } as unknown as CanvasDocument);

/** A realistic multi-section doc: prose, a figure pair, and a long tail that spills pages. */
const RICH = sectioned([
  { id: 'sec-a', title: 'Technical Approach', atoms: ['atom-1', 'atom-2'],
    groups: [grp('g1', [text('a1', 4)], 'atom-1'), grp('g2', [figure('a2'), caption('a3')], 'atom-2')] },
  { id: 'sec-b', title: 'Work Plan', atoms: ['atom-3'],
    groups: [grp('g3', [text('b1', 12)], 'atom-3')] },
  { id: 'sec-c', title: 'Key Personnel', atoms: [],
    groups: [grp('g4', [text('c1', 1)])] },
]);

const levels = (l: Scope[]) => l.map((s) => s.level);

describe('the ladder', () => {
  it('a node resolves node → group → section → document', () => {
    expect(levels(resolveScope(RICH, { nodeId: 'a1' }))).toEqual(['node', 'group', 'section', 'document']);
  });

  it('a group resolves group → section → document', () => {
    expect(levels(resolveScope(RICH, { groupId: 'g2' }))).toEqual(['group', 'section', 'document']);
  });

  it('a section resolves section → document', () => {
    expect(levels(resolveScope(RICH, { sectionId: 'sec-b' }))).toEqual(['section', 'document']);
  });

  it('always ends at document, so "widen to the whole volume" needs no special case', () => {
    for (const sel of [{ nodeId: 'a1' }, { groupId: 'g3' }, { sectionId: 'sec-c' }, {}]) {
      expect(levels(resolveScope(RICH, sel)).at(-1)).toBe('document');
    }
  });

  it('focusOf is the innermost scope', () => {
    expect(focusOf(resolveScope(RICH, { nodeId: 'a2' })).level).toBe('node');
    expect(focusOf(resolveScope(RICH, { sectionId: 'sec-a' })).level).toBe('section');
  });

  it('an unknown selection still yields the document', () => {
    expect(levels(resolveScope(RICH, { nodeId: 'nope' }))).toEqual(['document']);
  });
});

describe('a flat document has no group or section to invent', () => {
  const doc = flat([text('f1'), text('f2'), figure('f3')]);

  it('resolves node → document, honestly skipping the levels that do not exist', () => {
    expect(levels(resolveScope(doc, { nodeId: 'f2' }))).toEqual(['node', 'document']);
  });

  it('its document scope still holds every node', () => {
    expect(focusOf(resolveScope(doc, {})).nodes).toHaveLength(3);
  });
});

describe('content at each level', () => {
  it('a node scope holds exactly its node', () => {
    expect(focusOf(resolveScope(RICH, { nodeId: 'a2' })).nodes.map((x) => x.id)).toEqual(['a2']);
  });

  it('a group scope holds its whole run — the figure AND its caption', () => {
    // The reason the group level exists: node scope would review the image alone.
    expect(focusOf(resolveScope(RICH, { groupId: 'g2' })).nodes.map((x) => x.id)).toEqual(['a2', 'a3']);
  });

  it('a section scope holds every node across its groups', () => {
    expect(focusOf(resolveScope(RICH, { sectionId: 'sec-a' })).nodes.map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('characters are counted per level and grow outward', () => {
    const l = resolveScope(RICH, { nodeId: 'a1' });
    const [node, group, section, doc] = l;
    expect(node.characters).toBeGreaterThan(0);
    expect(section.characters).toBeGreaterThanOrEqual(group.characters);
    expect(doc.characters).toBeGreaterThanOrEqual(section.characters);
  });
});

describe('provenance travels with scope', () => {
  it('a group reports the atom it came from', () => {
    expect(focusOf(resolveScope(RICH, { groupId: 'g2' })).atomRefs).toEqual(['atom-2']);
  });

  it('a section reports every atom it was assembled from', () => {
    expect(focusOf(resolveScope(RICH, { sectionId: 'sec-a' })).atomRefs).toEqual(['atom-1', 'atom-2']);
  });

  it('a section assembled from nothing reports nothing rather than guessing', () => {
    expect(focusOf(resolveScope(RICH, { sectionId: 'sec-c' })).atomRefs).toEqual([]);
  });

  it('the document aggregates across sections', () => {
    const doc = resolveScope(RICH, {}).at(-1)!;
    expect(doc.atomRefs).toEqual(['atom-1', 'atom-2', 'atom-3']);
  });
});

describe('pages come from the same ruler the compliance gate uses', () => {
  it('a section page range matches paginate()', () => {
    const lay = paginate(RICH);
    for (const s of ['sec-a', 'sec-b', 'sec-c']) {
      const scope = focusOf(resolveScope(RICH, { sectionId: s }));
      const info = lay.perSection.find((p) => p.id === s)!;
      expect(scope.pages).toEqual({ start: info.startPage, end: info.endPage });
    }
  });

  it('the document range runs 1..totalPages', () => {
    expect(resolveScope(RICH, {}).at(-1)!.pages).toEqual({ start: 1, end: paginate(RICH).totalPages });
  });

  it('a page range resolves to the sections that fall inside it', () => {
    const l = resolveScope(RICH, { pageRange: { start: 1, end: 1 } });
    const pages = l.find((s) => s.level === 'pages')!;
    expect(pages.label).toBe('Page 1');
    expect(pages.nodes.length).toBeGreaterThan(0);
  });

  it('a multi-page range is labelled as a range', () => {
    const l = resolveScope(RICH, { pageRange: { start: 1, end: 2 } });
    expect(l.find((s) => s.level === 'pages')!.label).toBe('Pages 1–2');
  });

  it('spanOfNodes is a LOWER BOUND on the section range, never an equality', () => {
    // This assertion was wrong first time round: it demanded equality and got 1 vs 2. The
    // difference is the whole point of having two measures. `spanOfNodes` is OFFSET-BLIND — it
    // divides the run's height by the usable page height, as if the run began at the top of a
    // page. `paginate` is OFFSET-AWARE: sec-b starts partway down a page, so it spills onto a
    // second one even though its content alone would fit a single page.
    //
    // Which is precisely the BOUND invariant verify-ruler-composition already proves. Asserting
    // equality here contradicted a property established elsewhere in this repo — the section
    // gauge would have been reporting a stricter number than the document.
    for (const id of ['sec-a', 'sec-b', 'sec-c']) {
      const scope = focusOf(resolveScope(RICH, { sectionId: id }));
      const blind = spanOfNodes(scope.nodes, CANVAS);
      const aware = scope.pages!.end - scope.pages!.start + 1;
      expect(blind, `${id}: offset-blind span exceeded the paginated range`).toBeLessThanOrEqual(aware);
    }
  });
});

describe('reviewable scopes reflect the document, not a fixed list', () => {
  it('a grouped multi-section document offers group, section and document', () => {
    const r = reviewableScopes(RICH);
    expect(r).toContain('group');
    expect(r).toContain('section');
    expect(r).toContain('document');
  });

  it('a flat document offers only the document — no control that would queue nothing', () => {
    expect(reviewableScopes(flat([text('x')]))).toEqual(['document']);
  });

  it('a single-page document does not offer a page range', () => {
    const tiny = sectioned([{ id: 's', title: 'S', groups: [grp('g', [text('t', 1)])] }]);
    expect(reviewableScopes(tiny)).not.toContain('pages');
  });

  it('a multi-page document does', () => {
    expect(reviewableScopes(RICH)).toContain('pages');
  });
});
