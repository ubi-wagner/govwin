/**
 * R5.1 (J1) — createTask validation (the early-return branches, no DB).
 *
 * Every invariant check returns BEFORE touching sql, so these assert both the
 * error shape AND that sql is never called for a bad request (fail fast, cheap).
 * The DB-touching paths (same-tenant assignee guard + insert + emit) are covered
 * by the live-PG drive.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sqlMock, emitMock } = vi.hoisted(() => ({
  sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }),
  emitMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock, forceAdvanceProcess: vi.fn(), getTenantBySlug: vi.fn(), verifyTenantAccess: vi.fn() }));
vi.mock('@/lib/process/force-advance', () => ({ forceAdvanceProcess: vi.fn() }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitMock, userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));

import { createTask } from '@/lib/tasks/tasks';

const actor = { id: 'u1', email: 'a@b.com', role: 'tenant_admin' as const, tenantId: 't1' };
const ok = { actor, tenantId: 't1', assigneeRole: 'tenant_user', taskType: 'draft_section', title: 'Draft section 3' };

describe('createTask validation (no DB)', () => {
  beforeEach(() => { sqlMock.mockReset(); emitMock.mockReset(); });

  it('rejects a missing taskType without hitting sql', async () => {
    const r = await createTask({ ...ok, taskType: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a missing title', async () => {
    const r = await createTask({ ...ok, title: '' });
    expect(r.ok).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects when no assignee role or user is given', async () => {
    const r = await createTask({ ...ok, assigneeRole: null, assigneeUserId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/assignee/i);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid assignee role', async () => {
    const r = await createTask({ ...ok, assigneeRole: 'superuser' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid dueAt', async () => {
    const r = await createTask({ ...ok, dueAt: 'not-a-date' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dueAt/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('does NOT emit on a rejected request', async () => {
    await createTask({ ...ok, taskType: '' });
    expect(emitMock).not.toHaveBeenCalled();
  });
});
