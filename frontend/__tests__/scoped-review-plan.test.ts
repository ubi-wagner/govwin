/**
 * What a scoped review actually QUEUES.
 *
 * Colour-team review is hard-wired to the section: `requestAiReview` iterates `proposal_sections`
 * and queues one `color_team_reviewer` task per section, with `agent_task_queue.section_id` as the
 * only sub-proposal address there is. The scope ladder can now name a node, a group, a page range
 * and the document — so the question this file answers is what each of those turns into on the way
 * to the queue.
 *
 * Three constraints shape every expectation below, and none of them is negotiable:
 *
 *   1. THE WRITE-BACK NEEDS A SECTION. `fabric._post_section_recommendation` returns early when
 *      `section_id` is null, so a task with no section produces no comment at all — silently. Every
 *      target therefore carries a section id, even when the scope is wider than one section: the
 *      first section the scope covers is where the finding lands, and `scopeRef` records what was
 *      really reviewed. A page-range review whose finding vanishes is worse than one filed slightly
 *      too narrowly.
 *
 *   2. THE TEXT MUST BE THE SCOPE'S TEXT. If a node-scoped review is handed the whole section, the
 *      reviewer reviews the section and the anchor lies about it. `text` comes from the scope's own
 *      nodes, via the same `getNodeText` the ruler and the character cap read.
 *
 *   3. AN EMPTY SCOPE QUEUES NOTHING. A figure with no extractable text gives the reviewer nothing
 *      to review; queueing it spends the tenant's hourly budget to produce an empty comment. The
 *      planner drops it, and says so by returning fewer targets than scopes.
 *
 * Stored section canvases are FLAT (`proposal_sections.content` has `nodes`, never `sections` —
 * verified against the live DB), so node scoping has to work without an enclosing `CanvasSection`.
 * That is why the planner takes a fallback section id rather than reading one out of the document.
 */
import { describe, it, expect } from 'vitest';
import { planReviewTargets } from '@/lib/canvas/scope';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

const CANVAS = CANVAS_PRESETS.letter_standard;
const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second and '
  + 'formwork automation cut on-site labour by sixty percent across the validated build. ';

const n = (id: string, type: string, content: Record<string, unknown>) =>
  ({ id, type, content } as unknown as CanvasNode);
const text = (id: string, reps = 2) => n(id, 'text_block', { text: PROSE.repeat(reps) });
const figure = (id: string) => n(id, 'image', { storage_key: 'k.png', alt_text: '', width: 480, height: 300 });
const grp = (id: string, nodes: CanvasNode[], atomRef?: string) =>
  ({ id, label: `Group ${id}`, atom_ref: atomRef, keep_together: false, nodes });

const RICH = ({
  version: 2, document_id: 'doc-1', canvas: CANVAS,
  sections: [
    { id: 'sec-a', title: 'Technical Approach', layout: { mode: 'flow' }, source_atom_ids: ['atom-1'],
      groups: [grp('g1', [text('a1', 4)], 'atom-1'), grp('g2', [figure('a2')], 'atom-2')] },
    { id: 'sec-b', title: 'Work Plan', layout: { mode: 'flow' }, source_atom_ids: ['atom-3'],
      groups: [grp('g3', [text('b1', 14)], 'atom-3')] },
    { id: 'sec-c', title: 'Key Personnel', layout: { mode: 'flow' }, source_atom_ids: [],
      groups: [grp('g4', [text('c1', 1)])] },
  ],
} as unknown as CanvasDocument);

/** A stored section canvas: flat nodes, no section wrapper. This is the real shape on disk. */
const FLAT = ({
  version: 2, document_id: 'flat-1', canvas: CANVAS,
  nodes: [text('f1', 3), figure('f2'), text('f3', 2)],
} as unknown as CanvasDocument);

describe('a node-scoped review', () => {
  it('queues one target carrying only that node’s text', () => {
    const [t, ...rest] = planReviewTargets(RICH, { nodeId: 'a1' });
    expect(rest).toHaveLength(0);
    expect(t.scopeLevel).toBe('node');
    expect(t.scopeRef).toEqual({ nodeId: 'a1' });
    expect(t.text).toContain('forty millimetres');
    // The section's OTHER group must not be in the payload — that is the whole point.
    expect(t.text.length).toBeLessThan(PROSE.length * 6);
  });

  it('addresses the enclosing section so the finding can land', () => {
    expect(planReviewTargets(RICH, { nodeId: 'b1' })[0].sectionId).toBe('sec-b');
  });

  it('falls back to the caller’s section id on a flat stored canvas', () => {
    const [t] = planReviewTargets(FLAT, { nodeId: 'f1' }, { sectionIdFallback: 'sec-z' });
    expect(t.sectionId).toBe('sec-z');
    expect(t.scopeLevel).toBe('node');
  });

  it('drops a node with no reviewable text rather than queueing an empty review', () => {
    // An image with no alt text yields nothing for a text reviewer to read.
    expect(planReviewTargets(FLAT, { nodeId: 'f2' }, { sectionIdFallback: 'sec-z' })).toEqual([]);
  });
});

describe('a group-scoped review', () => {
  it('carries every node in the group and names the atom it came from', () => {
    const [t] = planReviewTargets(RICH, { groupId: 'g1' });
    expect(t.scopeLevel).toBe('group');
    expect(t.scopeRef).toEqual({ groupId: 'g1' });
    expect(t.sectionId).toBe('sec-a');
    expect(t.atomRefs).toEqual(['atom-1']);
  });
});

describe('a section-scoped review', () => {
  it('is one target over the whole section', () => {
    const [t, ...rest] = planReviewTargets(RICH, { sectionId: 'sec-a' });
    expect(rest).toHaveLength(0);
    expect(t.scopeLevel).toBe('section');
    expect(t.scopeRef).toBeNull();
    expect(t.sectionId).toBe('sec-a');
  });
});

describe('a page-range review', () => {
  it('files against the FIRST section it covers, and records the real range', () => {
    // sec-b is long enough to run past page 1, so pages 1-2 covers more than one section.
    const [t, ...rest] = planReviewTargets(RICH, { pageRange: { start: 1, end: 2 } });
    expect(rest).toHaveLength(0);
    expect(t.scopeLevel).toBe('pages');
    expect(t.scopeRef).toEqual({ pages: { start: 1, end: 2 } });
    expect(t.sectionId).toBe('sec-a');
    expect(t.pages).toEqual({ start: 1, end: 2 });
  });

  it('reviews the text of every section in the range, not just the one it files against', () => {
    const [t] = planReviewTargets(RICH, { pageRange: { start: 1, end: 9 } });
    expect(t.text).toContain('forty millimetres');
    expect(t.text.length).toBeGreaterThan(PROSE.length * 10);
  });

  it('works on a FLAT canvas — the only shape the product actually stores', () => {
    // The regression this exists for: resolving a page range through `perSection` matched nothing
    // on a flat document, so the review queued nothing and said nothing about why.
    const long = ({
      version: 2, document_id: 'flat-long', canvas: CANVAS,
      nodes: Array.from({ length: 12 }, (_, i) => text(`p${i}`, 6)),
    } as unknown as CanvasDocument);
    const [t] = planReviewTargets(long, { pageRange: { start: 1, end: 1 } }, { sectionIdFallback: 'sec-z' });
    expect(t).toBeTruthy();
    expect(t.sectionId).toBe('sec-z');
    expect(t.text.length).toBeGreaterThan(0);
  });

  it('a narrow range on a flat canvas reviews LESS than a wide one', () => {
    // SENSITIVITY: without this, "it selected something" would pass even if the range were ignored
    // and every page returned the whole document.
    const long = ({
      version: 2, document_id: 'flat-long', canvas: CANVAS,
      nodes: Array.from({ length: 24 }, (_, i) => text(`p${i}`, 6)),
    } as unknown as CanvasDocument);
    const one = planReviewTargets(long, { pageRange: { start: 1, end: 1 } }, { sectionIdFallback: 's' })[0];
    const all = planReviewTargets(long, { pageRange: { start: 1, end: 99 } }, { sectionIdFallback: 's' })[0];
    expect(one.text.length).toBeLessThan(all.text.length);
  });
});

describe('a document-scoped review', () => {
  it('is one target over everything, filed against the first section', () => {
    const [t, ...rest] = planReviewTargets(RICH, {});
    expect(rest).toHaveLength(0);
    expect(t.scopeLevel).toBe('document');
    expect(t.sectionId).toBe('sec-a');
    expect(t.label).toBe('Whole document');
  });
});

describe('a selection that names something must resolve to it', () => {
  // FOUND LIVE, NOT BY READING. `resolveScope` always ends its ladder at `document` so a UI can
  // offer "widen to the whole volume" without a special case. When nothing else resolved, that made
  // `document` the INNERMOST rung — so a request to review one figure queued a review of the entire
  // proposal, and returned 200 for it. Measured on a running box: `{groupId:'g-method'}` and
  // `{nodeId:'no-such-node'}` both stored scope_level='document'.
  const cases: Array<[string, Parameters<typeof planReviewTargets>[1]]> = [
    ['a node that does not exist', { nodeId: 'no-such-node' }],
    ['a group that does not exist', { groupId: 'no-such-group' }],
    ['a section that does not exist', { sectionId: 'no-such-section' }],
  ];
  it.each(cases)('%s queues NOTHING rather than the whole document', (_l, sel) => {
    expect(planReviewTargets(RICH, sel, { sectionIdFallback: 'sec-a' })).toEqual([]);
  });

  it('a page range outside the document queues nothing', () => {
    expect(planReviewTargets(RICH, { pageRange: { start: 400, end: 500 } },
      { sectionIdFallback: 'sec-a' })).toEqual([]);
  });

  it('but an EMPTY selection still means the whole document', () => {
    // SENSITIVITY: the guard must reject unresolvable selections without also breaking the one
    // level that legitimately has nothing to name.
    expect(planReviewTargets(RICH, {})[0].scopeLevel).toBe('document');
  });
});

describe('the guarantees that keep a finding from vanishing', () => {
  it('every target has a section id, at every level', () => {
    const sels = [
      { nodeId: 'a1' }, { groupId: 'g3' }, { sectionId: 'sec-c' },
      { pageRange: { start: 2, end: 3 } }, {},
    ];
    for (const sel of sels) {
      for (const t of planReviewTargets(RICH, sel)) {
        expect(t.sectionId, `${JSON.stringify(sel)} produced a target with no section`).toBeTruthy();
      }
    }
  });

  it('never queues a target whose text is empty', () => {
    const empty = ({ version: 2, document_id: 'e', canvas: CANVAS, nodes: [figure('x1')] } as unknown as CanvasDocument);
    expect(planReviewTargets(empty, {}, { sectionIdFallback: 's' })).toEqual([]);
  });

  it('truncates a document-sized payload to the reviewer’s window', () => {
    const huge = ({
      version: 2, document_id: 'h', canvas: CANVAS,
      sections: [{ id: 's1', title: 'Big', layout: { mode: 'flow' }, source_atom_ids: [],
        groups: [grp('gg', [text('t1', 3000)])] }],
    } as unknown as CanvasDocument);
    const [t] = planReviewTargets(huge, {});
    expect(t.text.length).toBeLessThanOrEqual(20000);
  });
});
