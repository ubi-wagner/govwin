/**
 * Manual AI (color-team) review — POST /api/portal/[t]/proposals/[p]/ai-review.
 *
 * Verifies: tenant_admin+ gate; per-section color_team_reviewer enqueue with the snake_case keys the
 * archetype reads (section_text/requested_by); and the audit emission proposal:ai_review.requested with
 * source='portal'. The type MUST NOT be 'review_requested' — that exact type is dispatched by the agent
 * fabric to color_team as a one-shot with no per-section write-back, which would double-invoke the agent.
 * The real requestAiReview runs against mocked @/lib/events + @/lib/agent-client — the audit guarantee.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  authMock, sqlMock, getTenantBySlugMock, verifyTenantAccessMock,
  emitEventStartMock, emitEventEndMock, requestAgentTaskMock,
} = vi.hoisted(() => {
  const sqlMock = Object.assign(vi.fn(), { json: (v: unknown) => v });
  return {
    authMock: vi.fn(),
    sqlMock,
    getTenantBySlugMock: vi.fn(),
    verifyTenantAccessMock: vi.fn(),
    emitEventStartMock: vi.fn(),
    emitEventEndMock: vi.fn(),
    requestAgentTaskMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  enterTenant: () => {},
  sql: sqlMock,
  getTenantBySlug: getTenantBySlugMock,
  verifyTenantAccess: verifyTenantAccessMock,
}));
vi.mock('@/lib/events', () => ({
  emitEventStart: emitEventStartMock,
  emitEventEnd: emitEventEndMock,
  userActor: (userId: string, email?: string) => ({ type: 'user', id: userId, email }),
}));
vi.mock('@/lib/agent-client', () => ({ requestAgentTask: requestAgentTaskMock }));
vi.mock('@/lib/proposal-advance', () => ({ extractCanvasText: () => 'section body text' }));

import { POST } from '@/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai-review/route';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROPOSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeSession(role: string) {
  return { user: { id: USER_ID, email: 'alice@acme.com', role, tenantId: TENANT_ID } };
}
const ctx = () => ({ params: Promise.resolve({ tenantSlug: 'acme', proposalId: PROPOSAL_ID }) });
const req = () =>
  new Request(`http://localhost/api/portal/acme/proposals/${PROPOSAL_ID}/ai-review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(makeSession('tenant_admin'));
  getTenantBySlugMock.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
  verifyTenantAccessMock.mockResolvedValue(true);
  emitEventStartMock.mockResolvedValue('evt-start');
  emitEventEndMock.mockResolvedValue(undefined);
  requestAgentTaskMock.mockResolvedValue('task-1');
  sqlMock.mockResolvedValue([]); // fallback for the activity-log insert / anything unqueued
});

describe('manual AI review — POST /api/portal/[t]/proposals/[p]/ai-review', () => {
  it('rejects a tenant_user (403)', async () => {
    authMock.mockResolvedValue(makeSession('tenant_user'));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    expect(requestAgentTaskMock).not.toHaveBeenCalled();
    expect(emitEventStartMock).not.toHaveBeenCalled();
  });

  it('404s when the proposal is not in the tenant', async () => {
    sqlMock.mockResolvedValue([]); // proposal existence check returns empty
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
    expect(requestAgentTaskMock).not.toHaveBeenCalled();
  });

  it('enqueues color_team per section + emits ai_review.requested (source=portal, NOT review_requested)', async () => {
    // call 1 = proposal existence, call 2 = sections; the fallback [] covers the activity insert.
    sqlMock
      .mockResolvedValueOnce([{ id: PROPOSAL_ID }])
      .mockResolvedValueOnce([{ id: SECTION_ID, title: 'Approach', content: '{"nodes":[]}', sectionType: 'narrative' }]);
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.enqueued).toBe(1);

    expect(requestAgentTaskMock).toHaveBeenCalledTimes(1);
    const taskArg = requestAgentTaskMock.mock.calls[0][0];
    expect(taskArg.agentRole).toBe('color_team_reviewer');
    expect(taskArg.taskType).toBe('review_section');
    expect(taskArg.sectionId).toBe(SECTION_ID);
    expect(taskArg.input.section_text).toBe('section body text');
    expect(taskArg.input.requested_by).toBe(USER_ID);

    // ONE ai_review.requested. Asserted by TYPE rather than by call index: the same request also
    // runs the visual pass (lib/proposal-visual-review.ts), which emits its own start/end pair, and
    // an index-based assertion would break the moment a second reviewer joined — which is exactly
    // what happened when one did.
    const aiReviewStarts = emitEventStartMock.mock.calls
      .map((c: unknown[]) => c[0] as { namespace: string; type: string; tenantId: string; payload: { source: string } })
      .filter((a) => a.type === 'ai_review.requested');
    expect(aiReviewStarts).toHaveLength(1);
    const emitArg = aiReviewStarts[0];
    expect(emitArg.namespace).toBe('proposal');
    expect(emitArg.type).not.toBe('review_requested');
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.payload.source).toBe('portal');

    // …and the VISUAL reviewer runs on the same trigger. The AI-review button is the one front door
    // for both kinds of review: the per-section text reviewers above, and the pass that looks at
    // the rendered pages. Every start is paired with an end.
    const visualStarts = emitEventStartMock.mock.calls
      .map((c: unknown[]) => c[0] as { type: string })
      .filter((a) => a.type === 'visual_review.requested');
    expect(visualStarts).toHaveLength(1);
    expect(emitEventEndMock).toHaveBeenCalledTimes(emitEventStartMock.mock.calls.length);
  });
});
