/**
 * Regression: the generic task completer must NOT close a manager_request (docs/PARTNER_MANAGER_DESIGN
 * §4B). Closing it there only marks the row done + tries to resume a (non-existent) workflow — it
 * grants NOTHING — so a company admin clicking "done" in their normal ToDo list would silently drop
 * the partner_manager grant. completeTask must reject it and route to the Manager Requests flow.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { sqlMock, faMock, emitMock } = vi.hoisted(() => ({
  sqlMock: Object.assign(vi.fn(), { json: (v: unknown) => v }),
  faMock: vi.fn(),
  emitMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock, forceAdvanceProcess: faMock, getTenantBySlug: vi.fn(), verifyTenantAccess: vi.fn() }));
vi.mock('@/lib/process/force-advance', () => ({ forceAdvanceProcess: faMock }));
vi.mock('@/lib/events', () => ({ emitEventSingle: emitMock, userActor: (id: string, email?: string) => ({ type: 'user', id, email }) }));

import { completeTask } from '@/lib/tasks/tasks';

const TASK = '11111111-1111-1111-1111-111111111111';

describe('completeTask blocks generic completion of a manager_request', () => {
  beforeEach(() => { sqlMock.mockReset(); faMock.mockReset(); emitMock.mockReset(); });

  it('returns USE_MANAGER_REQUEST_FLOW and never closes/resumes', async () => {
    // The completeTask lookup returns a manager_request task the actor IS assigned to.
    sqlMock.mockResolvedValueOnce([{
      id: TASK, status: 'open', tenantId: 't1', assigneeRole: null,
      assigneeUserId: 'u1', processInstanceId: null, taskType: 'manager_request',
    }]);
    const r = await completeTask({ taskId: TASK, actor: { id: 'u1', email: null, role: 'tenant_admin', tenantId: 't1' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('USE_MANAGER_REQUEST_FLOW');
    expect(faMock).not.toHaveBeenCalled();          // never resumed
    expect(sqlMock).toHaveBeenCalledTimes(1);        // only the lookup — the UPDATE (close) never ran
  });

  it('still completes an ordinary task (control)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: TASK, status: 'open', tenantId: 't1', assigneeRole: 'rfp_admin', assigneeUserId: null, processInstanceId: null, taskType: 'application_triage' }])
      .mockResolvedValueOnce([{ id: TASK }]); // the close UPDATE
    faMock.mockResolvedValueOnce({ ok: false });
    const r = await completeTask({ taskId: TASK, actor: { id: 'a1', email: null, role: 'rfp_admin', tenantId: null } });
    expect(r.ok).toBe(true);
  });
});
