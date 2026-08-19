/**
 * Document furniture — the apparatus pass that turns a drafted volume into a finished one.
 *
 * Every function under test is DETERMINISTIC by contract (same input → same output, no model
 * call), because it runs inside export paths where a surprise is a corrupted deliverable. These
 * tests pin that contract, and pin the specific failure shapes the pass exists to prevent:
 * drifted figure numbers, offsets that point past the end of trimmed text, and a document that
 * passes compliance while being obviously unfinished.
 */
import { describe, it, expect } from 'vitest';
import {
  addSectionRules,
  applyFurniture,
  buildTocNode,
  costWaterfallChart,
  emphasise,
  headroom,
  measureDocument,
  numberFigures,
  scheduleGanttChart,
  trimToCharacterCap,
  workSplitChart,
} from '@/lib/proposal/document-furniture';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

let seq = 0;
const n = (type: CanvasNode['type'], content: unknown): CanvasNode => ({
  id: `n${(seq += 1)}`,
  type,
  content: content as CanvasNode['content'],
  style: {},
  provenance: { source: 'manual' },
  history: [],
  library_eligible: false,
});
const text = (t: string) => n('text_block', { text: t });
const h1 = (t: string) => n('heading', { level: 1, text: t });

const doc = (nodes: CanvasNode[], canvas?: Partial<CanvasDocument['canvas']>): CanvasDocument =>
  ({
    canvas: { ...CANVAS_PRESETS.letter_sbir_phase1, ...canvas },
    sections: [{ id: 's1', title: 'S', groups: [{ id: 'g1', nodes }] }],
  }) as unknown as CanvasDocument;

// ── numbering ────────────────────────────────────────────────────────────────
describe('numberFigures', () => {
  it('numbers each prefix independently and in document order', () => {
    const out = numberFigures([
      n('chart', { chart_type: 'bar', title: 'Cost', categories: [], series: [] }),
      n('table', { headers: [], rows: [], sheet_name: 'Budget' }),
      n('chart', { chart_type: 'pie', title: 'Split', categories: [], series: [] }),
      n('image', { storage_key: 'k', alt_text: 'Prototype', width: 1, height: 1 }),
    ]);
    const caps = out.filter((x) => x.type === 'caption').map((x) => x.content as { prefix: string; number: number });
    expect(caps).toEqual([
      { prefix: 'Chart', number: 1, text: 'Cost' },
      { prefix: 'Table', number: 1, text: 'Budget' },
      { prefix: 'Chart', number: 2, text: 'Split' },
      { prefix: 'Figure', number: 1, text: 'Prototype' },
    ].map((c) => expect.objectContaining(c)));
  });

  it('RENUMBERS an existing caption in place and keeps the author words', () => {
    // The drift case: a figure is inserted above another, and every number below it is now wrong.
    // A proposal whose figure numbers do not match its cross-references reads as unproofed.
    const out = numberFigures([
      n('chart', { chart_type: 'bar', title: 'New first figure', categories: [], series: [] }),
      n('image', { storage_key: 'k', alt_text: 'x', width: 1, height: 1 }),
      n('caption', { prefix: 'Figure', number: 7, text: 'The authored caption' }),
    ]);
    const cap = out.find((x) => x.type === 'caption' && (x.content as { text: string }).text === 'The authored caption');
    expect(cap!.content).toMatchObject({ prefix: 'Figure', number: 1, text: 'The authored caption' });
    // and it did NOT also append a second caption for the same image
    expect(out.filter((x) => x.type === 'caption').length).toBe(2);
  });

  it('stays silent rather than inventing a caption it cannot source', () => {
    const out = numberFigures([n('image', { storage_key: 'k', alt_text: '', width: 1, height: 1 })]);
    expect(out.filter((x) => x.type === 'caption')).toHaveLength(0);
  });

  it('is idempotent — running it twice changes nothing', () => {
    const input = [
      n('chart', { chart_type: 'bar', title: 'A', categories: [], series: [] }),
      n('table', { headers: [], rows: [], sheet_name: 'B' }),
    ];
    const once = numberFigures(input);
    const twice = numberFigures(once);
    expect(twice.map((x) => [x.type, JSON.stringify(x.content)]))
      .toEqual(once.map((x) => [x.type, JSON.stringify(x.content)]));
  });
});

// ── emphasis ─────────────────────────────────────────────────────────────────
describe('emphasise', () => {
  it('bolds the first whole-word occurrence only', () => {
    const [out] = emphasise([text('The prototype is a prototype of a prototype.')], { bold: ['prototype'] });
    const runs = (out.content as { inline_formats: Array<{ start: number; length: number }> }).inline_formats;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ start: 4, length: 9, format: 'bold' });
  });

  it('does not match inside a longer word', () => {
    const [out] = emphasise([text('The equIPment shipped.')], { bold: ['IP'] });
    expect((out.content as { inline_formats?: unknown[] }).inline_formats ?? []).toHaveLength(0);
  });

  it('preserves existing runs and refuses to overlap one', () => {
    const node = n('text_block', {
      text: 'Critical Minerals matter.',
      inline_formats: [{ start: 0, length: 18, format: 'italic' }],
    });
    const [out] = emphasise([node], { bold: ['Minerals'] });
    const runs = (out.content as { inline_formats: unknown[] }).inline_formats;
    expect(runs).toHaveLength(1); // the overlapping bold was dropped, the italic kept
    expect(runs[0]).toMatchObject({ format: 'italic' });
  });

  it('emits runs in ascending start order (what the exporters assume)', () => {
    const [out] = emphasise([text('alpha beta gamma delta')], { bold: ['delta'], italic: ['beta'] });
    const runs = (out.content as { inline_formats: Array<{ start: number }> }).inline_formats;
    expect(runs.map((r) => r.start)).toEqual([...runs.map((r) => r.start)].sort((a, b) => a - b));
  });

  it('leaves non-text nodes untouched', () => {
    const img = n('image', { storage_key: 'k', alt_text: 'bold', width: 1, height: 1 });
    expect(emphasise([img], { bold: ['bold'] })[0]).toBe(img);
  });
});

// ── structural furniture ─────────────────────────────────────────────────────
describe('addSectionRules', () => {
  it('rules between top-level sections but never above the first', () => {
    const out = addSectionRules([h1('One'), text('a'), h1('Two'), text('b'), h1('Three')]);
    expect(out[0].type).toBe('heading');
    expect(out.filter((x) => x.type === 'divider')).toHaveLength(2);
  });

  it('does not double a rule that is already there', () => {
    const out = addSectionRules([h1('One'), n('divider', {}), h1('Two')]);
    expect(out.filter((x) => x.type === 'divider')).toHaveLength(1);
  });
});

describe('buildTocNode', () => {
  it('returns null when a TOC would cost more than it earns', () => {
    expect(buildTocNode([h1('a'), h1('b'), h1('c')])).toBeNull();
  });
  it('builds from the document own headings once there are enough', () => {
    const toc = buildTocNode([h1('a'), h1('b'), h1('c'), h1('d'), h1('e'), h1('f')]);
    expect((toc!.content as { entries: unknown[] }).entries).toHaveLength(6);
  });
});

// ── computed figures ─────────────────────────────────────────────────────────
describe('computed data figures', () => {
  it('plots only the cost lines that are actually present', () => {
    const c = costWaterfallChart({ labor: 93_500, fringe: 32_725, overhead: 56_801, ga: 30_904, fee: 0 });
    const content = c.content as { categories: string[]; series: Array<{ data: number[] }> };
    expect(content.categories).toEqual(['Direct labor', 'Fringe', 'Overhead', 'G&A']); // no zero Fee bar
    expect(content.series[0].data).toEqual([93_500, 32_725, 56_801, 30_904]);
  });

  it('builds a gantt whose two series are start and end months', () => {
    const g = scheduleGanttChart([{ name: 'Kickoff', startMonth: 0, endMonth: 1 }]);
    const content = g.content as { chart_type: string; series: Array<{ data: number[] }> };
    expect(content.chart_type).toBe('gantt');
    expect(content.series.map((s) => s.data)).toEqual([[0], [1]]);
  });

  it('marks every generated figure as template-provenance and library-ineligible', () => {
    // Furniture must never be harvested back into the atom library as reusable content.
    for (const node of [
      costWaterfallChart({ labor: 1, fringe: 1, overhead: 1, ga: 1 }),
      workSplitChart([{ name: 'Prime', percent: 89.4 }]),
      scheduleGanttChart([{ name: 't', startMonth: 0, endMonth: 1 }]),
    ]) {
      expect(node.provenance.source).toBe('template');
      expect(node.library_eligible).toBe(false);
    }
  });
});

// ── the quality ruler ────────────────────────────────────────────────────────
describe('measureDocument', () => {
  it('calls out a COMPLIANT but obviously unfinished volume', () => {
    // The whole point: compliance answers "is this allowed", this answers "is it finished".
    const m = measureDocument(doc([h1('Technical Approach'), text('One short paragraph.')]));
    expect(m.maxPages).toBe(15);
    expect(m.pages).toBe(1);
    expect(m.pageFill).toBeCloseTo(1 / 15, 5);
    expect(m.warnings.join(' ')).toMatch(/of 15 allowed pages/);
    expect(m.warnings.join(' ')).toMatch(/No figures/);
  });

  it('counts node-type coverage and furniture', () => {
    const m = measureDocument(doc(applyFurniture([
      h1('A'),
      text('Body copy mentioning Critical Minerals.'),
      costWaterfallChart({ labor: 10, fringe: 2, overhead: 3, ga: 1 }),
      h1('B'),
      n('table', { headers: ['x'], rows: [['1']], sheet_name: 'Budget' }),
    ], { bold: ['Critical Minerals'] })));
    expect(m.charts).toBe(1);
    expect(m.tables).toBe(1);
    expect(m.captions).toBe(2);      // one per chart + table
    expect(m.emphasisedBlocks).toBe(1);
    expect(m.nodeTypes.divider).toBe(1); // rule before the second H1
    expect(m.distinctNodeTypes).toBeGreaterThanOrEqual(5);
  });

  it('reports header/footer presence from the canvas rules', () => {
    const withFurniture = measureDocument(doc([text('x')]));           // sbir_phase1 has both
    const without = measureDocument(doc([text('x')], { header: null, footer: null }));
    expect(withFurniture.hasHeader && withFurniture.hasFooter).toBe(true);
    expect(without.warnings.join(' ')).toMatch(/No running header/);
    expect(without.warnings.join(' ')).toMatch(/No footer/);
  });

  it('reports no fill warnings for an uncapped document', () => {
    const m = measureDocument(doc([text('x')], { max_pages: null, max_characters: null }));
    expect(m.pageFill).toBeNull();
    expect(m.warnings.join(' ')).not.toMatch(/allowed pages/);
  });
});

describe('headroom', () => {
  it('reports the room left, and calls a filled document at capacity', () => {
    const thin = headroom(doc([text('short')]));
    expect(thin.pagesFree).toBe(14);
    expect(thin.atCapacity).toBe(false);

    const full = headroom(doc([text('x'.repeat(2_900))], { max_pages: null, max_characters: 3_000 }));
    expect(full.charactersFree).toBe(100);
    expect(full.atCapacity).toBe(true);
  });
});

// ── character cap ────────────────────────────────────────────────────────────
describe('trimToCharacterCap', () => {
  it('leaves a document already under the cap completely alone', () => {
    const input = [text('short')];
    expect(trimToCharacterCap(input, 3_000)).toBe(input);
  });

  it('trims to at-or-under the cap', () => {
    const out = trimToCharacterCap([text('a'.repeat(50)), text('b'.repeat(50))], 60);
    const total = out.reduce((s, x) => s + ((x.content as { text?: string }).text?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(60);
  });

  it('cuts at a sentence boundary when one is within reach', () => {
    const body = 'First sentence here. Second sentence here. Third sentence trails off and on and on.';
    const [out] = trimToCharacterCap([text(body)], 45);
    expect((out.content as { text: string }).text).toBe('First sentence here. Second sentence here.');
  });

  it('drops inline runs that would point past the end of the trimmed text', () => {
    // A run whose start+length exceeds the new length is a corrupt document, not a cosmetic issue:
    // the docx writer indexes into the string with it.
    const node = n('text_block', {
      text: 'a'.repeat(100),
      inline_formats: [{ start: 0, length: 5, format: 'bold' }, { start: 90, length: 5, format: 'italic' }],
    });
    const [out] = trimToCharacterCap([node], 40);
    const runs = (out.content as { inline_formats: Array<{ start: number; length: number }> }).inline_formats;
    const len = (out.content as { text: string }).text.length;
    expect(runs.every((r) => r.start + r.length <= len)).toBe(true);
    expect(runs).toHaveLength(1);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────
describe('the pass is deterministic', () => {
  it('produces identical content for identical input (ids aside)', () => {
    const build = () => applyFurniture([
      h1('A'), text('Body with Critical Minerals and IP.'),
      n('chart', { chart_type: 'bar', title: 'Cost', categories: [], series: [] }),
      h1('B'), text('More body.'),
    ], { bold: ['Critical Minerals'], italic: ['IP'] });
    const a = build();
    const b = build();
    expect(b.map((x) => [x.type, JSON.stringify(x.content)]))
      .toEqual(a.map((x) => [x.type, JSON.stringify(x.content)]));
  });
});

// ── artifact-type scoping ────────────────────────────────────────────────────
describe('warnings are scoped to the artifact type', () => {
  // A warning that fires where it cannot apply trains the reader to ignore the ones that do.
  // "No figures" is a real finding on a technical narrative and meaningless on a cover sheet;
  // page furniture is meaningless on a spreadsheet, which has no page to put it on.
  const thin = [h1('A'), text('one'), text('two'), text('three'), text('four')];

  it('flags a figure-less NARRATIVE', () => {
    expect(measureDocument(doc(thin), 0.85, 'narrative').warnings.join(' ')).toMatch(/No figures/);
  });

  it('does NOT flag figures or emphasis on a form or a cost volume', () => {
    for (const t of ['form', 'cost']) {
      const w = measureDocument(doc(thin), 0.85, t).warnings.join(' ');
      expect(w, t).not.toMatch(/No figures/);
      expect(w, t).not.toMatch(/No inline emphasis/);
    }
  });

  it('does not ask a spreadsheet for a running header', () => {
    const w = measureDocument(doc(thin, { format: 'spreadsheet', header: null, footer: null }), 0.85, 'cost')
      .warnings.join(' ');
    expect(w).not.toMatch(/running header/);
    expect(w).not.toMatch(/No footer/);
  });

  it('still reports a caption gap on ANY type that has figures', () => {
    const withChart = [costWaterfallChart({ labor: 1, fringe: 1, overhead: 1, ga: 1 })];
    // measured WITHOUT running numberFigures, so the caption is genuinely missing
    expect(measureDocument(doc(withChart), 0.85, 'form').warnings.join(' '))
      .toMatch(/1 figure\(s\) but only 0 caption\(s\)/);
  });

  it('defaults to the strictest reading when the type is unknown', () => {
    expect(measureDocument(doc(thin)).warnings.join(' ')).toMatch(/No figures/);
  });
});
