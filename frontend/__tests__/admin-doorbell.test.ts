/**
 * Admin Proposal Auto-Drive "Doorbell" — POST /api/admin/proposals/[proposalId]/full-draft.
 *
 * Verifies the admin-plane trigger: rfp_admin+ only; resolves the proposal→tenant cross-tenant;
 * and rings the SAME canonical emission as the portal (real requestFullDraft runs against mocked
 * @/lib/events) so it emits proposal:proposal.full_draft_requested with source='admin_doorbell',
 * the admin as actor, and the resolved tenant_id. This is the audit-attribution guarantee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, sqlBypassMock, emitEventStartMock, emitEventEndMock } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  const sqlBypassMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  return {
    authMock: vi.fn(),
    sqlMock,
    sqlBypassMock,
    emitEventStartMock: vi.fn(),
    emitEventEndMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  sql: sqlMock,
  sqlBypass: sqlBypassMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));

import { POST } from '@/app/api/admin/proposals/[proposalId]/full-draft/route';

const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function makeSession(role: string) {
  return { user: { id: ADMIN_ID, email: 'rfp@pipeline.com', role } };
}
function makeCtx() {
  return { params: Promise.resolve({ proposalId: PROPOSAL_ID }) };
}
function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/admin/proposals/${PROPOSAL_ID}/full-draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // proposal lookup (cross-tenant bypass) resolves the tenant; the helper's writes resolve empty.
  sqlBypassMock.mockResolvedValue([{ id: PROPOSAL_ID, tenantId: TENANT_ID, opportunityId: null }]);
  sqlMock.mockResolvedValue([]);
  emitEventStartMock.mockResolvedValue('evt-start');
  emitEventEndMock.mockResolvedValue(undefined);
});

describe('admin doorbell — POST /api/admin/proposals/[id]/full-draft', () => {
  it('rejects an unauthenticated request (401)', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(makeRequest({ mode: 'c' }), makeCtx());
    expect(res.status).toBe(401);
  });

  it('rejects tenant_admin — doorbell is rfp_admin+ (403)', async () => {
    authMock.mockResolvedValue(makeSession('tenant_admin'));
    const res = await POST(makeRequest({ mode: 'c' }), makeCtx());
    expect(res.status).toBe(403);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('rejects a bad mode (400)', async () => {
    authMock.mockResolvedValue(makeSession('rfp_admin'));
    const res = await POST(makeRequest({ mode: 'z' }), makeCtx());
    expect(res.status).toBe(400);
  });

  it('404s when the proposal does not exist', async () => {
    authMock.mockResolvedValue(makeSession('rfp_admin'));
    sqlBypassMock.mockResolvedValue([]);
    const res = await POST(makeRequest({ mode: 'c' }), makeCtx());
    expect(res.status).toBe(404);
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('rings it: emits proposal.full_draft_requested with source=admin_doorbell + resolved tenant', async () => {
    authMock.mockResolvedValue(makeSession('rfp_admin'));
    const res = await POST(makeRequest({ mode: 'c' }), makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.requested).toBe(true);
    expect(json.data.tenantId).toBe(TENANT_ID);
    expect(json.data.mode).toBe('c');

    // the canonical emission ran, attributed to the admin + the resolved tenant
    expect(emitEventStartMock).toHaveBeenCalledTimes(1);
    const emitArg = emitEventStartMock.mock.calls[0][0];
    expect(emitArg.namespace).toBe('proposal');
    expect(emitArg.type).toBe('proposal.full_draft_requested');
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.actor).toEqual({ type: 'user', id: ADMIN_ID, email: 'rfp@pipeline.com' });
    expect(emitArg.payload.source).toBe('admin_doorbell');
    expect(emitArg.payload.proposal_id).toBe(PROPOSAL_ID);
    expect(emitArg.payload.tenant_id).toBe(TENANT_ID);
    expect(emitArg.payload.mode).toBe('c');
    expect(emitEventEndMock).toHaveBeenCalledTimes(1);
  });

  it('master_admin can also ring it (200)', async () => {
    authMock.mockResolvedValue(makeSession('master_admin'));
    const res = await POST(makeRequest({ mode: 'a' }), makeCtx());
    expect(res.status).toBe(200);
    expect(emitEventStartMock).toHaveBeenCalledTimes(1);
  });
});
