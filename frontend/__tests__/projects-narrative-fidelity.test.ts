/**
 * DID THE DRAFTED NARRATIVE INVENT A NUMBER?
 *
 * P1's status report is correct by construction — every figure read off a row. An agent writing the
 * prose around those tables can destroy that in one sentence: "we are approximately 65% through the
 * period" reads perfectly, sits beside a table saying 40%, and the reader believes whichever they
 * saw first.
 *
 * A prompt asking the model not to do that is necessary and insufficient. This is the check that
 * makes it a rule, and these are the cases that decide whether it is usable or gets switched off.
 */
import { describe, it, expect } from 'vitest';
import {
  checkNarrativeFidelity, allowedFigures, numbersIn, SMALL_INT_CEILING,
} from '@/lib/projects/narrative-fidelity';

const ROLLUP = {
  project: {
    costPct: 60, schedulePct: 40, deliverablesPct: 33.3,
    plannedCost: '750000', actualCost: '450000',
    deliverablesAccepted: 1, deliverablesTotal: 3, nodesWithDates: 4,
  },
  variance: [
    { title: 'CDR', varianceDays: 14 },
    { title: 'Kickoff', varianceDays: -3 },
  ],
};

const ALLOWED = allowedFigures(ROLLUP);

describe('the number that was not computed', () => {
  it('CATCHES a plausible invented percentage', () => {
    // The headline case. Nothing about this sentence looks wrong.
    const r = checkNarrativeFidelity(
      'The team is approximately 65% through the period of performance.', ALLOWED,
    );
    expect(r.ok).toBe(false);
    expect(r.invented).toContain('65');
  });

  it('catches an invented dollar figure', () => {
    const r = checkNarrativeFidelity('Spend to date is roughly $512,000.', ALLOWED);
    expect(r.ok).toBe(false);
    expect(r.invented).toContain('512,000');
  });

  it('PASSES the figures the system actually computed', () => {
    const r = checkNarrativeFidelity(
      'Cost stands at 60% against a schedule that has run 40%, with $450000 of $750000 spent. '
      + 'CDR is 14 days past its baseline.',
      ALLOWED,
    );
    expect(r.ok, `invented: ${r.invented.join(', ')}`).toBe(true);
    expect(r.checked, 'and it actually checked something — a green over zero tokens is not a pass')
      .toBeGreaterThan(3);
  });

  it('accepts a computed decimal written without its tail', () => {
    // The report renders 33.3%; prose reasonably says 33%. Dropping precision the system HAD is
    // fine; adding precision it did not is what the check is for.
    expect(checkNarrativeFidelity('Deliverables are 33% accepted.', ALLOWED).ok).toBe(true);
  });

  it('does NOT accept precision the system never had', () => {
    const r = checkNarrativeFidelity('Deliverables are 33.34% accepted.', ALLOWED);
    expect(r.ok).toBe(false);
  });
});

describe('what it deliberately allows, so it does not get switched off', () => {
  it('lets ordinary small integers through', () => {
    const r = checkNarrativeFidelity(
      'Two of the three phases are complete, and one task remains blocked.', ALLOWED,
    );
    expect(r.ok).toBe(true);
  });

  it('and the ceiling is a real boundary, not a vibe', () => {
    expect(checkNarrativeFidelity(`${SMALL_INT_CEILING} items remain.`, []).ok).toBe(true);
    expect(checkNarrativeFidelity(`${SMALL_INT_CEILING + 1} items remain.`, []).ok).toBe(false);
  });

  it('lets a YEAR through — a date is not a claim about the project', () => {
    expect(checkNarrativeFidelity('Work resumed in March 2026 after the holidays.', ALLOWED).ok).toBe(true);
  });

  it('is not fooled by thousands separators or a currency symbol', () => {
    expect(checkNarrativeFidelity('Spend is $750,000 to date.', ALLOWED).ok).toBe(true);
  });

  it('REFUSES to normalise an abbreviation it would be guessing at', () => {
    // "$750K" is almost certainly 750,000 — and a check that approves numbers by inference is a
    // check that will eventually approve a wrong one. It reports it; a person can rephrase.
    const r = checkNarrativeFidelity('Spend is $750K to date.', ALLOWED);
    expect(r.ok).toBe(false);
    expect(r.invented).toContain('750');
  });
});

describe('collecting what is allowed', () => {
  it('walks nested structures rather than a hand-list', () => {
    // A hand-list falls behind the report and starts rejecting figures that ARE on the page.
    expect(ALLOWED).toContain('60');
    expect(ALLOWED).toContain('33.3');
    expect(ALLOWED).toContain('750000');
    expect(ALLOWED).toContain('14');
  });

  it('pulls figures out of STRING fields too', () => {
    const a = allowedFigures({ note: '1 of 3 accepted', cost: '450000.00' });
    expect(a).toContain('1');
    expect(a).toContain('3');
    expect(a).toContain('450000');
  });

  it('survives a null, an undefined and a cycle-free deep object', () => {
    expect(() => allowedFigures(null, undefined, { a: { b: { c: { d: { e: 5 } } } } })).not.toThrow();
  });
});

describe('numbersIn', () => {
  it('finds every numeric token and strips separators', () => {
    expect(numbersIn('$1,100,000 and 43.3% over 14 days')).toEqual(['1100000', '43.3', '14']);
  });

  it('finds none in prose that has none', () => {
    expect(numbersIn('The plan is holding.')).toEqual([]);
  });
});

describe('the empty case', () => {
  it('a narrative with no numbers passes, and says it checked nothing', () => {
    // Distinguishable from a real pass. A green with checked=0 is not evidence the guard works.
    const r = checkNarrativeFidelity('The plan is holding and nothing is blocked.', ALLOWED);
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(0);
  });
});
