/**
 * Archive lifecycle (V1-11) — restore, retention policy, and an FK-safe permanent delete.
 *
 * Archived proposals stay retrievable (they list under an "Archived" section) and RESTORABLE. A
 * guarded permanent delete removes an archived proposal for good — but does so FK-safely: it UNLINKS
 * the financial/audit rows that reference the proposal with NO ACTION (agent_task_log billing,
 * purchases, contracts, proposal_portals — all nullable) so that history is preserved, deletes the
 * transient rows (agent_task_queue, library_seed_jobs), then deletes the proposal (cascade handles
 * sections/comments/etc.). Retention: an archived proposal becomes purge-eligible after RETENTION_DAYS;
 * purgeExpiredArchived is the cron-ready sweep (opt-in ops procedure, not auto-wired for V1).
 *
 * Audit: proposal:proposal.restored / proposal.deleted / proposal.purged (start/end or single).
 */
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor, systemActor, type EventActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

/** Days an archived proposal is retained before it becomes purge-eligible. Documented policy. */
export const RETENTION_DAYS = 180;

interface Actor {
  actorId: string;
  actorEmail: string | null;
  role: Role;
}

/** Restore an archived proposal back to 'submitted' (compare-and-swap on stage='archived'). */
export async function restoreProposal(p: Actor & { proposalId: string; tenantId: string }): Promise<{ restored: boolean }> {
  const rows = await sql<{ id: string }[]>`
    UPDATE proposals
    SET stage = 'submitted', archived_at = NULL, version = version + 1, updated_at = now()
    WHERE id = ${p.proposalId}::uuid AND tenant_id = ${p.tenantId}::uuid AND stage = 'archived'
    RETURNING id
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
 * Permanently delete an archived proposal, FK-safely. Preserves financial/audit history by unlinking
 * (not deleting) the NO ACTION references. Only archived proposals are deletable.
 * `eventType` distinguishes an admin delete from a retention purge for the audit trail.
 */
async function deleteArchivedProposal(
  proposalId: string,
  tenantId: string,
  actor: EventActor,
  eventType: 'proposal.deleted' | 'proposal.purged',
  extraPayload: Record<string, unknown> = {},
): Promise<boolean> {
  const [row] = await sql<{ title: string; stage: string }[]>`
    SELECT title, stage FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
  `;
  if (!row || row.stage !== 'archived') return false;

  // Audit BEFORE the delete (the row disappears).
  await emitEventSingle({
    namespace: 'proposal',
    type: eventType,
    actor,
    tenantId,
    payload: { proposalId, title: row.title, ...extraPayload },
  });

  let deleted = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- postgres.js TransactionSql tagged-template typing (matches lib/rls withTenant)
  await sql.begin(async (tx: any) => {
    // Preserve financial/audit history — unlink, don't destroy.
    await tx`UPDATE agent_task_log SET proposal_id = NULL WHERE proposal_id = ${proposalId}::uuid`;
    await tx`UPDATE purchases SET proposal_id = NULL WHERE proposal_id = ${proposalId}::uuid`;
    await tx`UPDATE contracts SET proposal_id = NULL WHERE proposal_id = ${proposalId}::uuid`;
    await tx`UPDATE proposal_portals SET proposal_id = NULL WHERE proposal_id = ${proposalId}::uuid`;
    // Transient — safe to remove.
    await tx`DELETE FROM agent_task_queue WHERE proposal_id = ${proposalId}::uuid`;
    await tx`DELETE FROM library_seed_jobs WHERE proposal_id = ${proposalId}::uuid`;
    // The proposal itself — cascades sections/comments/collaborators/matrix/history/etc.
    const del = await tx`DELETE FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid AND stage = 'archived'`;
    deleted = del.count > 0;
  });
  return deleted;
}

/** Guarded permanent delete of one archived proposal (admin action). */
export async function hardDeleteProposal(p: Actor & { proposalId: string; tenantId: string }): Promise<{ deleted: boolean }> {
  const deleted = await deleteArchivedProposal(
    p.proposalId,
    p.tenantId,
    userActor(p.actorId, p.actorEmail ?? undefined),
    'proposal.deleted',
  );
  return { deleted };
}

/**
 * Retention sweep — permanently delete proposals archived beyond the window. Cron-ready; returns the
 * purged count. NOT auto-wired for V1 (opt-in ops procedure). Attributed to a system actor.
 */
export async function purgeExpiredArchived(p: { windowDays?: number } = {}): Promise<{ purged: number }> {
  const windowDays = p.windowDays ?? RETENTION_DAYS;
  const expired = await sql<{ id: string; tenantId: string }[]>`
    SELECT id, tenant_id AS "tenantId" FROM proposals
    WHERE stage = 'archived' AND archived_at IS NOT NULL
      AND archived_at < now() - (${windowDays} || ' days')::interval
  `;
  let purged = 0;
  const sys = systemActor('retention-sweep');
  for (const row of expired) {
    const ok = await deleteArchivedProposal(row.id, row.tenantId, sys, 'proposal.purged', { windowDays });
    if (ok) purged++;
  }
  return { purged };
}
