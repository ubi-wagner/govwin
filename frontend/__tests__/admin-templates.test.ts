/**
 * E3b — Template Studio CRUD (admin/templates + admin/templates/[templateId]).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  // sql.json(v) — postgres.js jsonb param helper; passthrough in tests (the
  // tagged-template mock just records interpolated values, doesn't run SQL).
  sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }),
}));

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));
vi.mock('@/lib/validation', () => ({
  isValidUUID: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
}));

import { GET, POST } from '@/app/api/admin/templates/route';
import { PATCH } from '@/app/api/admin/templates/[templateId]/route';

const ADMIN = { user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'rfp_admin' } };
const TPL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function req(body?: unknown, url = 'http://t/api/admin/templates') {
  return new Request(url, body !== undefined
    ? { method: 'POST', body: JSON.stringify(body) }
    : { method: 'GET' });
}

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset();
});

describe('admin/templates', () => {
  it('GET is rfp_admin-gated (403 for tenant_user)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u', role: 'tenant_user' } });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('GET lists templates for an admin', async () => {
    authMock.mockResolvedValue(ADMIN);
    sqlMock.mockResolvedValueOnce([{ id: TPL, name: 'Tech V', templateType: 'technical_volume' }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.templates).toHaveLength(1);
  });

  it('POST requires a name (400)', async () => {
    authMock.mockResolvedValue(ADMIN);
    const res = await POST(req({ templateType: 'custom' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('POST rejects an invalid templateType (400)', async () => {
    authMock.mockResolvedValue(ADMIN);
    const res = await POST(req({ name: 'X', templateType: 'bogus' }));
    expect(res.status).toBe(400);
  });

  it('POST creates a template (201) and computes node_count', async () => {
    authMock.mockResolvedValue(ADMIN);
    sqlMock.mockResolvedValueOnce([{ id: TPL }]);
    const res = await POST(req({
      name: 'Tech Volume', templateType: 'technical_volume',
      canvasDocument: { nodes: [{}, {}, {}] },
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.templateId).toBe(TPL);
  });
});

describe('admin/templates/[templateId] PATCH', () => {
  const ctx = { params: Promise.resolve({ templateId: TPL }) };

  it('blocks editing a system template (403)', async () => {
    authMock.mockResolvedValue(ADMIN);
    sqlMock.mockResolvedValueOnce([{ id: TPL, isSystem: true }]); // existence check
    const res = await PATCH(
      new Request('http://t', { method: 'PATCH', body: JSON.stringify({ name: 'new' }) }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/save as new/i);
  });

  it('updates a non-system template', async () => {
    authMock.mockResolvedValue(ADMIN);
    sqlMock
      .mockResolvedValueOnce([{ id: TPL, isSystem: false }]) // existence check
      .mockResolvedValueOnce([]); // UPDATE
    const res = await PATCH(
      new Request('http://t', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.updated).toBe(true);
  });
});
