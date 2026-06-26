/**
 * Section-standards taxonomy (Phase 3, C1): the inferSectionType helper +
 * the RFP-admin standards API (auth gate, validation, create).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inferSectionType } from '@/lib/section-standards';

const STANDARDS = [
  { key: 'team', label: 'Team / Key Personnel' },
  { key: 'team.bio', label: 'Bio' },
  { key: 'technical.overview', label: 'Technology Overview' },
  { key: 'commercialization', label: 'Commercialization Plan' },
];

describe('inferSectionType', () => {
  it('matches an exact label', () => {
    expect(inferSectionType('Technology Overview', STANDARDS)).toBe('technical.overview');
    expect(inferSectionType('bio', STANDARDS)).toBe('team.bio');
  });
  it('matches by containment (longest wins)', () => {
    expect(inferSectionType('Commercialization Plan and Strategy', STANDARDS)).toBe('commercialization');
  });
  it('returns null when nothing fits or no standards', () => {
    expect(inferSectionType('Appendix Z', STANDARDS)).toBeNull();
    expect(inferSectionType('Bio', [])).toBeNull();
    expect(inferSectionType('', STANDARDS)).toBeNull();
  });
});

// ── Admin API ────────────────────────────────────────────────────────────
const { authMock, sqlMock, emitEventSingleMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  sqlMock: vi.fn(),
  emitEventSingleMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { GET, POST } from '@/app/api/admin/section-standards/route';

const USER = '11111111-1111-4111-8111-111111111111';
const session = (role: string) => ({ user: { id: USER, email: 'a@b.com', role } });
const postReq = (body: unknown) =>
  new Request('http://t/api/admin/section-standards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset().mockResolvedValue([]);
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/admin/section-standards', () => {
  it('403 for tenant_admin (rfp_admin+ required)', async () => {
    authMock.mockResolvedValue(session('tenant_admin'));
    const res = await GET();
    expect(res.status).toBe(403);
  });
  it('lists standards for rfp_admin', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    sqlMock.mockResolvedValueOnce([{ id: 's1', key: 'team', label: 'Team', parentKey: null, category: 'team', sortOrder: 50, isActive: true }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.standards).toHaveLength(1);
  });
});

describe('POST /api/admin/section-standards', () => {
  it('401 unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(postReq({ key: 'x', label: 'X' }))).status).toBe(401);
  });
  it('422 for an invalid key slug', async () => {
    authMock.mockResolvedValue(session('rfp_admin'));
    const res = await POST(postReq({ key: 'Not A Slug!', label: 'X' }));
    expect(res.status).toBe(422);
  });
  it('201 creates a standard', async () => {
    authMock.mockResolvedValue(session('master_admin'));
    sqlMock.mockResolvedValueOnce([{ id: 's2', key: 'team.bio', label: 'Bio', parentKey: 'team', category: 'team', sortOrder: 51, isActive: true }]);
    const res = await POST(postReq({ key: 'team.bio', label: 'Bio', parentKey: 'team', category: 'team', sortOrder: 51 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.standard.key).toBe('team.bio');
    expect(emitEventSingleMock).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'finder', type: 'section_standard.created' }));
  });
});
