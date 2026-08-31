/**
 * Signal coverage — does a lens's criterion reach ANY of this tenant's cards?
 *
 * ── THE DEFECT THIS ENCODES ──────────────────────────────────────────────────────────────────
 * `scoreCard` abstains rather than punishing a card for what ingest never captured, and the bucket
 * author was told so: "A signal is skipped for any opportunity that does not carry that field."
 * That sentence is true whether the field is on every opportunity or on none, so it cannot be acted
 * on. Measured on the sandbox at the time this was written: `naics_codes` is an EMPTY ARRAY on all
 * 22 master opportunities, so it is empty on all 63 cards — and a lens naming NAICS codes was shown
 * "NAICS codes 25%" while that 25% reached nothing. The customer's ranking was keywords and closing
 * date at 100%, and the page said otherwise.
 *
 * ── THE INSTRUMENT BEFORE THE FINDING ────────────────────────────────────────────────────────
 * `measureCoverage` derives coverage by running `scoreCard` itself, so these cases validate it
 * against hand-verified answers before any of its output is believed. The `closeDate` case is the
 * one that matters most: it is exactly where a SQL `<> ''` count — the obvious implementation —
 * would report a signal as covered while the ranker abstains on every row.
 */

import { describe, it, expect } from 'vitest';
import { measureCoverage, describeComposition, scoreCard, type CardFields } from '@/lib/bucket-scoring';

const NOW = 1_787_011_200_000; // 2026-08-29T00:00:00Z

const FULL: CardFields = {
  title: 'Additive construction',
  agency: 'Department of the Navy',
  programType: 'SBIR',
  naicsCodes: ['541715'],
  setAsideType: 'SBA',
  closeDate: '2026-09-20T00:00:00Z',
};

describe('measureCoverage — how many cards a signal can actually reach', () => {
  it('a fully-populated card carries every conditional signal', () => {
    const cov = measureCoverage([FULL], NOW);
    expect(cov.cards).toBe(1);
    expect(cov.carried).toMatchObject({ naics: 1, agency: 1, program: 1, accessibility: 1, timeline: 1 });
  });

  it('an EMPTY ARRAY of naics codes is not coverage — the real sandbox state', () => {
    // Every opportunity on the box carries `naics_codes = '{}'`: non-null, and worth nothing.
    const cards: CardFields[] = [
      { title: 'a', agency: 'Navy', naicsCodes: [] },
      { title: 'b', agency: 'Army', naicsCodes: [] },
      { title: 'c', agency: 'DOE' },
    ];
    const cov = measureCoverage(cards, NOW);
    expect(cov.cards).toBe(3);
    expect(cov.carried.naics ?? 0).toBe(0);
    expect(cov.carried.agency).toBe(3);
  });

  it('a non-ISO close date is NOT covered — where a SQL "<> \'\'" count would lie', () => {
    // The exact string the bridge is recorded as having written into card jsonb.
    const card: CardFields = { title: 'x', closeDate: 'Fri Aug 28 2026 00:00:00 GMT+0000 (Coordinated Universal Time)' };
    // Red half: the field is non-empty, so any presence-based count says "covered".
    expect(String(card.closeDate).trim()).not.toBe('');
    // Green half: the ranker abstains on it, and coverage agrees with the ranker.
    expect(scoreCard(card, { keywords: ['x'], useTimeline: true }, NOW).factors).not.toHaveProperty('timeline');
    expect(measureCoverage([card], NOW).carried.timeline ?? 0).toBe(0);
  });

  it('coverage counts PARTICIPATION, never a good score', () => {
    // A card whose agency cannot match the probe still COUNTS: the question is whether the signal
    // is in the denominator, not whether it wins.
    const cov = measureCoverage([{ title: 'x', agency: 'Department of Energy' }], NOW);
    expect(cov.carried.agency).toBe(1);
  });

  it('agrees with scoreCard on every signal, card by card', () => {
    // The property that makes the measurement trustworthy: a signal is counted for a card exactly
    // when a real bucket naming that signal would put it in that card's denominator.
    const cards: CardFields[] = [
      FULL,
      { title: 'no fields at all' },
      { title: 'part', programType: 'STTR', closeDate: '2026-12-01' },
      { title: 'bad date', agency: 'USAF', closeDate: 'next Tuesday' },
    ];
    const real = { keywords: ['x'], naics: ['541715'], agencies: ['navy'], programTypes: ['sbir'], setAsides: ['sba'], useAccessibility: true, useTimeline: true };
    const expected: Record<string, number> = {};
    for (const c of cards) {
      for (const k of Object.keys(scoreCard(c, real, NOW).factors)) expected[k] = (expected[k] ?? 0) + 1;
    }
    const cov = measureCoverage(cards, NOW);
    for (const k of ['naics', 'agency', 'program', 'accessibility', 'timeline']) {
      expect(cov.carried[k as keyof typeof cov.carried] ?? 0).toBe(expected[k] ?? 0);
    }
  });
});

describe('describeComposition — carrying coverage to the person authoring the lens', () => {
  const criteria = { keywords: ['additive'], naics: ['541715'], agencies: ['navy'], useTimeline: true };

  it('reports NO claim when coverage was not measured', () => {
    for (const e of describeComposition(criteria).entries) {
      expect(e.carried).toBeNull();
      expect(e.cards).toBeNull();
    }
  });

  it('reports 0-of-N for a criterion no card can satisfy', () => {
    const cov = measureCoverage([{ title: 'a', agency: 'Navy' }, { title: 'b', agency: 'Army' }], NOW);
    const { entries } = describeComposition(criteria, cov);
    const naics = entries.find((e) => e.key === 'naics')!;
    const agency = entries.find((e) => e.key === 'agency')!;
    expect([naics.carried, naics.cards]).toEqual([0, 2]);
    expect([agency.carried, agency.cards]).toEqual([2, 2]);
  });

  it('leaves the UNCONDITIONAL keyword signal unmeasured', () => {
    // Every card has a title, so "carried by 2 of 2" would be noise dressed as information.
    const cov = measureCoverage([{ title: 'a' }, { title: 'b' }], NOW);
    const kw = describeComposition(criteria, cov).entries.find((e) => e.key === 'keyword')!;
    expect(kw.conditional).toBe(false);
    expect(kw.carried).toBeNull();
  });

  it('does not disturb the shares it already reported', () => {
    const cov = measureCoverage([FULL], NOW);
    const a = describeComposition(criteria).entries.map((e) => [e.key, e.share]);
    const b = describeComposition(criteria, cov).entries.map((e) => [e.key, e.share]);
    expect(b).toEqual(a);
  });
});
