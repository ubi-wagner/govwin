import { describe, expect, it } from 'vitest';
import {
  SUBMISSION_STAGES, canTransition, coarseStatus, isActiveStage,
  eventTypeForStage, allowedTransitions, isSubmissionStage, STAGE_LABEL,
  type SubmissionStage,
} from '@/lib/lifecycle';

describe('lifecycle: canonical 6-state model', () => {
  it('has exactly the 6 spec stages, each labelled', () => {
    expect([...SUBMISSION_STAGES]).toEqual(['nofo', 'pre_release', 'open', 'updated', 'closed', 'archived']);
    for (const s of SUBMISSION_STAGES) expect(STAGE_LABEL[s]).toBeTruthy();
  });

  it('isSubmissionStage guards unknown values', () => {
    expect(isSubmissionStage('open')).toBe(true);
    expect(isSubmissionStage('OPEN')).toBe(false);
    expect(isSubmissionStage('bogus')).toBe(false);
    expect(isSubmissionStage(null)).toBe(false);
  });

  it('coarseStatus collapses to open/closed/archived for feed filters', () => {
    expect(coarseStatus('nofo')).toBe('open');
    expect(coarseStatus('pre_release')).toBe('open');
    expect(coarseStatus('open')).toBe('open');
    expect(coarseStatus('updated')).toBe('open');
    expect(coarseStatus('closed')).toBe('closed');
    expect(coarseStatus('archived')).toBe('archived');
  });

  it('isActiveStage true only for the open band', () => {
    expect(isActiveStage('open')).toBe(true);
    expect(isActiveStage('updated')).toBe(true);
    expect(isActiveStage('closed')).toBe(false);
    expect(isActiveStage('archived')).toBe(false);
  });
});

describe('lifecycle: transitions', () => {
  it('allows the forward + reopen/archive edges, rejects illegal ones', () => {
    expect(canTransition('nofo', 'pre_release')).toBe(true);
    expect(canTransition('pre_release', 'open')).toBe(true);
    expect(canTransition('open', 'updated')).toBe(true);
    expect(canTransition('open', 'closed')).toBe(true);
    expect(canTransition('closed', 'open')).toBe(true); // reopen
    expect(canTransition('archived', 'open')).toBe(true); // un-archive
    expect(canTransition('open', 'archived')).toBe(true);
    // illegal
    expect(canTransition('closed', 'updated')).toBe(false);
    expect(canTransition('archived', 'closed')).toBe(false);
    expect(canTransition('nofo', 'closed')).toBe(false);
    expect(canTransition('open', 'open')).toBe(false); // no self-transition
  });

  it('every listed transition is itself a valid stage', () => {
    for (const from of SUBMISSION_STAGES) {
      for (const to of allowedTransitions(from)) {
        expect(isSubmissionStage(to)).toBe(true);
        expect(canTransition(from, to)).toBe(true);
      }
    }
  });
});

describe('lifecycle: bridge event mapping', () => {
  const cases: Array<[SubmissionStage, SubmissionStage, string]> = [
    ['open', 'closed', 'closed'],
    ['open', 'archived', 'archived'],
    ['closed', 'open', 'reopened'],
    ['archived', 'open', 'reopened'],
    ['open', 'updated', 'updated'],
    ['pre_release', 'open', 'updated'],
  ];
  it.each(cases)('%s → %s emits %s', (from, to, expected) => {
    expect(eventTypeForStage(from, to)).toBe(expected);
  });
});
