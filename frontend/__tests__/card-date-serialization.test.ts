/**
 * A card's dates must be ISO, because the OTHER service has to read them.
 *
 * buildCardSnapshot stringified date columns with a bare `String(v)`. postgres.js returns those
 * columns as JS `Date` objects, so what landed in the card jsonb was
 * Date.prototype.toString() — "Fri Aug 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)".
 *
 * That is locale- and timezone-shaped prose, not a date format, and it broke a ranking dimension in
 * a way nothing surfaced:
 *
 *   · the TS scorer's `new Date(v)` happens to parse V8's own toString output, so it applied the
 *     timeline signal;
 *   · the Python scorer's `_close_ms` does `datetime.fromisoformat(...)` and returns None, so it
 *     SKIPPED the signal.
 *
 * The two scorers therefore disagreed on the same card — which lib/bucket-ranking.ts explicitly
 * says they must not ("parity with the Python scorer's `_close_ms is None` skip"). Measured on the
 * sandbox: across 3,486 stored bucket scores, not one carried a `timeline` factor. Every
 * opportunity was ranked on keywords alone; "closes in 9 days" counted for nothing.
 *
 * These pin the FORMAT rather than the plumbing, because the format is the contract between the
 * two services.
 */
import { describe, expect, it } from 'vitest';

/** The exact serializer buildCardSnapshot uses. Kept in lockstep by the last test here. */
const str = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** What Python's `_close_ms` accepts: fromisoformat after swapping a trailing Z for +00:00. */
function pythonWouldParse(s: string | null): boolean {
  if (!s) return false;
  const normalized = s.replace(/Z$/, '+00:00');
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2})?)?$/.test(normalized);
}

describe('card date serialization', () => {
  it('emits ISO for a Date, not its toString()', () => {
    const d = new Date(Date.UTC(2026, 7, 28));
    expect(str(d)).toBe('2026-08-28T00:00:00.000Z');
    expect(str(d)).not.toContain('Coordinated Universal Time');
  });

  it('produces something the PYTHON scorer can parse — the contract that broke', () => {
    const d = new Date(Date.UTC(2026, 7, 28));
    expect(pythonWouldParse(str(d))).toBe(true);
  });

  it('the OLD serializer produced something Python could not parse', () => {
    // The regression, stated as the thing that used to happen.
    const legacy = (v: unknown) => (v == null ? null : String(v));
    const out = legacy(new Date(Date.UTC(2026, 7, 28)));
    expect(out).toContain('2026');
    expect(pythonWouldParse(out)).toBe(false);
  });

  it('and BOTH scorers now read the same instant, which is the point', () => {
    const d = new Date(Date.UTC(2026, 7, 28));
    const s = str(d)!;
    expect(pythonWouldParse(s)).toBe(true);          // Python: parses
    expect(Number.isFinite(new Date(s).getTime())).toBe(true); // TS: parses
    expect(new Date(s).getTime()).toBe(d.getTime()); // and to the same instant
  });

  it('leaves non-dates alone', () => {
    expect(str('DoW 2026 SBIR')).toBe('DoW 2026 SBIR');
    expect(str(42)).toBe('42');
    expect(str(null)).toBeNull();
    expect(str(undefined)).toBeNull();
  });

  it('handles a date-only column the same way — midnight UTC, still ISO', () => {
    // A DATE column comes back as a Date at midnight; the timeline scorer only needs the day.
    const dateOnly = new Date('2026-08-28T00:00:00.000Z');
    expect(str(dateOnly)).toBe('2026-08-28T00:00:00.000Z');
    expect(pythonWouldParse(str(dateOnly))).toBe(true);
  });

  it('stays in lockstep with the real serializer in opportunity-bridge.ts', async () => {
    // If that file's `str` is edited away from ISO, this fixture is a lie and the test above stops
    // meaning anything. Assert the source still special-cases Date.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../lib/opportunity-bridge.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/v instanceof Date \? v\.toISOString\(\)/);
  });
});
