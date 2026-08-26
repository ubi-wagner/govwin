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

/**
 * ── AND A GUARD, BECAUSE THIS HAS NOW HAPPENED THREE TIMES ───────────────────────────────────
 * The D8 fix repaired the *page* and left two siblings holding the identical idiom:
 *
 *   lib/delivery/milestones.ts   the milestone variance in the `project.milestone.met` payload —
 *                                NaN, and `JSON.stringify(NaN)` is `null`, so every met milestone
 *                                recorded "no baseline" instead of "nine days late", permanently
 *   lib/delivery/baseline.ts     the ALREADY_BASELINED message, shown to a person, reading
 *                                "This project was baselined on Tue Apr 28" — no year
 *
 * Neither is reachable by a unit test without a database, and both are invisible to every lens:
 * one lives in an event payload nothing renders, the other in a 409 body no happy path produces.
 * A grep is the only instrument that sees them, so it is the instrument.
 *
 * Narrow on purpose. It matches `String(x).slice(0, 10)` — slicing a value's *string form*, which
 * is only correct if the value is already ISO, and a `date`/`timestamptz` column never is.
 * `toISOString().slice(0, 10)` is untouched: that one is right, and it is what `isoDate` does.
 *
 * COMMENTS ARE STRIPPED FIRST. Every file that fixes this bug quotes it — including this one — and
 * a guard that cannot tell a warning from an offence would force the fix to stop describing what
 * it fixed. No file is exempt once the comments are gone, `dates.ts` included.
 */
describe('the delivery module does not slice the string form of a date', () => {
  const ROOTS = ['lib/delivery', 'components/delivery', 'app/portal/[tenantSlug]/delivery'];
  // The lookbehind is load-bearing: `toISOString()` ENDS IN `String()`, so a bare `String\(` also
  // matches the one idiom that is correct — and the first version of this guard did, which is why
  // it was written with `dates.ts` exempted. The exemption was hiding the flaw. The self-test
  // below is what surfaced it.
  const BAD = /(?<![A-Za-z0-9_$])String\([^)]*\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;
  const stripComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('has no `String(…).slice(0, 10)` in delivery code', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = join(__dirname, '..');

    // The guard has to be able to SEE the thing it guards against, or a clean run means nothing —
    // and it has to leave the correct idiom alone, or it is a nuisance rather than a check.
    expect(BAD.test(stripComments('const v = String(row.baselineDate).slice(0, 10);'))).toBe(true);
    expect(BAD.test(stripComments('const v = d.toISOString().slice(0, 10);'))).toBe(false);
    expect(BAD.test(stripComments('// was String(x).slice(0, 10)\n'))).toBe(false);
    expect(BAD.test(stripComments('/* was String(x).slice(0, 10) */\n'))).toBe(false);

    const walk = (dir: string): string[] => (existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
        ? walk(join(dir, e.name))
        : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))
      : []);

    const offenders = ROOTS
      .flatMap((r) => walk(join(root, r)))
      .map((f) => relative(root, f))
      .filter((rel) => BAD.test(stripComments(readFileSync(join(root, rel), 'utf8'))));

    expect(offenders, 'use isoDate()/daysBetween() from lib/delivery/dates.ts').toEqual([]);
  });
});
