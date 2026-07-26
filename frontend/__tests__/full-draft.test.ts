/**
 * TEST — portal/[tenantSlug]/proposals/[proposalId]/full-draft route handler
 *
 * The Proposal Draft Manager trigger (P3): the sole producer of the
 * `proposal.full_draft_requested` event that the pipeline OnFullDraftRequested
 * workflows trigger on. Focus:
 *   (a) auth guards — 401 unauth, 403 insufficient role (tenant_user)
 *   (b) input validation — 400 bad mode, 400 bad voice token
 *   (c) 404 when the proposal is not in this tenant
 *   (d) success — emits proposal.full_draft_requested (namespace `proposal`)
 *       with the workflow-facing snake_case payload in the emitEventEnd result
 *       (proposal_id + mode + voice), persists voice, returns {requested,mode}
 *
 * Mocks: @/auth, @/lib/db (sql + getTenantBySlug + verifyTenantAccess +
 * enterTenant), @/lib/events. @/lib/rbac is REAL (isRole/hasRoleAtLeast are
 * pure). This route uses the portal RLS pattern (enterTenant), not sqlBypass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────
const {
  authMock,
  sqlMock,
  getTenantBySlugMock,
  verifyTenantAccessMock,
  emitEventStartMock,
  emitEventEndMock,
} = vi.hoisted(() => {
  // sql.json(v) — postgres.js jsonb helper; plain fn (identity) so mockReset
  // can't wipe it. The mock ignores interpolated values.
  const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  return {
    authMock: vi.fn(),
    sqlMock,
    getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(),
    emitEventStartMock: vi.fn(),
    emitEventEndMock: vi.fn(),
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────
vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  enterBypass: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));

vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

// ─── Import route after mocks ──────────────────────────────────────────
import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/full-draft/route';

// ─── Fixtures ──────────────────────────────────────────────────────────
const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OPP_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function makeSession(role = 'tenant_admin') {
  return { user: { id: USER_ID, email: 'alice@acme.com', role, tenantId: TENANT_ID } };
}

function makeCtx() {
  return { params: Promise.resolve({ tenantSlug: 'acme-defense', proposalId: PROPOSAL_ID }) };
}

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/portal/acme-defense/proposals/${PROPOSAL_ID}/full-draft`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
}

function wireHappyGate() {
  authMock.mockResolvedValue(makeSession('tenant_admin'));
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID, slug: 'acme-defense' });
  verifyTenantAccessMock.mockResolvedValue(true);
  emitEventStartMock.mockResolvedValue('evt-start-id');
  emitEventEndMock.mockResolvedValue(undefined);
  // SELECT proposal → found (subsequent UPDATE/INSERT results are unused).
  sqlMock.mockResolvedValue([{ id: PROPOSAL_ID, opportunityId: OPP_ID }]);
}

describe('POST /api/portal/[tenantSlug]/proposals/[proposalId]/full-draft', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
  });

  // ── Auth guards ──────────────────────────────────────────────────────
  it('returns 401 when no session', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ mode: 'a' }), makeCtx());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('returns 403 when role is below tenant_admin', async () => {
    authMock.mockResolvedValue(makeSession('tenant_user'));
    const res = await POST(makeRequest({ mode: 'a' }), makeCtx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  // ── Input validation ─────────────────────────────────────────────────
  it('returns 400 when mode is not a/b/c', async () => {
    wireHappyGate();
    const res = await POST(makeRequest({ mode: 'x' }), makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('returns 400 when voice contains an unknown token', async () => {
    wireHappyGate();
    const res = await POST(makeRequest({ mode: 'a', voice: ['technical', 'bogus'] }), makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  // ── Not found ────────────────────────────────────────────────────────
  it('returns 404 when the proposal is not in this tenant', async () => {
    wireHappyGate();
    sqlMock.mockReset();
    sqlMock.json = (v: unknown) => v;
    sqlMock.mockResolvedValueOnce([]); // SELECT proposal → none
    const res = await POST(makeRequest({ mode: 'a' }), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  // ── Success ──────────────────────────────────────────────────────────
  it('emits proposal.full_draft_requested with the snake_case workflow payload and returns 200', async () => {
    wireHappyGate();
    const res = await POST(
      makeRequest({ mode: 'c', voice: ['technical', 'persuasive'] }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    // adversarial defaults to false (not requested) → present but off.
    expect(await res.json()).toEqual({ data: { requested: true, mode: 'c', adversarial: false } });

    // Event type/namespace EXACTLY match the pipeline trigger
    // (proposal:proposal.full_draft_requested:end).
    expect(emitEventStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'proposal',
        type: 'proposal.full_draft_requested',
        tenantId: TENANT_ID,
        payload: expect.objectContaining({
          proposal_id: PROPOSAL_ID,
          tenant_id: TENANT_ID,
          mode: 'c',
          voice: ['technical', 'persuasive'],
          opportunity_id: OPP_ID,
        }),
      }),
    );
    // The END event carries the workflow-facing payload (matched on phase='end').
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({
        result: expect.objectContaining({
          proposal_id: PROPOSAL_ID,
          mode: 'c',
          voice: ['technical', 'persuasive'],
        }),
      }),
    );
  });

  it('treats an empty/absent voice as null (no register) and still emits', async () => {
    wireHappyGate();
    const res = await POST(makeRequest({ mode: 'b' }), makeCtx());
    expect(res.status).toBe(200);
    expect(emitEventStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'proposal.full_draft_requested',
        payload: expect.objectContaining({ mode: 'b', voice: null }),
      }),
    );
  });

  // ── Adversarial gate (P4-D) ──────────────────────────────────────────
  it('threads the adversarial gate + auto policy into the workflow payload (Mode C)', async () => {
    wireHappyGate();
    const res = await POST(
      makeRequest({ mode: 'c', adversarial: true, adversarialPolicy: 'auto' }),
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { requested: true, mode: 'c', adversarial: true, adversarialPolicy: 'auto' },
    });
    // The END event carries the snake_case gate fields the pipeline's request_overlay reads.
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({
        result: expect.objectContaining({
          mode: 'c',
          adversarial: true,
          adversarial_policy: 'auto',
          adversarial_resolution: 'majority',
        }),
      }),
    );
  });

  it('defaults the adversarial policy to hitl when omitted', async () => {
    wireHappyGate();
    const res = await POST(makeRequest({ mode: 'c', adversarial: true }), makeCtx());
    expect(res.status).toBe(200);
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({
        result: expect.objectContaining({ adversarial: true, adversarial_policy: 'hitl' }),
      }),
    );
  });

  it('ignores the adversarial gate for non-C modes (no gate cohort)', async () => {
    wireHappyGate();
    const res = await POST(makeRequest({ mode: 'a', adversarial: true }), makeCtx());
    expect(res.status).toBe(200);
    expect(emitEventStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ mode: 'a', adversarial: false }),
      }),
    );
  });

  it('returns 400 when adversarialPolicy is not hitl/auto', async () => {
    wireHappyGate();
    const res = await POST(
      makeRequest({ mode: 'c', adversarial: true, adversarialPolicy: 'bogus' }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });
});
