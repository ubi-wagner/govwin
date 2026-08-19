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
import {
  architectureFigure, coverBanner, costBuildupFigure, improvementFigure,
  scheduleFigure, workShareFigure,
} from '@/lib/proposal/figures';
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
      n('image', { storage_key: 'k', caption: 'Prototype', width: 1, height: 1 }),
      n('chart', { chart_type: 'pie', title: 'Split', categories: [], series: [] }),
    ]);
    const caps = out.filter((x) => x.type === 'caption').map((x) => x.content as { prefix: string; number: number });
    expect(caps).toEqual([
      { prefix: 'Chart', number: 1, text: 'Cost' },
      { prefix: 'Figure', number: 1, text: 'Prototype' },
      { prefix: 'Chart', number: 2, text: 'Split' },
    ].map((c) => expect.objectContaining(c)));
  });

  it('does NOT number an element that will carry no caption', () => {
    // A cover banner is page furniture. Letting it take Figure 1 pushed every real figure up by
    // one — the rendered page opened with "Figure 2. Patent-to-prototype pathway" — and the
    // document's own cross-references would have been wrong from the first one.
    const out = numberFigures([
      n('image', { storage_key: 'banner', alt_text: 'Immobileyes Inc. — Volume 2', width: 468, height: 96 }),
      n('chart', { chart_type: 'bar', title: 'Cost build-up', categories: [], series: [] }),
    ]);
    const caps = out.filter((x) => x.type === 'caption').map((x) => x.content as { prefix: string; number: number; text: string });
    expect(caps).toEqual([{ prefix: 'Chart', number: 1, text: 'Cost build-up' }]);
  });

  it('never borrows alt text or a sheet name as a caption', () => {
    // alt_text describes the picture for someone who cannot see it; a sheet_name is a workbook tab.
    // Borrowed, they rendered as "Figure 1. Immobileyes Inc. — Volume 2 — …" under a masthead and
    // "Table 1. Patent" under a table — both read as unfinished placeholders.
    const out = numberFigures([
      n('image', { storage_key: 'k', alt_text: 'a long accessibility description', width: 1, height: 1 }),
      n('table', { headers: ['a'], rows: [['1']], sheet_name: 'Patent' }),
    ]);
    expect(out.filter((x) => x.type === 'caption')).toHaveLength(0);
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
    expect(m.captions).toBe(1);      // the chart; the table has no caption to source
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

// ── figure library ───────────────────────────────────────────────────────────
describe('figure generators', () => {
  // These produce the pictures a technical volume is read by. Every one is drawn from values the
  // caller passes in — nothing is invented — so the contract that matters is: real data in → a
  // figure with a caption; missing or degenerate data in → NOTHING, because a diagram of nothing
  // is worse than no diagram.
  const stages = [{ name: 'Patent' }, { name: 'Adaptation' }, { name: 'Prototype' }];

  it('emits an image + caption pair, as a data: URI the exporters can rasterize', () => {
    const [img, cap] = architectureFigure(stages, 'Pathway');
    expect(img.type).toBe('image');
    expect(cap.type).toBe('caption');
    const c = img.content as { storage_key: string; width: number; height: number; alt_text: string };
    expect(c.storage_key.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(c.width).toBeGreaterThan(0);
    expect(c.alt_text).toContain('Patent');
    // decodes to well-formed SVG
    const svg = Buffer.from(c.storage_key.split(',')[1], 'base64').toString('utf8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('refuses to draw a diagram of nothing', () => {
    expect(architectureFigure([])).toEqual([]);
    expect(architectureFigure([{ name: 'Only one' }])).toEqual([]);   // one box is not a flow
    expect(scheduleFigure([], 10)).toEqual([]);
    expect(scheduleFigure([{ name: 'x', startMonth: 5, endMonth: 2 }], 10)).toEqual([]); // inverted
    expect(costBuildupFigure([{ label: 'only', amount: 100 }])).toEqual([]);
    expect(costBuildupFigure([{ label: 'a', amount: 0 }, { label: 'b', amount: 0 }])).toEqual([]);
    expect(workShareFigure(0, 67)).toEqual([]);
    expect(improvementFigure([])).toEqual([]);
  });

  it('escapes label text so one ampersand cannot corrupt the document', () => {
    const [img] = architectureFigure([{ name: 'R&D <phase>' }, { name: 'Build' }]);
    const svg = Buffer.from((img.content as { storage_key: string }).storage_key.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('R&amp;D');
    expect(svg).not.toMatch(/R&D/);
  });

  it('wraps a long stage label instead of truncating it mid-word', () => {
    // Clipping produced "production un…" on a rendered page — a diagram whose own labels are cut
    // off undermines the document it is meant to strengthen.
    const [img] = architectureFigure([
      { name: 'Transition', detail: 'production unit' }, { name: 'Build' }, { name: 'Test' },
    ]);
    const svg = Buffer.from((img.content as { storage_key: string }).storage_key.split(',')[1], 'base64').toString('utf8');
    expect(svg).toContain('production');
    expect(svg).toContain('unit');
    expect(svg).not.toContain('…');
  });

  it('states the total and every element in the cost figure caption and alt text', () => {
    const [img, cap] = costBuildupFigure([
      { label: 'Direct labor', amount: 93500 },
      { label: 'Overhead', amount: 56801 },
    ]);
    expect((img.content as { alt_text: string }).alt_text).toContain('$93,500');
    expect((cap.content as { text: string }).text).toContain('$150,301');
  });

  it('marks work share against its floor in both directions', () => {
    const pass = workShareFigure(89.4, 67);
    const fail = workShareFigure(30, 40);
    expect((pass[0].content as { alt_text: string }).alt_text).toContain('compliant');
    expect((fail[0].content as { alt_text: string }).alt_text).toContain('BELOW FLOOR');
  });

  it('gives the cover banner no caption — it is page furniture, not a figure', () => {
    const nodes = coverBanner('Immobileyes Inc.', 'OSW26BZ04-DP013', 'Volume 2');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('image');
    expect((nodes[0].content as { caption?: string }).caption).toBeUndefined();
  });

  it('is deterministic — the same data renders the same bytes', () => {
    const a = costBuildupFigure([{ label: 'x', amount: 10 }, { label: 'y', amount: 5 }]);
    const b = costBuildupFigure([{ label: 'x', amount: 10 }, { label: 'y', amount: 5 }]);
    expect((a[0].content as { storage_key: string }).storage_key)
      .toBe((b[0].content as { storage_key: string }).storage_key);
  });

  it('marks every figure template-provenance and library-ineligible', () => {
    for (const [node] of [
      architectureFigure(stages), scheduleFigure([{ name: 'a', startMonth: 0, endMonth: 2 }], 4),
      costBuildupFigure([{ label: 'a', amount: 2 }, { label: 'b', amount: 1 }]),
      workShareFigure(50, 40), improvementFigure([{ name: 'm', current: 1, proposed: 2 }]),
      coverBanner('Co', 'S-1', 'V1'),
    ]) {
      expect(node.provenance.source).toBe('template');
      expect(node.library_eligible).toBe(false);
    }
  });
});
