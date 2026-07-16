/**
 * forceAdvanceProcess — the shared HITL force-advance core (admin + portal routes).
 * Locks the guards the map found untested: RBAC (own-tenant scope), paused-only,
 * the paused→retrying compare-and-swap losing the race, the Python-JSONB coerce,
 * and the success shape (sibling reconcile + audit + event).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock, emitEventSingleMock } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  return { sqlMock, emitEventSingleMock: vi.fn() };
});

vi.mock('@/lib/db', () => ({ sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { forceAdvanceProcess, type ForceAdvanceActor } from '@/lib/process/force-advance';

const IID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const admin: ForceAdvanceActor = { id: 'admin1', email: 'admin@rfp.com', role: 'rfp_admin', tenantId: null };
const otherTenantAdmin: ForceAdvanceActor = { id: 'u1', email: 'u@x.com', role: 'tenant_admin', tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };

function pausedInstance(over: Record<string, unknown> = {}) {
  return { id: IID, status: 'paused', currentStep: 'wait_for_review', stepStatus: {}, stepResults: {}, tenantId: TENANT, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  emitEventSingleMock.mockResolvedValue(undefined);
});

describe('forceAdvanceProcess', () => {
  it('404 when the instance is not found', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const r = await forceAdvanceProcess({ instanceId: IID, actor: admin });
    expect(r).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' });
  });

  it('403 when a tenant_admin targets another tenant', async () => {
    sqlMock.mockResolvedValueOnce([pausedInstance()]); // instance belongs to TENANT
    const r = await forceAdvanceProcess({ instanceId: IID, actor: otherTenantAdmin });
    expect(r).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN' });
  });

  it('409 NOT_PAUSED when the instance is not paused', async () => {
    sqlMock.mockResolvedValueOnce([pausedInstance({ status: 'running' })]);
    const r = await forceAdvanceProcess({ instanceId: IID, actor: admin });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'NOT_PAUSED' });
  });

  it('409 when the paused→retrying CAS loses the race (0 rows updated)', async () => {
    sqlMock
      .mockResolvedValueOnce([pausedInstance()]) // SELECT
      .mockResolvedValueOnce([]);                // UPDATE ... RETURNING → 0 rows (a human resumed first)
    const r = await forceAdvanceProcess({ instanceId: IID, actor: admin });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'NOT_PAUSED' });
  });

  it('succeeds: 4 sql calls, event emitted under finder ns, returns the resumed step', async () => {
    sqlMock
      .mockResolvedValueOnce([pausedInstance()]) // SELECT
      .mockResolvedValueOnce([{ id: IID }])      // UPDATE CAS
      .mockResolvedValueOnce([])                 // UPDATE tasks reconcile
      .mockResolvedValueOnce([]);                // INSERT transition
    const r = await forceAdvanceProcess({ instanceId: IID, actor: admin, note: 'go' });
    expect(r).toEqual({ ok: true, data: { instanceId: IID, resumedStep: 'wait_for_review' } });
    expect(sqlMock).toHaveBeenCalledTimes(4);
    expect(emitEventSingleMock).toHaveBeenCalledTimes(1);
    expect(emitEventSingleMock.mock.calls[0][0]).toMatchObject({ namespace: 'finder', type: 'process.force_advanced' });
  });

  it('coerces a Python-stringified step_status instead of char-indexing it', async () => {
    // step_status arrives as a STRING (json.dumps::jsonb read-back). Spreading a
    // string would corrupt it to {0:'{',1:'"',…}; coerceJsonb must object-ify first.
    const inst = pausedInstance({
      stepStatus: '{"prior":"completed"}' as unknown as Record<string, string>,
      stepResults: '{}' as unknown as Record<string, unknown>,
    });
    let updateValues: unknown[] = [];
    sqlMock
      .mockResolvedValueOnce([inst])
      .mockImplementationOnce((_s: TemplateStringsArray, ...vals: unknown[]) => { updateValues = vals; return Promise.resolve([{ id: IID }]); })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const r = await forceAdvanceProcess({ instanceId: IID, actor: admin });
    expect(r.ok).toBe(true);
    // the step_status object handed to the UPDATE keeps its real key + the forced step,
    // and has no char-index key from spreading a raw string.
    const stepStatusArg = updateValues.find(
      (v) => v && typeof v === 'object' && 'prior' in (v as object),
    ) as Record<string, string> | undefined;
    expect(stepStatusArg).toBeDefined();
    expect(stepStatusArg).toMatchObject({ prior: 'completed', wait_for_review: 'completed' });
    expect(stepStatusArg).not.toHaveProperty('0');
  });
});
