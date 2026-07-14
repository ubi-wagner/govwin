/**
 * Force-advance a paused (HITL-waiting) process instance — an authorized
 * operator supplies the input the workflow was parked for, marking the gate
 * step complete so the pipeline engine continues from the next step.
 *
 * This is the SHARED core used by:
 *   - the admin route (rfp_admin) at /api/admin/workflows/[instanceId]/advance (now)
 *   - the customer-admin (tenant_admin) portal route (later) — it calls this
 *     same function with the operator's tenant; canForceAdvanceInstance enforces
 *     own-tenant scope, so no logic forks.
 *
 * It mirrors pipeline `WorkflowManager.resume_instance` EXACTLY: mark the parked
 * step 'completed', set status 'retrying'. poll_retrying_instances (source=
 * 'pipeline') then re-drives the instance and execute_instance skips the
 * completed step (manager.py: `step_status.get(step_name) == "completed"`).
 * Keep the two in sync — see pipeline/tests/test_force_advance.py.
 */
import { sql } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';
import { canForceAdvanceInstance, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

export interface ForceAdvanceActor {
  id: string;
  email: string | null;
  role: Role;
  /** The operator's tenant (null for system admins). Drives own-tenant scope. */
  tenantId: string | null;
}

export type ForceAdvanceResult =
  | { ok: true; data: { instanceId: string; resumedStep: string | null } }
  | { ok: false; status: number; error: string; code: string };

export async function forceAdvanceProcess(opts: {
  instanceId: string;
  actor: ForceAdvanceActor;
  note?: string;
}): Promise<ForceAdvanceResult> {
  const { instanceId, actor, note } = opts;

  // ── Load the target instance ───────────────────────────────────────
  let rows: {
    id: string;
    status: string;
    currentStep: string | null;
    stepStatus: Record<string, string> | null;
    stepResults: Record<string, unknown> | null;
    tenantId: string | null;
  }[];
  try {
    rows = await sql<{
      id: string;
      status: string;
      currentStep: string | null;
      stepStatus: Record<string, string> | null;
      stepResults: Record<string, unknown> | null;
      tenantId: string | null;
    }[]>`
      SELECT id, status, current_step, step_status, step_results, tenant_id
      FROM process_instances
      WHERE id = ${instanceId}::uuid
    `;
  } catch (e) {
    console.error('[force-advance] instance query failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
  if (rows.length === 0) {
    return { ok: false, status: 404, error: 'Process instance not found', code: 'NOT_FOUND' };
  }
  const inst = rows[0];

  // ── Authorization (tenant-scoped for tenant_admin) ─────────────────
  if (!canForceAdvanceInstance(actor.role, actor.tenantId, inst.tenantId)) {
    return { ok: false, status: 403, error: 'Not permitted to advance this process', code: 'FORBIDDEN' };
  }

  // ── Only a paused (HITL-waiting) instance can be force-advanced ─────
  if (inst.status !== 'paused') {
    return {
      ok: false,
      status: 409,
      error: `Process is '${inst.status}', not paused — nothing to advance`,
      code: 'NOT_PAUSED',
    };
  }

  const currentStep = inst.currentStep;
  // step_status/step_results are written by the Python pipeline (json.dumps::jsonb)
  // → they read back as STRINGS; spreading a string yields a char-indexed object
  // and permanently corrupts the real step state. Coerce before spread.
  const stepStatus: Record<string, string> = { ...coerceJsonb<Record<string, string>>(inst.stepStatus, {}) };
  const stepResults: Record<string, unknown> = { ...coerceJsonb<Record<string, unknown>>(inst.stepResults, {}) };
  if (currentStep) {
    stepStatus[currentStep] = 'completed';
    stepResults[currentStep] = {
      forced: true,
      forcedBy: actor.email,
      forcedByRole: actor.role,
      note: note ?? null,
      at: new Date().toISOString(),
    };
  }

  // ── Transition paused → retrying (guarded against a lost race) ──────
  let updated: { id: string }[];
  try {
    updated = await sql<{ id: string }[]>`
      UPDATE process_instances
      SET status = 'retrying',
          step_status = ${sql.json(stepStatus)},
          step_results = ${sql.json((stepResults) as Parameters<typeof sql.json>[0])},
          last_heartbeat_at = now(),
          updated_at = now()
      WHERE id = ${instanceId}::uuid AND status = 'paused'
      RETURNING id
    `;
  } catch (e) {
    console.error('[force-advance] instance update failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
  if (updated.length === 0) {
    return { ok: false, status: 409, error: 'Process is no longer paused', code: 'NOT_PAUSED' };
  }

  // ── Reconcile sibling ToDos — part of advancing the process ────────
  // A gate can be assigned to several people (Eric AND Bob). Advancing it marks
  // EVERY still-open task for this instance COMPLETED, attributed to whoever
  // advanced it — the work was done, just by someone else (your scenario). In
  // the task-completion path the actor's own row is already 'completed', so this
  // WHERE skips it and only closes the siblings (Bob's). Mirrors pipeline
  // resume_instance's reconcile so both engines behave identically.
  try {
    await sql`
      UPDATE tasks
      SET status = 'completed',
          completed_by = ${actor.id}::uuid,
          completed_at = now(),
          updated_at = now()
      WHERE process_instance_id = ${instanceId}::uuid
        AND status IN ('open', 'in_progress')
    `;
  } catch (e) {
    console.error('[force-advance] tasks reconcile failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }

  // ── Durable audit: who forced it ───────────────────────────────────
  try {
    await sql`
      INSERT INTO process_instance_transitions
        (instance_id, from_status, to_status, step_name, actor, reason, metadata)
      VALUES (${instanceId}::uuid, 'paused', 'retrying', ${currentStep},
              ${actor.email ?? actor.id}, 'hitl_forced',
              ${sql.json({ forcedByRole: actor.role, forcedById: actor.id, note: note ?? null })})
    `;
  } catch (e) {
    console.error('[force-advance] audit insert failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }

  // ── Observable event — namespace reflects who acted (admin vs customer) ──
  const namespace = hasRoleAtLeast(actor.role, 'rfp_admin') ? 'finder' : 'capture';
  await emitEventSingle({
    namespace,
    type: 'process.force_advanced',
    actor: userActor(actor.id, actor.email ?? undefined),
    tenantId: inst.tenantId,
    payload: { instanceId, step: currentStep, forcedByRole: actor.role },
  });

  return { ok: true, data: { instanceId, resumedStep: currentStep } };
}
