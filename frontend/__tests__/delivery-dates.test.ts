/**
 * The date bug that every automated lens passed, and only a screenshot caught.
 *
 * postgres.js returns a `date` column as a JavaScript `Date`. The workspace page treated one as an
 * ISO string — `String(d).slice(0, 10)` — which yields `"Tue Apr 28"`, and `Date.parse` of that
 * plus `"T00:00:00Z"` is `NaN`. On a live page it rendered as:
 *
 *     Kickoff and SOW agreed              met  NaN days early against baseline
 *     0001  Base period …   Tue Apr 28 → Wed Apr 28
 *
 * A variance of NaN labelled "early" — because `NaN > 0` is false, so the ternary picked the
 * cheerful branch — and a period of performance whose start and end read identically, because a
 * ten-character slice of a Date's string form cuts before the year.
 *
 * `verify-surfaces`, `verify-api-contract` and `verify-ui-vs-db` all scored the page clean.
 *
 * ── SO EVERY CASE HERE IS FED A REAL `Date` ──────────────────────────────────────────────────
 * A test that only passed ISO strings would have passed against the broken code too. That is the
 * whole lesson: the fixture has to be shaped like what the runtime actually hands you.
 */
import { describe, it, expect } from 'vitest';
import { isoDate, daysBetween, varianceLabel } from '@/lib/delivery/dates';

// What postgres.js actually returns for `date '2026-04-28'`.
const APR28 = new Date('2026-04-28T00:00:00.000Z');
const MAY12 = new Date('2026-05-12T00:00:00.000Z');

describe('isoDate', () => {
  it('formats a Date object, which is what the driver returns', () => {
    expect(isoDate(APR28)).toBe('2026-04-28');
    // The bug, stated as an assertion: the old code produced this instead.
    expect(String(APR28).slice(0, 10)).not.toBe('2026-04-28');
  });

  it('two different dates format differently', () => {
    // The visible symptom was "Tue Apr 28 → Wed Apr 28" for a start and end two weeks apart.
    expect(isoDate(APR28)).not.toBe(isoDate(MAY12));
  });

  it('accepts an ISO string too, without changing it', () => {
    expect(isoDate('2026-04-28')).toBe('2026-04-28');
    expect(isoDate('2026-04-28T13:45:00.000Z')).toBe('2026-04-28');
  });

  it('returns null — never a partial slice — for anything unparseable', () => {
    expect(isoDate(null)).toBeNull();
    expect(isoDate(undefined)).toBeNull();
    expect(isoDate('')).toBeNull();
    expect(isoDate('Tue Apr 28')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('measures across Date objects', () => {
    expect(daysBetween(APR28, MAY12)).toBe(14);
    expect(daysBetween(MAY12, APR28)).toBe(-14);
    expect(daysBetween(APR28, APR28)).toBe(0);
  });

  it('returns null when either end is missing — NOT NaN, and NOT zero', () => {
    // NaN is worse than either: it survives a `!== 0` check and then picks a branch. "No baseline"
    // and "on time" are different facts and must not render the same.
    expect(daysBetween(null, MAY12)).toBeNull();
    expect(daysBetween(APR28, null)).toBeNull();
    expect(daysBetween('Tue Apr 28', MAY12)).toBeNull();
  });

  it('never returns NaN', () => {
    for (const bad of [null, undefined, '', 'nonsense', {}, [], Number.NaN]) {
      const out = daysBetween(bad, MAY12);
      expect(Number.isNaN(out as number), `daysBetween(${JSON.stringify(bad)}, …)`).toBe(false);
    }
  });
});

describe('varianceLabel', () => {
  it('says late for positive and early for negative', () => {
    expect(varianceLabel(14)).toEqual({ text: '14 days late against baseline', late: true });
    expect(varianceLabel(-3)).toEqual({ text: '3 days early against baseline', late: false });
  });

  it('singularises one day', () => {
    expect(varianceLabel(1)?.text).toBe('1 day late against baseline');
    expect(varianceLabel(-1)?.text).toBe('1 day early against baseline');
  });

  it('renders NOTHING for zero or null, rather than "0 days early"', () => {
    expect(varianceLabel(0)).toBeNull();
    expect(varianceLabel(null)).toBeNull();
  });
});
