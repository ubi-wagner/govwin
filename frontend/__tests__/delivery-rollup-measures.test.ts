/**
 * NOT MEASURED IS NOT ZERO.
 *
 * A project with nothing planned is not 0% spent. A CLIN with no deliverables is not 0% delivered.
 * Rendering either as `0%` states a measurement that was never taken, and a reader cannot tell it
 * apart from real, alarming progress-of-zero.
 *
 * The live drive (`scripts/verify-delivery-rollup.mjs`) proves the SQL against hand-computed
 * numbers, but it needs a database and CI runs vitest. This rule gets a fast-suite guard because it
 * is the one most likely to be "fixed" by someone who reads a null percentage as a defect.
 */
import { describe, it, expect } from 'vitest';
import { pct } from '@/lib/delivery/rollup';

describe('a measure with no denominator', () => {
  it('is null, not zero', () => {
    expect(pct(0, 0), 'nothing planned is NOT nought percent spent').toBeNull();
    expect(pct(5, 0)).toBeNull();
  });

  it('distinguishes "measured, and it is zero" from "not measured"', () => {
    // The pair that matters. A CLIN with a budget and no spend really is 0%; one with no budget
    // has no answer, and the two must not render the same.
    expect(pct(0, 1000)).toBe(0);
    expect(pct(0, 0)).toBeNull();
  });

  it('refuses a negative or non-finite denominator rather than inventing a number', () => {
    expect(pct(1, -10)).toBeNull();
    expect(pct(1, Number.NaN)).toBeNull();
    expect(pct(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rounds to one decimal, so 1 of 3 reads 33.3 rather than 33.33333', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(800, 2000)).toBe(40);
    expect(pct(2, 202)).toBe(1);
  });
});
