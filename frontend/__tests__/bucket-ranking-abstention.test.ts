/**
 * Abstention, the corpus factor, and the fields that finally cross the bridge (mig 238).
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

describe('the corpus factor', () => {
  it('abstains when null or omitted', () => {
    expect(scoreCard({ title: 'x' }, { keywords: ['x'] }, NOW).factors).not.toHaveProperty('corpus');
    expect(scoreCard({ title: 'x' }, { keywords: ['x'] }, NOW, { corpusRank: null }).factors)
      .not.toHaveProperty('corpus');
  });

  it('zero is a REAL zero — the corpus was searched and did not match', () => {
    const r = scoreCard({ title: 'x' }, { keywords: ['x'] }, NOW, { corpusRank: 0 });
    expect(r.factors.corpus).toBe(0);
  });

  it('carries a card the card text alone would have missed', () => {
    // The whole point: "hypersonic" appears 14 times in the solicitation and zero times on the card.
    const without = scoreCard({ title: 'Open topic' }, { keywords: ['hypersonic'] }, NOW);
    const withCorpus = scoreCard({ title: 'Open topic' }, { keywords: ['hypersonic'] }, NOW, { corpusRank: 0.8 });
    expect(without.score).toBe(0);
    expect(withCorpus.score).toBeGreaterThan(0);
  });

  it('assists rather than overrides — its default weight is below keyword', () => {
    // A corpus hit must not outrank a card whose curated summary actually matched.
    const cardHit = scoreCard({ title: 'hypersonic glide' }, { keywords: ['hypersonic'] }, NOW, { corpusRank: 0 });
    const corpusOnly = scoreCard({ title: 'Open topic' }, { keywords: ['hypersonic'] }, NOW, { corpusRank: 1 });
    expect(cardHit.score).toBeGreaterThan(corpusOnly.score);
  });

  it('is clamped, so an out-of-range rank cannot leak a bad score', () => {
    const r = scoreCard({ title: 'x' }, { keywords: ['x'] }, NOW, { corpusRank: 7.5 });
    expect(r.factors.corpus).toBe(100);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('respects an explicit weight', () => {
    const r = scoreCard({ title: 'x' }, { keywords: ['nope'], weights: { corpus: 2 } }, NOW, { corpusRank: 1 });
    // keyword 0 at weight 1, corpus 100 at weight 2 → 67
    expect(r.score).toBe(67);
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
