/**
 * Phase 1 §E.2a — solicitation state-transition tools (E3, E4, E5).
 *
 * Hermetic unit tests mocking @/lib/db + events. Verifies:
 *   - Registration under expected names
 *   - rfp_admin requirement + tenantScoped=false
 *   - Happy-path row transitions + event emission
 *   - ClaimConflictError on race
 *   - StateTransitionError on wrong state
 *   - NotFoundError on missing row
 *   - Dismiss writes curation memory when namespace is present
 *   - Dismiss skips memory write when namespace is null
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: Object.assign(vi.fn(), { json: (v) => v }) }));
// writeCurationMemory writes episodic_memories (force-RLS, platform/nil-tenant scope) through
// sqlBypass, NOT the context-aware client — so it gets its own mock and its own assertions.
const { sqlBypassMock } = vi.hoisted(() => ({ sqlBypassMock: Object.assign(vi.fn(), { json: (v) => v }) }));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {}, sql: sqlMock, sqlBypass: sqlBypassMock }));

vi.mock('@/lib/events', async () => {
  const actual = await vi.importActual<typeof import('@/lib/events')>('@/lib/events');
  return {
    ...actual,
    emitEventStart: vi.fn(async () => 'stub-event-id'),
    emitEventEnd: vi.fn(async () => undefined),
    emitEventSingle: emitSingleMock,
  };
});

vi.mock('@/lib/capacity', () => ({
  recordInvoke: vi.fn(async () => undefined),
}));

import { __resetForTest, register, invoke } from '@/lib/tools/registry';
import { solicitationClaimTool } from '@/lib/tools/solicitation-claim';
import { solicitationReleaseTool } from '@/lib/tools/solicitation-release';
import { solicitationDismissTool } from '@/lib/tools/solicitation-dismiss';
import { ToolAuthorizationError, ToolValidationError } from '@/lib/tools/errors';
import {
  ClaimConflictError,
  NotFoundError,
  StateTransitionError,
} from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/lib/tools/base';

const testLog = createLogger('tools');

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: {
      type: 'user',
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@example.com',
      role: 'rfp_admin',
    },
    tenantId: null,
    requestId: 'req_test',
    log: testLog,
    ...overrides,
  };
}

const SOL_ID = '22222222-2222-4222-8222-222222222222';

/** True once a curation memory actually landed: an episodic_memories INSERT on the bypass client. */
function memoryInsertCount(): number {
  return sqlBypassMock.mock.calls.filter(
    (c: unknown[]) => String(c[0]).includes('episodic_memories'),
  ).length;
}

beforeEach(() => {
  __resetForTest();
  register(solicitationClaimTool);
  register(solicitationReleaseTool);
  register(solicitationDismissTool);
  sqlMock.mockReset();
  sqlBypassMock.mockReset();
  // Default for BOTH sqlBypass uses: the platform-tenant lookup and the memory INSERT.
  sqlBypassMock.mockResolvedValue([{ id: 'b4e60242-ece7-482a-b661-eb7adf34ffc4' }]);
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

// ─── solicitation.claim (E3) ──────────────────────────────────────

describe('solicitation.claim', () => {
  it('happy path: returns claimed status + emits event', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, claimedAt: new Date('2026-04-22T14:00:00Z') }]) // UPDATE returning
      .mockResolvedValueOnce(undefined); // triage_actions INSERT

    const result = await invoke('solicitation.claim',
      { solicitationId: SOL_ID }, ctx(),
    ) as { solicitationId: string; status: string; claimedBy: string };

    expect(result.status).toBe('claimed');
    expect(result.solicitationId).toBe(SOL_ID);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'finder',
        type: 'solicitation.claimed',
      }),
    );
  });

  it('throws ClaimConflictError when UPDATE returns 0 rows (row already claimed)', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // UPDATE returns nothing
      .mockResolvedValueOnce([{ status: 'claimed', claimedBy: 'other-user' }]); // disambiguation query

    await expect(
      invoke('solicitation.claim', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(ClaimConflictError);
  });

  it('throws NotFoundError when the solicitation does not exist', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // UPDATE returns nothing
      .mockResolvedValueOnce([]); // disambiguation finds nothing

    await expect(
      invoke('solicitation.claim', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects non-rfp_admin caller', async () => {
    await expect(
      invoke('solicitation.claim', { solicitationId: SOL_ID },
        ctx({ actor: { type: 'user', id: 'u', email: null, role: 'tenant_user' } })),
    ).rejects.toBeInstanceOf(ToolAuthorizationError);
  });

  it('rejects invalid UUID', async () => {
    await expect(
      invoke('solicitation.claim', { solicitationId: 'not-uuid' }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});

// ─── solicitation.release (E4) ────────────────────────────────────

describe('solicitation.release', () => {
  it('happy path: inserts shred job + emits event', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID }]) // UPDATE returning
      .mockResolvedValueOnce(undefined) // triage_actions INSERT
      .mockResolvedValueOnce([{ id: 'job-abc' }]); // pipeline_jobs INSERT

    const result = await invoke('solicitation.release',
      { solicitationId: SOL_ID }, ctx(),
    ) as { status: string; shredJobId: string };

    expect(result.status).toBe('released_for_analysis');
    expect(result.shredJobId).toBe('job-abc');
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'finder',
        type: 'solicitation.released',
      }),
    );
    // Verify 3 sql calls: UPDATE, triage audit INSERT, pipeline_jobs INSERT
    expect(sqlMock).toHaveBeenCalledTimes(3);
  });

  it('throws StateTransitionError when not claimed by actor', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // UPDATE returns nothing
      .mockResolvedValueOnce([{ status: 'claimed', claimedBy: 'someone-else' }]);

    await expect(
      invoke('solicitation.release', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('throws NotFoundError on missing row', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(
      invoke('solicitation.release', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── solicitation.dismiss (E5) ────────────────────────────────────

describe('solicitation.dismiss', () => {
  it('happy path with namespace: writes curation memory', async () => {
    sqlMock
      .mockResolvedValueOnce([{ // SELECT existing
        status: 'new',
        claimedBy: null,
        namespace: 'DOD:unknown:SBIR:Phase1',
      }])
      .mockResolvedValueOnce([{ id: SOL_ID }]) // UPDATE returning
      .mockResolvedValueOnce(undefined); // triage_actions INSERT

    const result = await invoke('solicitation.dismiss',
      { solicitationId: SOL_ID, phaseClassification: 'phase_1_like', notes: 'off-scope' },
      ctx(),
    ) as { status: string; previousStatus: string };

    expect(result.status).toBe('dismissed');
    expect(result.previousStatus).toBe('new');
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'finder',
        type: 'solicitation.dismissed',
      }),
    );
    // 3 context-aware sql calls: SELECT + UPDATE + triage_actions INSERT.
    expect(sqlMock).toHaveBeenCalledTimes(3);
    // The memory INSERT goes through sqlBypass (platform/nil-tenant scope on a force-RLS table).
    expect(memoryInsertCount()).toBe(1);
  });

  it('skips memory write when namespace is null', async () => {
    sqlMock
      .mockResolvedValueOnce([{ status: 'new', claimedBy: null, namespace: null }])
      .mockResolvedValueOnce([{ id: SOL_ID }])
      .mockResolvedValueOnce(undefined); // only triage_actions INSERT

    await invoke('solicitation.dismiss',
      { solicitationId: SOL_ID, notes: 'irrelevant' }, ctx(),
    );

    // 3 sql calls: SELECT + UPDATE + triage_actions (no memory INSERT)
    expect(sqlMock).toHaveBeenCalledTimes(3);
    expect(memoryInsertCount()).toBe(0);
  });

  it('throws StateTransitionError from non-dismissible state', async () => {
    sqlMock.mockResolvedValueOnce([{
      status: 'approved',
      claimedBy: null,
      namespace: 'DOD:unknown:SBIR:Phase1',
    }]);

    await expect(
      invoke('solicitation.dismiss', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('blocks dismissal when another admin owns the claim', async () => {
    sqlMock.mockResolvedValueOnce([{
      status: 'claimed',
      claimedBy: 'different-actor-uuid',
      namespace: null,
    }]);

    await expect(
      invoke('solicitation.dismiss', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('throws NotFoundError on missing row', async () => {
    sqlMock.mockResolvedValueOnce([]);

    await expect(
      invoke('solicitation.dismiss', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
