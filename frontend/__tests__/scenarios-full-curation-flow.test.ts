/**
 * Phase 1 §E24 — cross-tool full-curation-flow integration test.
 *
 * Walks the entire happy path through the registered tools with a
 * mocked DB, proving the tools compose correctly:
 *
 *   1. admin A: solicitation.list_triage        → sees the new solicitation
 *   2. admin A: solicitation.claim              → claims it
 *   3. admin A: solicitation.release            → kicks off shred job
 *   4. (shredder runs, writes ai_extracted — simulated as a direct mock)
 *   5. admin A: compliance.save_variable_value  → HITL write (memory!)
 *   6. admin A: solicitation.request_review
 *   7. admin B: solicitation.approve            → same-person rule
 *   8. admin B: solicitation.push               → goes live
 *
 * All under the same test file with a shared sqlMock queue. The test
 * verifies both the return values and that a namespace-tagged memory
 * row gets written at step 5 — the core HITL assertion.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
const { emitSingleMock } = vi.hoisted(() => ({ emitSingleMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ sql: sqlMock }));

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
import { solicitationListTriageTool } from '@/lib/tools/solicitation-list-triage';
import { solicitationClaimTool } from '@/lib/tools/solicitation-claim';
import { solicitationReleaseTool } from '@/lib/tools/solicitation-release';
import { solicitationRequestReviewTool } from '@/lib/tools/solicitation-request-review';
import { solicitationApproveTool } from '@/lib/tools/solicitation-approve';
import { solicitationPushTool } from '@/lib/tools/solicitation-push';
import { complianceSaveVariableValueTool } from '@/lib/tools/compliance-save-variable-value';
import { createLogger } from '@/lib/logger';
import type { ToolContext } from '@/lib/tools/base';

const testLog = createLogger('tools');

const ADMIN_A_ID = '11111111-1111-4111-8111-11111111aaaa';
const ADMIN_B_ID = '22222222-2222-4222-8222-22222222bbbb';
const SOL_ID = '33333333-3333-4333-8333-333333333333';
const OPP_ID = '44444444-4444-4444-8444-444444444444';
const NAMESPACE = 'DOD:unknown:SBIR:Phase1';

function ctx(actorId: string, email: string): ToolContext {
  return {
    actor: { type: 'user', id: actorId, email, role: 'rfp_admin' },
    tenantId: null,
    requestId: 'req_integration',
    log: testLog,
  };
}

beforeEach(() => {
  __resetForTest();
  register(solicitationListTriageTool);
  register(solicitationClaimTool);
  register(solicitationReleaseTool);
  register(solicitationRequestReviewTool);
  register(solicitationApproveTool);
  register(solicitationPushTool);
  register(complianceSaveVariableValueTool);
  sqlMock.mockReset();
  emitSingleMock.mockReset();
  emitSingleMock.mockResolvedValue(undefined);
});

describe('Phase 1 §E24 — full curation flow', () => {
  it('admin A claims → releases → verifies → requests review; admin B approves → pushes; HITL memory written', async () => {
    // ── Step 1: admin A lists triage queue ─────────────────────
    sqlMock.mockResolvedValueOnce([{
      solicitationId: SOL_ID, opportunityId: OPP_ID, status: 'new',
      namespace: NAMESPACE, claimedBy: null, claimedAt: null,
      curatedBy: null, approvedBy: null,
      createdAt: new Date('2026-04-22T10:00:00Z'),
      title: 'DoD 25.2 SBIR', source: 'sam_gov',
      agency: 'Department of Defense', office: null,
      programType: 'sbir_phase_1', closeDate: null, postedDate: null,
    }]);

    const triage = await invoke('solicitation.list_triage', {
      limit: 25, claimedBy: 'unclaimed',
    }, ctx(ADMIN_A_ID, 'admin-a@example.com')) as {
      items: Array<{ solicitationId: string; status: string }>;
    };
    expect(triage.items).toHaveLength(1);
    expect(triage.items[0].solicitationId).toBe(SOL_ID);
    expect(triage.items[0].status).toBe('new');

    // ── Step 2: admin A claims ──────────────────────────────────
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, claimedAt: new Date() }]) // UPDATE
      .mockResolvedValueOnce(undefined); // triage_actions INSERT

    const claim = await invoke('solicitation.claim', {
      solicitationId: SOL_ID,
    }, ctx(ADMIN_A_ID, 'admin-a@example.com')) as { status: string };
    expect(claim.status).toBe('claimed');

    // ── Step 3: admin A releases → inserts shred job ────────────
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID }])             // UPDATE
      .mockResolvedValueOnce(undefined)                     // triage_actions
      .mockResolvedValueOnce([{ id: 'shred-job-uuid' }]);   // pipeline_jobs INSERT

    const release = await invoke('solicitation.release', {
      solicitationId: SOL_ID,
    }, ctx(ADMIN_A_ID, 'admin-a@example.com')) as { shredJobId: string };
    expect(release.shredJobId).toBe('shred-job-uuid');

    // ── Step 4: shredder runs (simulated — not invoked here) ───
    // The real shredder would UPDATE curated_solicitations with
    // ai_extracted + status='ai_analyzed'. For this integration test
    // we simulate the state having advanced when the curator returns.

    // ── Step 5: admin A saves a verified compliance value ──────
    // THE HITL marquee write. Three sql calls:
    //   (a) preflight — namespace + compId + priorJson
    //   (b) UPSERT solicitation_compliance.custom_variables
    //   (c) writeCurationMemory INSERT into episodic_memories
    sqlMock
      .mockResolvedValueOnce([{ namespace: NAMESPACE, compId: null, priorJson: null }])
      .mockResolvedValueOnce([{ verifiedAt: new Date() }])
      .mockResolvedValueOnce(undefined);

    const save = await invoke('compliance.save_variable_value', {
      solicitationId: SOL_ID,
      variableName: 'page_limit_technical',
      value: 15,
      sourceExcerpt: 'Technical Volume shall not exceed 15 pages.',
    }, ctx(ADMIN_A_ID, 'admin-a@example.com')) as {
      memoryWritten: boolean; action: string;
    };
    expect(save.memoryWritten).toBe(true);
    expect(save.action).toBe('manual_entry');

    // Count sql calls so far: triage(1) + claim(2) + release(3) + save(3) = 9
    expect(sqlMock).toHaveBeenCalledTimes(9);

    // ── Step 6: admin A requests review ─────────────────────────
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, curatedBy: ADMIN_A_ID }])
      .mockResolvedValueOnce(undefined);

    const req = await invoke('solicitation.request_review', {
      solicitationId: SOL_ID,
    }, ctx(ADMIN_A_ID, 'admin-a@example.com')) as { status: string };
    expect(req.status).toBe('review_requested');

    // ── Step 7: admin B (different user) approves ──────────────
    // Two-admin rule: admin B must NOT be the same as admin A (curator).
    sqlMock
      .mockResolvedValueOnce([{ id: SOL_ID, curatedBy: ADMIN_A_ID, namespace: NAMESPACE }])
      .mockResolvedValueOnce(undefined) // triage_actions
      .mockResolvedValueOnce(undefined); // approve memory INSERT

    const approve = await invoke('solicitation.approve', {
      solicitationId: SOL_ID,
    }, ctx(ADMIN_B_ID, 'admin-b@example.com')) as { status: string };
    expect(approve.status).toBe('approved');

    // ── Step 8: admin B pushes → visible to customers ──────────
    sqlMock
      .mockResolvedValueOnce([{                                  // preflight
        status: 'approved', namespace: NAMESPACE, opportunityId: OPP_ID,
        submissionFormat: 'DSIP', pageLimitTechnical: 15, customVariables: {},
      }])
      .mockResolvedValueOnce([{ pushedAt: new Date() }]) // UPDATE sol
      .mockResolvedValueOnce(undefined)                   // UPDATE opp is_active
      .mockResolvedValueOnce(undefined)                   // triage_actions
      .mockResolvedValueOnce(undefined);                  // push memory INSERT

    const push = await invoke('solicitation.push', {
      solicitationId: SOL_ID,
    }, ctx(ADMIN_B_ID, 'admin-b@example.com')) as {
      status: string; namespace: string | null;
    };
    expect(push.status).toBe('pushed_to_pipeline');
    expect(push.namespace).toBe(NAMESPACE);

    // ── Verify HITL signal — events covering the full flow ────
    const eventTypes = emitSingleMock.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(eventTypes).toEqual([
      'rfp.triage_claimed',
      'rfp.released_for_analysis',
      'rfp.review_requested',
      'rfp.review_approved',
      'rfp.curated_and_pushed',
    ]);
  });

  it('admin A cannot approve their own curation (same-person rule)', async () => {
    // Simulate: admin A is the curator (curated_by = ADMIN_A_ID)
    // When admin A tries to approve, the UPDATE's WHERE clause
    // `curated_by != actor.id` filters them out — 0 rows returned.
    // The disambiguation query returns the existing row with
    // curated_by == actor.id, which the tool recognizes as same-
    // person and raises ForbiddenError with code=SAME_PERSON_REVIEW.
    sqlMock
      .mockResolvedValueOnce([])                                       // UPDATE 0 rows
      .mockResolvedValueOnce([{ status: 'review_requested', curatedBy: ADMIN_A_ID }]);

    const { ForbiddenError } = await import('@/lib/errors');
    await expect(
      invoke('solicitation.approve', { solicitationId: SOL_ID },
        ctx(ADMIN_A_ID, 'admin-a@example.com')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
