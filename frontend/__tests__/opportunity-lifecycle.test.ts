/**
 * POST /api/admin/opportunities/[oppId]/lifecycle — C6 opportunity lifecycle.
 * Verifies admin gating, action validation, soft-state transitions (close /
 * archive / reopen / close_date_change), invalid-transition guard, and events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, sqlBeginMock, isValidUUIDMock, emitEventSingleMock } = vi.hoisted(() => {
  const sqlBeginMock = vi.fn();
  const sqlMock = Object.assign(vi.fn(), { begin: sqlBeginMock, json: (v) => v });
  return { authMock: vi.fn(), sqlMock, sqlBeginMock, isValidUUIDMock: vi.fn(), emitEventSingleMock: vi.fn() };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));
vi.mock('@/lib/validation', () => ({ isValidUUID: isValidUUIDMock }));

import { POST } from '@/app/api/admin/opportunities/[oppId]/lifecycle/route';

const OPP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function ctx() { return { params: Promise.resolve({ oppId: OPP }) }; }
function req(body: unknown) {
  return new Request(`http://t/api/admin/opportunities/${OPP}/lifecycle`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

/** Wire auth + opp load + the transaction (UPDATE → updateCount, then audit insert). */
function wire({ role = 'rfp_admin', status = 'open', updateCount = 1, oppFound = true } = {}) {
  authMock.mockResolvedValue({ user: { id: USER, email: 'admin@x.com', role } });
  isValidUUIDMock.mockReturnValue(true);
  sqlMock.mockReset();
  sqlMock
    .mockResolvedValueOnce(oppFound ? [{ id: OPP, title: 'Quantum Radar SBIR', submissionStage: status, closeDate: null }] : [])
    .mockResolvedValue([{ v: null }]); // republishIfReleased head check → not released (fan-out is a no-op)
  sqlBeginMock.mockImplementation(async (cb: (tx: any) => Promise<unknown>) => {
    const tx = vi.fn((strings: TemplateStringsArray) => {
      const q = Array.isArray(strings) ? strings.join('?') : String(strings);
      if (q.includes('UPDATE opportunities')) return Promise.resolve(Object.assign([], { count: updateCount }));
      return Promise.resolve([]); // audit insert
    });
    return cb(tx);
  });
}

beforeEach(() => {
  authMock.mockReset();
  sqlMock.mockReset();
  sqlBeginMock.mockReset();
  isValidUUIDMock.mockReset();
  emitEventSingleMock.mockReset().mockResolvedValue(undefined);
});

describe('POST opportunity lifecycle', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req({ action: 'close' }), ctx());
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin (tenant_admin)', async () => {
    authMock.mockResolvedValue({ user: { id: USER, role: 'tenant_admin' } });
    isValidUUIDMock.mockReturnValue(true);
    const res = await POST(req({ action: 'close' }), ctx());
    expect(res.status).toBe(403);
  });

  it('400 for an invalid action', async () => {
    authMock.mockResolvedValue({ user: { id: USER, role: 'rfp_admin' } });
    isValidUUIDMock.mockReturnValue(true);
    const res = await POST(req({ action: 'delete' }), ctx());
    expect(res.status).toBe(400);
  });

  it('400 for close_date_change without a valid closeDate', async () => {
    authMock.mockResolvedValue({ user: { id: USER, role: 'rfp_admin' } });
    isValidUUIDMock.mockReturnValue(true);
    const res = await POST(req({ action: 'close_date_change' }), ctx());
    expect(res.status).toBe(400);
  });

  it('404 when the opportunity does not exist', async () => {
    wire({ oppFound: false });
    const res = await POST(req({ action: 'close' }), ctx());
    expect(res.status).toBe(404);
  });

  it('closes an open opportunity and emits opportunity.closed', async () => {
    wire({ status: 'open', updateCount: 1 });
    const res = await POST(req({ action: 'close', reason: 'Solicitation withdrawn' }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ action: 'close', fromStage: 'open', toStage: 'closed' });
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'finder',
        type: 'opportunity.closed',
        payload: expect.objectContaining({ opportunityId: OPP, fromStage: 'open', toStage: 'closed' }),
      }),
    );
  });

  it('409 INVALID_TRANSITION when closing an already-closed opportunity', async () => {
    wire({ status: 'closed', updateCount: 0 }); // guard matches no row
    const res = await POST(req({ action: 'close' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('INVALID_TRANSITION');
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  it('reopens a closed opportunity (→ open) and emits opportunity.reopened', async () => {
    wire({ status: 'closed', updateCount: 1 });
    const res = await POST(req({ action: 'reopen' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data.toStage).toBe('open');
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opportunity.reopened' }),
    );
  });

  it('changes the close date and emits opportunity.close_date_changed', async () => {
    wire({ status: 'open', updateCount: 1 });
    const res = await POST(req({ action: 'close_date_change', closeDate: '2026-09-01T00:00:00Z' }), ctx());
    expect(res.status).toBe(200);
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'opportunity.close_date_changed', payload: expect.objectContaining({ newCloseDate: '2026-09-01T00:00:00Z' }) }),
    );
  });
});
