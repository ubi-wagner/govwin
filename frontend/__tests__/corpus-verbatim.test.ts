/**
 * LIB-HYGIENE — the probe that decides whose words an atom contains.
 *
 * The DB half (does this text appear in the solicitation corpus?) is proven live by
 * `scripts/backfill-corpus-verbatim.mts` against real solicitations. What is pinned here is the
 * DECISION the probe encodes, because both of its properties were arrived at by getting them
 * wrong first:
 *
 *   · a short atom is never judged — a heading legitimately appears in both a solicitation and a
 *     company's own proposal, and flagging on one would fence real material;
 *   · the probe is taken from the MIDDLE — openings are the most-shared part of any document, so
 *     matching on one would flag a tenant's section for being called "Technical Approach".
 */
import { describe, expect, it } from 'vitest';
import { corpusProbe, normalizeForCorpusMatch } from '@/lib/library/corpus-verbatim';

const LONG = (s: string, n = 400) => s.repeat(Math.ceil(n / s.length)).slice(0, n);

describe('normalization closes the gap between an extractor and a stored atom', () => {
  it('collapses whitespace, so a PDF line-wrap cannot defeat a match', () => {
    expect(normalizeForCorpusMatch('the  offeror\n shall\tsubmit')).toBe('the offeror shall submit');
  });

  it('folds smart quotes and dashes, which extractors and editors disagree about', () => {
    expect(normalizeForCorpusMatch('the “offeror’s” plan — revised'))
      .toBe('the "offeror\'s" plan - revised');
  });
});

describe('a short atom is never judged', () => {
  it.each([
    ['', 'empty'],
    ['Technical Approach', 'a heading'],
    ['Volume 1 — Technical Volume, 10 pages', 'a label with a real page limit in it'],
  ])('returns null for %s (%s)', (text) => {
    expect(corpusProbe(text)).toBeNull();
  });

  it('returns null just below the threshold and a probe just above it', () => {
    expect(corpusProbe('a'.repeat(119))).toBeNull();
    expect(corpusProbe('a'.repeat(121))).not.toBeNull();
  });
});

describe('the probe comes from the middle, not the opening', () => {
  it('skips the opening of a long passage', () => {
    const text = `${'OPENING '.repeat(20)}${'MIDDLE '.repeat(20)}${'CLOSING '.repeat(20)}`;
    const probe = corpusProbe(text)!;
    expect(probe).toContain('middle');
    expect(probe.startsWith('opening')).toBe(false);
  });

  it('returns the whole passage when it is shorter than one probe window', () => {
    const text = LONG('the offeror shall describe the technical approach in detail. ', 150);
    expect(corpusProbe(text)).toBe(normalizeForCorpusMatch(text));
  });

  it('is stable — the same text always probes the same slice', () => {
    const text = LONG('phase i shall culminate in a final report delivered to the contracting officer. ');
    expect(corpusProbe(text)).toBe(corpusProbe(text));
  });

  it('probes identically across formatting differences in the same passage', () => {
    // The operation ORDER is the thing under test: normalize, THEN slice. An atom extracted from
    // a PDF carries different whitespace and quote characters than the corpus copy of the same
    // sentence, so its RAW length differs — slicing first would take a different window from each
    // and the two would never match, which is the bug this asserts against. Same sentence, same
    // repetition count, different formatting.
    const messy = 'the offeror’s  proposal   shall\nnot exceed ten pages of narrative content. ';
    const clean = "the offeror's proposal shall not exceed ten pages of narrative content. ";
    expect(messy.length).not.toBe(clean.length);          // genuinely different raw input
    expect(corpusProbe(messy.repeat(5))).toBe(corpusProbe(clean.repeat(5)));
  });
});
