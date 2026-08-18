/**
 * Portal (pipeline) archive lifecycle — archive / restore, with workflow cascade.
 *
 * Archiving a whole portal (proposal) is a SOFT, reversible visibility state for sorting/visibility:
 * the proposal drops out of active views but the row stays in indexed Postgres, and its instantiated
 * workflow instances (`process_instances` for the same tenant+opportunity) archive WITH it — workflows
 * are instantiated templates, they have no archive of their own. Restore un-archives both.
 *
 * Nothing is ever hard-deleted here. When indexed Postgres gets large, archived rows are bulk-moved to
 * S3 cold storage (pointed to as needed) by a future sweep — RETENTION_DAYS is the watermark it reads.
 *
 * Audit: proposal:proposal.archived / proposal.restored (start/end), tenant-scoped.
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

/** Days an archived portal is retained in indexed Postgres before it is cold-storage eligible. */
export const RETENTION_DAYS = 180;

interface Actor {
  actorId: string;
  actorEmail: string | null;
  role: Role;
}

/**
 * Archive a whole portal/pipeline: soft-archive the proposal and cascade its workflow instances
 * (same tenant + opportunity). Compare-and-swap on not-already-archived. Nothing is deleted.
 */
export async function archiveProposal(
  p: Actor & { proposalId: string; tenantId: string },
): Promise<{ archived: boolean; workflowsArchived: number }> {
  const [row] = await sql<{ opportunityId: string | null; stage: string }[]>`
    SELECT opportunity_id AS "opportunityId", stage FROM proposals
    WHERE id = ${p.proposalId}::uuid AND tenant_id = ${p.tenantId}::uuid LIMIT 1
  `;
  if (!row || row.stage === 'archived') return { archived: false, workflowsArchived: 0 };

  const upd = await sql<{ id: string }[]>`
    UPDATE proposals
    SET stage = 'archived', archived_at = now(), version = version + 1, updated_at = now()
    WHERE id = ${p.proposalId}::uuid AND tenant_id = ${p.tenantId}::uuid AND stage <> 'archived'
    RETURNING id
  `;
  if (upd.length === 0) return { archived: false, workflowsArchived: 0 };

  try {
    await sql`
      INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
      VALUES (${p.proposalId}::uuid, ${row.stage}, 'archived', ${p.actorId}::uuid, 'Portal archived')
    `;
  } catch (e) {
    console.error('[archiveProposal] stage history failed', e);
  }

  // Cascade: the pipeline's instantiated workflows archive with the portal.
  let workflowsArchived = 0;
  if (row.opportunityId) {
    try {
      // Scope to the BUILD workflows only. A tenant can have a co-active discovery ('spotlight') or
      // post-award ('contract') workflow on the SAME opportunity spine (master-mirror, two releases) —
      // archiving a portal must not flip those. NULL scope = legacy build instance, included.
      const wf = await sql<{ id: string }[]>`
        UPDATE process_instances SET archived_at = now()
        WHERE tenant_id = ${p.tenantId}::uuid AND opportunity_id = ${row.opportunityId}::uuid AND archived_at IS NULL
          AND (scope IS NULL OR scope NOT IN ('spotlight', 'contract'))
        RETURNING id
      `;
      workflowsArchived = wf.length;
    } catch (e) {
      console.error('[archiveProposal] workflow cascade failed', e);
    }
  }

  const payload = { proposalId: p.proposalId, tenant_id: p.tenantId, workflowsArchived };
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'proposal.archived',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload,
  });
  await emitEventEnd(startId, { result: payload });
  return { archived: true, workflowsArchived };
}

/**
 * Restore an archived portal back to 'submitted' and un-archive its cascaded workflow instances.
 * Compare-and-swap on stage='archived'.
 */
export async function restoreProposal(
  p: Actor & { proposalId: string; tenantId: string },
): Promise<{ restored: boolean }> {
  const rows = await sql<{ opportunityId: string | null }[]>`
    UPDATE proposals
    SET stage = 'submitted', archived_at = NULL, version = version + 1, updated_at = now()
    WHERE id = ${p.proposalId}::uuid AND tenant_id = ${p.tenantId}::uuid AND stage = 'archived'
    RETURNING opportunity_id AS "opportunityId"
  `;
  if (rows.length === 0) return { restored: false };

  try {
    await sql`
      INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
      VALUES (${p.proposalId}::uuid, 'archived', 'submitted', ${p.actorId}::uuid, 'Restored from archive')
    `;
  } catch (e) {
    console.error('[restoreProposal] stage history failed', e);
  }

  // Cascade the restore to the pipeline's workflows.
  if (rows[0].opportunityId) {
    try {
      await sql`
        UPDATE process_instances SET archived_at = NULL
        WHERE tenant_id = ${p.tenantId}::uuid AND opportunity_id = ${rows[0].opportunityId}::uuid AND archived_at IS NOT NULL
          AND (scope IS NULL OR scope NOT IN ('spotlight', 'contract'))
      `;
    } catch (e) {
      console.error('[restoreProposal] workflow restore cascade failed', e);
    }
  }

  const payload = { proposalId: p.proposalId, tenant_id: p.tenantId };
  const startId = await emitEventStart({
    namespace: 'proposal',
    type: 'proposal.restored',
    actor: userActor(p.actorId, p.actorEmail ?? undefined),
    tenantId: p.tenantId,
    payload,
  });
  await emitEventEnd(startId, { result: payload });
  return { restored: true };
}

/**
 * HARD-delete one proposal and its full dependency fan-out — the ONLY sanctioned hard-delete
 * path, reserved for (a) the future cold-storage retention sweep and (b) seed/dress-rehearsal
 * teardown. The archive contract stands: product flows soft-archive, never call this. The FK
 * graph lives HERE so callers stop hand-ordering DELETEs that break every time the
 * provision fan-out grows (agent results/queue/log → ToDos → seed jobs → supporting docs →
 * matrix → sections (canvas_versions cascade) → artifacts → proposal).
 * Audit: proposal:proposal.hard_deleted single (reason carried in the payload).
 */
export async function hardDeleteProposalCascade(
  proposalId: string,
  opts: { reason: 'retention_sweep' | 'seed_rehearsal'; tenantId?: string | null; actorId?: string | null; actorEmail?: string | null },
): Promise<{ deleted: boolean }> {
  await sql`DELETE FROM agent_task_results WHERE task_id IN (SELECT id FROM agent_task_queue WHERE proposal_id = ${proposalId}::uuid)`;
  await sql`DELETE FROM agent_task_queue WHERE proposal_id = ${proposalId}::uuid`;
  await sql`DELETE FROM agent_task_log WHERE proposal_id = ${proposalId}::uuid`;
  await sql`DELETE FROM tasks WHERE entity_type = 'proposal' AND entity_id = ${proposalId}::uuid`;
  await sql`DELETE FROM library_seed_jobs WHERE proposal_id = ${proposalId}::uuid`;
  await sql`DELETE FROM proposal_supporting_docs WHERE proposal_id = ${proposalId}::uuid`;
  await sql`DELETE FROM proposal_compliance_matrix WHERE proposal_id = ${proposalId}::uuid`;
  await sql`DELETE FROM proposal_sections WHERE proposal_id = ${proposalId}::uuid`;
  await sql`DELETE FROM proposal_artifacts WHERE proposal_id = ${proposalId}::uuid`;
  const rows = await sql<{ id: string }[]>`DELETE FROM proposals WHERE id = ${proposalId}::uuid RETURNING id`;
  const deleted = rows.length > 0;
  if (deleted) {
    try {
      const { emitEventSingle } = await import('@/lib/events');
      await emitEventSingle({
        namespace: 'proposal', type: 'proposal.hard_deleted',
        actor: userActor(opts.actorId ?? '00000000-0000-4000-8000-000000000000', opts.actorEmail ?? undefined),
        tenantId: opts.tenantId ?? null,
        payload: { proposalId, reason: opts.reason },
      });
    } catch (e) { console.error('[hardDeleteProposalCascade] audit emit failed (non-fatal)', e); }
  }
  return { deleted };
}
