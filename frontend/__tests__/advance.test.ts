/**
 * TEST-05 — POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance
 *
 * Tests:
 *   (a) Auth guard: 401 unauthenticated, 403 insufficient role
 *   (b) 404 when tenant not found
 *   (c) 403 when tenant access denied
 *   (d) 404 when proposal not found
 *   (e) 422 when proposal is already at final gate
 *   (f) 422 when no sections exist
 *   (g) 422 when unmet gate requirements (GATE_REQUIREMENTS_NOT_MET)
 *   (h) 409 when OCC version conflict (CONFLICT → stage already changed)
 *   (i) 200 success: proposal.advanced event emitted, emitEventEnd called
 *   (j) 422 when targetStage skips a gate
 *   (k) 422 when proposal is locked
 *
 * Mocked: @/auth, @/lib/db (sql + sql.begin + getTenantBySlug + verifyTenantAccess),
 *         @/lib/events (emitEventStart + emitEventEnd + userActor), @/lib/validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────────
const { authMock, sqlMock, sqlBeginMock, getTenantBySlugMock, verifyTenantAccessMock,
  emitEventStartMock, emitEventEndMock, isValidUUIDMock } = vi.hoisted(() => {
  const sqlBeginMock = vi.fn();
  const sqlMock = Object.assign(vi.fn(), { begin: sqlBeginMock });
  return {
    authMock: vi.fn(),
    sqlMock,
    sqlBeginMock,
    getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(),
    emitEventStartMock: vi.fn(),
    emitEventEndMock: vi.fn(),
    isValidUUIDMock: vi.fn(),
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/db', () => ({
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));

vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

vi.mock('@/lib/validation', () => ({
  isValidUUID: isValidUUIDMock,
}));

// ─── Import after mocks ────────────────────────────────────────────────────
import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/advance/route';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeSession(role = 'tenant_admin') {
  return {
    user: { id: USER_ID, email: 'alice@acme.com', role, tenantId: TENANT_ID },
  };
}

function makeTenant() {
  return { id: TENANT_ID, slug: 'acme-defense', name: 'Acme Defense' };
}

function makeProposal(overrides: Partial<{
  id: string; stage: string; title: string;
  gateConfig: string[]; lockCount: number; isLocked: boolean; version: number;
}> = {}) {
  return {
    id: PROPOSAL_ID,
    stage: 'draft',
    title: 'My Proposal',
    gateConfig: ['draft', 'review', 'final'],
    lockCount: 0,
    isLocked: false,
    version: 3,
    ...overrides,
  };
}

function makeCtx(tenantSlug = 'acme-defense', proposalId = PROPOSAL_ID) {
  return {
    params: Promise.resolve({ tenantSlug, proposalId }),
  };
}

function makeRequest(body: unknown = {}) {
  return new Request(`http://localhost/api/portal/acme-defense/proposals/${PROPOSAL_ID}/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Shared setup for happy-path: auth + tenant + proposal + sections all succeed
function setupHappyPath({ proposal = makeProposal(), sections = 2 } = {}) {
  authMock.mockResolvedValue(makeSession());
  getTenantBySlugMock.mockResolvedValue(makeTenant());
  verifyTenantAccessMock.mockResolvedValue(true);
  isValidUUIDMock.mockReturnValue(true);

  // Proposal query
  sqlMock.mockResolvedValueOnce([proposal]);
  // Section count
  sqlMock.mockResolvedValueOnce([{ count: String(sections) }]);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('POST advance — auth guards', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
  });

  it('returns 401 when no session', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('returns 403 when role is tenant_user (below tenant_admin)', async () => {
    authMock.mockResolvedValue(makeSession('tenant_user'));
    isValidUUIDMock.mockReturnValue(true);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('returns 403 when role is partner_user', async () => {
    authMock.mockResolvedValue(makeSession('partner_user'));
    isValidUUIDMock.mockReturnValue(true);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });

  it('returns 401 when session has invalid role string', async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: 'x@x.com', role: 'not_a_role' } });
    isValidUUIDMock.mockReturnValue(true);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 when proposalId is not a valid UUID', async () => {
    authMock.mockResolvedValue(makeSession());
    isValidUUIDMock.mockReturnValue(false);
    const ctx = { params: Promise.resolve({ tenantSlug: 'acme-defense', proposalId: 'not-a-uuid' }) };
    const res = await POST(makeRequest(), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when tenant not found', async () => {
    authMock.mockResolvedValue(makeSession());
    isValidUUIDMock.mockReturnValue(true);
    getTenantBySlugMock.mockResolvedValue(null);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('returns 403 when tenant access denied', async () => {
    authMock.mockResolvedValue(makeSession());
    isValidUUIDMock.mockReturnValue(true);
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(false);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });
});

describe('POST advance — proposal loading / gate validation', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
  });

  it('returns 404 when proposal not found', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    sqlMock.mockResolvedValueOnce([]); // no proposal
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('returns 409 when proposal is locked', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    sqlMock.mockResolvedValueOnce([makeProposal({ isLocked: true })]);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('LOCKED');
  });

  it('returns 422 when already at the final gate', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    // Proposal is at the last gate
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'final', gateConfig: ['draft', 'review', 'final'] })]);
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.error).toMatch(/final gate/i);
  });

  it('returns 422 when no sections exist (section count = 0)', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    sqlMock.mockResolvedValueOnce([makeProposal()]);
    sqlMock.mockResolvedValueOnce([{ count: '0' }]); // no sections
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.error).toMatch(/no sections/i);
  });

  it('returns 422 when targetStage skips a gate (not the next one)', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    // Proposal at draft, trying to jump to final (skipping review)
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'draft', gateConfig: ['draft', 'review', 'final'] })]);
    sqlMock.mockResolvedValueOnce([{ count: '2' }]);

    const res = await POST(makeRequest({ targetStage: 'final' }), makeCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 when proposal DB query throws', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    sqlMock.mockRejectedValueOnce(new Error('DB timeout'));
    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('DB_ERROR');
  });
});

describe('POST advance — OCC version conflict (409)', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
  });

  it('returns 409 CONFLICT when transaction throws CONFLICT (version mismatch)', async () => {
    setupHappyPath();
    emitEventStartMock.mockResolvedValue('evt-start-id');

    // Inside the transaction, the UPDATE affects 0 rows (version mismatch → throws 'CONFLICT')
    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([]) // gate requirements query (no unmet gates)
        .mockResolvedValueOnce([  // sections snapshot
          { id: 's1', title: 'Section 1', version: 1, status: 'in_progress', content: null },
        ])
        .mockResolvedValueOnce([]) // stage_completion_snapshots INSERT
        .mockResolvedValueOnce([]) // proposal_sections UPDATE (mark completed)
        // canvas_versions INSERT for loop - no content so not called
        .mockImplementationOnce(() => {
          // UPDATE proposals returns count=0 → CONFLICT
          return Promise.resolve(Object.assign([], { count: 0 }));
        });
      return cb(txMock);
    });

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('CONFLICT');

    // emitEventEnd should have been called with the error
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({ error: expect.objectContaining({ code: 'CONFLICT' }) }),
    );
  });
});

describe('POST advance — gate requirements', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
  });

  it('returns 422 GATE_REQUIREMENTS_NOT_MET when unmet gates exist and force is not set', async () => {
    setupHappyPath();
    emitEventStartMock.mockResolvedValue('evt-start-id');

    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([{ label: 'Executive Summary' }, { label: 'Budget Justification' }]); // unmet gates
      return cb(txMock);
    });

    const res = await POST(makeRequest({ force: false }), makeCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('GATE_REQUIREMENTS_NOT_MET');
    expect(json.details.unmet).toContain('Executive Summary');
    expect(json.details.unmet).toContain('Budget Justification');
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({ error: expect.objectContaining({ code: 'GATE_REQUIREMENTS_NOT_MET' }) }),
    );
  });

  it('proceeds when force=true even with unmet gate requirements', async () => {
    setupHappyPath();
    emitEventStartMock.mockResolvedValue('evt-start-id');

    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([{ label: 'Executive Summary' }]) // unmet gates
        .mockResolvedValueOnce([])  // sections snapshot (empty)
        .mockResolvedValueOnce([])  // stage_completion_snapshots INSERT
        .mockResolvedValueOnce([])  // proposal_sections UPDATE
        .mockImplementationOnce(() => Promise.resolve(Object.assign([], { count: 1 }))) // UPDATE proposals
        .mockResolvedValue([]); // stage history
      return cb(txMock);
    });

    // Activity log after transaction
    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ force: true }), makeCtx());
    expect(res.status).toBe(200);
  });
});

describe('POST advance — success path', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
  });

  it('emits proposal.advanced event on success and returns 200 with new stage', async () => {
    setupHappyPath();
    emitEventStartMock.mockResolvedValue('evt-start-id');

    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([]) // gate requirements — no unmet
        .mockResolvedValueOnce([]) // sections snapshot (empty for simplicity)
        .mockResolvedValueOnce([]) // stage_completion_snapshots INSERT
        .mockResolvedValueOnce([]) // proposal_sections UPDATE
        .mockImplementationOnce(() => Promise.resolve(Object.assign([], { count: 1 }))) // UPDATE proposals (version match)
        .mockResolvedValue([]); // stage_history INSERT
      return cb(txMock);
    });

    // Activity log
    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.previousStage).toBe('draft');
    expect(json.data.stage).toBe('review');
    expect(json.data.locked).toBe(false);

    // Event assertions
    expect(emitEventStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'proposal',
        type: 'proposal.advanced',
        tenantId: TENANT_ID,
      }),
    );
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({
        result: expect.objectContaining({
          proposalId: PROPOSAL_ID,
          previousStage: 'draft',
          targetStage: 'review',
        }),
      }),
    );
  });

  it('auto-locks and advances to submitted when advancing to final gate', async () => {
    // Proposal at 'review', gates: ['draft', 'review', 'final']
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'review' })]);
    sqlMock.mockResolvedValueOnce([{ count: '1' }]);
    emitEventStartMock.mockResolvedValue('evt-start-id');

    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([]) // gate requirements
        .mockResolvedValueOnce([{ id: 's1', title: 'S1', version: 1, status: 'complete', content: null }])
        .mockResolvedValueOnce([]) // snapshot insert
        .mockResolvedValueOnce([]) // proposal_sections update
        // No canvas_versions (no content)
        .mockImplementationOnce(() => Promise.resolve(Object.assign([], { count: 1 }))) // UPDATE proposals with is_locked=true
        .mockResolvedValue([]); // stage_history x2
      return cb(txMock);
    });

    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);

    const json = await res.json();
    // When advancing to 'final', it auto-locks and sets stage to 'submitted'
    expect(json.data.locked).toBe(true);
    expect(json.data.stage).toBe('submitted');
    expect(json.data.lockCount).toBe(1);
  });

  it('rfp_admin is allowed to advance proposals', async () => {
    authMock.mockResolvedValue(makeSession('rfp_admin'));
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);

    sqlMock.mockResolvedValueOnce([makeProposal()]);
    sqlMock.mockResolvedValueOnce([{ count: '1' }]);
    emitEventStartMock.mockResolvedValue('evt-start-id');

    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => Promise.resolve(Object.assign([], { count: 1 })))
        .mockResolvedValue([]);
      return cb(txMock);
    });

    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
  });

  it('accepts empty body (auto-advance to next gate)', async () => {
    setupHappyPath();
    emitEventStartMock.mockResolvedValue('evt-start-id');

    sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockImplementationOnce(() => Promise.resolve(Object.assign([], { count: 1 })))
        .mockResolvedValue([]);
      return cb(txMock);
    });

    sqlMock.mockResolvedValue([]);

    // Send request with no body
    const req = new Request(`http://localhost/api/portal/acme-defense/proposals/${PROPOSAL_ID}/advance`, {
      method: 'POST',
    });

    const res = await POST(req, makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.stage).toBe('review'); // next after 'draft'
  });
});
