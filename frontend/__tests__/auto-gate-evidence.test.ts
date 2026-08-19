/**
 * The AI-manager stage gate's auto-close decision (B17 + PATTERN_AUDIT HIGH-4).
 *
 * This one boolean decides whether a customer's proposal stage advances with nobody looking at
 * it. It has been wrong in both directions, so both are pinned here:
 *
 *   · a review WITH findings must not auto-close   (HIGH-4)
 *   · a review that never RAN must not auto-close  (B17 — the dangerous one, because a
 *     safe-skipped cohort produces zero findings and zero findings looked like a clean pass)
 *
 * The assisted path is not covered here on purpose: a human may close a gate the AI never
 * reviewed. That is judgement, not a bug — the summary now tells them the review did not run.
 */
import { describe, expect, it } from 'vitest';
import { autoGateRefusal } from '@/lib/portal-workflow';

const clean = { verdict: 'reviewed', noteCount: 0, cohortRan: true };

describe('auto-close is allowed only on an evidenced, clean review', () => {
  it('passes a clean review the cohort actually ran', () => {
    expect(autoGateRefusal(clean)).toBeNull();
  });

  it.each(['pass', 'clean'])('accepts the other affirmative verdicts (%s)', (verdict) => {
    expect(autoGateRefusal({ ...clean, verdict })).toBeNull();
  });
});

describe('B17 — silence is not a pass', () => {
  it('refuses when the pipeline says the cohort did NOT run', () => {
    // The exact shape of the bug: a safe-skipped manager, so zero notes, which used to read clean.
    expect(autoGateRefusal({ verdict: 'not_reviewed', noteCount: 0, cohortRan: false }))
      .toBe('review_not_evidenced');
  });

  it('refuses a NULL verdict rather than treating unknown as clean', () => {
    // Completions emitted before the verdict existed. Unknown is not a pass.
    expect(autoGateRefusal({ verdict: null, noteCount: 0, cohortRan: null }))
      .toBe('review_not_evidenced');
  });

  it('refuses an unverified verdict', () => {
    expect(autoGateRefusal({ verdict: 'unverified', noteCount: 0, cohortRan: false }))
      .toBe('review_not_evidenced');
  });

  it('refuses even when the verdict reads clean but the evidence flag says otherwise', () => {
    // Belt and braces: the two signals disagreeing means something is wrong, and the safe
    // resolution of "something is wrong" is a human, not an advance.
    expect(autoGateRefusal({ verdict: 'reviewed', noteCount: 0, cohortRan: false }))
      .toBe('review_not_evidenced');
  });
});

describe('HIGH-4 — findings park the gate', () => {
  it('refuses a review that ran and found something', () => {
    expect(autoGateRefusal({ ...clean, noteCount: 3 })).toBe('review_has_findings');
  });

  it('reports the MISSING review first when a review neither ran nor is clean', () => {
    // Ordering matters for the reason string a builder reads: "nothing reviewed this" is the
    // more important fact than "there are notes".
    expect(autoGateRefusal({ verdict: null, noteCount: 3, cohortRan: false }))
      .toBe('review_not_evidenced');
  });
});
