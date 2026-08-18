/**
 * Phase 1 §E.2b — approval-flow state-machine tools (E6, E7, E8, E9).
 *
 * Covers:
 *   - request_review: curation_in_progress → review_requested
 *   - approve: review_requested → approved, same-person rule (D-Phase1-09)
 *   - reject_review: review_requested → curation_in_progress
 *   - push: approved → pushed_to_pipeline, compliance validation,
 *           is_active flip, memory write
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => {
  const mock = vi.fn() as any;
  // sql.begin(async (tx) => { ... }) — pass the mock itself as tx
  mock.begin = vi.fn(async (fn: any) => fn(mock));
  mock.json = (v: any) => v;
  return { sqlMock: mock };
});
// writeCurationMemory writes episodic_memories (force-RLS, platform/nil-tenant scope) through
// sqlBypass, NOT the context-aware client — so it gets its own mock and its own assertions.
const { sqlBypassMock } = vi.hoisted(() => ({ sqlBypassMock: Object.assign(vi.fn(), { json: (v: any) => v }) }));
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

// Isolate the push unit test from the bridge integration (the approve→push→bridge
// fan-out is verified separately). Without this its buildCardSnapshot SELECT would
// add an extra sql call to the push tool's own count.
vi.mock('@/lib/opportunity-bridge', () => ({
  publishAndFanOut: vi.fn(async () => null),
}));

import { __resetForTest, register, invoke } from '@/lib/tools/registry';
import { solicitationRequestReviewTool } from '@/lib/tools/solicitation-request-review';
import { solicitationApproveTool } from '@/lib/tools/solicitation-approve';
import { solicitationRejectReviewTool } from '@/lib/tools/solicitation-reject-review';
import { solicitationPushTool } from '@/lib/tools/solicitation-push';
import { ToolValidationError } from '@/lib/tools/errors';
import {
  NotFoundError,
  StateTransitionError,
  ValidationError,
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
const CURATOR_ID = '33333333-3333-4333-8333-333333333333';
const NAMESPACE = 'DOD:unknown:SBIR:Phase1';

/** True once a curation memory actually landed: an episodic_memories INSERT on the bypass client. */
function memoryInsertCount(): number {
  return sqlBypassMock.mock.calls.filter(
    (c: unknown[]) => String(c[0]).includes('episodic_memories'),
  ).length;
}

beforeEach(() => {
  __resetForTest();
  register(solicitationRequestReviewTool);
  register(solicitationApproveTool);
  register(solicitationRejectReviewTool);
  register(solicitationPushTool);
  sqlMock.mockReset();
  sqlBypassMock.mockReset();
  // Default for BOTH sqlBypass uses: the platform-tenant lookup and the memory INSERT.
  sqlBypassMock.mockResolvedValue([{ id: 'b4e60242-ece7-482a-b661-eb7adf34ffc4' }]);
  sqlMock.begin = vi.fn(async (fn: any) => fn(sqlMock));
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

// ─── solicitation.request_review (E6) ─────────────────────────────

describe('solicitation.request_review', () => {
  it('happy path: transitions + emits event', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, curatedBy: CURATOR_ID }])
      .mockResolvedValueOnce(undefined) // triage_actions INSERT
      .mockResolvedValueOnce(undefined); // curation_revision INSERT

    const result = await invoke('solicitation.request_review',
      { solicitationId: SOL_ID }, ctx(),
    ) as { status: string };

    expect(result.status).toBe('review_requested');
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'solicitation.review_requested' }),
    );
  });

  it('throws StateTransitionError from wrong state', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'approved' }]);

    await expect(
      invoke('solicitation.request_review', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('throws NotFoundError on missing row', async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      invoke('solicitation.request_review', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── solicitation.approve (E7) ────────────────────────────────────

describe('solicitation.approve', () => {
  it('happy path: different approver, writes memory', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        id: SOL_ID, curatedBy: CURATOR_ID, namespace: NAMESPACE,
      }])
      .mockResolvedValueOnce(undefined) // triage_actions
      .mockResolvedValueOnce(undefined) // memory INSERT
      .mockResolvedValueOnce(undefined); // curation_revision INSERT

    const result = await invoke('solicitation.approve',
      { solicitationId: SOL_ID }, ctx(),
    ) as { status: string; curatedBy: string };

    expect(result.status).toBe('approved');
    expect(result.curatedBy).toBe(CURATOR_ID);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'solicitation.approved' }),
    );
    // 3 context-aware sql calls: UPDATE + triage + curation_revision.
    expect(sqlMock).toHaveBeenCalledTimes(3);
    // The memory INSERT goes through sqlBypass (platform/nil-tenant scope on a force-RLS table).
    expect(memoryInsertCount()).toBe(1);
  });

  it('allows self-approve (single-admin operation), audit-flagged', async () => {
    // curated_by == actor.id — the two-admin rule was relaxed so a lone RFP
    // admin can curate then approve. The UPDATE now returns a row (no filter).
    const selfId = '11111111-1111-4111-8111-111111111111'; // == ctx() actor.id
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, curatedBy: selfId, namespace: NAMESPACE }]) // UPDATE succeeds
      .mockResolvedValueOnce(undefined) // triage_actions
      .mockResolvedValueOnce(undefined) // memory INSERT
      .mockResolvedValueOnce(undefined); // curation_revision INSERT

    const result = await invoke('solicitation.approve',
      { solicitationId: SOL_ID }, ctx(),
    ) as { status: string; curatedBy: string; approvedBy: string };

    expect(result.status).toBe('approved');
    // self-approve: curator and approver are the same actor
    expect(result.curatedBy).toBe(selfId);
    expect(result.approvedBy).toBe(selfId);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'solicitation.approved' }),
    );
  });

  it('throws StateTransitionError from wrong state', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'curation_in_progress', curatedBy: CURATOR_ID }]);

    await expect(
      invoke('solicitation.approve', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('throws NotFoundError on missing row', async () => {
    sqlMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      invoke('solicitation.approve', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('skips memory write when namespace is null', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, curatedBy: CURATOR_ID, namespace: null }])
      .mockResolvedValueOnce(undefined) // triage INSERT
      .mockResolvedValueOnce(undefined); // curation_revision INSERT (no memory since namespace is null)

    await invoke('solicitation.approve',
      { solicitationId: SOL_ID }, ctx(),
    );
    // 3 sql calls: UPDATE + triage + curation_revision (no memory since namespace is null)
    expect(sqlMock).toHaveBeenCalledTimes(3);
  });
});

// ─── solicitation.reject_review (E8) ──────────────────────────────

describe('solicitation.reject_review', () => {
  it('happy path with required notes', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID }])
      .mockResolvedValueOnce(undefined);

    const result = await invoke('solicitation.reject_review',
      { solicitationId: SOL_ID, notes: 'Page limit wrong, re-check section 7' },
      ctx(),
    ) as { status: string };

    expect(result.status).toBe('curation_in_progress');
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'solicitation.review_rejected' }),
    );
  });

  it('requires notes (empty string rejected by zod)', async () => {
    await expect(
      invoke('solicitation.reject_review', { solicitationId: SOL_ID, notes: '' }, ctx()),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('throws StateTransitionError from wrong state', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'approved' }]);

    await expect(
      invoke('solicitation.reject_review',
        { solicitationId: SOL_ID, notes: 'reason' }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });
});

// ─── solicitation.push (E9) ───────────────────────────────────────

describe('solicitation.push', () => {
  const OPP_ID = '44444444-4444-4444-8444-444444444444';

  it('happy path: validates, flips status + is_active, writes memory', async () => {
    sqlMock
      .mockResolvedValueOnce([{
        status: 'approved', namespace: NAMESPACE, opportunityId: OPP_ID,
        submissionFormat: 'DSIP', pageLimitTechnical: 15,
        customVariables: {}, hasSubmissionFormat: true,
        spotlightSummary: 'Navy CV property-intelligence SBIR — agencies: Navy/DoD; tech: computer vision, edge inference.',
      }])
      .mockResolvedValueOnce([{ n: 0 }]) // date-guard: 0 activated opps missing close_date (⑤)
      .mockResolvedValueOnce([{ pushedAt: new Date('2026-04-22T15:00:00Z') }])
      .mockResolvedValueOnce(undefined) // opportunities UPDATE
      .mockResolvedValueOnce(undefined) // triage_actions
      .mockResolvedValueOnce(undefined) // curation_revision INSERT
      .mockResolvedValueOnce([{ count: '3' }]) // topic COUNT
      .mockResolvedValueOnce(undefined); // memory INSERT

    const result = await invoke('solicitation.push',
      { solicitationId: SOL_ID }, ctx(),
    ) as { status: string; opportunityId: string; namespace: string | null };

    expect(result.status).toBe('pushed_to_pipeline');
    expect(result.opportunityId).toBe(OPP_ID);
    expect(result.namespace).toBe(NAMESPACE);
    expect(emitSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'solicitation.pushed' }),
    );
    // 8 context-aware sql: SELECT preflight + date-guard COUNT + UPDATE sol + UPDATE opp + triage
    //   + revision + COUNT topics + SELECT activated-set (multi-topic fan-out publishes each opp)
    expect(sqlMock).toHaveBeenCalledTimes(8);
    // The memory INSERT goes through sqlBypass (platform/nil-tenant scope on a force-RLS table).
    expect(memoryInsertCount()).toBe(1);
  });

  it('throws ValidationError when submission_format is missing', async () => {
    sqlMock.mockResolvedValueOnce([{
      status: 'approved', namespace: NAMESPACE, opportunityId: OPP_ID,
      submissionFormat: null, pageLimitTechnical: 15, customVariables: {},
    }]);

    await expect(
      invoke('solicitation.push', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError when submission_format is empty string', async () => {
    sqlMock.mockResolvedValueOnce([{
      status: 'approved', namespace: NAMESPACE, opportunityId: OPP_ID,
      submissionFormat: '   ', pageLimitTechnical: 15, customVariables: {},
    }]);

    await expect(
      invoke('solicitation.push', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws StateTransitionError when not approved', async () => {
    sqlMock.mockResolvedValueOnce([{
      status: 'curation_in_progress', namespace: NAMESPACE, opportunityId: OPP_ID,
      submissionFormat: 'DSIP', pageLimitTechnical: 15, customVariables: {},
    }]);

    await expect(
      invoke('solicitation.push', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(StateTransitionError);
  });

  it('throws NotFoundError on missing row', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(
      invoke('solicitation.push', { solicitationId: SOL_ID }, ctx()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
