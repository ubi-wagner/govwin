/**
 * launchProjectCollaboration — the CANONICAL way to start a project/opportunity
 * HITL reaction from the frontend. New project automation calls THIS, not a
 * bespoke flow: it builds a complete, guarded overlay for the generic
 * `ProjectCollaboration` pipeline template (pipeline/src/workflows/
 * project_collaboration.py) and launches it via the existing launchTemplate
 * engine path (emit the single-phase trigger event with the overlay frozen as
 * the instance payload; the pipeline parks a `tasks` gate and nudges it).
 *
 * Why a helper and not a raw launchTemplate call at each site: the generic
 * template resolves every gate field from the overlay, and a MISSING required
 * field (taskType/assigneeRole) silently degrades to a corrupt task. This helper
 * makes those fields REQUIRED in the type system and guards them at runtime, so
 * a bridge can never launch an unassigned/mis-typed gate. It also stamps the
 * spine keys (opportunityId + scope) the control tower rolls up by.
 *
 * Bridges that call this today: the proposal create route (scope='project', the
 * 72h admin-review gate) and the Stripe webhook on an opportunity purchase
 * (scope='opp', the workspace-setup gate) — closing the purchase.completed orphan.
 */
import { launchTemplate, type LaunchActor, type LaunchResult } from '@/lib/process/launch-template';
import { isValidUUID } from '@/lib/validation';

export type SpineScope = 'opp' | 'spotlight' | 'project' | 'contract';

export interface ProjectCollaborationLaunch {
  /** Who launched it. For a system bridge (webhook) set actorType:'system'. */
  actor: LaunchActor;
  actorType?: 'user' | 'system';
  /** Owning tenant (null for an admin/platform gate). */
  tenantId: string | null;
  /** Spine discriminator — written to process_instances.scope. */
  scope: SpineScope;
  /** The immutable spine key — written to process_instances.opportunity_id. */
  opportunityId: string;
  /** The project, when project-scoped (the gate's stage context). */
  proposalId?: string | null;
  /** The project stage this gate sits at (context only; never written back). */
  stage?: string | null;

  // ── the gate (all REQUIRED-by-type so a launch can't write a corrupt task) ──
  taskType: string;
  taskTitle: string;
  assigneeRole: string;
  assigneeUser?: string | null;
  entityType: string;
  entityRef: string;
  nudgeDays?: number[];
  /** Task due window (drives urgency + nudges). Default 72h. */
  dueMinutes?: number;
  /** Instance park ceiling (abandon backstop). Omit ⇒ the template's 30-day default. */
  parkMinutes?: number;
  /** Email template on completion; omit ⇒ no email (degrades cleanly). */
  completeTemplate?: string | null;
}

const WORKFLOW = 'ProjectCollaboration';

export async function launchProjectCollaboration(
  opts: ProjectCollaborationLaunch,
): Promise<LaunchResult> {
  // Runtime guard: the generic template can't enforce required overlay fields
  // (a missing one degrades to a corrupt task: mis-typed, unassigned, or pointing
  // at nothing), so refuse an incomplete launch — matching this helper's promise
  // that a bridge "can never launch a corrupt gate". Covers every consumed field.
  const missing: string[] = [];
  if (!opts.taskType?.trim()) missing.push('taskType');
  if (!opts.taskTitle?.trim()) missing.push('taskTitle');
  if (!opts.assigneeRole?.trim()) missing.push('assigneeRole');
  if (!opts.entityType?.trim()) missing.push('entityType');
  if (!opts.entityRef?.trim()) missing.push('entityRef');
  if (!opts.opportunityId?.trim()) missing.push('opportunityId');
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `ProjectCollaboration launch missing required field(s): ${missing.join(', ')}`,
      code: 'INCOMPLETE_OVERLAY',
    };
  }

  // UUID-format guard: entityRef becomes the task's entity_id and opportunityId
  // the spine roll-up key — both go through the pipeline's _safe_uuid, which nulls
  // a non-UUID. A presence-only check would let an operator-influenceable value
  // (e.g. raw Stripe metadata) pass, then SILENTLY null the entity + scope key —
  // a task pointing at nothing and an unscoped instance (re-creating the orphan
  // this bridge exists to close). Refuse loudly instead.
  const malformed: string[] = [];
  if (!isValidUUID(opts.entityRef)) malformed.push('entityRef');
  if (!isValidUUID(opts.opportunityId)) malformed.push('opportunityId');
  if (opts.assigneeUser && !isValidUUID(opts.assigneeUser)) malformed.push('assigneeUser');
  if (malformed.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `ProjectCollaboration launch has non-UUID field(s): ${malformed.join(', ')}`,
      code: 'INVALID_OVERLAY',
    };
  }

  // Build the overlay — omit undefined keys so the template's resolve_input sees
  // a clean payload (and parkMinutes/completeTemplate fall back to their defaults).
  const overlay: Record<string, unknown> = {
    scope: opts.scope,
    opportunityId: opts.opportunityId,
    taskType: opts.taskType,
    taskTitle: opts.taskTitle,
    assigneeRole: opts.assigneeRole,
    entityType: opts.entityType,
    entityRef: opts.entityRef,
    // Days-BEFORE-due: [2,1] (48h + 24h out). A value ≥ the full due window (e.g. 3 on a 72h
    // gate) makes the first nudge threshold equal the creation instant — an immediate nudge.
    nudgeDays: opts.nudgeDays ?? [2, 1],
    dueMinutes: opts.dueMinutes ?? 4320, // 72h
  };
  if (opts.proposalId) overlay.proposalId = opts.proposalId;
  if (opts.stage) overlay.stage = opts.stage;
  if (opts.assigneeUser) overlay.assigneeUser = opts.assigneeUser;
  if (opts.parkMinutes != null) overlay.parkMinutes = opts.parkMinutes;
  if (opts.completeTemplate) overlay.completeTemplate = opts.completeTemplate;

  return launchTemplate({
    workflowName: WORKFLOW,
    overlay,
    actor: opts.actor,
    actorType: opts.actorType ?? 'user',
    tenantId: opts.tenantId,
  });
}
