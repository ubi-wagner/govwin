/**
 * Mid-window propagation lib (lib/curation/republish.ts) — hermetic unit tests.
 *
 * Locks the contracts the FLEX pass hangs on:
 *   1. BEST-EFFORT: the tail NEVER throws — it rides on business writes that already
 *      committed, so a propagation failure (or a mocked/absent sql) must not surface.
 *   2. SCOPING + CHANGE DETECTION: a topic-scoped edit touches exactly that opp; a
 *      solicitation-wide edit walks the activation set; a never-released opp is skipped;
 *      a released opp whose fresh snapshot equals the bridge head is UNCHANGED — no junk
 *      version, no pin-nudge re-arm, no rescore storm (the double-clicked-Broadcast case).
 *   3. LATE-TOPIC GATE: release keys on the BRIDGE (not is_active), refuses without a
 *      close date (mig-128 date guard), refuses a CLOSED/ARCHIVED topic (retraction is a
 *      lifecycle decision a close-date edit may never undo — adversarially proven), and
 *      no-ops off a pushed solicitation.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }) }));
const { publishMock, snapshotMock } = vi.hoisted(() => ({
  publishMock: vi.fn(), snapshotMock: vi.fn(),
}));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn(async () => 'evt') }));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/opportunity-bridge', () => ({
  publishAndFanOut: publishMock,
  buildCardSnapshot: snapshotMock,
}));
vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return { ...actual, emitEventSingle: emitSingleMock };
});

import { republishSolicitationCards, activateLateTopicIfReady } from '@/lib/curation/republish';

const SOL = '22222222-2222-4222-8222-222222222222';
const OPP = '33333333-3333-4333-8333-333333333333';
const ACTOR = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.com' };

const CARD = (title: string, frozenAt = '2026-01-01T00:00:00Z') => ({ title, frozenAt });

beforeEach(() => {
  sqlMock.mockReset();
  publishMock.mockReset();
  snapshotMock.mockReset();
  emitSingleMock.mockClear();
});

describe('republishSolicitationCards', () => {
  it('topic-scoped CHANGED edit republishes exactly that opp (no activation-set lookup)', async () => {
    sqlMock.mockResolvedValueOnce([{ card: CARD('old') }]);          // head
    snapshotMock.mockResolvedValueOnce(CARD('new', '2026-02-02T00:00:00Z'));
    publishMock.mockResolvedValueOnce({ event: { id: 'b1' }, tenantsApplied: 3 });
    const out = await republishSolicitationCards({ solicitationId: SOL, opportunityId: OPP, actorId: ACTOR.id });
    expect(sqlMock).toHaveBeenCalledTimes(1); // head check only — no activation-set query
    expect(publishMock).toHaveBeenCalledWith(OPP, 'updated', ACTOR.id, expect.any(String));
    expect(out).toEqual({ republished: 1, skipped: 0, unchanged: 0, cardsRefreshed: 3 });
  });

  it('an UNCHANGED snapshot (frozenAt ignored) publishes nothing — the no-op-broadcast killer', async () => {
    sqlMock.mockResolvedValueOnce([{ card: CARD('same', '2026-01-01T00:00:00Z') }]);
    snapshotMock.mockResolvedValueOnce(CARD('same', '2026-03-03T00:00:00Z')); // only frozenAt differs
    const out = await republishSolicitationCards({ solicitationId: SOL, opportunityId: OPP });
    expect(publishMock).not.toHaveBeenCalled();
    expect(out).toEqual({ republished: 0, skipped: 0, unchanged: 1, cardsRefreshed: 0 });
  });

  it('solicitation-wide edit walks the activation set; never-released opps are skipped', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 'opp-a' }, { id: 'opp-b' }])     // activation set
      .mockResolvedValueOnce([{ card: CARD('old') }])                 // opp-a head
      .mockResolvedValueOnce([]);                                     // opp-b: never released
    snapshotMock.mockResolvedValueOnce(CARD('new'));
    publishMock.mockResolvedValueOnce({ event: { id: 'b1' }, tenantsApplied: 2 });
    const out = await republishSolicitationCards({ solicitationId: SOL, actorId: ACTOR.id });
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ republished: 1, skipped: 1, unchanged: 0, cardsRefreshed: 2 });
  });

  it('NEVER throws — a failing (or absent) sql yields zeros, not an error', async () => {
    sqlMock.mockRejectedValueOnce(new Error('db down'));
    await expect(republishSolicitationCards({ solicitationId: SOL })).resolves.toEqual({
      republished: 0, skipped: 0, unchanged: 0, cardsRefreshed: 0,
    });
    // The unit-test shape that broke the volume tools live: sql returns undefined.
    sqlMock.mockResolvedValueOnce(undefined);
    await expect(republishSolicitationCards({ solicitationId: SOL })).resolves.toEqual({
      republished: 0, skipped: 0, unchanged: 0, cardsRefreshed: 0,
    });
    // A per-opp publish throw is contained too.
    sqlMock
      .mockResolvedValueOnce([{ id: 'opp-a' }])
      .mockResolvedValueOnce([{ card: CARD('old') }]);
    snapshotMock.mockResolvedValueOnce(CARD('new'));
    publishMock.mockRejectedValueOnce(new Error('bridge down'));
    await expect(republishSolicitationCards({ solicitationId: SOL })).resolves.toEqual({
      republished: 0, skipped: 1, unchanged: 0, cardsRefreshed: 0,
    });
  });
});

describe('activateLateTopicIfReady', () => {
  const row = (over: Record<string, unknown>) => [{
    closeDate: new Date('2026-09-01'), solStatus: 'pushed_to_pipeline',
    solicitationId: SOL, bridgeHead: null, submissionStage: 'open', ...over,
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

  it('REFUSES a closed/archived topic — a close-date edit may never undo a retraction', async () => {
    sqlMock.mockResolvedValueOnce(row({ submissionStage: 'closed' }));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'not_open' });
    sqlMock.mockResolvedValueOnce(row({ submissionStage: 'archived' }));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'not_open' });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('CAS belt: a concurrent close between read and write makes the flip a no-op, no publish', async () => {
    sqlMock
      .mockResolvedValueOnce(row({}))   // read says open
      .mockResolvedValueOnce([]);       // CAS UPDATE returns 0 rows (someone closed it)
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'not_open' });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('releases a date-complete late topic: W2 activation + first bridge publish + audit event', async () => {
    sqlMock
      .mockResolvedValueOnce(row({}))            // lookup
      .mockResolvedValueOnce([{ id: OPP }]);     // CAS UPDATE flipped a row
    publishMock.mockResolvedValueOnce({ event: { id: 'b1' }, tenantsApplied: 2 });
    const out = await activateLateTopicIfReady(OPP, ACTOR);
    expect(out).toEqual({ released: true, cardsRefreshed: 2 });
    expect(publishMock).toHaveBeenCalledWith(OPP, 'published', ACTOR.id, expect.any(String));
    expect(emitSingleMock).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'finder', type: 'topic.released',
      payload: expect.objectContaining({ opportunityId: OPP, lateRelease: true }),
    }));
  });

  it('a null actor (system-driven topic-file ingest) releases without a uuid crash', async () => {
    sqlMock
      .mockResolvedValueOnce(row({}))
      .mockResolvedValueOnce([{ id: OPP }]);
    publishMock.mockResolvedValueOnce({ event: { id: 'b1' }, tenantsApplied: 1 });
    const out = await activateLateTopicIfReady(OPP, { id: null });
    expect(out.released).toBe(true);
    expect(publishMock).toHaveBeenCalledWith(OPP, 'published', null, expect.any(String));
  });

  it('never throws on a broken lookup', async () => {
    sqlMock.mockRejectedValueOnce(new Error('boom'));
    expect(await activateLateTopicIfReady(OPP, ACTOR)).toEqual({ released: false, reason: 'error' });
  });
});
