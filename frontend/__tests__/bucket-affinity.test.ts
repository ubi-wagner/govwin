/**
 * Affinity — the thumb generalised into the attributes behind it.
 *
 * A verdict on a card is already handled: it sorts the feed and gates nudges. What it could not do
 * was help with the card the customer has NOT seen — which is the entire point of "rank new
 * opportunities like the ones I marked". That needs the vote generalised: a customer who up-votes
 * three Navy SBIR additive topics has said something about Navy, about SBIR, and about additive
 * manufacturing, and the fourth such topic should arrive near the top before anyone has looked.
 *
 * The three guards below are what separate a signal from a bug, and each has its own case.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreCard, buildAffinityProfile, affinityKeys, DEFAULT_WEIGHTS,
  type CardFields,
} from '@/lib/bucket-scoring';

const NOW = 1_787_011_200_000;
const KW = { keywords: ['zz'] };

const VOTED = [
  { card: { agency: 'Department of the Navy', programType: 'sbir', techFocusAreas: ['additive manufacturing'] }, verdict: 'monitoring' },
  { card: { agency: 'Department of the Navy', phaseType: 'Direct to Phase II' }, verdict: 'pursuing' },
  { card: { agency: 'NASA', techFocusAreas: ['life support'] }, verdict: 'passed' },
];
const profile = buildAffinityProfile(VOTED);
const factorsFor = (card: CardFields) => scoreCard({ title: 'zz', ...card }, KW, NOW, { affinity: profile }).factors;

describe('buildAffinityProfile', () => {
  it('counts a purchase as a like — buying is the strongest endorsement there is', () => {
    expect(profile.net['agency:department of the navy']).toBe(2); // monitoring + pursuing
    expect(profile.votes).toBe(3);
  });

  it('carries negative signal with the same machinery as positive', () => {
    expect(profile.net['agency:nasa']).toBe(-1);
    expect(profile.net['tech:life support']).toBe(-1);
  });

  it('ignores cards the customer never judged', () => {
    const p = buildAffinityProfile([{ card: { agency: 'DOE' }, verdict: 'unreviewed' }]);
    expect(p.votes).toBe(0);
    expect(p.net).toEqual({});
  });

  it('counts one card as one opinion even when it repeats an attribute', () => {
    const p = buildAffinityProfile([{ card: { techFocusAreas: ['materials', 'materials'] }, verdict: 'monitoring' }]);
    expect(p.net['tech:materials']).toBe(1);
  });

  it('is case- and whitespace-insensitive, so the same agency is the same key', () => {
    expect(affinityKeys({ agency: '  Department Of The NAVY ' })).toContain('agency:department of the navy');
  });
});

describe('the affinity factor', () => {
  it('lifts a card sharing an up-voted attribute', () => {
    expect(factorsFor({ agency: 'Department of the Navy' }).affinity).toBe(100);
  });

  it('scores a down-voted attribute a REAL 0 — in the denominator, not abstaining', () => {
    const f = factorsFor({ agency: 'NASA' });
    expect(f.affinity).toBe(0);
    // And it must actually move the score, or "a real 0" is a claim with no consequence.
    const withAffinity = scoreCard({ title: 'zz', agency: 'NASA' }, KW, NOW, { affinity: profile }).score;
    const without = scoreCard({ title: 'zz', agency: 'NASA' }, KW, NOW).score;
    expect(withAffinity).toBeLessThan(without);
  });

  it('ABSTAINS on an attribute the tenant has never judged', () => {
    // Absent is not zero: someone who voted on Navy topics has said nothing about the Interior.
    expect(factorsFor({ agency: 'Department of the Interior' })).not.toHaveProperty('affinity');
  });

  it('averages mixed attributes by how much each DIMENSION says', () => {
    // A disliked agency (0.7) against a liked program type (0.3): (0·0.7 + 1·0.3)/1.0 = 0.3.
    // An unweighted mean would call this a 50 — treating "it is an SBIR", which 63 of 63 cards are,
    // as equal evidence to who the customer sells to.
    expect(factorsFor({ agency: 'NASA', programType: 'sbir' }).affinity).toBe(30);
  });

  it('lets a technology match outweigh a generic program match', () => {
    // tech 1.0 (liked) vs program 0.3 — this is the whole reason the table exists.
    const p = buildAffinityProfile([
      { card: { techFocusAreas: ['additive manufacturing'] }, verdict: 'monitoring' },
      { card: { programType: 'sbir' }, verdict: 'passed' },
    ]);
    const f = scoreCard({ title: 'zz', techFocusAreas: ['additive manufacturing'], programType: 'sbir' }, KW, NOW, { affinity: p }).factors;
    expect(f.affinity).toBeGreaterThan(50);   // the specific signal wins
    expect(f.affinity).toBeLessThan(100);     // but the rejection is not ignored
  });

  it('SKIPS a card the customer already judged — the self-loop guard', () => {
    // Without this, an up-voted card would always match itself perfectly and boost its own score,
    // double-counting a verdict the feed's ORDER BY already expresses.
    expect(factorsFor({ agency: 'Department of the Navy', verdict: 'monitoring' })).not.toHaveProperty('affinity');
    expect(factorsFor({ agency: 'Department of the Navy', verdict: 'passed' })).not.toHaveProperty('affinity');
    // …and the guard is specific to a judged card, not to any card with a truthy field.
    expect(factorsFor({ agency: 'Department of the Navy', verdict: 'unreviewed' }).affinity).toBe(100);
  });

  it('does nothing at all before the customer has voted', () => {
    const empty = buildAffinityProfile([]);
    expect(scoreCard({ title: 'zz', agency: 'Department of the Navy' }, KW, NOW, { affinity: empty }).factors)
      .not.toHaveProperty('affinity');
    // Inert by default: no `inputs` at all is byte-for-byte the pre-affinity scorer.
    expect(scoreCard({ title: 'zz', agency: 'Department of the Navy' }, KW, NOW))
      .toEqual(scoreCard({ title: 'zz', agency: 'Department of the Navy' }, KW, NOW, {}));
  });

  it('is weighted below the criteria the customer wrote themselves', () => {
    expect(DEFAULT_WEIGHTS.affinity).toBeLessThan(DEFAULT_WEIGHTS.keyword);
    expect(DEFAULT_WEIGHTS.affinity).toBe(DEFAULT_WEIGHTS.timeline);
  });
});
