/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/seed-job/skip
 *
 * Admin dismisses the library-seed suggestion. CAS-updates library_seed_jobs.status='skipped'
 * from awaiting_selection|awaiting_review (idempotent no-op otherwise), then audits it. This is
 * the fix for the cosmetic-Skip bug (the old path POSTed empty decisions to /decide, which never
 * writes status). Mocked: @/auth, @/lib/db, @/lib/events. Real: rbac, validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, emitEventSingleMock } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (x: unknown) => x });
  return { authMock: vi.fn(), sqlMock, getTenantBySlugMock: vi.fn(), emitEventSingleMock: vi.fn() };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/seed-job/skip/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEED_JOB_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function ctx() {
  return { params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROPOSAL_ID }) };
}
function req(body: unknown = { seedJobId: SEED_JOB_ID }) {
  return new Request(`http://localhost/api/portal/acme/proposals/${PROPOSAL_ID}/seed-job/skip`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
function setupAuth(role = 'rfp_admin') {
  authMock.mockResolvedValue({ user: { id: USER_ID, email: 'a@a.com', role, tenantId: TENANT_ID } });
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID });
  emitEventSingleMock.mockResolvedValue(undefined);
}

describe('POST seed-job/skip', () => {
  beforeEach(() => {
    authMock.mockReset(); sqlMock.mockReset(); getTenantBySlugMock.mockReset(); emitEventSingleMock.mockReset();
  });

  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req(), ctx())).status).toBe(401);
  });

  it('403 for a non-admin role', async () => {
    setupAuth('tenant_admin');
    expect((await POST(req(), ctx())).status).toBe(403);
  });

  it('400 when seedJobId is missing', async () => {
    setupAuth();
    expect((await POST(req({}), ctx())).status).toBe(400);
  });

  it('persists status=skipped and audits it when the job is skippable', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([{ id: SEED_JOB_ID }]); // CAS UPDATE ... RETURNING id
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.skipped).toBe(true);
    expect(emitEventSingleMock).toHaveBeenCalledTimes(1);
    const emitted = emitEventSingleMock.mock.calls[0][0];
    expect(emitted).toMatchObject({ namespace: 'proposal', type: 'seed.skipped' });
  });

  it('404 (and does not audit) when the job is already applied/skipped (CAS no-op)', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([]); // CAS matched no row
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});
