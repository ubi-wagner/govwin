/**
 * WHICH PAGE IS THIS NODE ON — the question the ruler could not answer.
 *
 * Found by building the scope ladder on top of it rather than by reading it. `resolveScope`'s
 * `pages` rung looked correct and passed its own tests, because those tests used a SECTIONED
 * document. Then the review planner met the real data:
 *
 *   proposal_sections.content   → { version, metadata, document_id, nodes, canvas }   ← flat
 *   assembleProposalDocument()  → { version, document_id, canvas, nodes, metadata }   ← flat
 *
 * Neither has a `sections` array. Verified against the live DB: `SELECT DISTINCT
 * jsonb_object_keys(content::jsonb) FROM proposal_sections` returns exactly those five keys, and
 * `sections` is not among them. So on every document the product actually stores, page-scoping
 * resolved against `paginate().perSection` — whose ids, for a flat document, come from
 * `toSections()` and are `crypto.randomUUID()`, freshly minted on every call and matching nothing.
 * A page-range scope therefore selected no nodes at all, silently.
 *
 * The fix is to make the ruler report what it already knows. It walks every node deciding what page
 * that node lands on; it just never wrote the answer down. `perNode` writes it down.
 *
 * The invariant that matters more than the feature: adding this must not move a single measurement.
 * `totalPages`, `perSection` and every existing gate read the same numbers before and after — the
 * ruler is the export safety gate, and an under-count there clears a volume that is over its
 * agency page limit. So the tests below check the new answer AND pin the old ones.
 */
import { describe, it, expect } from 'vitest';
import {
  paginate, CANVAS_PRESETS, type CanvasDocument, type CanvasNode,
} from '@/lib/types/canvas-document';

const CANVAS = CANVAS_PRESETS.letter_standard;
const PROSE = 'Foundation 3DCP prints structural concrete walls at forty millimetres per second, and '
  + 'the formwork automation cut on-site labour by sixty percent across every validated build. ';

const n = (id: string, type: string, content: Record<string, unknown>) =>
  ({ id, type, content } as unknown as CanvasNode);
const text = (id: string, reps: number) => n(id, 'text_block', { text: PROSE.repeat(reps) });
const brk = (id: string) => n(id, 'page_break', {});
const bigFigure = (id: string) => n(id, 'image', { storage_key: 'k.png', alt_text: 'gantry', width: 600, height: 700 });

const flat = (nodes: CanvasNode[], id = 'flat') =>
  ({ version: 2, document_id: id, canvas: CANVAS, nodes } as unknown as CanvasDocument);

const grp = (id: string, nodes: CanvasNode[], keep = false) =>
  ({ id, nodes, keep_together: keep });

const sectioned = (specs: Array<{ id: string; groups: ReturnType<typeof grp>[]; keep?: boolean }>) =>
  ({ version: 2, document_id: 'sec', canvas: CANVAS,
     sections: specs.map((s) => ({ id: s.id, title: s.id, groups: s.groups,
       layout: { mode: s.keep ? 'keep_together' : 'flow' } })) } as unknown as CanvasDocument);

const byId = (doc: CanvasDocument) =>
  Object.fromEntries(paginate(doc).perNode.map((p) => [p.id, p]));

describe('every node reports the page it lands on', () => {
  it('covers a flat document — the shape the product actually stores', () => {
    const doc = flat([text('a', 1), text('b', 1), text('c', 1)]);
    const { perNode } = paginate(doc);
    expect(perNode.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    for (const p of perNode) {
      expect(p.startPage).toBeGreaterThanOrEqual(1);
      expect(p.endPage).toBeGreaterThanOrEqual(p.startPage);
    }
  });

  it('a long run really does advance the page, node by node', () => {
    const doc = flat(Array.from({ length: 14 }, (_, i) => text(`t${i}`, 6)));
    const p = paginate(doc);
    const pages = p.perNode.map((x) => x.startPage);
    expect(p.totalPages).toBeGreaterThan(1);
    // SENSITIVITY: if every node claimed page 1 the assertions above would still pass.
    expect(new Set(pages).size).toBeGreaterThan(1);
    expect(Math.max(...pages)).toBe(p.totalPages);
  });

  it('start pages are non-decreasing in document order', () => {
    const doc = flat([text('a', 5), bigFigure('f'), text('b', 9), brk('pb'), text('c', 3)]);
    const seq = paginate(doc).perNode.map((x) => x.startPage);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
  });

  it('an explicit page break puts what follows on the next page', () => {
    const m = byId(flat([text('a', 1), brk('pb'), text('b', 1)]));
    expect(m.b.startPage).toBe(m.a.startPage + 1);
  });

  it('a node taller than a page spans a range, not a point', () => {
    const m = byId(flat([text('huge', 60)]));
    expect(m.huge.endPage).toBeGreaterThan(m.huge.startPage);
  });
});

describe('nodes that move as one report as one', () => {
  it('a keep_together group shares its block’s page range', () => {
    // Fill most of page 1, then a group that cannot fit in the remainder.
    const doc = sectioned([{ id: 's1', groups: [
      grp('g0', [text('filler', 11)]),
      grp('g1', [text('x', 3), bigFigure('y')], true),
    ] }]);
    const m = byId(doc);
    expect(m.x.startPage).toBe(m.y.startPage);
    expect(m.x.startPage).toBeGreaterThan(m.filler.startPage);
  });

  it('a keep_together SECTION reports every node in it at the block’s range', () => {
    const doc = sectioned([
      { id: 's1', groups: [grp('g0', [text('filler', 11)])] },
      { id: 's2', keep: true, groups: [grp('g1', [text('p', 2)]), grp('g2', [text('q', 2)])] },
    ]);
    const m = byId(doc);
    expect(m.p.startPage).toBe(m.q.startPage);
  });
});

describe('the measurements this must not disturb', () => {
  const CASES: Array<[string, CanvasDocument]> = [
    ['prose', flat(Array.from({ length: 20 }, (_, i) => text(`t${i}`, 4)))],
    ['figures', flat([text('a', 6), bigFigure('f1'), text('b', 6), bigFigure('f2'), text('c', 6)])],
    ['breaks', flat([text('a', 2), brk('p1'), text('b', 2), brk('p2'), text('c', 2)])],
    ['sectioned', sectioned([
      { id: 's1', groups: [grp('g1', [text('a', 8)])] },
      { id: 's2', groups: [grp('g2', [text('b', 8), bigFigure('f')], true)] },
      { id: 's3', keep: true, groups: [grp('g3', [text('c', 3)])] },
    ])],
  ];

  it.each(CASES)('%s — perNode covers every node exactly once', (_label, doc) => {
    const { perNode } = paginate(doc);
    const ids = perNode.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CASES)('%s — no node is reported past the document’s last page', (_label, doc) => {
    const p = paginate(doc);
    for (const x of p.perNode) expect(x.endPage).toBeLessThanOrEqual(p.totalPages);
  });

  it.each(CASES)('%s — perSection still agrees with the nodes inside it', (_label, doc) => {
    const p = paginate(doc);
    // Where the document names its own sections, each section's span must contain its nodes'.
    if (!doc.sections?.length) return;
    const m = Object.fromEntries(p.perNode.map((x) => [x.id, x]));
    for (const s of doc.sections) {
      const info = p.perSection.find((x) => x.id === s.id);
      expect(info).toBeTruthy();
      for (const g of s.groups ?? []) {
        for (const node of g.nodes ?? []) {
          if (node.type === 'page_break') continue;
          expect(m[node.id].startPage).toBeGreaterThanOrEqual(info!.startPage);
          expect(m[node.id].endPage).toBeLessThanOrEqual(info!.endPage);
        }
      }
    }
  });
});
