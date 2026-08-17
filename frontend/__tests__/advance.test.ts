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
  emitEventStartMock, emitEventEndMock, isValidUUIDMock, requestAgentTaskMock, getNodeTextMock,
  resolveGatePolicyMock, computeReadinessMock } = vi.hoisted(() => {
  const sqlBeginMock = vi.fn();
  const sqlMock = Object.assign(vi.fn(), { begin: sqlBeginMock, json: (v) => v });
  return {
    authMock: vi.fn(),
    sqlMock,
    sqlBeginMock,
    getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(),
    emitEventStartMock: vi.fn(),
    emitEventEndMock: vi.fn(),
    isValidUUIDMock: vi.fn(),
    requestAgentTaskMock: vi.fn(),
    getNodeTextMock: vi.fn(),
    resolveGatePolicyMock: vi.fn(),
    computeReadinessMock: vi.fn(),
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/auth', () => ({ auth: authMock }));

vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {},
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

vi.mock('@/lib/agent-client', () => ({ requestAgentTask: requestAgentTaskMock }));

// The submission-readiness gate (C1) runs only on advance-to-final; mock it so the unit test
// controls the verdict. Unset (default) → undefined → gate is skipped (existing tests unaffected).
vi.mock('@/lib/proposal/submission-readiness', () => ({ computeSubmissionReadiness: computeReadinessMock }));

// AI review on advance is now gated by resolveGatePolicy('proposal:proposal.advanced'),
// not the retired tenant_automation_preferences read (mig 142). Mock the resolver directly.
vi.mock('@/lib/automation/policy', () => ({ resolveGatePolicy: resolveGatePolicyMock }));

vi.mock('@/lib/types/canvas-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/types/canvas-document')>();
  return { ...actual, getNodeText: getNodeTextMock };
});

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

/**
 * Query-aware transaction mock — robust to the order/number of queries inside
 * the advance transaction (so adding a query, like the lock-state gate, does
 * not silently misalign a positional mock sequence). Routes each tagged-template
 * query to a result by matching its SQL text.
 */
function wireTx({
  openSections = [] as Array<Record<string, unknown>>,
  unmetGates = [] as Array<Record<string, unknown>>,
  sections = [] as Array<Record<string, unknown>>,
  updateCount = 1,
} = {}) {
  sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<any>) => {
    const tx = vi.fn((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('is_locked = false')) return Promise.resolve(openSections);
      if (q.includes('stage_gate_requirements')) return Promise.resolve(unmetGates);
      if (q.includes('FROM proposal_sections WHERE proposal_id')) return Promise.resolve(sections);
      if (q.includes('UPDATE proposals')) return Promise.resolve(Object.assign([], { count: updateCount }));
      return Promise.resolve([]); // INSERTs, mark-completed UPDATE, canvas_versions, stage_history
    });
    return cb(tx);
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
    wireTx({
      sections: [{ id: 's1', title: 'Section 1', version: 1, status: 'in_progress', content: null }],
      updateCount: 0, // UPDATE proposals affects 0 rows → CONFLICT
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

    wireTx({ unmetGates: [{ label: 'Executive Summary' }, { label: 'Budget Justification' }] });

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

    wireTx({ unmetGates: [{ label: 'Executive Summary' }] });

    // Activity log after transaction
    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ force: true }), makeCtx());
    expect(res.status).toBe(200);
  });
});

describe('POST advance — lock-state gate (Phase 2)', () => {
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

  it('returns 422 SECTIONS_NOT_LOCKED when a section is unlocked and force is not set', async () => {
    setupHappyPath();
    wireTx({ openSections: [{ id: 's1', title: 'Technical Approach', volumeName: 'Technical Volume' }] });

    const res = await POST(makeRequest({ force: false }), makeCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('SECTIONS_NOT_LOCKED');
    expect(json.details.openSections).toHaveLength(1);
    expect(json.details.openSections[0]).toMatchObject({ title: 'Technical Approach', volumeName: 'Technical Volume' });
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({ error: expect.objectContaining({ code: 'SECTIONS_NOT_LOCKED' }) }),
    );
  });

  it('force-advances despite unlocked sections and records them as forcedOpenSections', async () => {
    setupHappyPath();
    wireTx({ openSections: [{ id: 's1', title: 'Technical Approach', volumeName: 'Technical Volume' }] });
    sqlMock.mockResolvedValue([]); // activity log after the transaction

    const res = await POST(makeRequest({ force: true }), makeCtx());
    expect(res.status).toBe(200);
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'evt-start-id',
      expect.objectContaining({
        result: expect.objectContaining({
          forced: true,
          forcedOpenSections: expect.arrayContaining([
            expect.objectContaining({ title: 'Technical Approach', volumeName: 'Technical Volume' }),
          ]),
        }),
      }),
    );
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

    wireTx();

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

    wireTx({ sections: [{ id: 's1', title: 'S1', version: 1, status: 'complete', content: null }] });

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

    wireTx();

    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
  });

  it('accepts empty body (auto-advance to next gate)', async () => {
    setupHappyPath();
    emitEventStartMock.mockResolvedValue('evt-start-id');

    wireTx();

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

describe('POST advance — submission-readiness gate (C1)', () => {
  // A whole-proposal verdict with two hard blockers (the shape computeSubmissionReadiness returns).
  const blockerReport = {
    proposalId: PROPOSAL_ID, ready: false, blockerCount: 2, warningCount: 0,
    summary: {
      sections: { total: 3, locked: 1, drafted_unlocked: 1, empty: 1 },
      deadline: { closeDate: null, daysRemaining: null, past: false, estimated: false },
      requirements: { mandatory: 0, satisfied: 0, unmet: 0 },
      documents: { required: 1, provided: 0, missing: 1 },
      formatViolations: 0, overBudget: 0, volumes: [],
    },
    blockers: [
      { category: 'empty_section', severity: 'blocker', message: '"S3" is empty — nothing drafted yet.', sectionId: 's3' },
      { category: 'missing_document', severity: 'blocker', message: 'Required document not provided: SF424.' },
    ],
  };

  beforeEach(() => {
    authMock.mockReset(); sqlMock.mockReset(); sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset(); verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset(); emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset(); computeReadinessMock.mockReset();
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);
  });

  it('blocks the submission (422 NOT_READY) when advancing to final with hard blockers', async () => {
    // review → final is the submit moment; readiness reports blockers, and the caller did NOT acknowledge.
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'review' })]); // proposal load
    sqlMock.mockResolvedValueOnce([{ count: '3' }]);                    // section count
    computeReadinessMock.mockResolvedValue(blockerReport);

    const res = await POST(makeRequest({ targetStage: 'final' }), makeCtx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe('NOT_READY');
    expect(json.details.blockers).toHaveLength(2);
    // The gate returns BEFORE the advance transaction — no start event, no stage change.
    expect(emitEventStartMock).not.toHaveBeenCalled();
    expect(sqlBeginMock).not.toHaveBeenCalled();
  });

  it('submits anyway (200) with acknowledgeBlockers, recording the override on the advance event', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'review' })]);
    sqlMock.mockResolvedValueOnce([{ count: '1' }]);
    computeReadinessMock.mockResolvedValue(blockerReport);
    wireTx({ sections: [{ id: 's1', title: 'S1', version: 1, status: 'complete', content: null }] });
    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ targetStage: 'final', acknowledgeBlockers: true }), makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.stage).toBe('submitted');
    // The override is audited on the proposal.advanced event.
    expect(emitEventEndMock).toHaveBeenCalledWith('evt-start-id', expect.objectContaining({
      result: expect.objectContaining({
        readinessOverride: expect.objectContaining({ blockerCount: 2 }),
      }),
    }));
  });

  it('admin force-advance bypasses the readiness gate entirely (never computes it)', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'review' })]);
    sqlMock.mockResolvedValueOnce([{ count: '1' }]);
    // section is not locked, but force overrides both the lock gate AND the readiness gate.
    wireTx({ sections: [{ id: 's1', title: 'S1', version: 1, status: 'in_progress', content: null }] });
    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ targetStage: 'final', force: true }), makeCtx());
    expect(res.status).toBe(200);
    expect(computeReadinessMock).not.toHaveBeenCalled();
  });

  it('advancing to a non-final gate (review) does not invoke the readiness gate', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'draft' })]); // draft → review
    sqlMock.mockResolvedValueOnce([{ count: '2' }]);
    wireTx();
    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ targetStage: 'review' }), makeCtx());
    expect(res.status).toBe(200);
    expect(computeReadinessMock).not.toHaveBeenCalled();
  });
});

describe('POST advance — AI review on advance (Phase 3, C3)', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    isValidUUIDMock.mockReset();
    requestAgentTaskMock.mockReset().mockResolvedValue('task-1');
    getNodeTextMock.mockReset().mockReturnValue('Reviewable section prose.');
    emitEventStartMock.mockResolvedValue('evt-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
  });

  function wireAdvanceSql({ aiReviewOnAdvance = true, reviewSections = [] as Array<Record<string, unknown>> } = {}) {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(true);
    // The 'Stage advanced' gate governs AI review on advance (enabled ⇔ opted in).
    resolveGatePolicyMock.mockReset().mockResolvedValue({
      enabled: aiReviewOnAdvance, assigneeRole: 'tenant_admin', nudgeDays: [], dueInMinutes: 0,
      channel: 'email', cooldownMinutes: 0, maxFiresPerHour: 0,
      source: { tenantPolicy: false, frameworkPinned: false },
    });
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('gate_config')) return Promise.resolve([makeProposal()]);
      if (q.includes('count(*)::text')) return Promise.resolve([{ count: '1' }]);
      if (q.includes('is_locked = true')) return Promise.resolve(reviewSections);
      return Promise.resolve([]); // activity log + anything else
    });
    wireTx();
  }

  it('enqueues a per-section review_section task when the tenant opted in', async () => {
    wireAdvanceSql({
      aiReviewOnAdvance: true,
      reviewSections: [{ id: 'sec-1', title: 'Technical Approach', content: JSON.stringify({ nodes: [{}] }), sectionType: 'technical.approach' }],
    });

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
    expect(requestAgentTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRole: 'color_team_reviewer',
        taskType: 'review_section',
        proposalId: PROPOSAL_ID,
        sectionId: 'sec-1',
        input: expect.objectContaining({ requestedBy: USER_ID, sectionTitle: 'Technical Approach', category: 'technical.approach' }),
      }),
    );
  });

  it('does not enqueue review when the tenant opted out', async () => {
    wireAdvanceSql({
      aiReviewOnAdvance: false,
      reviewSections: [{ id: 'sec-1', title: 'X', content: JSON.stringify({ nodes: [{}] }), sectionType: null }],
    });

    const res = await POST(makeRequest(), makeCtx());
    expect(res.status).toBe(200);
    expect(requestAgentTaskMock).not.toHaveBeenCalled();
  });
});
