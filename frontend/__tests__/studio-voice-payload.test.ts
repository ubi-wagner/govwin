/**
 * THE STUDIO CARRIES THE PROPOSAL'S VOICE — pinned because it silently did not (bug log B84).
 *
 * `OnReviewPhaseRequestedDraft.plan_draft` and `OnReviewPhaseRequestedRefine.restyle` both declare
 * `"voice": "payload.voice"` in their input_map. `requestReviewPhase` is the ONE canonical emitter
 * for their trigger, and it never wrote that key — so the engine resolved voice to null on every
 * Studio run and the drafting agent fell back to its house register.
 *
 * Nothing complained, and nothing could: a degraded AI_INVOKE input is a SAFE SKIP by design (a
 * workflow must never dead-end), so a broken input contract and a working one look identical from
 * the workflow's side. What made it customer-visible is the asymmetry — `requestFullDraft` DOES
 * carry voice, so the same proposal with the same persisted `proposals.voice` drafted in the
 * tenant's voice from the full-draft button and in the house voice from the Studio, which is the
 * designated single front door for AI drafting.
 *
 * WHY A UNIT TEST WHEN A LIVE HARNESS EXISTS. Two harnesses prove this on a running box —
 * `frontend/scripts/verify-studio-voice.mts` (real emitter → real engine resolver) and
 * `pipeline/scripts/check_ai_invoke_contract.py` (the standing lens that found it). Both need a
 * database with real event history. CI has neither, and this is exactly the kind of key a future
 * refactor drops without noticing. So the contract also gets a check that runs everywhere.
 *
 * The real `requestReviewPhase` runs here against a mocked `@/lib/db` and `@/lib/events` — the
 * payload asserted is the one the function actually builds, not a copy of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock, emitEventStartMock, emitEventEndMock } = vi.hoisted(() => ({
  sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }),
  emitEventStartMock: vi.fn(),
  emitEventEndMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { requestReviewPhase } from '@/lib/proposal-studio';

const P = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

const base = {
  proposalId: P,
  tenantId: T,
  opportunityId: null,
  phase: 'draft' as const,
  auto: false,
  guidance: null,
  actorId: '33333333-3333-4333-8333-333333333333',
  actorEmail: 'a@b.test',
  role: 'tenant_admin' as const,
  source: 'studio_portal' as const,
};

/** The emitted END payload, read off the mock — never re-derived. */
function emitted() {
  return emitEventStartMock.mock.calls[0][0].payload as Record<string, unknown>;
}

beforeEach(() => {
  sqlMock.mockReset();
  emitEventStartMock.mockReset().mockResolvedValue('evt-1');
  emitEventEndMock.mockReset().mockResolvedValue(undefined);
});

describe('requestReviewPhase carries the proposal voice', () => {
  it('emits the voice the UPDATE returned', async () => {
    sqlMock
      .mockResolvedValueOnce([{ voice: ['technical', 'research'] }]) // the UPDATE … RETURNING voice
      .mockResolvedValueOnce([]);                                    // the activity log
    await requestReviewPhase(base);
    expect(emitted().voice).toEqual(['technical', 'research']);
  });

  it('the key is present even when no voice is set — absent and null are different to a resolver', async () => {
    // `resolve_input` returning None for a missing key and for an explicit null are the same
    // downstream, but the LENS that found this reads key PRESENCE off stored payloads. A payload
    // that omits the key when there is no voice would make the contract unverifiable on any box
    // where no tenant happens to have set one.
    sqlMock.mockResolvedValueOnce([{ voice: null }]).mockResolvedValueOnce([]);
    await requestReviewPhase(base);
    expect(Object.keys(emitted())).toContain('voice');
    expect(emitted().voice).toBeNull();
  });

  it('a failed state UPDATE degrades to a null voice rather than throwing', async () => {
    // The UPDATE is already wrapped in a non-critical try/catch — a phase run must not be lost
    // because the voice read failed. Pre-fix behaviour was exactly a null voice, so this is a
    // degradation to the old path, not a new failure mode.
    sqlMock.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([]);
    await expect(requestReviewPhase(base)).resolves.toBeUndefined();
    expect(emitted().voice).toBeNull();
    expect(emitEventStartMock).toHaveBeenCalledTimes(1);
  });

  it('an UPDATE that matched no row (wrong tenant) does not throw on the missing row', async () => {
    // The WHERE binds tenant_id, so a cross-tenant call returns zero rows. `row?.voice` must not
    // explode — the emit still happens, voice null.
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(requestReviewPhase(base)).resolves.toBeUndefined();
    expect(emitted().voice).toBeNull();
  });

  it('the workflows this feeds really do read payload.voice', () => {
    // Pins the OTHER half of the contract from the frontend side. If someone removes the voice
    // input_map from the pipeline templates, this test should be deleted WITH it — and finding this
    // assertion is how they learn the emitter change was for those steps.
    const src = require('node:fs').readFileSync(
      require('node:path').join(process.cwd(), '..', 'pipeline', 'src', 'workflows', 'on_review_phase_requested.py'),
      'utf8',
    ) as string;
    expect(src).toMatch(/_VOICE\s*=\s*["']payload\.voice["']/);
    expect(src).toMatch(/"voice":\s*_VOICE/);
  });
});
