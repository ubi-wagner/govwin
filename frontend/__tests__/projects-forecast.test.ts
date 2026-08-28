/**
 * ESTIMATE AT COMPLETION — and the three ways it can be a lie.
 *
 * EAC is spend ÷ percent-complete. The formula is trivial; the honesty is not:
 *
 *  1. **The denominator is the number `rollup.ts` refuses to produce.** Cost, schedule and
 *     deliverables disagree, so there are THREE estimates, reported side by side and never blended.
 *  2. **No denominator means no estimate.** `null`, never a figure — an EAC from a percent-complete
 *     nobody measured is a fabrication with a currency symbol on it.
 *  3. **Variance is against the frozen BASELINE**, not the current plan, or a rebaseline would move
 *     both sides and report zero overrun forever.
 */
import { describe, it, expect } from 'vitest';
import {
  forecast, estimateOn, forecastNote, SPREAD_THRESHOLD, type ForecastInputs,
} from '@/lib/projects/forecast';

const IN: ForecastInputs = {
  actualCost: 450000, plannedCost: 750000, baselineCost: 750000,
  costPct: 60, schedulePct: 40, deliverablesPct: 33.3,
};

describe('the arithmetic', () => {
  it('EAC is spend over percent complete', () => {
    // 450,000 at 60% → 750,000.
    expect(estimateOn('cost', 60, IN).eac).toBe(750000);
  });

  it('ETC is what is LEFT, not the whole thing', () => {
    expect(estimateOn('cost', 60, IN).etc).toBe(300000);
  });

  it('variance is measured against the BASELINE, and negative is an overrun', () => {
    // At 40% elapsed the same spend projects to 1,125,000 — an overrun of 375,000.
    const e = estimateOn('schedule', 40, IN);
    expect(e.eac).toBe(1125000);
    expect(e.varianceAtCompletion).toBe(-375000);
  });

  it('and NOT against the current plan, which a rebaseline moves', () => {
    // The plan was raised to match the overrun; the baseline did not move, so the variance stands.
    const rebaselined = { ...IN, plannedCost: 1125000 };
    expect(estimateOn('schedule', 40, rebaselined).varianceAtCompletion).toBe(-375000);
  });

  it('reports no variance when there is no baseline — never a zero', () => {
    const e = estimateOn('cost', 60, { ...IN, baselineCost: null });
    expect(e.eac).toBe(750000);
    expect(e.varianceAtCompletion).toBeNull();
  });

  it('carries the percent-complete it divided by, so the number can be checked', () => {
    expect(estimateOn('schedule', 40, IN).percentComplete).toBe(40);
  });
});

describe('when there is no estimate to give', () => {
  it('a null denominator gives null, and says why', () => {
    const e = estimateOn('deliverables', null, IN);
    expect(e.eac).toBeNull();
    expect(e.etc).toBeNull();
    expect(e.unavailable).toMatch(/no denominator/);
  });

  it('ZERO percent gives null rather than infinity', () => {
    // Rendering "∞" or a colossal number would be read as a real forecast.
    const e = estimateOn('cost', 0, IN);
    expect(e.eac).toBeNull();
    expect(e.unavailable).toMatch(/division by zero/);
  });

  it('no spend gives null — there is nothing to extrapolate from', () => {
    const e = estimateOn('cost', 60, { ...IN, actualCost: 0 });
    expect(e.eac).toBeNull();
    expect(e.unavailable).toMatch(/Nothing has been spent/);
  });

  it('never returns a number that is not finite', () => {
    for (const pct of [0, -5, null]) {
      const e = estimateOn('cost', pct, IN);
      expect(e.eac === null || Number.isFinite(e.eac)).toBe(true);
    }
  });
});

describe('three estimates, never one', () => {
  it('produces one per basis, each naming its basis', () => {
    const f = forecast(IN);
    expect(f.estimates.map((e) => e.basis)).toEqual(['cost', 'schedule', 'deliverables']);
  });

  it('exposes NO blended figure', () => {
    // The number that looks most like an answer and is worth the least. 750k, 1.125m and 1.351m
    // average to ~1.075m, and that number means nothing.
    const f = forecast(IN) as unknown as Record<string, unknown>;
    expect(f.eac).toBeUndefined();
    expect(f.headline).toBeUndefined();
    expect(f.blended).toBeUndefined();
  });

  it('FLAGS a real disagreement', () => {
    const f = forecast(IN);
    expect(f.measuresDisagree).toBe(true);
    expect(f.spread).toBeGreaterThan(0);
  });

  it('and does not flag a small one — the threshold is a real boundary', () => {
    // Within the threshold: 60% and 55% project close enough that "which basis" is pedantry.
    const close = forecast({ ...IN, costPct: 60, schedulePct: 58, deliverablesPct: 59 });
    expect(close.measuresDisagree).toBe(false);
    expect(SPREAD_THRESHOLD).toBe(0.2);
  });

  it('does not claim disagreement when only ONE estimate exists', () => {
    const one = forecast({ ...IN, schedulePct: null, deliverablesPct: null });
    expect(one.measuresDisagree).toBe(false);
    expect(one.spread).toBeNull();
  });

  it('measures the spread RELATIVE to the lower figure, so it means the same at any size', () => {
    // The same 50% relative gap on a small contract and a large one.
    const small = forecast({ ...IN, actualCost: 500, costPct: 50, schedulePct: 25, deliverablesPct: null });
    const large = forecast({ ...IN, actualCost: 5_000_000, costPct: 50, schedulePct: 25, deliverablesPct: null });
    expect(small.measuresDisagree).toBe(large.measuresDisagree);
  });
});

describe('the note', () => {
  it('says the bases disagree and REFUSES to pick one', () => {
    const note = forecastNote(forecast(IN))!;
    expect(note).toMatch(/bases disagree/);
    expect(note).toMatch(/depends on whether/);
    // Naming a headline would answer the question the spread is asking.
    expect(note).not.toMatch(/we expect|the estimate is|most likely/i);
  });

  it('is null when they agree — nothing to point at', () => {
    expect(forecastNote(forecast({ ...IN, schedulePct: 59, deliverablesPct: 61 }))).toBeNull();
  });

  it('is null when there is nothing to forecast at all', () => {
    expect(forecastNote(forecast({
      actualCost: 0, plannedCost: null, baselineCost: null,
      costPct: null, schedulePct: null, deliverablesPct: null,
    }))).toBeNull();
  });
});
