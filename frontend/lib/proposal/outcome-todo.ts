/**
 * Post-submission outcome-nudge ToDo (#13).
 *
 * When a proposal is SUBMITTED, the tenant should eventually record whether it was
 * awarded / rejected / withdrawn — that outcome drives the library learning loop
 * (winning atoms surface first in future drafts) and, on a win, seeds the contract
 * kickoff. But nothing ever prompted them to come back and record it, so the loop
 * mostly never closed. This raises a `record_outcome` ToDo for the tenant_admin,
 * deep-linked to the proposal, that AUTO-COMPLETES when the outcome route records a
 * result. Advisory + best-effort — it never blocks the submission or the outcome.
 *
 * Mirrors the section-editing ToDo spine (lib/proposal/section-todo.ts): a `createTask`
 * producer + a direct-ledger completer, both RLS-faithful via runInTenant.
 */
import { sql } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { createTask } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

type Actor = { id: string; email: string | null; role: Role; tenantId: string | null };

// A gentle multi-week cadence — federal decisions land one to four months out, so
// nudge monthly across a quarter (the last day also derives the ToDo's due_at, which
// is what the pipeline nudge sweep and the queue's urgency sort key off).
const OUTCOME_NUDGE_DAYS = [30, 60, 90];

/**
 * Raise the record-outcome nudge for a just-submitted proposal. Idempotent: skips
 * (returns the existing id) if an open one already exists, so a re-lock/re-submit
 * never stacks duplicates. Best-effort — a failure is logged, never thrown.
 */
export async function createOutcomeNudge(
  actor: Actor,
  tenantId: string,
  proposalId: string,
  proposalTitle: string,
): Promise<{ created: boolean; taskId?: string }> {
  try {
    return await runInTenant(tenantId, async () => {
      const existing = await sql<Array<{ id: string }>>`
        SELECT id FROM tasks
        WHERE tenant_id = ${tenantId}::uuid AND task_type = 'record_outcome'
          AND entity_type = 'proposal' AND entity_id = ${proposalId}::uuid
          AND status IN ('open', 'in_progress')
        LIMIT 1`;
      if (existing.length > 0) return { created: false, taskId: existing[0].id };

      const res = await createTask({
        actor,
        tenantId,
        assigneeRole: 'tenant_admin', // only tenant_admin+ can POST the outcome route
        taskType: 'record_outcome',
        title: `Record the outcome: ${proposalTitle}`,
        description:
          'When you hear back on this submission, record whether it was awarded, rejected, or withdrawn. A win seeds your contract kickoff and elevates the winning content in your library.',
        entityType: 'proposal',
        entityId: proposalId,
        nudgeDays: OUTCOME_NUDGE_DAYS,
        // kind:'review' renders the deep-link ("Open →" → the proposal overview, where the
        // outcome control lives) plus a "Done" completion in the queue.
        params: { kind: 'review', proposalId },
      });
      if (!res.ok) {
        console.error('[createOutcomeNudge] createTask refused:', res.code, res.error);
        return { created: false };
      }
      return { created: true, taskId: res.data?.taskId };
    });
  } catch (e) {
    console.error('[createOutcomeNudge] failed (non-fatal)', e);
    return { created: false };
  }
}

/**
 * Auto-close the record-outcome ToDo(s) for a proposal because the outcome was just
 * recorded (the outcome route is the completion signal, not a human ticking their own
 * item). Writes the ledger directly (RLS-scoped). Best-effort — never blocks the
 * outcome. Returns the number of ToDos closed.
 */
export async function completeOutcomeTodos(
  tenantId: string,
  proposalId: string,
  actorId: string,
  outcome: string,
): Promise<number> {
  try {
    return await runInTenant(tenantId, async () => {
      const rows = await sql<Array<{ id: string }>>`
        UPDATE tasks SET status = 'completed', completed_at = now(),
          result = ${jsonParam({ approved: true, auto: true, reason: 'outcome_recorded', outcome, by: actorId })}
        WHERE tenant_id = ${tenantId}::uuid AND task_type = 'record_outcome'
          AND entity_type = 'proposal' AND entity_id = ${proposalId}::uuid
          AND status IN ('open', 'in_progress')
        RETURNING id`;
      return rows.length;
    });
  } catch (e) {
    console.error('[completeOutcomeTodos] failed (non-fatal)', e);
    return 0;
  }
}
