/**
 * Mid-window propagation lib (lib/curation/republish.ts) — hermetic unit tests.
 *
 * Locks the three contracts the whole FLEX pass hangs on:
 *   1. BEST-EFFORT: the tail NEVER throws — it rides on business writes that already
 *      committed, so a propagation failure (or a mocked/absent sql) must not surface.
 *   2. SCOPING: a topic-scoped edit republishes exactly that opp; a solicitation-wide
 *      edit republishes the activation set; never-released opps count as skipped.
 *   3. LATE-TOPIC GATE: release keys on the BRIDGE (not is_active), refuses without a
 *      close date (mig-128 date guard), and no-ops off a pushed solicitation.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }) }));
const { republishMock, publishMock } = vi.hoisted(() => ({
  republishMock: vi.fn(), publishMock: vi.fn(),
}));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn(async () => 'evt') }));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/opportunity-bridge', () => ({
  republishIfReleased: republishMock,
  publishAndFanOut: publishMock,
}));
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, emitEventSingle: emitSingleMock };
});

import { republishSolicitationCards, activateLateTopicIfReady } from '@/lib/curation/republish';

const SOL = '22222222-2222-4222-8222-222222222222';
const OPP = '33333333-3333-4333-8333-333333333333';
const ACTOR = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com' };

beforeEach(() => {
  sqlMock.mockReset();
  republishMock.mockReset();
  publishMock.mockReset();
  emitSingleMock.mockClear();
});

describe('republishSolicitationCards', () => {
  it('topic-scoped edit republishes exactly that opp (no activation-set lookup)', async () => {
    republishMock.mockResolvedValue({ event: { id: 'b1' }, tenantsApplied: 3 });
    const out = await republishSolicitationCards({ solicitationId: SOL, opportunityId: OPP, actorId: ACTOR.id });
    expect(sqlMock).not.toHaveBeenCalled();
    expect(republishMock).toHaveBeenCalledTimes(1);
    expect(republishMock.mock.calls[0][0]).toBe(OPP);
    expect(republishMock.mock.calls[0][1]).toBe('updated');
    expect(out).toEqual({ republished: 1, skipped: 0, cardsRefreshed: 3 });
  });

  it('solicitation-wide edit republishes the activation set; never-released opps are skipped', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'opp-a' }, { id: 'opp-b' }]);
    republishMock
      .mockResolvedValueOnce({ event: { id: 'b1' }, tenantsApplied: 2 })
      .mockResolvedValueOnce(null); // opp-b was never released → no-op
    const out = await republishSolicitationCards({ solicitationId: SOL, actorId: ACTOR.id });
    expect(republishMock).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ republished: 1, skipped: 1, cardsRefreshed: 2 });
  });

  it('NEVER throws — a failing (or absent) sql yields zeros, not an error', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    await expect(republishSolicitationCards({ solicitationId: SOL })).resolves.toEqual({
      republished: 0, skipped: 0, cardsRefreshed: 0,
    });
    // The unit-test shape that broke the volume tools live: sql returns undefined.
    sqlMock.mockResolvedValueOnce(undefined);
    await expect(republishSolicitationCards({ solicitationId: SOL })).resolves.toEqual({
      republished: 0, skipped: 0, cardsRefreshed: 0,
    });
    // A per-opp republish throw is contained too.
    sqlMock.mockResolvedValueOnce([{ id: 'opp-a' }]);
    republishMock.mockRejectedValueOnce(new Error('bridge down'));
    await expect(republishSolicitationCards({ solicitationId: SOL })).resolves.toEqual({
      republished: 0, skipped: 1, cardsRefreshed: 0,
    });
  });
});

describe('activateLateTopicIfReady', () => {
  const row = (over: Record<string, unknown>) => [{
    closeDate: new Date('2026-09-01'), solStatus: 'pushed_to_pipeline',
    solicitationId: SOL, bridgeHead: null, ...over,
  }];

  it('refuses off a non-pushed solicitation', async () => {
    sqlMock.mockResolvedValueOnce(row({ solStatus: 'approved' }));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'not_pushed' });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('keys on the BRIDGE, not is_active: an already-published topic is already_released', async () => {
    sqlMock.mockResolvedValueOnce(row({ bridgeHead: 4 }));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'already_released' });
  });

  it('honors the mig-128 date guard: no close date, no customer visibility', async () => {
    sqlMock.mockResolvedValueOnce(row({ closeDate: null }));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'needs_close_date' });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('releases a date-complete late topic: W2 activation + first bridge publish + audit event', async () => {
    sqlMock
      .mockResolvedValueOnce(row({}))   // lookup
      .mockResolvedValueOnce(undefined); // the W2 UPDATE
    publishMock.mockResolvedValueOnce({ event: { id: 'b1' }, tenantsApplied: 2 });
    const out = await activateLateTopicIfReady(OPP, ACTOR);
    expect(out).toEqual({ released: true, cardsRefreshed: 2 });
    expect(publishMock).toHaveBeenCalledWith(OPP, 'published', ACTOR.id, expect.any(String));
    expect(emitSingleMock).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'finder', type: 'topic.released',
      payload: expect.objectContaining({ opportunityId: OPP, lateRelease: true }),
    }));
  });

  it('never throws on a broken lookup', async () => {
    sqlMock.mockRejectedValueOnce(new Error('boom'));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'error' });
  });
});
