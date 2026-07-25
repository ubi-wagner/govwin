/**
 * One-time onboarding OFFER (P5.3) — nudge a new tenant_admin to add the dogfooded
 * starter template set to their (empty) library (docs/LIBRARY_AND_VAULTS_DESIGN.md §4).
 *
 * Emits `library:starter_set.offered` and creates a single dismissible
 * broadcast/acknowledge ToDo routing the admin to the Library, where the empty-state
 * StarterCatalog (P5.1) does the one-click bulk copy-on-use (P5.2). We OFFER rather
 * than auto-seed so onboarding never deep-copies ~300 grains into a tenant that may
 * not want them — the copy is materialized on the admin's click.
 *
 * Idempotent: skips if an open offer already exists for the tenant. Best-effort —
 * callers MUST treat a throw as non-fatal (onboarding must never fail on this).
 */
import { sql } from '@/lib/db';
import { createTask } from '@/lib/tasks/tasks';
import { emitEventSingle, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

export const STARTER_OFFER_TASK_TYPE = 'starter_set_offer';

export interface StarterOfferResult { offered: boolean; alreadyOffered: boolean; taskId: string | null }

export async function offerStarterSet(opts: {
  tenantId: string;
  tenantSlug: string;
  adminUserId: string; // the new tenant_admin who receives the ToDo
  actor: { id: string; email: string | null; role: Role; tenantId: string | null }; // who is provisioning
}): Promise<StarterOfferResult> {
  const { tenantId, tenantSlug, adminUserId, actor } = opts;

  // Idempotency: at most one open offer per tenant.
  const existing = await sql<Array<{ id: string }>>`
    SELECT id FROM tasks
    WHERE tenant_id = ${tenantId}::uuid AND task_type = ${STARTER_OFFER_TASK_TYPE}
      AND status IN ('open', 'in_progress') LIMIT 1`;
  if (existing.length) return { offered: false, alreadyOffered: true, taskId: existing[0].id };

  // Assign to the tenant_admin ROLE bucket (not pinned to one user id) — the offer
  // belongs to whoever administers the tenant, and role-scoping sidesteps the
  // multi-membership decoupling of users.tenant_id. adminUserId rides in the payload
  // as the onboarding recipient of record.
  const r = await createTask({
    actor,
    tenantId,
    assigneeRole: 'tenant_admin',
    taskType: STARTER_OFFER_TASK_TYPE,
    title: 'Add the proposal starter set to your library',
    description:
      `Your library starts empty. Open the Library (/portal/${tenantSlug}/atoms) and click ` +
      `"Add starter set" to copy in ready-made SBIR/STTR/CSO templates — capability statement, ` +
      `technical & cost volumes, commercialization deck and more. Each becomes your own editable canvas.`,
    params: { kind: 'acknowledge', href: `/portal/${tenantSlug}/atoms` },
    nudgeDays: [7],
  });
  if (!r.ok) return { offered: false, alreadyOffered: false, taskId: null };

  await emitEventSingle({
    namespace: 'library', type: 'starter_set.offered',
    actor: userActor(actor.id, actor.email ?? undefined), tenantId,
    payload: { tenantSlug, adminUserId, taskId: r.data.taskId },
  });

  return { offered: true, alreadyOffered: false, taskId: r.data.taskId };
}
