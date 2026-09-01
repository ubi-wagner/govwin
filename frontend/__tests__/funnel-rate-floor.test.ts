/**
 * THE FUNNEL MAY NOT PRINT A RATE IT CANNOT SUPPORT.
 *
 * `conversionRate` returns `null` below `RATE_FLOOR`, and that null is the entire safety property.
 * The "obvious simplification" — `(numerator / denominator) * 100` — passes every happy-path test
 * and turns *we have not tried enough to know* into *we tried and nothing converted*. Those are
 * opposite conclusions, only one is supportable from the data, and the wrong one renders as a
 * confident `0.0%` that nobody questions.
 *
 * It is the same rule the Projects roll-ups are built on (a measure with no denominator is "not
 * measured", never zero), and it has to be enforced in one place because the funnel page has nine
 * columns that would each otherwise grow their own copy.
 *
 * ── RED FIRST ────────────────────────────────────────────────────────────────────────────────
 * The first case below is exactly the bad simplification's output. Replace the body of
 * `conversionRate` with the naive expression and it fails; that is what makes the rest evidence.
 */
import { describe, it, expect } from 'vitest';
import { conversionRate, RATE_FLOOR } from '@/lib/contacts';

describe('funnel conversion rates', () => {
  it('refuses a rate when the denominator is below the floor', () => {
    // The naive `(0/3)*100` returns 0 here — a dashboard cell asserting nothing converted.
    expect(conversionRate(0, 3)).toBeNull();
    expect(conversionRate(1, 3)).toBeNull();
    expect(conversionRate(0, RATE_FLOOR - 1)).toBeNull();
  });

  it('computes a rate at and above the floor', () => {
    expect(conversionRate(0, RATE_FLOOR)).toBe(0);
    expect(conversionRate(5, 20)).toBe(25);
    expect(conversionRate(1, 200)).toBeCloseTo(0.5, 10);
  });

  it('a real zero at a sufficient denominator IS reported, not hidden', () => {
    // The opposite error: suppressing every zero would hide a campaign that genuinely converts
    // nobody, which is the finding a funnel exists to surface.
    expect(conversionRate(0, 500)).toBe(0);
  });

  it('never returns NaN or Infinity', () => {
    // A zero denominator is below the floor, so this is null rather than NaN — and NaN survives a
    // `!== 0` check and then picks a branch, which is how "NaN days early against baseline"
    // reached a live page (CLAUDE.md, the date trap).
    expect(conversionRate(1, 0)).toBeNull();
    expect(conversionRate(Number.NaN, 100)).toBeNull();
    expect(conversionRate(1, Number.NaN)).toBeNull();
    expect(conversionRate(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('the floor is a real threshold, not zero', () => {
    // A floor of 0 or 1 would make every assertion above pass while restoring the defect.
    expect(RATE_FLOOR).toBeGreaterThan(1);
  });
});
