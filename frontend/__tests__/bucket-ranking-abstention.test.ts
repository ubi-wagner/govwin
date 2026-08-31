/**
 * Abstention, the curated ranking corpus, and the fields that cross the bridge (mig 238 · 239).
 *
 * ── THE BUG THIS PINS ────────────────────────────────────────────────────────────────────────
 * Four of six factors — agency, naics, program, accessibility — guarded only the BUCKET side. So a
 * card whose `agency` the ingest never captured scored **0** on that factor and still entered the
 * denominator: the tenant's lens was punishing the card for the platform's missing data. Only
 * `timeline` got it right, and it says so in a comment: *"an invalid date must not change the
 * denominator."* The other four are the same statement with the same answer.
 *
 * It was latent only because live buckets are thin (4 of 5 set keywords and nothing else). It fires
 * the moment bucket authoring gets prefill — which is exactly the change queued behind it.
 *
 * The distinction that matters throughout: **absent is not zero.** A card with no agency abstains;
 * a card with an agency that does not match scores a real 0. Both are asserted below, because a fix
 * that abstained on a genuine miss would be a worse bug wearing the same shape.
 */
import { describe, it, expect } from 'vitest';
import { scoreCard } from '@/lib/bucket-ranking';
import { describeComposition, DEFAULT_WEIGHTS } from '@/lib/bucket-scoring';

const NOW = 1_787_011_200_000; // 2026-08-29T00:00:00Z
const DAY = 86_400_000;

describe('abstention — a card is not punished for what ingest never captured', () => {
  it('agency: absent abstains, present-but-wrong is a real 0', () => {
    const criteria = { keywords: ['radar'], agencies: ['navy'] };
    const absent = scoreCard({ title: 'Radar' }, criteria, NOW);
    const wrong = scoreCard({ title: 'Radar', agency: 'Air Force' }, criteria, NOW);

    expect(absent.factors).not.toHaveProperty('agency'); // out of the denominator entirely
    expect(absent.score).toBe(100);                      // keyword alone, and it hit

    expect(wrong.factors.agency).toBe(0);                // in the denominator, scoring zero
    expect(wrong.score).toBe(50);
  });

  it('naics: absent and EMPTY-ARRAY both abstain; a non-matching code is a real 0', () => {
    const criteria = { naics: ['541715'] };
    expect(scoreCard({ title: 'x' }, criteria, NOW).factors).not.toHaveProperty('naics');
    expect(scoreCard({ title: 'x', naicsCodes: [] }, criteria, NOW).factors).not.toHaveProperty('naics');
    expect(scoreCard({ title: 'x', naicsCodes: ['999999'] }, criteria, NOW).factors.naics).toBe(0);
  });

  it('program: absent abstains, mismatched is a real 0', () => {
    const criteria = { programTypes: ['sbir'] };
    expect(scoreCard({ title: 'x' }, criteria, NOW).factors).not.toHaveProperty('program');
    expect(scoreCard({ title: 'x', programType: 'sttr' }, criteria, NOW).factors.program).toBe(0);
  });

  it('accessibility: absent abstains, mismatched is a real 0', () => {
    const criteria = { setAsides: ['8(a)'], useAccessibility: true };
    expect(scoreCard({ title: 'x' }, criteria, NOW).factors).not.toHaveProperty('accessibility');
    expect(scoreCard({ title: 'x', setAsideType: 'sdvosb' }, criteria, NOW).factors.accessibility).toBe(0);
  });

  it('keyword: a card with NO matchable text at all abstains', () => {
    // Nothing to match against is the ingest side's gap, not the card's fault — same rule.
    expect(scoreCard({}, { keywords: ['radar'] }, NOW).factors).not.toHaveProperty('keyword');
    expect(scoreCard({ title: 'sonar' }, { keywords: ['radar'] }, NOW).factors.keyword).toBe(0);
  });

  it('the empty card against every criterion scores 0 with an EMPTY factor set', () => {
    const r = scoreCard({}, {
      keywords: ['a'], naics: ['1'], agencies: ['b'], programTypes: ['c'],
      setAsides: ['d'], useAccessibility: true, useTimeline: true,
    }, NOW);
    expect(r.factors).toEqual({});
    expect(r.score).toBe(0); // no signals → no denominator → 0, not a confident 0 out of 5
  });

  it('timeline still abstains on an unparseable date — the behaviour the others now copy', () => {
    const r = scoreCard({ title: 'x', closeDate: 'Fri Aug 28' }, { keywords: ['x'], useTimeline: true }, NOW);
    expect(r.factors).not.toHaveProperty('timeline');
    expect(r.score).toBe(100);
  });
});

describe('the fields that finally cross the bridge (mig 238)', () => {
  it('techFocusAreas is matchable — the open-topic case', () => {
    // "open topics which include manufacturing might get missed by electronics researchers but
    // might be a perfect fit." The signal was extracted, edited and read by an agent, and dropped
    // by the one hop that feeds ranking.
    const r = scoreCard(
      { title: 'Open topic', techFocusAreas: ['advanced manufacturing', 'autonomy'] },
      { keywords: ['manufacturing'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });

  it('phaseType is matchable', () => {
    const r = scoreCard({ title: 'Open topic', phaseType: 'Direct to Phase II' },
      { keywords: ['direct to phase ii'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });

  it('topic identity is matchable', () => {
    const r = scoreCard({ title: 'x', topicNumber: 'AF261-0001', topicBranch: 'USAF' },
      { keywords: ['af261-0001'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });
});

describe('the curated record — what ranking reads instead of the solicitation (mig 239)', () => {
  /**
   * mig 238 fed a ts_rank over the tenant's copy of the whole solicitation. Measured on one
   * 330-page general BAA, ts_rank returns the SAME value for terms the document has nothing to do
   * with — agriculture, concrete and submarine all 0.0608 — because a general solicitation mentions
   * everything once. The factor measured document LENGTH. What replaces it is what a curator
   * PRODUCED while reading: small, specific, and there because a person decided it mattered.
   */
  it('a volume name is matchable', () => {
    const r = scoreCard({ title: 'Open topic', volumes: ['Technical Volume', 'Commercialization Plan'] },
      { keywords: ['commercialization'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });

  it('a required item is matchable — the skeleton says what the work IS', () => {
    const r = scoreCard({ title: 'Open topic', requiredItems: ['Phase I Work Plan', 'Letters of Support'] },
      { keywords: ['work plan'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });

  it("an admin's highlight is matchable — the residue of a reading that otherwise evaporates", () => {
    const r = scoreCard({
      title: 'Open topic',
      highlights: [{ text: 'Proposals must address additive construction of expeditionary structures.' }],
    }, { keywords: ['expeditionary'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });

  it('a highlight with no text contributes nothing, and does not throw', () => {
    const r = scoreCard({ title: 'Open topic', highlights: [{ text: null }, { text: '   ' }] },
      { keywords: ['expeditionary'] }, NOW);
    expect(r.factors.keyword).toBe(0);
  });

  it('survives every field arriving as the wrong shape', () => {
    // Stored jsonb of an older vintage, or a hand-edited row. The scorer must not throw on it.
    const r = scoreCard({
      title: 'Open topic',
      volumes: 'not a list' as unknown as string[],
      requiredItems: null,
      highlights: { nope: true } as unknown as Array<{ text: string }>,
    }, { keywords: ['open'] }, NOW);
    expect(r.factors.keyword).toBe(100);
  });

  it('there is NO corpus factor any more', () => {
    const r = scoreCard({
      title: 'x', volumes: ['Technical Volume'], requiredItems: ['Work Plan'],
      highlights: [{ text: 'anything' }],
    }, { keywords: ['x'] }, NOW);
    expect(r.factors).not.toHaveProperty('corpus');
    expect(Object.keys(r.factors)).toEqual(['keyword']);
  });

  it('the curated record does not manufacture a factor of its own', () => {
    // It widens the TEXT the keyword factor matches. It is not a separate signal with a weight,
    // because a separate signal is what let a 330-page document score at ceiling on every bucket.
    const r = scoreCard({ volumes: ['Cost Volume'] }, { keywords: ['cost'] }, NOW);
    expect(Object.keys(r.factors)).toEqual(['keyword']);
    expect(r.score).toBe(100);
  });
});

describe('what the fix must NOT change', () => {
  it('a fully-populated card scores exactly as before', () => {
    const r = scoreCard(
      { title: 'AI Radar', agency: 'DARPA', naicsCodes: ['541715'], programType: 'sbir',
        setAsideType: 'small business', closeDate: new Date(NOW + 10 * DAY).toISOString() },
      { keywords: ['ai'], naics: ['541715'], agencies: ['darpa'], programTypes: ['sbir'],
        setAsides: ['small business'], useAccessibility: true, useTimeline: true },
      NOW);
    expect(r.score).toBe(100);
    expect(Object.keys(r.factors).sort())
      .toEqual(['accessibility', 'agency', 'keyword', 'naics', 'program', 'timeline']);
  });

  it('empty criteria is still 0 with no factors', () => {
    expect(scoreCard({ title: 'x' }, {}, NOW)).toEqual({ score: 0, factors: {} });
  });
});
