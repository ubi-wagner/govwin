/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/comments — read-scoping
 *
 * Regression guard for the collaborator comment-read leak: a viewer WITHOUT
 * tenant-wide access (a partner_user, or a cross-company collaborator) must only
 * read comments on the sections they were granted — never the whole proposal,
 * whether by omitting ?nodeId or by passing a ?nodeId= outside their grant.
 *
 * Tenant staff (tenant_user+ at their home tenant) keep tenant-wide read.
 *
 * The SQL *filtering* itself is proven against a live DB (seed-and-rollback);
 * this locks in the route's control flow:
 *   (a) partner, no nodeId      → resolveUserAccess consulted; scoped ids reach SQL
 *   (b) partner, ungranted node → 403 (never runs the comments query)
 *   (c) partner, granted node   → 200
 *   (d) tenant-wide member      → resolveUserAccess NOT consulted (unscoped)
 *
 * Mocked: @/auth, @/lib/db (sql + getTenantBySlug + verifyProposalAccess),
 *         @/lib/proposal-access, @/lib/events, @/lib/validation.
 * Real:   @/lib/rbac (isRole + isTenantWideMember) — the seam under test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyProposalAccessMock,
  resolveUserAccessMock, isValidUUIDMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  getTenantBySlugMock: vi.fn(),
  verifyProposalAccessMock: vi.fn(),
  resolveUserAccessMock: vi.fn(),
  isValidUUIDMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyProposalAccess: verifyProposalAccessMock,
}));
vi.mock('@/lib/proposal-access', () => ({ resolveUserAccess: resolveUserAccessMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn().mockResolvedValue(undefined),
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));
vi.mock('@/lib/validation', () => ({ isValidUUID: isValidUUIDMock }));

import { GET } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/comments/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECTION_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // granted
const SECTION_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'; // NOT granted

function partnerSession() {
  return { user: { id: USER_ID, email: 'ext@partner.com', role: 'partner_user', tenantId: null } };
}
function staffSession() {
  return { user: { id: USER_ID, email: 'staff@acme.com', role: 'tenant_user', tenantId: TENANT_ID } };
}
function ctx() {
  return { params: Promise.resolve({ tenantSlug: 'acme-defense', proposalId: PROPOSAL_ID }) };
}
function req(nodeId?: string) {
  const base = `http://localhost/api/portal/acme-defense/proposals/${PROPOSAL_ID}/comments`;
  return new Request(nodeId ? `${base}?nodeId=${nodeId}` : base);
}

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset();
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT_ID, slug: 'acme-defense' });
  verifyProposalAccessMock.mockReset().mockResolvedValue(true);
  resolveUserAccessMock.mockReset();
  isValidUUIDMock.mockReset().mockReturnValue(true);
});

describe('GET comments — collaborator read-scoping', () => {
  it('(a) partner without nodeId: consults resolveUserAccess and passes scoped ids to SQL', async () => {
    authMock.mockResolvedValue(partnerSession());
    resolveUserAccessMock.mockResolvedValue({
      role: 'external', editableSections: [SECTION_A], commentableSections: [], viewableSections: [],
    });
    sqlMock
      .mockResolvedValueOnce([{ id: PROPOSAL_ID }]) // proposal-belongs-to-tenant check
      .mockResolvedValueOnce([]);                    // scoped comments query

    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(resolveUserAccessMock).toHaveBeenCalledWith(USER_ID, PROPOSAL_ID, TENANT_ID);

    // The comments query (2nd sql call) must carry the granted section id array —
    // proving we filtered rather than falling through to the unscoped branch.
    const commentsCallArgs = sqlMock.mock.calls[1];
    const scopedArg = commentsCallArgs.find((a) => Array.isArray(a) && a.includes(SECTION_A));
    expect(scopedArg).toEqual([SECTION_A]);
  });

  it('(b) partner requesting an ungranted section → 403, never runs the comments query', async () => {
    authMock.mockResolvedValue(partnerSession());
    resolveUserAccessMock.mockResolvedValue({
      role: 'external', editableSections: [SECTION_A], commentableSections: [], viewableSections: [],
    });
    sqlMock.mockResolvedValueOnce([{ id: PROPOSAL_ID }]); // proposal check only

    const res = await GET(req(SECTION_B), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('FORBIDDEN');
    // Only the proposal-existence check ran — the comments query was never reached.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('(c) partner requesting a granted section → 200', async () => {
    authMock.mockResolvedValue(partnerSession());
    resolveUserAccessMock.mockResolvedValue({
      role: 'external', editableSections: [], commentableSections: [SECTION_A], viewableSections: [],
    });
    sqlMock
      .mockResolvedValueOnce([{ id: PROPOSAL_ID }])
      .mockResolvedValueOnce([{ id: 'x', proposalId: PROPOSAL_ID, sectionId: SECTION_A, userId: USER_ID, content: 'ok', resolved: false, createdAt: new Date(), recommendationType: 'human', category: null, userName: null, userEmail: null }]);

    const res = await GET(req(SECTION_A), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it('(d) tenant-wide staff → resolveUserAccess NOT consulted (unscoped read)', async () => {
    authMock.mockResolvedValue(staffSession());
    sqlMock
      .mockResolvedValueOnce([{ id: PROPOSAL_ID }])
      .mockResolvedValueOnce([]); // unscoped comments query

    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(resolveUserAccessMock).not.toHaveBeenCalled();
  });
});
