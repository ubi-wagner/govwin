/**
 * Manager-request guards (docs/PARTNER_MANAGER_DESIGN.md §4 Branch B). The empty-input guards must
 * fail closed BEFORE any DB call. The full create/approve/decline paths are covered by the drive/E2E.
 */
import { describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sqlBypass: sqlMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: vi.fn(), userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));
vi.mock('@/lib/tasks/tasks', () => ({ createTask: vi.fn() }));

import { createManagerRequest, resolveManagerRequest } from '@/lib/partner/manager-request';

describe('manager-request guards fail closed with no DB', () => {
  it('createManagerRequest requires a tenantId', async () => {
    const r = await createManagerRequest({ partner: { id: 'p1', email: null }, tenantId: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
    expect(sqlMock).not.toHaveBeenCalled();
  });
  it('resolveManagerRequest requires a taskId', async () => {
    const r = await resolveManagerRequest({ taskId: '', tenantId: 't1', approver: { id: 'a', email: null }, decision: 'approve' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
