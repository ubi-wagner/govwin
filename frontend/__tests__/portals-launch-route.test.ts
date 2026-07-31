/**
 * Portal launch/release hand-off (adversarial-sweep B2): the discovery-spine → build-spine link.
 * Proves the accept/release handlers PROVISION + LINK the build BEFORE flipping the portal live, so
 * a provisioning failure leaves the portal recoverable (no wedged buildless `launched`), and that a
 * retry is idempotent (an already-linked proposal is not re-provisioned).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  authMock: vi.fn(), getTenantBySlugMock: vi.fn(), verifyTenantAccessMock: vi.fn(),
  withTenantMock: vi.fn(), txMock: vi.fn(),
  acceptGuardrailsMock: vi.fn(), releaseFromCurationMock: vi.fn(), linkPortalProposalMock: vi.fn(),
  provisionMock: vi.fn(), getLimitsMock: vi.fn(), validateMock: vi.fn(), instantiateMock: vi.fn(),
  emitSingleMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: H.authMock }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, getTenantBySlug: H.getTenantBySlugMock, verifyTenantAccess: H.verifyTenantAccessMock, sql: vi.fn() }));
vi.mock('@/lib/rls', () => ({ withTenant: H.withTenantMock }));
vi.mock('@/lib/portal-launch', () => ({
  acceptGuardrails: H.acceptGuardrailsMock, releaseFromCuration: H.releaseFromCurationMock,
  linkPortalProposal: H.linkPortalProposalMock, revokeShadowAdmin: vi.fn(), setPortalStatus: vi.fn(),
}));
vi.mock('@/lib/portal-workflow', () => ({
  getGuardrailLimits: H.getLimitsMock, validateGuardrailConfig: H.validateMock,
  instantiatePortalWorkflow: H.instantiateMock, advancePortalStage: vi.fn(),
}));
vi.mock('@/lib/provision-proposal', () => ({ provisionProposalForPortal: H.provisionMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: H.emitSingleMock }));

import { POST } from '@/app/api/portal/[tenantSlug]/portals/[portalId]/route';

const TENANT = '22222222-2222-4222-8222-222222222222';
const PORTAL = '33333333-3333-4333-8333-333333333333';
const OPP = '44444444-4444-4444-8444-444444444444';
const session = (role: string) => ({ user: { id: 'u1', email: 'a@b.com', role } });
const ctx = { params: Promise.resolve({ tenantSlug: 'acme', portalId: PORTAL }) };
const req = (action: string, body: unknown) =>
  new Request(`http://t/api/portal/acme/portals/${PORTAL}?action=${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const CONFIG = { stages: [{ key: 'draft', label: 'Draft', todos: [] }], collaborators: [], nudgeDays: [] };
// withTenant reads the portal row inside provisionAndLink; default = unprovisioned portal.
const portalRow = (proposalId: string | null) => [{ opportunityId: OPP, proposalId, label: 'primary' }];

beforeEach(() => {
  H.authMock.mockReset();
  H.getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme', name: 'Acme' });
  H.verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  H.txMock.mockReset().mockResolvedValue(portalRow(null));
  H.withTenantMock.mockReset().mockImplementation(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(H.txMock));
  H.acceptGuardrailsMock.mockReset().mockResolvedValue({ launched: true });
  H.releaseFromCurationMock.mockReset().mockResolvedValue({ released: true });
  H.linkPortalProposalMock.mockReset().mockResolvedValue(true);
  H.provisionMock.mockReset().mockResolvedValue({ proposalId: 'prop-1', sectionCount: 3 });
  H.getLimitsMock.mockReset().mockResolvedValue({ maxStages: 3, maxCollaborators: 25, maxManagers: 25, maxNudges: 3 });
  H.validateMock.mockReset().mockReturnValue({ ok: true, errors: [] });
  H.instantiateMock.mockReset().mockResolvedValue({ tasksCreated: 1 });
  H.emitSingleMock.mockReset().mockResolvedValue(undefined);
});

describe('accept — provision before flip (B2)', () => {
  it('provision FAILS → 500 PROVISION_FAILED and the portal is NOT flipped (acceptGuardrails not called)', async () => {
    H.authMock.mockResolvedValue(session('tenant_admin'));
    H.provisionMock.mockResolvedValue({ error: 'provisioning failed' });
    const res = await POST(req('accept', { guardrailConfig: CONFIG }), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('PROVISION_FAILED');
    expect(H.acceptGuardrailsMock).not.toHaveBeenCalled(); // never flipped → recoverable
  });

  it('provision OK → link, THEN flip, THEN todos → 200 with proposalId', async () => {
    H.authMock.mockResolvedValue(session('tenant_admin'));
    const res = await POST(req('accept', { guardrailConfig: CONFIG }), ctx);
    expect(res.status).toBe(200);
    expect(H.provisionMock).toHaveBeenCalled();
    expect(H.linkPortalProposalMock).toHaveBeenCalledWith(TENANT, PORTAL, 'prop-1');
    expect(H.acceptGuardrailsMock).toHaveBeenCalled();
    expect((await res.json()).data).toMatchObject({ launched: true, proposalId: 'prop-1', tasksCreated: 1 });
  });

  it('already-provisioned portal → idempotent: provision skipped, still flips', async () => {
    H.authMock.mockResolvedValue(session('tenant_admin'));
    H.txMock.mockResolvedValue(portalRow('prop-existing')); // portal already has a proposal
    const res = await POST(req('accept', { guardrailConfig: CONFIG }), ctx);
    expect(res.status).toBe(200);
    expect(H.provisionMock).not.toHaveBeenCalled(); // no duplicate provision
    expect(H.acceptGuardrailsMock).toHaveBeenCalled();
    expect((await res.json()).data.proposalId).toBe('prop-existing');
  });

  it('provision OK but flip CAS misses (not pending) → 409, todos not run', async () => {
    H.authMock.mockResolvedValue(session('tenant_admin'));
    H.acceptGuardrailsMock.mockResolvedValue({ launched: false });
    const res = await POST(req('accept', { guardrailConfig: CONFIG }), ctx);
    expect(res.status).toBe(409);
    expect(H.instantiateMock).not.toHaveBeenCalled();
  });
});

describe('release — provision before flip (B2), rfp_admin only', () => {
  it('tenant_admin cannot release (403) — cannot self-skip curation', async () => {
    H.authMock.mockResolvedValue(session('tenant_admin'));
    expect((await POST(req('release', {}), ctx)).status).toBe(403);
    expect(H.provisionMock).not.toHaveBeenCalled();
  });

  it('provision FAILS → 500 and releaseFromCuration NOT called (stays awaiting-curation)', async () => {
    H.authMock.mockResolvedValue(session('rfp_admin'));
    H.provisionMock.mockResolvedValue({ error: 'topic load failed' });
    const res = await POST(req('release', {}), ctx);
    expect(res.status).toBe(500);
    expect(H.releaseFromCurationMock).not.toHaveBeenCalled();
  });

  it('provision OK → link, flip, emit workspace.released → 200', async () => {
    H.authMock.mockResolvedValue(session('rfp_admin'));
    const res = await POST(req('release', {}), ctx);
    expect(res.status).toBe(200);
    expect(H.linkPortalProposalMock).toHaveBeenCalledWith(TENANT, PORTAL, 'prop-1');
    expect(H.releaseFromCurationMock).toHaveBeenCalled();
    expect(H.emitSingleMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'workspace.released' }));
  });
});
