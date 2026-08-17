/**
 * Post-submission outcome-nudge ToDo (#13) — lib/proposal/outcome-todo.ts.
 *
 * Proves the two halves of the loop:
 *   - createOutcomeNudge: raises a `record_outcome` ToDo (tenant_admin, entity=proposal)
 *     when none is open; is idempotent (skips when one already exists).
 *   - completeOutcomeTodos: closes the open record_outcome ToDo(s) for a proposal.
 *
 * runInTenant is stubbed to just run the callback; sql is a tagged-template mock
 * whose resolved value we set per call.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock, createTaskMock } = vi.hoisted(() => {
  const sqlMock: any = vi.fn();
  sqlMock.json = (v: unknown) => v;
  return { sqlMock, createTaskMock: vi.fn() };
});

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/tenant-context', () => ({ runInTenant: (_tid: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/tasks/tasks', () => ({ createTask: createTaskMock }));

import { createOutcomeNudge, completeOutcomeTodos } from '@/lib/proposal/outcome-todo';

const actor = { id: 'u1', email: 'admin@acme.test', role: 'tenant_admin' as const, tenantId: 't1' };
const TENANT = 't1';
const PROPOSAL = 'p1';

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.json = (v: unknown) => v;
  createTaskMock.mockReset();
});

describe('createOutcomeNudge', () => {
  it('raises a record_outcome ToDo for the tenant_admin when none is open', async () => {
    sqlMock.mockResolvedValueOnce([]); // no existing open ToDo
    createTaskMock.mockResolvedValueOnce({ ok: true, data: { taskId: 'task-1' } });

    const res = await createOutcomeNudge(actor, TENANT, PROPOSAL, 'Acme SBIR Phase I');

    expect(res).toEqual({ created: true, taskId: 'task-1' });
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'record_outcome',
        assigneeRole: 'tenant_admin',
        entityType: 'proposal',
        entityId: PROPOSAL,
        title: expect.stringContaining('Acme SBIR Phase I'),
      }),
    );
  });

  it('is idempotent — skips creating a second ToDo when one is already open', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'existing-task' }]); // one already open

    const res = await createOutcomeNudge(actor, TENANT, PROPOSAL, 'Acme SBIR Phase I');

    expect(res).toEqual({ created: false, taskId: 'existing-task' });
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('never throws — a DB failure resolves to created:false', async () => {
    sqlMock.mockRejectedValueOnce(new Error('boom'));
    const res = await createOutcomeNudge(actor, TENANT, PROPOSAL, 'X');
    expect(res).toEqual({ created: false });
  });
});

describe('completeOutcomeTodos', () => {
  it('closes the open record_outcome ToDos and returns the count', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const closed = await completeOutcomeTodos(TENANT, PROPOSAL, 'u1', 'awarded');
    expect(closed).toBe(2);
  });

  it('never throws — a DB failure resolves to 0', async () => {
    sqlMock.mockRejectedValueOnce(new Error('boom'));
    const closed = await completeOutcomeTodos(TENANT, PROPOSAL, 'u1', 'rejected');
    expect(closed).toBe(0);
  });
});
