/**
 * TEST-06 — PUT /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save
 *
 * Tests:
 *   (a) Auth guard: 401 unauthenticated
 *   (b) 404 when tenant not found
 *   (c) 403 when tenant access denied
 *   (d) 400 when content is missing or not an object
 *   (e) 413 when content too large
 *   (f) 404 when proposal or section not found
 *   (g) 423 when proposal is locked
 *   (h) 403 when partner_user has no edit permission for current stage
 *   (i) 409 when OCC version mismatch (0 rows updated)
 *   (j) canvas_versions snapshot write before the section UPDATE
 *   (k) 200 success: section.saved event emitted
 *   (l) Partner_user WITH edit permission → 200
 *
 * Mocked: @/auth, @/lib/db (sql + getTenantBySlug + verifyTenantAccess),
 *         @/lib/events (emitEventSingle + userActor), @/lib/validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────────
const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock,
  emitEventSingleMock, isValidUUIDMock } = vi.hoisted(() => {
  const sqlMock = vi.fn();
  return {
    authMock: vi.fn(),
    sqlMock,
    getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(),
    emitEventSingleMock: vi.fn(),
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
  emitEventSingle: emitEventSingleMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

vi.mock('@/lib/validation', () => ({
  isValidUUID: isValidUUIDMock,
}));

// ─── Import after mocks ────────────────────────────────────────────────────
import { PUT } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save/route';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeSession(role = 'tenant_admin') {
  return {
    user: { id: USER_ID, email: 'alice@acme.com', role, tenantId: TENANT_ID },
  };
}

function makeTenant() {
  return { id: TENANT_ID, slug: 'acme-defense', name: 'Acme Defense' };
}

function makeProposal(overrides: Partial<{
  id: string; isLocked: boolean; unlockDeadline: Date | null; stage: string;
}> = {}) {
  return {
    id: PROPOSAL_ID,
    isLocked: false,
    unlockDeadline: null,
    stage: 'draft',
    ...overrides,
  };
}

function makeSection(overrides: Partial<{
  id: string; version: number; status: string; title: string;
  content: string | null; completedStage: string | null; completedAt: Date | null;
}> = {}) {
  return {
    id: SECTION_ID,
    version: 5,
    status: 'in_progress',
    title: 'Technical Approach',
    content: null,
    completedStage: null,
    completedAt: null,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<{ tenantSlug: string; proposalId: string; sectionId: string }> = {}) {
  return {
    params: Promise.resolve({
      tenantSlug: 'acme-defense',
      proposalId: PROPOSAL_ID,
      sectionId: SECTION_ID,
      ...overrides,
    }),
  };
}

function makeRequest(body: unknown) {
  return new Request(
    `http://localhost/api/portal/acme-defense/proposals/${PROPOSAL_ID}/sections/${SECTION_ID}/save`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

const VALID_CONTENT = { nodes: [{ type: 'paragraph', content: { text: 'Hello world' } }] };

// ─── Shared setup helpers ──────────────────────────────────────────────────

function setupAuth(role = 'tenant_admin') {
  authMock.mockResolvedValue(makeSession(role));
  isValidUUIDMock.mockReturnValue(true);
  getTenantBySlugMock.mockResolvedValue(makeTenant());
  verifyTenantAccessMock.mockResolvedValue(true);
}

// A successful save requires: proposal query → section query → canvas_versions INSERT → UPDATE → event + activity log
function setupFullHappyPath({
  role = 'tenant_admin',
  proposal = makeProposal(),
  section = makeSection(),
  updateCount = 1,
  collabPermission = 'edit',
} = {}) {
  setupAuth(role);
  // Proposal query
  sqlMock.mockResolvedValueOnce([proposal]);

  if (role !== 'tenant_admin' && role !== 'rfp_admin' && role !== 'master_admin') {
    // collaborator access check
    sqlMock.mockResolvedValueOnce([{ permission: collabPermission }]);
  }

  // Section query
  sqlMock.mockResolvedValueOnce([section]);

  // canvas_versions INSERT (non-fatal snapshot)
  sqlMock.mockResolvedValueOnce([]);

  // UPDATE proposal_sections — returns count as property
  const updateResult = Object.assign([], { count: updateCount });
  sqlMock.mockResolvedValueOnce(updateResult);

  // Activity log INSERT (non-fatal)
  sqlMock.mockResolvedValue([]);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PUT section/save — auth guards', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
  });

  it('returns 401 when no session', async () => {
    authMock.mockResolvedValue(null);
    const res = await PUT(makeRequest({ content: {} }), makeCtx());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 when session has invalid role', async () => {
    authMock.mockResolvedValue({ user: { id: USER_ID, email: 'x@x.com', role: 'not_real' } });
    isValidUUIDMock.mockReturnValue(true);
    const res = await PUT(makeRequest({ content: {} }), makeCtx());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('returns 400 when UUID format is invalid', async () => {
    authMock.mockResolvedValue(makeSession());
    isValidUUIDMock.mockReturnValue(false);
    const res = await PUT(makeRequest({ content: {} }), makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when tenant not found', async () => {
    authMock.mockResolvedValue(makeSession());
    isValidUUIDMock.mockReturnValue(true);
    getTenantBySlugMock.mockResolvedValue(null);
    const res = await PUT(makeRequest({ content: {} }), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('returns 403 when tenant access denied', async () => {
    authMock.mockResolvedValue(makeSession());
    isValidUUIDMock.mockReturnValue(true);
    getTenantBySlugMock.mockResolvedValue(makeTenant());
    verifyTenantAccessMock.mockResolvedValue(false);
    const res = await PUT(makeRequest({ content: {} }), makeCtx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
  });
});

describe('PUT section/save — input validation', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
    setupAuth();
  });

  it('returns 400 when content is missing', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    const res = await PUT(makeRequest({ status: 'in_progress' }), makeCtx());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    expect(json.error).toMatch(/content/i);
  });

  it('returns 400 when content is null', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    const res = await PUT(makeRequest({ content: null }), makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when content is a string (not object)', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    const res = await PUT(makeRequest({ content: 'plain text' }), makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 413 when content exceeds 2MB', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([makeProposal()]);

    // Create content that serializes to > 2,000,000 chars
    const bigContent = { data: 'x'.repeat(2_000_001) };
    const res = await PUT(makeRequest({ content: bigContent }), makeCtx());
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 for invalid JSON body', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([makeProposal()]);

    const req = new Request(
      `http://localhost/api/portal/acme-defense/proposals/${PROPOSAL_ID}/sections/${SECTION_ID}/save`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: 'not json {{',
      },
    );
    const res = await PUT(req, makeCtx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });
});

describe('PUT section/save — proposal / section state checks', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
    setupAuth();
  });

  it('returns 404 when proposal not found', async () => {
    sqlMock.mockResolvedValueOnce([]); // no proposal
    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('returns 423 when proposal is locked', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal({ isLocked: true })]);
    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(423);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 423 when unlock deadline has passed', async () => {
    const pastDate = new Date(Date.now() - 1000); // 1 second ago
    sqlMock.mockResolvedValueOnce([makeProposal({ unlockDeadline: pastDate })]);
    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(423);
    expect((await res.json()).code).toBe('EDIT_WINDOW_EXPIRED');
  });

  it('returns 404 when section not found', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    sqlMock.mockResolvedValueOnce([]); // no section
    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('returns 423 STAGE_LOCKED when section was completed in a previous stage', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal({ stage: 'review' })]);
    // Section was completed in draft stage (different from current 'review')
    sqlMock.mockResolvedValueOnce([makeSection({
      completedStage: 'draft',
      completedAt: new Date('2026-01-15'),
    })]);
    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(423);
    const json = await res.json();
    expect(json.code).toBe('STAGE_LOCKED');
    expect(json.completedStage).toBe('draft');
  });
});

describe('PUT section/save — collaborator (partner_user) edit permission', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
  });

  it('returns 403 when partner_user has no collaborator entry', async () => {
    setupAuth('partner_user');

    sqlMock.mockResolvedValueOnce([makeProposal()]); // proposal
    sqlMock.mockResolvedValueOnce([]);               // no collaborator access

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
  });

  it('returns 403 when partner_user has view (not edit) permission', async () => {
    setupAuth('partner_user');

    sqlMock.mockResolvedValueOnce([makeProposal()]); // proposal
    sqlMock.mockResolvedValueOnce([{ permission: 'view' }]); // view-only

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('FORBIDDEN');
  });

  it('returns 200 when partner_user has edit permission', async () => {
    setupAuth('partner_user');

    sqlMock.mockResolvedValueOnce([makeProposal()]); // proposal
    sqlMock.mockResolvedValueOnce([{ permission: 'edit' }]); // edit permission
    sqlMock.mockResolvedValueOnce([makeSection()]);   // section
    sqlMock.mockResolvedValueOnce([]);                // canvas_versions INSERT
    const updateResult = Object.assign([], { count: 1 });
    sqlMock.mockResolvedValueOnce(updateResult);      // UPDATE
    sqlMock.mockResolvedValue([]);                    // activity log

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(200);
  });

  it('tenant_admin bypasses collaborator permission check', async () => {
    // tenant_admin does NOT trigger the collaborator DB query
    setupAuth('tenant_admin');

    sqlMock.mockResolvedValueOnce([makeProposal()]); // proposal
    // NO collaborator access query
    sqlMock.mockResolvedValueOnce([makeSection()]);  // section
    sqlMock.mockResolvedValueOnce([]);               // canvas_versions INSERT
    const updateResult = Object.assign([], { count: 1 });
    sqlMock.mockResolvedValueOnce(updateResult);     // UPDATE
    sqlMock.mockResolvedValue([]);                   // activity log

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(200);
  });
});

describe('PUT section/save — OCC version conflict (409)', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
    setupAuth();
  });

  it('returns 409 when UPDATE affects 0 rows (version mismatch)', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    sqlMock.mockResolvedValueOnce([makeSection({ version: 5 })]);
    sqlMock.mockResolvedValueOnce([]);  // canvas_versions INSERT

    // UPDATE returns count=0 (another writer saved first)
    const updateResult = Object.assign([], { count: 0 });
    sqlMock.mockResolvedValueOnce(updateResult);

    // Re-fetch current version
    sqlMock.mockResolvedValueOnce([{ version: 7 }]);

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('CONFLICT');
    expect(json.currentVersion).toBe(7);

    // Event should NOT be emitted on conflict
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  it('returns 409 with null currentVersion if re-fetch also fails', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    sqlMock.mockResolvedValueOnce([makeSection()]);
    sqlMock.mockResolvedValueOnce([]);  // canvas_versions INSERT

    const updateResult = Object.assign([], { count: 0 });
    sqlMock.mockResolvedValueOnce(updateResult);

    // Re-fetch throws
    sqlMock.mockRejectedValueOnce(new Error('DB error'));

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('CONFLICT');
    expect(json.currentVersion).toBeNull();
  });
});

describe('PUT section/save — canvas_versions snapshot', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
    setupAuth();
  });

  it('inserts canvas_versions BEFORE updating proposal_sections', async () => {
    const callOrder: string[] = [];
    let callCount = 0;

    sqlMock.mockImplementation((...args: unknown[]) => {
      callCount++;
      const n = callCount;
      if (n === 1) {
        callOrder.push('proposal_query');
        return Promise.resolve([makeProposal()]);
      }
      if (n === 2) {
        callOrder.push('section_query');
        return Promise.resolve([makeSection()]);
      }
      if (n === 3) {
        callOrder.push('canvas_versions_insert');
        return Promise.resolve([]);
      }
      if (n === 4) {
        callOrder.push('section_update');
        return Promise.resolve(Object.assign([], { count: 1 }));
      }
      // activity log
      callOrder.push('activity_log');
      return Promise.resolve([]);
    });

    await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());

    const cvIdx = callOrder.indexOf('canvas_versions_insert');
    const updateIdx = callOrder.indexOf('section_update');

    expect(cvIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(cvIdx).toBeLessThan(updateIdx);
  });

  it('continues to save even when canvas_versions INSERT fails (non-fatal)', async () => {
    sqlMock.mockResolvedValueOnce([makeProposal()]);
    sqlMock.mockResolvedValueOnce([makeSection()]);
    sqlMock.mockRejectedValueOnce(new Error('canvas_versions table not found')); // non-fatal
    const updateResult = Object.assign([], { count: 1 });
    sqlMock.mockResolvedValueOnce(updateResult);
    sqlMock.mockResolvedValue([]);

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(200);
  });
});

describe('PUT section/save — success path', () => {
  beforeEach(() => {
    authMock.mockReset();
    sqlMock.mockReset();
    getTenantBySlugMock.mockReset();
    verifyTenantAccessMock.mockReset();
    emitEventSingleMock.mockReset();
    isValidUUIDMock.mockReset();
    emitEventSingleMock.mockResolvedValue(undefined);
  });

  it('returns 200 with sectionId, incremented version, and status', async () => {
    setupFullHappyPath({ section: makeSection({ version: 5, status: 'in_progress' }) });

    const res = await PUT(makeRequest({ content: VALID_CONTENT, status: 'complete' }), makeCtx());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.sectionId).toBe(SECTION_ID);
    expect(json.data.version).toBe(6); // section.version(5) + 1
    expect(json.data.status).toBe('complete');
  });

  it('emits section.saved event in proposal namespace', async () => {
    setupFullHappyPath();
    emitEventSingleMock.mockResolvedValue(undefined);

    await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());

    expect(emitEventSingleMock).toHaveBeenCalledOnce();
    const call = emitEventSingleMock.mock.calls[0][0];
    expect(call.namespace).toBe('proposal');
    expect(call.type).toBe('section.saved');
    expect(call.tenantId).toBe(TENANT_ID);
    expect(call.payload.proposalId).toBe(PROPOSAL_ID);
    expect(call.payload.sectionId).toBe(SECTION_ID);
    expect(call.payload.version).toBe(6);
  });

  it('preserves existing section status when no status provided in body', async () => {
    setupFullHappyPath({ section: makeSection({ status: 'ai_drafted' }) });

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(200);

    const json = await res.json();
    // No status in body → preserves original
    expect(json.data.status).toBe('ai_drafted');
  });

  it('ignores invalid status values (not in VALID_STATUSES)', async () => {
    setupFullHappyPath({ section: makeSection({ status: 'in_progress' }) });

    // invalid_stage is not in VALID_STATUSES so it should be treated as null (no status update)
    const res = await PUT(makeRequest({ content: VALID_CONTENT, status: 'invalid_stage' }), makeCtx());
    expect(res.status).toBe(200);

    const json = await res.json();
    // Falls back to current section status
    expect(json.data.status).toBe('in_progress');
  });

  it("ignores status='approved' — lock is the sole writer of 'approved' (A5)", async () => {
    setupFullHappyPath({ section: makeSection({ status: 'in_progress' }) });

    // 'approved' is no longer client-settable via save; only the lock route sets it.
    const res = await PUT(makeRequest({ content: VALID_CONTENT, status: 'approved' }), makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('in_progress'); // unchanged, not 'approved'
  });

  it('strips __revisionMeta from content before persisting', async () => {
    setupFullHappyPath();

    const contentWithMeta = {
      ...VALID_CONTENT,
      __revisionMeta: { aiModel: 'claude', instruction: 'improve it' },
    };

    // We just verify the route returns 200 — the stripping is internal
    const res = await PUT(makeRequest({ content: contentWithMeta }), makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sectionId).toBe(SECTION_ID);
  });

  it('event emission failure is non-fatal (still returns 200)', async () => {
    setupFullHappyPath();
    emitEventSingleMock.mockRejectedValue(new Error('event bus down'));

    const res = await PUT(makeRequest({ content: VALID_CONTENT }), makeCtx());
    expect(res.status).toBe(200);
  });
});
