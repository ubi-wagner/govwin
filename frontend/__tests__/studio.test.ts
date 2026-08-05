/**
 * Proposal Studio route — POST /api/portal/[t]/proposals/[p]/studio (start / regenerate / approve).
 * Verifies: tenant_admin+ gate; start emits proposal:review_phase.requested phase='draft'
 * source='studio_portal' (auto threads through); regenerate re-runs the current phase with guidance;
 * approve advances to the next phase; approve past Compliance completes (no phase emitted).
 * The real requestReviewPhase runs against mocked @/lib/events — the audit-attribution guarantee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, emitEventStartMock, emitEventEndMock } =
  vi.hoisted(() => {
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

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/studio/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function makeSession(role: string) {
  return { user: { id: USER_ID, email: 'alice@acme.com', role, tenantId: TENANT_ID } };
}
const ctx = () => ({ params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROPOSAL_ID }) });
const req = (body: unknown) =>
  new Request(`http://localhost/api/portal/acme/proposals/${PROPOSAL_ID}/studio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// The proposal fetch returns the current phase; make it configurable per test.
function setCurrentPhase(studioPhase: string | null) {
  sqlMock.mockResolvedValue([{ opportunityId: null, studioPhase }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(makeSession('tenant_admin'));
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
  verifyTenantAccessMock.mockResolvedValue(true);
  emitEventStartMock.mockResolvedValue('evt-start');
  emitEventEndMock.mockResolvedValue(undefined);
  setCurrentPhase(null);
});

describe('proposal studio route', () => {
  it('rejects a tenant_user (403)', async () => {
    authMock.mockResolvedValue(makeSession('tenant_user'));
    const res = await POST(req({ action: 'start' }), ctx());
    expect(res.status).toBe(403);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('rejects a bad action (400)', async () => {
    const res = await POST(req({ action: 'nope' }), ctx());
    expect(res.status).toBe(400);
  });

  it('start → emits review_phase.requested phase=draft source=studio_portal', async () => {
    const res = await POST(req({ action: 'start' }), ctx());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.phase).toBe('draft');
    expect(emitEventStartMock).toHaveBeenCalledTimes(1);
    const arg = emitEventStartMock.mock.calls[0][0];
    expect(arg.namespace).toBe('proposal');
    expect(arg.type).toBe('review_phase.requested');
    expect(arg.tenantId).toBe(TENANT_ID);
    expect(arg.payload.phase).toBe('draft');
    expect(arg.payload.source).toBe('studio_portal');
    expect(arg.payload.auto).toBe(false);
  });

  it('start with auto:true threads auto into the payload', async () => {
    await POST(req({ action: 'start', auto: true }), ctx());
    expect(emitEventStartMock.mock.calls[0][0].payload.auto).toBe(true);
  });

  it('regenerate re-runs the CURRENT phase with guidance', async () => {
    setCurrentPhase('refine');
    const res = await POST(req({ action: 'regenerate', guidance: 'tighten section 2' }), ctx());
    expect(res.status).toBe(200);
    const arg = emitEventStartMock.mock.calls[0][0];
    expect(arg.payload.phase).toBe('refine');
    expect(arg.payload.guidance).toBe('tighten section 2');
  });

  it('regenerate with no active phase → 409', async () => {
    setCurrentPhase(null);
    const res = await POST(req({ action: 'regenerate' }), ctx());
    expect(res.status).toBe(409);
  });

  it('approve advances draft → refine', async () => {
    setCurrentPhase('draft');
    const res = await POST(req({ action: 'approve' }), ctx());
    expect(res.status).toBe(200);
    expect(emitEventStartMock.mock.calls[0][0].payload.phase).toBe('refine');
  });

  it('approve past Compliance → complete (no phase emitted)', async () => {
    setCurrentPhase('compliance');
    const res = await POST(req({ action: 'approve' }), ctx());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.phase).toBe('complete');
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });
});
