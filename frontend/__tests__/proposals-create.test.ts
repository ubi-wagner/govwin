/**
 * TEST-04 — portal/[tenantSlug]/proposals/create route handler
 *
 * Strategy: mock @/auth, @/lib/db (sql + sql.begin + getTenantBySlug +
 * verifyTenantAccess), @/lib/events, @/lib/storage/s3-client (putObject,
 * copyObject), @/lib/compliance-resolver, @/lib/templates/index,
 * @/lib/validation, @/lib/storage/paths, and @/lib/email.
 *
 * The route is too integrated to avoid heavy mocking.  Focus is on:
 *   (a) success path: proposal row + sections + supporting docs created via
 *       sql.begin; S3 putObject called
 *   (b) purchase-gate rejection → 402 when FOUNDING_COHORT_BYPASS is false
 *   (c) sql.begin failure → 500, no partial state (event not emitted)
 *   (d) auth guard: unauthenticated → 401, insufficient role → 403
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────
const {
  authMock,
  sqlMock,
  sqlBeginMock,
  getTenantBySlugMock,
  verifyTenantAccessMock,
  emitEventStartMock,
  emitEventEndMock,
  emitEventSingleMock,
  putObjectMock,
  copyObjectMock,
  resolveTopicComplianceMock,
  isValidUUIDMock,
} = vi.hoisted(() => {
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
    emitEventSingleMock: vi.fn(),
    putObjectMock: vi.fn(),
    copyObjectMock: vi.fn(),
    resolveTopicComplianceMock: vi.fn(),
    isValidUUIDMock: vi.fn(),
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────

vi.mock('@/auth', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db', () => ({
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));

vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  emitEventSingle: emitEventSingleMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

vi.mock('@/lib/storage/s3-client', () => ({
  putObject: putObjectMock,
  copyObject: copyObjectMock,
}));

vi.mock('@/lib/compliance-resolver', () => ({
  resolveTopicCompliance: resolveTopicComplianceMock,
}));

vi.mock('@/lib/templates/index', () => ({
  resolveTemplateKey: vi.fn().mockReturnValue(null), // no template for simplicity
  getTemplate: vi.fn().mockReturnValue(null),
  interpolateTemplate: vi.fn(),
}));

vi.mock('@/lib/templates', () => ({
  resolveTemplateKey: vi.fn().mockReturnValue(null),
  getTemplate: vi.fn().mockReturnValue(null),
  interpolateTemplate: vi.fn(),
}));

vi.mock('@/lib/validation', () => ({
  isValidUUID: isValidUUIDMock,
}));

vi.mock('@/lib/storage/paths', () => ({
  customerProposalPath: (tenantSlug: string, proposalId: string, filename: string) =>
    `tenants/${tenantSlug}/proposals/${proposalId}/${filename}`,
}));

// Mock the dynamic import of @/lib/email used in the route
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import route after mocks ──────────────────────────────────────────
import { POST } from '@/app/api/portal/[tenantSlug]/proposals/create/route';

// ─── Fixtures ──────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOPIC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SOL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function makeSession(role = 'tenant_admin') {
  return {
    user: {
      id: USER_ID,
      email: 'alice@acme.com',
      role,
      tenantId: TENANT_ID,
    },
  };
}

function makeTenant() {
  return { id: TENANT_ID, slug: 'acme-defense', name: 'Acme Defense', status: 'active', product_tier: 'standard' };
}

function makeTopic() {
  return {
    id: TOPIC_ID,
    title: 'Advanced Sensor Research',
    solicitationId: SOL_ID,
    agency: 'Army',
    topicNumber: 'A24-001',
    programType: 'SBIR',
    solicitationNumber: 'W911NF-24-S-0001',
  };
}

function makeResolvedCompliance() {
  return {
    compliance: { page_limit_technical: 20, font_size: '12pt' },
    volumes: [
      {
        volumeName: 'Technical Volume',
        volumeNumber: 1,
        items: [
          { itemNumber: 1, itemName: 'Technical Approach', itemType: 'technical_narrative', pageLimit: 15 },
          { itemNumber: 2, itemName: 'Cost Volume', itemType: 'cost_narrative', pageLimit: 5 },
        ],
      },
    ],
  };
}

function makeCtx(tenantSlug = 'acme-defense') {
  return {
    params: Promise.resolve({ tenantSlug }),
  };
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/portal/acme-defense/proposals/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('POST /api/portal/[tenantSlug]/proposals/create', () => {
  let originalBypass: string | undefined;

  beforeEach(() => {
    // Reset all mocks
    authMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventStartMock.mockReset();
    emitEventEndMock.mockReset();
    emitEventSingleMock.mockReset();
    putObjectMock.mockReset();
    copyObjectMock.mockReset();
    resolveTopicComplianceMock.mockReset();
    isValidUUIDMock.mockReset();

    // Default: FOUNDING_COHORT_BYPASS is true (bypass active)
    originalBypass = process.env.FOUNDING_COHORT_BYPASS;
    process.env.FOUNDING_COHORT_BYPASS = 'true';

    // Default happy-path stubs
    isValidUUIDMock.mockReturnValue(true);
    emitEventStartMock.mockResolvedValue('event-start-id');
    emitEventEndMock.mockResolvedValue(undefined);
    emitEventSingleMock.mockResolvedValue(undefined);
    putObjectMock.mockResolvedValue(undefined);
    copyObjectMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalBypass === undefined) {
      delete process.env.FOUNDING_COHORT_BYPASS;
    } else {
      process.env.FOUNDING_COHORT_BYPASS = originalBypass;
    }
  });

  // ── Auth guards ────────────────────────────────────────────────────

  it('returns 401 when no session', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe('UNAUTHENTICATED');
  });

  it('returns 403 when role is tenant_user (below tenant_admin)', async () => {
    authMock.mockResolvedValue(makeSession('tenant_user'));
    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
  });

  it('returns 403 when role is partner_user', async () => {
    authMock.mockResolvedValue(makeSession('partner_user'));
    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(403);
  });

  // ── Purchase gate ──────────────────────────────────────────────────

  it('returns 402 when FOUNDING_COHORT_BYPASS is false (purchase gate active)', async () => {
    process.env.FOUNDING_COHORT_BYPASS = 'false';

    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.code).toBe('PAYMENT_REQUIRED');
  });

  it('proceeds (no 402) when FOUNDING_COHORT_BYPASS is unset — V1 paywall is opt-in', async () => {
    delete process.env.FOUNDING_COHORT_BYPASS;

    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    // Topic lookup → not found, which proves we passed the (now off-by-default) gate.
    sqlMock.mockResolvedValueOnce([]);

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).not.toBe(402);
    expect(res.status).toBe(404);
  });

  // ── Input validation ───────────────────────────────────────────────

  it('returns 400 when topicId is missing', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    const res = await POST(makeRequest({}), makeCtx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when topicId is not a valid UUID', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);
    isValidUUIDMock.mockReturnValue(false);

    const res = await POST(makeRequest({ topicId: 'not-a-uuid' }), makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  // ── Success path ───────────────────────────────────────────────────

  it('success path: creates proposal + sections via sql.begin and calls putObject (S3)', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    // Topic lookup
    sqlMock.mockResolvedValueOnce([makeTopic()]);
    // Duplicate check (no existing proposal)
    sqlMock.mockResolvedValueOnce([]);

    resolveTopicComplianceMock.mockResolvedValue(makeResolvedCompliance());

    // sql.begin: proposal INSERT + section INSERTs + compliance seed + supporting docs
    sqlBeginMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      // tx is called as tagged template — return appropriate shapes for each call
      let callCount = 0;
      const txMock = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // proposal INSERT RETURNING id
          return [{ id: PROPOSAL_ID }];
        }
        // section INSERTs + compliance query + other writes
        return [{ id: `section-${callCount}` }];
      });
      return cb(txMock);
    });

    // After sql.begin: purchase linkage update + S3 doc query + activity log + admin emails + process_instance
    sqlMock.mockResolvedValue([]); // all subsequent sql calls return empty arrays

    const res = await POST(
      makeRequest({ topicId: TOPIC_ID, productType: 'proposal_phase1' }),
      makeCtx(),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(json.data.proposalId).toBe(PROPOSAL_ID);
    expect(typeof json.data.sectionCount).toBe('number');

    // sql.begin was called (the transaction ran)
    expect(sqlBeginMock).toHaveBeenCalledOnce();

    // S3 putObject called at least once (compliance.json artifact)
    expect(putObjectMock).toHaveBeenCalled();
    expect(putObjectMock.mock.calls[0][0].key).toMatch(/compliance\.json$/);

    // emitEventStart was called with proposal namespace
    expect(emitEventStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'proposal',
        type: 'proposal.created',
        tenantId: TENANT_ID,
      }),
    );

    // emitEventEnd was called
    expect(emitEventEndMock).toHaveBeenCalledWith(
      'event-start-id',
      expect.objectContaining({ result: expect.any(Object) }),
    );
  });

  it('success path accepts rfp_admin role (admin-on-behalf)', async () => {
    authMock.mockResolvedValue(makeSession('rfp_admin'));
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    sqlMock.mockResolvedValueOnce([makeTopic()]);
    sqlMock.mockResolvedValueOnce([]); // no duplicate
    resolveTopicComplianceMock.mockResolvedValue(makeResolvedCompliance());

    sqlBeginMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([{ id: PROPOSAL_ID }])
        .mockResolvedValue([]);
      return cb(txMock);
    });

    sqlMock.mockResolvedValue([]);

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(200);
  });

  it('returns 409 when proposal already exists for this tenant+topic', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    // Topic lookup succeeds
    sqlMock.mockResolvedValueOnce([makeTopic()]);
    // Duplicate check finds existing proposal
    sqlMock.mockResolvedValueOnce([{ id: 'existing-proposal-id' }]);

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(sqlBeginMock).not.toHaveBeenCalled();
  });

  it('returns 404 when topic does not exist', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    sqlMock.mockResolvedValueOnce([]); // no topic found

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(404);
  });

  // ── DB failure mid-transaction → 500, no event emitted ────────────

  it('DB failure inside sql.begin → 500 and emitEventEnd is NOT called', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    sqlMock.mockResolvedValueOnce([makeTopic()]);
    sqlMock.mockResolvedValueOnce([]); // no duplicate

    resolveTopicComplianceMock.mockResolvedValue(makeResolvedCompliance());

    // sql.begin itself throws (simulates transaction rollback at the DB level)
    const txError = new Error('database connection lost');
    sqlBeginMock.mockRejectedValue(txError);

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DB_ERROR');

    // Proposal was not created → emitEventEnd should not have been called
    // (emitEventStart may have been called; emitEventEnd signals completion)
    expect(emitEventEndMock).not.toHaveBeenCalled();

    // S3 operations should not have run
    expect(putObjectMock).not.toHaveBeenCalled();
  });

  it('DB failure during topic query → 500', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    sqlMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('DB_ERROR');
  });

  // ── S3 failure is non-fatal ────────────────────────────────────────

  it('S3 putObject failure is non-fatal: still returns 200 with proposalId', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    sqlMock.mockResolvedValueOnce([makeTopic()]);
    sqlMock.mockResolvedValueOnce([]);
    resolveTopicComplianceMock.mockResolvedValue(makeResolvedCompliance());

    sqlBeginMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = vi.fn()
        .mockResolvedValueOnce([{ id: PROPOSAL_ID }])
        .mockResolvedValue([]);
      return cb(txMock);
    });

    sqlMock.mockResolvedValue([]);

    // S3 throws
    putObjectMock.mockRejectedValue(new Error('S3 endpoint unavailable'));

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.proposalId).toBe(PROPOSAL_ID);
  });

  // ── Tenant not found ───────────────────────────────────────────────

  it('returns 404 when tenant slug does not resolve', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ topicId: TOPIC_ID }), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  // ── gateConfig validation ──────────────────────────────────────────

  it('returns 400 when gateConfig contains invalid stage value', async () => {
    authMock.mockResolvedValue(makeSession());
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(true);

    const res = await POST(
      makeRequest({ topicId: TOPIC_ID, gateConfig: ['draft', 'invalid_stage'] }),
      makeCtx(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });
});
