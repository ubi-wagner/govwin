import { describe, it, expect } from 'vitest';
import { summarize } from '@/lib/proposal-color-team';

/**
 * Color-team review STATUS — the half of the loop that was missing.
 *
 * The review CONTENT always landed correctly (the fabric writes each completed review into
 * proposal_comments as an `ai_review`, which the section thread renders). What never surfaced was
 * a review that did NOT run. On this database 36 of 68 queued color-team tasks failed, every one
 * with "exceeded the hourly call limit", and the customer was told only "N reviews queued". A
 * section whose review silently died is indistinguishable from one the reviewer had nothing to say
 * about — which is the reading that gets an unreviewed section shipped.
 *
 * These lock the rollup the UI states, with the emphasis that matters: a failure is never rounded
 * off into progress.
 */

const row = (over: Partial<Parameters<typeof summarize>[0][number]> = {}) => ({
  sectionId: crypto.randomUUID(), sectionTitle: 'Phase I Statement of Work',
  status: 'completed', error: null, comments: 1,
  createdAt: '2026-08-19T00:00:00Z', completedAt: '2026-08-19T00:01:00Z', ...over,
});

describe('color-team status rollup', () => {
  it('counts each state and never lets a failure read as progress', () => {
    const s = summarize([
      row(), row(), row(),
      row({ status: 'failed', error: 'Tenant abc exceeded the hourly call limit', comments: 0 }),
      row({ status: 'failed', error: 'Tenant abc exceeded the hourly call limit', comments: 0 }),
    ]);
    expect(s.total).toBe(5);
    expect(s.completed).toBe(3);
    expect(s.failed).toBe(2);
    // The headline LEADS with the failure. "3 of 5 sections reviewed" is technically true and
    // materially misleading — it reads as progress toward a finish that is not coming.
    expect(s.headline).toMatch(/^2 of 5 section reviews did not run/);
    expect(s.headline).toContain('exceeded the hourly call limit');
    expect(s.headline).toContain('Retry');
  });

  it('names the shared reason when every failure has one, and drops it when they differ', () => {
    const shared = summarize([
      row({ status: 'failed', error: 'rate limit' }),
      row({ status: 'failed', error: 'rate limit' }),
    ]);
    expect(shared.headline).toContain('rate limit');

    const mixed = summarize([
      row({ status: 'failed', error: 'rate limit' }),
      row({ status: 'failed', error: 'model timeout' }),
    ]);
    // With two different causes a single reason would be a lie about one of them; the per-section
    // list still carries both.
    expect(mixed.headline).not.toContain('rate limit');
    expect(mixed.sections.map((x) => x.error)).toEqual(['rate limit', 'model timeout']);
  });

  it('gives a failure a reason even when none was recorded', () => {
    // A failed task with a null error must not render as a blank tooltip — "we do not know why"
    // is information; an empty string is not.
    const s = summarize([row({ status: 'failed', error: null })]);
    expect(s.sections[0].error).toMatch(/did not run/);
  });

  it('never attaches an error to a review that succeeded', () => {
    // A stale error column on a completed row would make a good review look suspect.
    const s = summarize([row({ status: 'completed', error: 'some earlier attempt failed' })]);
    expect(s.sections[0].error).toBeNull();
    expect(s.sections[0].state).toBe('completed');
  });

  it('reports work still in flight rather than calling it done', () => {
    const s = summarize([row(), row({ status: 'running', comments: 0 }), row({ status: 'queued', comments: 0 })]);
    expect(s.pending).toBe(2);
    expect(s.headline).toBe('1 of 3 sections reviewed · 2 still running.');
  });

  it('says so plainly when everything passed', () => {
    expect(summarize([row(), row()]).headline).toBe('All 2 sections reviewed.');
  });

  it('distinguishes "never asked" from "asked and got nothing"', () => {
    // An empty queue is not a clean bill of health.
    expect(summarize([]).headline).toMatch(/No color-team review has been requested/);
    expect(summarize([]).total).toBe(0);
  });

  it('carries the comment count so a "completed" review with no output is visible', () => {
    // A review that completed but wrote no comment produced nothing the author can act on — the
    // count is what lets the UI distinguish that from a review with findings.
    const s = summarize([row({ comments: 0 }), row({ comments: 4 })]);
    expect(s.sections.map((x) => x.comments)).toEqual([0, 4]);
  });

  it('normalises timestamps and tolerates missing ones', () => {
    const s = summarize([row({ completedAt: null })]);
    expect(s.sections[0].requestedAt).toBe('2026-08-19T00:00:00.000Z');
    expect(s.sections[0].finishedAt).toBeNull();
  });
});
