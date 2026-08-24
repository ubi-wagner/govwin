/**
 * The measurement grid's geometry — a ruler is worthless if its lines are in the wrong place.
 */
import { describe, it, expect } from 'vitest';
import {
  gridGeometry, defaultGridStep, gridStepLabel, describePt, isGridStep,
  GRID_STEPS_PT, MIN_GRID_STEP_PT, PT_PER_INCH,
} from '@/lib/canvas/measure-grid';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

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
