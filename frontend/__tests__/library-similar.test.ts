/**
 * GET /api/portal/[tenantSlug]/library/similar — C4 similar-section retrieval.
 * Resolves the section's section_type server-side and returns approved library
 * atoms scoped to that type / standard bucket, sorted. All DB calls mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock, isValidUUIDMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  getTenantBySlugMock: vi.fn(),
  verifyTenantAccessMock: vi.fn(),
  isValidUUIDMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/validation', () => ({ isValidUUID: isValidUUIDMock }));

import { GET } from '@/app/api/portal/[tenantSlug]/library/similar/route';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROPOSAL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function session(role = 'tenant_user') {
  return { user: { id: USER, email: 'u@acme.com', role } };
}
function ctx() { return { params: Promise.resolve({ tenantSlug: 'acme' }) }; }
function req(qs: string) { return new Request(`http://t/api/portal/acme/library/similar?${qs}`); }

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(session());
  getTenantBySlugMock.mockReset().mockResolvedValue({ id: TENANT, slug: 'acme' });
  verifyTenantAccessMock.mockReset().mockResolvedValue(true);
  isValidUUIDMock.mockReset().mockReturnValue(true);
  sqlMock.mockReset().mockImplementation((strings: TemplateStringsArray) => {
    const q = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (q.includes('FROM proposal_sections')) {
      return Promise.resolve([{ sectionType: 'technical.innovation', standardCategory: 'tech_highlight' }]);
    }
    if (q.includes('FROM library_units')) {
      return Promise.resolve([
        { id: 'atom-1', content: 'Reusable technical innovation paragraph.', category: 'technical', subcategory: 'tech_highlight', tags: ['type:technical.innovation'], outcomeScore: 0.8, outcome: 'awarded', usageCount: 3 },
      ]);
    }
    return Promise.resolve([]); // scope / orderBy fragments
  });
});

describe('GET library/similar', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(req(`sectionId=${SECTION}`), ctx());
    expect(res.status).toBe(401);
  });

  it('400 when sectionId missing or invalid', async () => {
    const res = await GET(req('sort=outcome'), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');

    isValidUUIDMock.mockReturnValue(false);
    const res2 = await GET(req('sectionId=not-a-uuid'), ctx());
    expect(res2.status).toBe(400);
  });

  it('404 when tenant not found', async () => {
    getTenantBySlugMock.mockResolvedValue(null);
    const res = await GET(req(`sectionId=${SECTION}`), ctx());
    expect(res.status).toBe(404);
  });

  it('403 when tenant access denied', async () => {
    verifyTenantAccessMock.mockResolvedValue(false);
    const res = await GET(req(`sectionId=${SECTION}`), ctx());
    expect(res.status).toBe(403);
  });

  it('404 when section not found for tenant', async () => {
    sqlMock.mockImplementation((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('FROM proposal_sections')) return Promise.resolve([]); // no section
      return Promise.resolve([]);
    });
    const res = await GET(req(`sectionId=${SECTION}`), ctx());
    expect(res.status).toBe(404);
  });

  it('200 returns section-type-scoped atoms + scope metadata', async () => {
    const res = await GET(req(`sectionId=${SECTION}&proposalId=${PROPOSAL}&sort=usage`), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sectionType).toBe('technical.innovation');
    expect(json.data.standardCategory).toBe('tech_highlight');
    expect(json.data.sort).toBe('usage');
    expect(json.data.atoms).toHaveLength(1);
    expect(json.data.atoms[0]).toMatchObject({ id: 'atom-1', subcategory: 'tech_highlight', usageCount: 3, outcome: 'awarded' });
  });
});
