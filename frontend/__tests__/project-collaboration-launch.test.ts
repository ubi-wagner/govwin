/**
 * R3.3 — launchProjectCollaboration, the canonical project-reaction entry point.
 *
 * Guards that bridges build a COMPLETE, correct overlay for the generic
 * ProjectCollaboration template and that an incomplete launch is refused before
 * it can write a corrupt (unassigned / mis-typed) task.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { launchTemplateMock } = vi.hoisted(() => ({ launchTemplateMock: vi.fn() }));
vi.mock('@/lib/process/launch-template', () => ({ launchTemplate: launchTemplateMock }));

import { launchProjectCollaboration } from '@/lib/process/project-collaboration';

const OPP_ID = '11111111-1111-4111-8111-111111111111';
const PROP_ID = '22222222-2222-4222-8222-222222222222';
const base = {
  actor: { id: 'u1', email: 'a@b.com', role: 'tenant_admin' as const, tenantId: 't1' },
  tenantId: 't1',
  scope: 'project' as const,
  opportunityId: OPP_ID,
  taskType: 'admin_review',
  taskTitle: 'Review & unlock',
  assigneeRole: 'rfp_admin',
  entityType: 'proposal',
  entityRef: PROP_ID,
};

describe('launchProjectCollaboration', () => {
  beforeEach(() => {
    launchTemplateMock.mockReset();
    launchTemplateMock.mockResolvedValue({ ok: true, data: { eventId: 'e1', workflowName: 'ProjectCollaboration', trigger: 'proposal:project.collaboration_requested:single' } });
  });

  it('launches the ProjectCollaboration template with a complete overlay + defaults', async () => {
    await launchProjectCollaboration({ ...base, proposalId: PROP_ID, stage: 'draft', completeTemplate: 'proposal_unlocked' });
    expect(launchTemplateMock).toHaveBeenCalledTimes(1);
    const call = launchTemplateMock.mock.calls[0][0];
    expect(call.workflowName).toBe('ProjectCollaboration');
    expect(call.actorType).toBe('user');
    expect(call.tenantId).toBe('t1');
    expect(call.overlay).toMatchObject({
      scope: 'project',
      opportunityId: OPP_ID,
      proposalId: PROP_ID,
      stage: 'draft',
      taskType: 'admin_review',
      assigneeRole: 'rfp_admin',
      entityType: 'proposal',
      entityRef: PROP_ID,
      nudgeDays: [1, 3],   // default
      dueMinutes: 4320,    // default 72h
      completeTemplate: 'proposal_unlocked',
    });
  });

  it('passes through a system actorType for a webhook bridge', async () => {
    await launchProjectCollaboration({ ...base, actor: { id: 'stripe-webhook', email: null, tenantId: 't1' }, actorType: 'system' });
    expect(launchTemplateMock.mock.calls[0][0].actorType).toBe('system');
  });

  it('omits optional overlay keys when not provided', async () => {
    await launchProjectCollaboration(base);
    const overlay = launchTemplateMock.mock.calls[0][0].overlay;
    expect('proposalId' in overlay).toBe(false);
    expect('stage' in overlay).toBe(false);
    expect('parkMinutes' in overlay).toBe(false);
    expect('completeTemplate' in overlay).toBe(false);
  });

  it.each(['taskType', 'taskTitle', 'assigneeRole', 'entityType', 'entityRef', 'opportunityId'])(
    'refuses an incomplete launch (missing %s) WITHOUT emitting',
    async (field) => {
      const bad = { ...base, [field]: '' };
      const res = await launchProjectCollaboration(bad as typeof base);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('INCOMPLETE_OVERLAY');
      expect(launchTemplateMock).not.toHaveBeenCalled();
    },
  );

  it.each(['entityRef', 'opportunityId'])(
    'refuses a non-UUID %s WITHOUT emitting (silent-null orphan guard)',
    async (field) => {
      // a present-but-malformed value (e.g. raw Stripe metadata) passes presence
      // but would be _safe_uuid'd to NULL downstream — refuse loudly instead
      const bad = { ...base, [field]: 'not-a-uuid' };
      const res = await launchProjectCollaboration(bad as typeof base);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('INVALID_OVERLAY');
      expect(launchTemplateMock).not.toHaveBeenCalled();
    },
  );
});
