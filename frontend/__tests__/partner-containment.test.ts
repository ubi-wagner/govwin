/**
 * Partner-containment regression (leak-hunt fix, 2026-08-01).
 *
 * Root cause: verifyTenantAccess() returns true for a partner_user holding any active tenant
 * membership (external collaborators are given exactly such a membership). Six proposal-wide /
 * tenant-object GET/POST routes gated on verifyTenantAccess ALONE — with no tenant_user floor —
 * let a partner read/enumerate proposals (incl. collaborator PII) they're not a collaborator on.
 *
 * The fix adds `hasRoleAtLeast(role, 'tenant_user')` BEFORE any tenant/DB work. This test proves,
 * for every patched route, that partner_user → 403 FORBIDDEN (blocked at the floor, before DB),
 * and that tenant_user gets PAST the floor (reaches the tenant lookup → 404 on our null mock).
 * rbac is intentionally NOT mocked — its role logic is what's under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const getTenantBySlugMock = vi.hoisted(() => vi.fn());

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  auth: authMock,
  getTenantBySlug: getTenantBySlugMock,       // returns null in these tests → 404 past the floor
  verifyTenantAccess: vi.fn(async () => true),
  enterTenant: () => {},
  sql: Object.assign(vi.fn(async () => []), { json: (v: unknown) => v, begin: vi.fn() }),
}));

// Import AFTER mocks are registered.
import { GET as proposalGet } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/route';
import { GET as complianceGet } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/compliance/route';
import { GET as stageGet } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/stage/route';
import { GET as collaboratorsGet } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/route';
import { GET as storageGet } from '@/app/api/portal/[tenantSlug]/storage/route';
import { POST as uploadsImagePost } from '@/app/api/portal/[tenantSlug]/uploads/image/route';

const PROPOSAL = '3b0e7f8b-7ca2-4570-91d9-48326add00ff';
const session = (role: string) => ({ user: { id: '11111111-1111-1111-1111-111111111111', role } });

const proposalCtx = { params: Promise.resolve({ tenantSlug: 'acme-navy-systems', proposalId: PROPOSAL }) };
const tenantCtx = { params: Promise.resolve({ tenantSlug: 'acme-navy-systems' }) };

beforeEach(() => {
  authMock.mockReset();
  getTenantBySlugMock.mockReset().mockResolvedValue(null); // → 404 for anyone past the floor
});

describe('partner-containment: patched routes block partner_user at the tenant_user floor', () => {
  const cases: Array<{ name: string; invoke: () => Promise<Response> }> = [
    { name: 'GET proposals/[id]',               invoke: () => proposalGet(new Request('http://x/'), proposalCtx as never) },
    { name: 'GET proposals/[id]/compliance',    invoke: () => complianceGet(new Request('http://x/'), proposalCtx as never) },
    { name: 'GET proposals/[id]/stage',         invoke: () => stageGet(new Request('http://x/'), proposalCtx as never) },
    { name: 'GET proposals/[id]/collaborators', invoke: () => collaboratorsGet(new Request('http://x/'), proposalCtx as never) },
    { name: 'GET storage',                      invoke: () => storageGet(new Request('http://x/?download=customers/acme-navy-systems/x') as never, tenantCtx as never) },
    { name: 'POST uploads/image',               invoke: () => uploadsImagePost(new Request('http://x/', { method: 'POST' }) as never, tenantCtx as never) },
  ];

  for (const c of cases) {
    it(`${c.name} → 403 for partner_user`, async () => {
      authMock.mockResolvedValue(session('partner_user'));
      const res = await c.invoke();
      expect(res.status, `${c.name} should 403 a partner_user`).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('FORBIDDEN');
    });

    it(`${c.name} → past the floor for tenant_user (404 on null tenant, not a floor-403)`, async () => {
      authMock.mockResolvedValue(session('tenant_user'));
      const res = await c.invoke();
      expect(res.status, `${c.name} tenant_user should pass the floor`).not.toBe(403);
    });
  }
});
