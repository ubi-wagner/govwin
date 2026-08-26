/**
 * "We did not find it" must never stand in for "we never looked".
 *
 * Extraction was capped with a bare `.slice()` in four places — 500,000 chars in three frontend
 * paths, 200,000 in the shredder — none of which told anyone. Measured against the real documents
 * in docs/: the DoW 2026 SBIR BAA is 1,013,966 characters and the DoD 25.1 SBIR BAA is 1,341,245,
 * so 50.7% and 62.7% of them were discarded. Both sat in the sandbox at exactly 500,000.
 *
 * The consequence is a provenance lie, not a truncated string: the pattern extractor finds no page
 * limit in text it was never given, reports "not stated in the source", and the field falls back to
 * a red "Default — unverified" that looks like a considered finding. docs/INGEST_PROVENANCE.md
 * forbids exactly this.
 *
 * Raising the cap fixes today's documents. REPORTING the cap fixes the class — any fixed limit is
 * eventually too small, and the next one must not be silent.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SOURCE_TEXT_CHARS,
  capSourceText,
  extractionOf,
  truncationNotice,
} from '@/lib/ingest/source-text-cap';

describe('capSourceText', () => {
  it('passes a document under the ceiling through untouched', () => {
    const r = capSourceText('the solicitation text');
    expect(r.text).toBe('the solicitation text');
    expect(r.truncated).toBe(false);
    expect(r.chars).toBe(r.originalChars);
  });

  it('caps a document over the ceiling AND says so', () => {
    const r = capSourceText('x'.repeat(MAX_SOURCE_TEXT_CHARS + 5_000));
    expect(r.text.length).toBe(MAX_SOURCE_TEXT_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.originalChars).toBe(MAX_SOURCE_TEXT_CHARS + 5_000);
    expect(r.capChars).toBe(MAX_SOURCE_TEXT_CHARS);
  });

  it('is exclusive at the boundary — exactly at the cap is NOT truncated', () => {
    const r = capSourceText('y'.repeat(MAX_SOURCE_TEXT_CHARS));
    expect(r.truncated).toBe(false);
    expect(r.chars).toBe(MAX_SOURCE_TEXT_CHARS);
  });

  it('handles null and undefined without pretending it read something', () => {
    for (const v of [null, undefined, '']) {
      const r = capSourceText(v);
      expect(r.text).toBe('');
      expect(r.chars).toBe(0);
      expect(r.truncated).toBe(false);
    }
  });

  it('the ceiling clears the largest real solicitation with headroom', () => {
    // Measured from docs/: DoD 25.1 SBIR BAA = 1,341,245 characters. A cap below that is the bug.
    const LARGEST_REAL = 1_341_245;
    expect(MAX_SOURCE_TEXT_CHARS).toBeGreaterThan(LARGEST_REAL);
    const r = capSourceText('z'.repeat(LARGEST_REAL));
    expect(r.truncated).toBe(false);
  });

  it('the OLD ceiling would have truncated it — the regression this pins', () => {
    const r = capSourceText('z'.repeat(1_341_245), 500_000);
    expect(r.truncated).toBe(true);
    expect(truncationNotice(r)).toContain('63%');
  });
});

describe('truncationNotice', () => {
  it('says nothing when the whole document was read', () => {
    expect(truncationNotice(capSourceText('short'))).toBeNull();
    expect(truncationNotice(null)).toBeNull();
  });

  it('leads with the SHARE lost, not the count kept', () => {
    // "we read 500,000 characters" sounds thorough; "49% was not examined" does not. The notice
    // has to be the second one, or it reassures instead of warning.
    const n = truncationNotice(capSourceText('a'.repeat(1_000_000), 500_000));
    expect(n).toContain('50%');
    expect(n).toContain('not examined');
    expect(n).toMatch(/unverified/);
  });

  it('does not divide by zero on an empty document', () => {
    expect(truncationNotice({ chars: 0, truncated: true, originalChars: 0, capChars: 10 }))
      .toContain('0%');
  });
});

describe('extractionOf — reading the stamp back', () => {
  it('reads a record written by capSourceText', () => {
    const { text: _t, ...rec } = capSourceText('a'.repeat(600_000), 500_000);
    const back = extractionOf({ extraction: rec });
    expect(back?.truncated).toBe(true);
    expect(back?.originalChars).toBe(600_000);
  });

  it('returns null for rows written before the stamp existed, rather than inventing coverage', () => {
    for (const m of [null, undefined, {}, { extraction: null }, { extraction: 'yes' }, 'nope']) {
      expect(extractionOf(m)).toBeNull();
    }
  });

  it('keeps the cap that was in force at extraction time', () => {
    // A later raise must not rewrite history: a document read under a 500k ceiling was still only
    // read to 500k, whatever the ceiling is today.
    const back = extractionOf({ extraction: { chars: 500_000, truncated: true, originalChars: 1_000_000, capChars: 500_000 } });
    expect(back?.capChars).toBe(500_000);
  });
});
