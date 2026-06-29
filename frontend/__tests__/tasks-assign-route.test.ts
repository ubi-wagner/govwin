/**
 * R5.1 (J1) — the assign route's guards (auth floor + portal role allowlist +
 * UUID shape). The core createTask is tested separately; here we lock that the
 * route refuses privilege-escalating / malformed assignments BEFORE createTask.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, getTenantMock, verifyAccessMock, createTaskMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getTenantMock: vi.fn(),
  verifyAccessMock: vi.fn(),
  createTaskMock: vi.fn(),
}));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ getTenantBySlug: getTenantMock, verifyTenantAccess: verifyAccessMock, sql: vi.fn() }));
vi.mock('@/lib/tasks/tasks', () => ({ createTask: createTaskMock }));

import { POST } from '@/app/api/portal/[tenantSlug]/tasks/assign/route';

const ctx = { params: Promise.resolve({ tenantSlug: 'acme' }) };
function req(body: unknown) {
  return new Request('http://localhost/api/portal/acme/tasks/assign', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
const GOOD_BODY = { taskType: 'delegated_task', title: 'Draft section', assigneeRole: 'tenant_user' };

describe('POST tasks/assign guards', () => {
  beforeEach(() => {
    authMock.mockReset(); getTenantMock.mockReset(); verifyAccessMock.mockReset(); createTaskMock.mockReset();
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'm@acme.com', role: 'tenant_admin' } });
    getTenantMock.mockResolvedValue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'acme' });
    verifyAccessMock.mockResolvedValue(true);
    createTaskMock.mockResolvedValue({ ok: true, data: { taskId: 'task-1' } });
  });

  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req(GOOD_BODY), ctx);
    expect(res.status).toBe(401);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('403 for a below-floor role (partner_user)', async () => {
    authMock.mockResolvedValue({ user: { id: 'p1', email: 'p@x.com', role: 'partner_user' } });
    const res = await POST(req(GOOD_BODY), ctx);
    expect(res.status).toBe(403);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it.each(['master_admin', 'rfp_admin'])('400 — a portal caller cannot assign to %s', async (role) => {
    const res = await POST(req({ ...GOOD_BODY, assigneeRole: role }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('400 for a non-UUID assigneeUserId', async () => {
    const res = await POST(req({ taskType: 'x', title: 'y', assigneeUserId: 'not-a-uuid' }), ctx);
    expect(res.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('400 for a non-UUID entityId', async () => {
    const res = await POST(req({ ...GOOD_BODY, entityId: 'nope' }), ctx);
    expect(res.status).toBe(400);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('201 + delegates to createTask on a valid request', async () => {
    const res = await POST(req(GOOD_BODY), ctx);
    expect(res.status).toBe(201);
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    const arg = createTaskMock.mock.calls[0][0];
    expect(arg.tenantId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); // from the URL tenant, never the body
    expect(arg.assigneeRole).toBe('tenant_user');
  });
});
