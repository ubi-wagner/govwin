/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/land-revisions
 *
 * The read-on-review landing: reads the proposal's latest drafting runs (the one-shot full
 * draft OnFullDraftRequested% AND the Proposal Studio OnReviewPhaseRequested% Draft/Refine
 * phases), extracts review-staged section canvases (merged oldest→newest), and lands each as
 * a PROPOSED ai_revision canvas_versions row. Mocked: @/auth, @/lib/db, @/lib/events. Real:
 * rbac, validation, jsonb (pure).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { authMock, sqlMock, getTenantBySlugMock, verifyProposalAccessMock, emitEventSingleMock } = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (x: unknown) => x });
  return {
    authMock: vi.fn(),
    sqlMock,
    getTenantBySlugMock: vi.fn(),
    verifyProposalAccessMock: vi.fn(),
    emitEventSingleMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyProposalAccess: verifyProposalAccessMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  userActor: (id: string, email?: string) => ({ type: 'user', id, email }),
}));

import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/land-revisions/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const CANVAS = { version: 1, nodes: [{ type: 'text_block', content: { text: 'proposed' } }] };
// The real nested invoke_agent → result → tool_results → output shape.
const stepResultsWith = (sectionId: string, canvas: unknown) => ({
  reformat: { result: { result: { tool_results: [{ output: { section_id: sectionId, canvas, source: 'ai_revision', persisted: false } }] } } },
});

function ctx() {
  return { params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROPOSAL_ID }) };
}
function req() {
  return new Request(`http://localhost/api/portal/acme/proposals/${PROPOSAL_ID}/land-revisions`, { method: 'POST', body: '{}' });
}
function setupAuth(role = 'tenant_admin') {
  authMock.mockResolvedValue({ user: { id: USER_ID, email: 'a@a.com', role, tenantId: TENANT_ID } });
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID });
  verifyProposalAccessMock.mockResolvedValue(true);
  emitEventSingleMock.mockResolvedValue(undefined);
}

describe('POST land-revisions', () => {
  beforeEach(() => {
    authMock.mockReset(); sqlMock.mockReset(); getTenantBySlugMock.mockReset();
    verifyProposalAccessMock.mockReset(); emitEventSingleMock.mockReset();
  });

  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(401);
  });

  it('403 for a non-admin role', async () => {
    setupAuth('tenant_user');
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
  });

  it('lands a staged revision as a proposed ai_revision version', async () => {
    setupAuth();
    sqlMock
      .mockResolvedValueOnce([{ stepResults: stepResultsWith(SECTION_ID, CANVAS) }]) // instance
      .mockResolvedValueOnce([{ id: SECTION_ID, version: 5 }]) // ownership (+ current version)
      .mockResolvedValueOnce([])                    // prior ai_revision (none)
      .mockResolvedValueOnce([{ versionNumber: 5 }]) // INSERT ... RETURNING (inserted)
      .mockResolvedValueOnce([]);                    // UPDATE proposal_sections (advance counter)
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.landed).toBe(1);
    expect(data.sections).toEqual([SECTION_ID]);
    expect(emitEventSingleMock).toHaveBeenCalledTimes(1);
    // The version counter is advanced (INSERT RETURNING + UPDATE) — 5 sql calls total.
    expect(sqlMock).toHaveBeenCalledTimes(5);
  });

  it('merges across Studio phases — the later Refine canvas wins over the earlier Draft', async () => {
    setupAuth();
    const OLD_CANVAS = { version: 1, nodes: [{ type: 'text_block', content: { text: 'draft' } }] };
    const NEW_CANVAS = { version: 1, nodes: [{ type: 'text_block', content: { text: 'refined' } }] };
    // Two instances returned by the DISTINCT ON query, deliberately out of order to prove the
    // oldest→newest re-sort: Refine (newer) first, Draft (older) second → Refine still wins.
    sqlMock
      .mockResolvedValueOnce([
        { workflowName: 'OnReviewPhaseRequestedRefine', startedAt: '2026-08-02T00:00:00Z', stepResults: stepResultsWith(SECTION_ID, NEW_CANVAS) },
        { workflowName: 'OnReviewPhaseRequestedDraft', startedAt: '2026-08-01T00:00:00Z', stepResults: stepResultsWith(SECTION_ID, OLD_CANVAS) },
      ])
      .mockResolvedValueOnce([{ id: SECTION_ID, version: 5 }]) // ownership
      .mockResolvedValueOnce([])                    // prior (none)
      .mockResolvedValueOnce([{ versionNumber: 5 }]) // INSERT ... RETURNING
      .mockResolvedValueOnce([]);                    // UPDATE advance
    const data = (await (await POST(req(), ctx())).json()).data;
    expect(data.landed).toBe(1);
    // The INSERT (4th sql call) must carry the NEW (Refine) canvas, not the stale Draft one.
    const insertCall = sqlMock.mock.calls[3];
    expect(insertCall).toContain(NEW_CANVAS);
    expect(insertCall).not.toContain(OLD_CANVAS);
  });

  it('does NOT land (or advance) when the version slot is already taken (race)', async () => {
    setupAuth();
    sqlMock
      .mockResolvedValueOnce([{ stepResults: stepResultsWith(SECTION_ID, CANVAS) }]) // instance
      .mockResolvedValueOnce([{ id: SECTION_ID, version: 5 }]) // ownership
      .mockResolvedValueOnce([])                    // prior (none)
      .mockResolvedValueOnce([]);                   // INSERT ... RETURNING → conflict (empty)
    const data = (await (await POST(req(), ctx())).json()).data;
    expect(data.landed).toBe(0);
    expect(sqlMock).toHaveBeenCalledTimes(4); // no UPDATE (didn't advance)
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  it('returns landed:0 with reason when there is no full-draft run', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([]); // no instance
    const data = (await (await POST(req(), ctx())).json()).data;
    expect(data.landed).toBe(0);
    expect(data.reason).toBe('no_full_draft_run');
  });

  it('returns landed:0 when the run staged no revisions', async () => {
    setupAuth();
    sqlMock.mockResolvedValueOnce([{ stepResults: { reformat: { result: { result: { tool_results: [] } } } } }]);
    const data = (await (await POST(req(), ctx())).json()).data;
    expect(data.landed).toBe(0);
    expect(data.reason).toBe('no_staged_revisions');
  });

  it('skips a section that does not belong to the proposal', async () => {
    setupAuth();
    sqlMock
      .mockResolvedValueOnce([{ stepResults: stepResultsWith(SECTION_ID, CANVAS) }])
      .mockResolvedValueOnce([]); // ownership → not found
    const data = (await (await POST(req(), ctx())).json()).data;
    expect(data.landed).toBe(0);
  });

  it('is idempotent — skips when the latest full-draft ai_revision already matches', async () => {
    setupAuth();
    sqlMock
      .mockResolvedValueOnce([{ stepResults: stepResultsWith(SECTION_ID, CANVAS) }])
      .mockResolvedValueOnce([{ id: SECTION_ID, version: 5 }]) // ownership
      .mockResolvedValueOnce([{ content: CANVAS }]); // prior matches → skip
    const data = (await (await POST(req(), ctx())).json()).data;
    expect(data.landed).toBe(0);
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});
