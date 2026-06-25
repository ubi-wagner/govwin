/**
 * Section accept/lock lifecycle route — POST (accept+lock) / DELETE (unlock).
 * Verifies admin-only gating, section-belongs check, the state transition,
 * and the audited events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, resolveUserAccessMock, emitEventSingleMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    sqlMock: vi.fn(),
    getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(),
    resolveUserAccessMock: vi.fn(),
    emitEventSingleMock: vi.fn(),
  }));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/proposal-access', () => ({ resolveUserAccess: resolveUserAccessMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { POST, DELETE } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/lock/route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PROPOSAL = '33333333-3333-4333-8333-333333333333';
const SECTION = '44444444-4444-4444-8444-444444444444';

const ctx = { params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROPOSAL, sectionId: SECTION }) };
const req = () => new Request('http://t/lock', { method: 'POST' });

function session(role = 'tenant_admin') {
  return { user: { id: USER, email: 'a@acme.com', role } };
}

function wireGuard(accessRole: 'admin' | 'contributor' | 'external', sectionFound = true) {
  authMock.mockResolvedValue(session());
  getTenantBySlugMock.mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockResolvedValue(true);
  resolveUserAccessMock.mockResolvedValue({ role: accessRole });
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const q = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (q.includes('FROM proposal_sections s')) {
      return Promise.resolve(
        sectionFound ? [{ stage: 'draft', sectionId: SECTION, title: 'Technical Approach', volumeName: 'Technical Volume' }] : [],
      );
    }
    return Promise.resolve([]); // UPDATE
  });
}

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset();
  getTenantBySlugMock.mockReset();
  verifyTenantAccessMock.mockReset();
  resolveUserAccessMock.mockReset();
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
});

describe('POST section lock (accept + lock)', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(401);
  });

  it('403 when the user is not an admin on this proposal', async () => {
    wireGuard('contributor');
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
  });

  it('404 when the section does not belong to the proposal', async () => {
    wireGuard('admin', false);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
  });

  it('locks the section and emits section.locked with stage + volume context', async () => {
    wireGuard('admin');
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ sectionId: SECTION, isLocked: true, status: 'approved', acceptedStage: 'draft' });

    // An UPDATE proposal_sections ... is_locked = true ran.
    const ranLockUpdate = sqlMock.mock.calls.some((c) => {
      const q = Array.isArray(c[0]) ? c[0].join('?') : String(c[0]);
      return q.includes('UPDATE proposal_sections') && q.includes('is_locked = true');
    });
    expect(ranLockUpdate).toBe(true);

    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'proposal',
        type: 'section.locked',
        tenantId: TENANT,
        payload: expect.objectContaining({ proposalId: PROPOSAL, sectionId: SECTION, stage: 'draft', volumeName: 'Technical Volume' }),
      }),
    );
  });
});

describe('DELETE section lock (unlock)', () => {
  it('unlocks the section and emits section.unlocked', async () => {
    wireGuard('admin');
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ sectionId: SECTION, isLocked: false, status: 'in_progress' });
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'section.unlocked', tenantId: TENANT }),
    );
  });

  it('403 for a non-admin', async () => {
    wireGuard('external');
    const res = await DELETE(req(), ctx);
    expect(res.status).toBe(403);
  });
});
