/**
 * The measurement grid's geometry — a ruler is worthless if its lines are in the wrong place.
 */
import { describe, it, expect } from 'vitest';
import {
  gridGeometry, defaultGridStep, gridStepLabel, describePt, isGridStep, pageBoundaries,
  GRID_STEPS_PT, MIN_GRID_STEP_PT, PT_PER_INCH,
} from '@/lib/canvas/measure-grid';
import { CANVAS_PRESETS, paginate, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

const letter = CANVAS_PRESETS.letter_standard;

describe('the step ladder', () => {
  it('every step divides an inch — otherwise its lines drift off the inch marks', () => {
    for (const s of GRID_STEPS_PT) expect(PT_PER_INCH % s).toBe(0);
  });

  it('the floor is 6pt, the smallest divisor of 72 at or above a 5pt floor', () => {
    expect(MIN_GRID_STEP_PT).toBe(6);
    // 5 is what a person asks for; it is not a divisor of 72, which is why 6 is offered instead.
    expect(PT_PER_INCH % 5).not.toBe(0);
    const belowSix = [1, 2, 3, 4, 5].filter((n) => PT_PER_INCH % n === 0 && n >= 5);
    expect(belowSix).toEqual([]);   // nothing between 5 and 6 divides 72
  });

  it('gets strictly finer, and is NOT a pure halving — that is the point', () => {
    // 72/36/18 are inch fractions; 12/6 are picas. A pure halving would give 9 and 4.5 instead,
    // losing the 12pt step — which is a body line, and the measurement an author reaches for most.
    // Two interleaved series beat one clean one when the units people think in are not the same.
    for (let i = 1; i < GRID_STEPS_PT.length; i++) {
      expect(GRID_STEPS_PT[i]).toBeLessThan(GRID_STEPS_PT[i - 1]);
    }
    expect([...GRID_STEPS_PT]).toContain(12);
  });

  it('rejects a step that is not on the ladder', () => {
    expect(isGridStep(5)).toBe(false);
    expect(isGridStep(6)).toBe(true);
    expect(isGridStep('12')).toBe(false);
  });
});

describe('grid geometry on a letter page (612 × 792)', () => {
  it('emits a line at 0 AND at the closing edge, so the last cell is not oversized', () => {
    const g = gridGeometry(letter, 72);
    expect(g.vertical[0].pt).toBe(0);
    expect(g.vertical.at(-1)!.pt).toBe(612);      // 612 / 72 = 8.5 → the edge is not a multiple…
    expect(g.horizontal[0].pt).toBe(0);
    expect(g.horizontal.at(-1)!.pt).toBe(792);    // …but 792 / 72 = 11 exactly
  });

  it('puts 9 vertical and 12 horizontal lines on a 1-inch grid', () => {
    const g = gridGeometry(letter, 72);
    expect(g.vertical.filter((l) => l.pt % 72 === 0)).toHaveLength(9);   // 0…576, plus 612 partial
    expect(g.horizontal.filter((l) => l.pt % 72 === 0)).toHaveLength(12); // 0…792
  });

  it('marks inches major and half-inches medium, never both', () => {
    const g = gridGeometry(letter, 18);
    const inch = g.horizontal.find((l) => l.pt === 72)!;
    const half = g.horizontal.find((l) => l.pt === 36)!;
    const quarter = g.horizontal.find((l) => l.pt === 18)!;
    expect([inch.major, inch.medium]).toEqual([true, false]);
    expect([half.major, half.medium]).toEqual([false, true]);
    expect([quarter.major, quarter.medium]).toEqual([false, false]);
  });

  it('reports the usable box inside the margins — the landmark that matters most', () => {
    const g = gridGeometry(letter, 12);
    expect(g.margin.left).toBe(letter.margins.left);
    expect(g.margin.right).toBe(612 - letter.margins.right);
    expect(g.margin.width).toBe(612 - letter.margins.left - letter.margins.right);
    expect(g.margin.height).toBe(792 - letter.margins.top - letter.margins.bottom);
  });

  it('does not accumulate float drift across the page', () => {
    // 132 iterations at 6pt: naive summing lands on 791.9999999999 and the edge line goes missing.
    const g = gridGeometry(letter, 6);
    expect(g.horizontal.at(-1)!.pt).toBe(792);
    expect(g.horizontal.every((l) => Number.isFinite(l.pt))).toBe(true);
  });

  it('falls back to the floor rather than looping forever on a bad step', () => {
    // @ts-expect-error — deliberately off-ladder; this runs on every keystroke in the editor
    const g = gridGeometry(letter, 0);
    expect(g.step).toBe(MIN_GRID_STEP_PT);
    expect(g.horizontal.length).toBeGreaterThan(1);
  });
});

describe('the default step keeps the grid legible rather than a grey wash', () => {
  it('a letter page does not open at the finest step', () => {
    const step = defaultGridStep(letter);
    expect(step).toBeGreaterThan(MIN_GRID_STEP_PT);
  });

  it('a smaller canvas is allowed to open finer than a larger one', () => {
    const small = { ...letter, width: 288, height: 288 };   // 4 × 4 in
    const big = { ...letter, width: 1224, height: 1584 };   // 17 × 22 in
    expect(defaultGridStep(small)).toBeLessThanOrEqual(defaultGridStep(big));
  });

  it('never returns a step off the ladder', () => {
    for (const c of [letter, CANVAS_PRESETS.slide_deck, CANVAS_PRESETS.custom]) {
      expect(isGridStep(defaultGridStep(c))).toBe(true);
    }
  });
});

describe('the readout speaks in units a person uses', () => {
  it('labels steps as a ruler would', () => {
    expect(gridStepLabel(72)).toBe('1 in');
    expect(gridStepLabel(36)).toBe('½ in');
    expect(gridStepLabel(6)).toBe('½ pica');
  });

  it('describes a distance in both points and inches', () => {
    expect(describePt(72)).toBe('72pt (1.00 in)');
    expect(describePt(78)).toBe('78pt (1.08 in)');
  });
});

describe('page boundaries — where the break actually falls', () => {
  it('draws no boundary for a single-page document', () => {
    expect(pageBoundaries(letter, 1)).toEqual([]);
  });

  it('draws interior boundaries only — never at the top or after the last page', () => {
    const b = pageBoundaries(letter, 3);
    expect(b).toHaveLength(2);                    // 3 pages → 2 breaks between them
    expect(b[0]).toBeGreaterThan(0);
  });

  it('puts the first break one usable height below the top margin', () => {
    const usable = letter.height - letter.margins.top - letter.margins.bottom;
    expect(pageBoundaries(letter, 2)[0]).toBe(letter.margins.top + usable);
  });

  it('spaces every subsequent break by exactly one usable height', () => {
    const usable = letter.height - letter.margins.top - letter.margins.bottom;
    const b = pageBoundaries(letter, 5);
    for (let i = 1; i < b.length; i++) expect(b[i] - b[i - 1]).toBe(usable);
  });

  it('agrees with the margin box the grid draws — one usable height, one definition', () => {
    const g = gridGeometry(letter, 12);
    expect(pageBoundaries(letter, 2)[0]).toBe(g.margin.top + g.margin.height);
  });

  it('returns nothing rather than dividing by a nonsense page', () => {
    expect(pageBoundaries({ ...letter, margins: { top: 500, bottom: 500, left: 72, right: 72 } }, 3)).toEqual([]);
    expect(pageBoundaries(letter, Number.NaN)).toEqual([]);
  });

  it('handles a fractional page count by rounding up — 1.2 pages IS two pages', () => {
    expect(pageBoundaries(letter, 1.2)).toHaveLength(1);
  });
});

/**
 * RELOCATION — why a geometric boundary is not enough (B112).
 *
 * `fitKeep` pushes a block that will not fit wholesale to the next page rather than filling in
 * behind what precedes it. The paginator's own comment records the measurement: a 40-row table
 * alone is 2 pages; ONE sentence of prose plus that table is 3. So a boundary computed as
 * `marginTop + k × usableHeight` can land in the MIDDLE of a block that actually begins the page.
 */
describe('a geometric boundary disagrees with the paginator when a block relocates', () => {
  const tallTable = (rows: number): CanvasNode => ({
    id: 'tbl', type: 'table', style: {},
    content: { headers: ['A', 'B'], rows: Array.from({ length: rows }, (_, i) => [`r${i}`, 'x']) },
    provenance: { source: 'manual' }, history: [], library_eligible: false,
  } as unknown as CanvasNode);
  const prose = (id: string): CanvasNode => ({
    id, type: 'text_block', content: { text: 'One sentence of prose.' }, style: {},
    provenance: { source: 'manual' }, history: [], library_eligible: false,
  } as unknown as CanvasNode);
  const docOf = (nodes: CanvasNode[]): CanvasDocument => ({
    version: 2, document_id: 'd', canvas: { ...letter }, nodes: [],
    sections: [{ id: 's', title: 's', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
    metadata: { title: 'd', status: 'in_progress' },
  } as unknown as CanvasDocument);

  it('one sentence of prose moves a tall table a whole page — the relocation is real', () => {
    const alone = paginate(docOf([tallTable(40)])).totalPages;
    const withProse = paginate(docOf([prose('p'), tallTable(40)])).totalPages;
    expect(withProse).toBeGreaterThan(alone);
  });

  it('the table BEGINS the page it was pushed to, so the geometric line falls inside it', () => {
    const layout = paginate(docOf([prose('p'), tallTable(40)]));
    const table = layout.perNode.find((n) => n.id === 'tbl')!;
    const proseNode = layout.perNode.find((n) => n.id === 'p')!;
    // The prose stays on page 1; the table starts page 2 — it did not fill in behind the prose.
    expect(proseNode.startPage).toBe(1);
    expect(table.startPage).toBe(2);
    // …and the table is TALLER than a page, so a geometric page-2 line would cut through it rather
    // than sit at its top. That is the case a measured boundary exists to get right.
    expect(table.endPage).toBeGreaterThan(table.startPage);
  });

  it('leaves the previous page part-empty — the whitespace the overlay shades', () => {
    const layout = paginate(docOf([prose('p'), tallTable(40)]));
    // Page 1 holds only the prose. Everything else on it is the gap a relocation leaves behind,
    // which a continuous editor shows nowhere.
    const onPageOne = layout.perNode.filter((n) => n.startPage === 1);
    expect(onPageOne.map((n) => n.id)).toEqual(['p']);
  });
});
