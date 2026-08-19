import { describe, it, expect } from 'vitest';

/**
 * `compliance.save_variable_value` stores every value in `custom_variables` (which carries the
 * provenance — source excerpt, anchor, verifier, timestamp) and MIRRORS it into the typed
 * `solicitation_compliance` column when one exists. The mirror matters because nothing downstream
 * reads custom_variables: buildArtifactSpecs, the readiness roll-up, the cost forms and the
 * opportunity card all read the typed columns. Without it an admin could verify "TABA allowed" or
 * "CMMC Level 1" against the source, see it saved, and still have the build see NULL.
 *
 * These lock the value-coercion half of that mirror (the DB write itself is exercised by the live
 * ingest drive): a value must land in the column's own type, and a value the column cannot
 * represent must be SKIPPED rather than written as something the column would misread.
 */

// Mirrors the coercion in lib/tools/compliance-save-variable-value.ts.
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const digits = String(value).replace(/[^0-9.-]/g, '');
  if (!/[0-9]/.test(digits)) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}
function coerceForColumn(value: unknown, type: 'int' | 'text' | 'bool' | 'numeric' | undefined): unknown {
  if (value === null) return null;
  switch (type) {
    case 'int': {
      const n = toNumber(value);
      return n === undefined ? undefined : Math.round(n);
    }
    case 'numeric':
      return toNumber(value);
    case 'bool': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(s)) return true;
      if (['false', 'no', 'n', '0'].includes(s)) return false;
      return undefined;
    }
    case 'text':
      return typeof value === 'string' ? value : String(value);
    default:
      return undefined;
  }
}

describe('compliance typed-column mirror — value coercion', () => {
  it('coerces an int page limit from either a number or the solicitation’s own wording', () => {
    expect(coerceForColumn(10, 'int')).toBe(10);
    expect(coerceForColumn('10 pages', 'int')).toBe(10);
    expect(coerceForColumn('not stated', 'int')).toBeUndefined(); // skipped, never written as 0
  });

  it('NEVER coerces digit-free prose to 0 — absence is a finding, not a limit of zero', () => {
    // The bug this locks: stripping non-digits from "not stated" leaves "", and Number("") is 0,
    // which is finite — so a missing page limit would have been written as a 0-PAGE limit and a
    // missing ceiling as $0. Both read downstream as rules the solicitation actually stated.
    for (const prose of ['not stated', 'see the Component-specific instructions', 'TBD', 'N/A', '']) {
      expect(coerceForColumn(prose, 'int')).toBeUndefined();
      expect(coerceForColumn(prose, 'numeric')).toBeUndefined();
    }
  });

  it('coerces the booleans an RFP actually states (YES/NO/true)', () => {
    expect(coerceForColumn(true, 'bool')).toBe(true);
    expect(coerceForColumn('YES', 'bool')).toBe(true);
    expect(coerceForColumn('No', 'bool')).toBe(false);
    expect(coerceForColumn('see Component instructions', 'bool')).toBeUndefined();
  });

  it('keeps money/rate values numeric without rounding them to ints', () => {
    expect(coerceForColumn(0.35, 'numeric')).toBe(0.35);
    expect(coerceForColumn('$250,000', 'numeric')).toBe(250000);
  });

  it('passes text through and never mirrors a freeform (untyped) variable', () => {
    expect(coerceForColumn('CMMC Level 1 (projected)', 'text')).toBe('CMMC Level 1 (projected)');
    // A variable with no KNOWN_TYPE has no column — custom_variables only.
    expect(coerceForColumn('anything', undefined)).toBeUndefined();
  });

  it('preserves an explicit null (a rule the solicitation states as absent)', () => {
    expect(coerceForColumn(null, 'int')).toBeNull();
    expect(coerceForColumn(null, 'bool')).toBeNull();
  });
});
