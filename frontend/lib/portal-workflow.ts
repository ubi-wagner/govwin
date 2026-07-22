/**
 * Per-portal workflow (greenfield, mig 097/098). The guardrail template the customer
 * admin accepts at launch is instantiated as that portal's workflow — its stages
 * become HITL ToDo gates in the existing tasks/nudge ledger. Bounded by RFP-admin
 * limits (max 3 stages, 10 collaborators, 1 manager, 3 nudges). Completion is
 * all-or-nothing per stage now (a stage advances only when every ToDo is complete or
 * the manager/admin force-advances); save-progress is a future extension.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { createTask } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';

export interface GuardrailLimits {
  maxStages: number;
  maxCollaborators: number;
  maxManagers: number;
  maxNudges: number;
}
// Managers are a delegated, per-portal role (mig 123) — as many as the admin wants; only
// stages (3) and nudges (3) stay bounded. maxCollaborators tracks maxManagers since a
// manager IS a collaborator (role='manager').
const FALLBACK_LIMITS: GuardrailLimits = { maxStages: 3, maxCollaborators: 25, maxManagers: 25, maxNudges: 3 };

const TODO_TYPES = new Set(['acknowledge', 'complete_sections', 'upload_documents']);
const TODO_KIND: Record<string, 'review' | 'form' | 'upload'> = {
  acknowledge: 'review',
  complete_sections: 'form',
  upload_documents: 'upload',
};

export interface StageTodo {
  type: string;                 // acknowledge | complete_sections | upload_documents
  assigneeRole?: string | null;
  assigneeUserId?: string | null;
  title?: string;
  dueDays?: number;
}
export interface Stage { key: string; label?: string; todos?: StageTodo[]; }
export interface Collaborator { email: string; role: 'manager' | 'collaborator'; stages?: string[]; }
export interface GuardrailConfig {
  stages?: Stage[];
  collaborators?: Collaborator[];
  nudgeDays?: number[];
}

/** Read the RFP-admin-settable limits from the global default template (fallback: 3/25/25/3). */
export async function getGuardrailLimits(): Promise<GuardrailLimits> {
  try {
    const [row] = await sql<Array<{ limits: Partial<GuardrailLimits> | null }>>`
      SELECT config->'limits' AS limits
      FROM guardrail_templates WHERE tenant_id IS NULL AND is_default = true LIMIT 1
    `;
    const l = row?.limits ?? {};
    return {
      maxStages: Number(l.maxStages ?? FALLBACK_LIMITS.maxStages),
      maxCollaborators: Number(l.maxCollaborators ?? FALLBACK_LIMITS.maxCollaborators),
      maxManagers: Number(l.maxManagers ?? FALLBACK_LIMITS.maxManagers),
      maxNudges: Number(l.maxNudges ?? FALLBACK_LIMITS.maxNudges),
    };
  } catch {
    return FALLBACK_LIMITS;
  }
}

/** Validate a customer's guardrail config against the RFP-admin limits. */
export function validateGuardrailConfig(config: GuardrailConfig, limits: GuardrailLimits): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  // Runtime-shape guards: config arrives from JSON (a saved template, a launch body), so a
  // mistyped field (stages: 5, collaborators: {}) must NOT throw an un-iterable error — it must
  // fall through to a validation error. `?? []` alone doesn't catch a non-null non-array.
  const stages = Array.isArray(config.stages) ? config.stages : [];
  const collaborators = Array.isArray(config.collaborators) ? config.collaborators : [];
  const nudgeDays = Array.isArray(config.nudgeDays) ? config.nudgeDays : [];
  if (stages.length < 1) errors.push('at least one stage is required');
  if (stages.length > limits.maxStages) errors.push(`too many stages (max ${limits.maxStages})`);
  if (collaborators.length > limits.maxCollaborators) errors.push(`too many collaborators (max ${limits.maxCollaborators})`);
  const managers = collaborators.filter((c) => c && c.role === 'manager').length;
  if (managers > limits.maxManagers) errors.push(`too many managers (max ${limits.maxManagers})`);
  if (nudgeDays.length > limits.maxNudges) errors.push(`too many nudges (max ${limits.maxNudges})`);
  for (const s of stages) {
    for (const t of (Array.isArray(s?.todos) ? s.todos : [])) {
      if (!TODO_TYPES.has(t.type)) errors.push(`invalid todo type "${t.type}" (allowed: ${[...TODO_TYPES].join(', ')})`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Create the ToDos for a given stage (all-or-nothing gate) into the tasks/nudge ledger. */
async function createStageTodos(
  actor: { id: string; email: string | null; role: Role; tenantId: string },
  tenantId: string,
  portalId: string,
  stage: Stage,
  nudgeDays: number[],
): Promise<number> {
  let n = 0;
  for (const t of stage.todos ?? []) {
    const dueAt = t.dueDays ? new Date(Date.now() + t.dueDays * 86_400_000).toISOString() : null;
    const res = await createTask({
      actor,
      tenantId,
      assigneeRole: t.assigneeUserId ? null : (t.assigneeRole ?? 'tenant_user'),
      assigneeUserId: t.assigneeUserId ?? null,
      taskType: t.type,
      title: t.title ?? `${stage.label ?? stage.key}: ${t.type.replace(/_/g, ' ')}`,
      entityType: 'portal',
      entityId: portalId,
      dueAt,
      nudgeDays,
      params: { kind: TODO_KIND[t.type] ?? 'review', portalId, stage: stage.key },
    });
    if (res.ok) n++;
  }
  return n;
}

/** Instantiate the portal's workflow: reset to stage 0 + create its ToDos. */
export async function instantiatePortalWorkflow(
  actor: { id: string; email: string | null; role: Role; tenantId: string },
  tenantId: string,
  portalId: string,
  config: GuardrailConfig,
): Promise<{ tasksCreated: number }> {
  const limits = await getGuardrailLimits();
  const nudgeDays = (config.nudgeDays ?? []).slice(0, limits.maxNudges);
  await withTenant(tenantId, async (tx) => {
    await tx`UPDATE proposal_portals SET current_stage_index = 0 WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
  });
  const first = config.stages?.[0];
  const tasksCreated = first ? await createStageTodos(actor, tenantId, portalId, first, nudgeDays) : 0;
  return { tasksCreated };
}

/** Advance the portal to the next stage — all-or-nothing (every stage ToDo complete) unless force. */
export async function advancePortalStage(
  actor: { id: string; email: string | null; role: Role; tenantId: string },
  tenantId: string,
  portalId: string,
  opts: { force?: boolean } = {},
): Promise<{ advanced: boolean; reason?: string; stageIndex?: number; status?: string }> {
  const portal = await withTenant(tenantId, async (tx) => {
    const [p] = await tx<Array<{ currentStageIndex: number; guardrailConfig: GuardrailConfig; status: string }>>`
      SELECT current_stage_index, guardrail_config, status
      FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1
    `;
    return p ?? null;
  });
  if (!portal) return { advanced: false, reason: 'not_found' };
  const stages = portal.guardrailConfig?.stages ?? [];
  const curKey = stages[portal.currentStageIndex]?.key ?? null;

  // All-or-nothing gate: block unless every ToDo for this stage is complete (or force).
  if (!opts.force && curKey) {
    const [{ open }] = await sql<Array<{ open: number }>>`
      SELECT count(*)::int AS open FROM tasks
      WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'portal' AND entity_id = ${portalId}::uuid
        AND params->>'stage' = ${curKey} AND status NOT IN ('completed', 'cancelled')
    `;
    if (open > 0) return { advanced: false, reason: 'incomplete_todos' };
  }

  const nextIndex = portal.currentStageIndex + 1;
  const limits = await getGuardrailLimits();
  const nudgeDays = (portal.guardrailConfig?.nudgeDays ?? []).slice(0, limits.maxNudges);

  if (nextIndex >= stages.length) {
    await withTenant(tenantId, async (tx) => {
      await tx`UPDATE proposal_portals SET status = 'closeout', current_stage_index = ${nextIndex} WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
    });
    return { advanced: true, stageIndex: nextIndex, status: 'closeout' };
  }

  await withTenant(tenantId, async (tx) => {
    await tx`UPDATE proposal_portals SET status = 'executing', current_stage_index = ${nextIndex} WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
  });
  await createStageTodos(actor, tenantId, portalId, stages[nextIndex], nudgeDays);
  return { advanced: true, stageIndex: nextIndex, status: 'executing' };
}
