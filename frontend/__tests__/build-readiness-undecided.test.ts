/**
 * Build-out readiness must count the items still waiting on a person.
 *
 * Ingest derives part of a solicitation's shape and no more — on a DoD annual BAA that is the
 * Volume 1 summaries, Volume 2, Volume 3 and some of Volume 5. The remainder (a DSIP webform, a
 * commercialization report, certifications, a signed DD Form 2345) has to be BUILT as a mold or
 * MARKED as completed elsewhere. An item left undecided is not neutral: it provisions as an
 * authorable section and the drafter fills it with prose, which is how an AI-written "DD Form 2345"
 * reaches a buyer. So "undecided" belongs in the readiness bar, not beside it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));

import { getBuildReadiness } from '@/lib/provisioning/readiness';

const row = (over: Record<string, unknown> = {}) => [{
  hasCompliance: true, volumeCount: 7, requiredItemCount: 22,
  itemsWithTemplate: 12, itemsUndecided: 0,
  buildComplete: false, buildCompletedAt: null, ...over,
}];

beforeEach(() => sqlMock.mockReset());

describe('getBuildReadiness', () => {
  it('is ready when compliance, volumes and items are present and nothing is undecided', async () => {
    sqlMock.mockResolvedValueOnce(row());
    const r = await getBuildReadiness('11111111-1111-4111-8111-111111111111');
    expect(r.ready).toBe(true);
    expect(r.itemsUndecided).toBe(0);
  });

  it('is NOT ready while any item still needs building or marking', async () => {
    sqlMock.mockResolvedValueOnce(row({ itemsUndecided: 10 }));
    const r = await getBuildReadiness('11111111-1111-4111-8111-111111111111');
    expect(r.ready).toBe(false);
    expect(r.itemsUndecided).toBe(10);
    // The other three legs are all satisfied — undecided items are what holds it back, and the
    // cockpit needs the count to say so rather than just "below the bar".
    expect(r.hasCompliance).toBe(true);
    expect(r.volumeCount).toBeGreaterThan(0);
    expect(r.requiredItemCount).toBeGreaterThan(0);
  });

  it('still fails on the original three legs, so the new one only ADDS a condition', async () => {
    for (const over of [{ hasCompliance: false }, { volumeCount: 0 }, { requiredItemCount: 0 }]) {
      sqlMock.mockResolvedValueOnce(row(over));
      expect((await getBuildReadiness('11111111-1111-4111-8111-111111111111')).ready).toBe(false);
    }
  });

  it('counts an item as decided when it has a mold OR is marked completed-elsewhere', async () => {
    sqlMock.mockResolvedValueOnce(row());
    await getBuildReadiness('11111111-1111-4111-8111-111111111111');
    const q = (sqlMock.mock.calls.at(-1)?.[0] as string[]).join('?');
    // Both halves of "decided" must be in the predicate, and the volume-level mark must count too —
    // a whole DSIP-only volume shouldn't leave every one of its items reading as outstanding.
    expect(q).toMatch(/vri\.template_id IS NULL/);
    expect(q).toMatch(/vri\.metadata->>'dsipOnly'/);
    expect(q).toMatch(/sv\.metadata->>'dsipOnly'/);
  });

  it('fails closed on a bad id and on a query error', async () => {
    expect((await getBuildReadiness('')).ready).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
    sqlMock.mockRejectedValueOnce(new Error('boom'));
    const r = await getBuildReadiness('11111111-1111-4111-8111-111111111111');
    expect(r.ready).toBe(false);
    expect(r.itemsUndecided).toBe(0);
  });
});
