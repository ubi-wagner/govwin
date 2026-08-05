/**
 * Submission-package review — the canonical path for an admin-triggered packaging_specialist pass.
 *
 * Enqueues one proposal-level packaging_specialist task (the agent compiles the manifest: volume
 * completeness, required forms/attachments, page/format compliance, submission instructions). The
 * agent's own tools (get_sections / get_compliance) fetch what it needs, so the queued input is
 * minimal. Advisory — the agent NEVER marks the proposal submitted or auto-submits to any portal.
 *
 * Audit: emits `proposal:package_review.requested` (start/end). The type is not one the fabric
 * dispatches (packaging_specialist reacts to proposal.stage.advanced), so this manual enqueue is the
 * only invocation — no double-fire.
 */
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';
import type { Role } from '@/lib/rbac';

export type PackageReviewSource = 'portal' | 'admin_doorbell';

export interface RequestPackageReviewParams {
  proposalId: string;
  tenantId: string;
  actorId: string;
  actorEmail: string | null;
  role: Role;
  source: PackageReviewSource;
}

export interface RequestPackageReviewResult {
  enqueued: boolean;
}

export async function requestPackageReview(p: RequestPackageReviewParams): Promise<RequestPackageReviewResult> {
  const taskId = await requestAgentTask({
    tenantId: p.tenantId,
    agentRole: 'packaging_specialist',
    taskType: 'package_review',
    proposalId: p.proposalId,
    input: {
      proposal_id: p.proposalId,
      requested_by: p.actorId,
      requestedBy: p.actorId,
    },
  });
  const enqueued = !!taskId;

  const payload = {
    proposalId: p.proposalId,
    proposal_id: p.proposalId,
    tenant_id: p.tenantId,
    enqueued,
    source: p.source,
  };
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'package_review.requested',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload,
  });
  await emitEventEnd(startId, { result: payload });

  return { enqueued };
}
