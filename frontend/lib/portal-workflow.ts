/**
 * Per-portal workflow (greenfield, mig 097/098). The guardrail template the customer
 * admin accepts at launch is instantiated as that portal's workflow — its stages
 * become HITL ToDo gates in the existing tasks/nudge ledger. Bounded by RFP-admin
 * limits (max 3 stages, 25 collaborators, 25 managers, 3 nudges — mig 123). Completion is
 * all-or-nothing per stage (a stage advances only when every ToDo is complete or the
 * manager/admin force-advances).
 *
 * Tenant Workflow Setup (docs/TENANT_WORKFLOW_SETUP_DESIGN.md) extends the config with
 * ABSOLUTE stage-gate dates, a per-stage GATE CLOSER (human | agent_manager), a per-stage
 * default owner, and per-todo date/nudge overrides — all in the open JSONB (no migration).
 * `projectTodoTiming` is the single place a todo's live `due_at`/`nudge_schedule` are derived
 * (absolute date wins over relative days), so the phase-machine + the nudge sweeper stay the
 * source of truth on the task rows.
 */

import { sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { runInTenant } from '@/lib/tenant-context';
import { createTask } from '@/lib/tasks/tasks';
import { emitEventSingle, emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

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

/** Who closes a stage's gate. 'human' = advance when the stage's ToDos are all done (or force);
 *  'agent_manager' = an agent manager (e.g. advisory_manager / color_team_reviewer) lands its cohort +
 *  the adversarial pass, then the stage is gate-ready (TW-8 wires the auto-advance). */
export type GateCloser = 'human' | 'agent_manager';
export const GATE_CLOSERS: ReadonlySet<string> = new Set<GateCloser>(['human', 'agent_manager']);

export interface StageTodo {
  type: string;                 // acknowledge | complete_sections | upload_documents
  assigneeRole?: string | null;
  assigneeUserId?: string | null;
  title?: string;
  dueDays?: number | null;      // relative fallback (days from creation) when there's no absolute date
  dueDate?: string | null;      // NEW — absolute ISO override of the stage date, per todo
  nudgeDays?: number[];         // NEW — per-todo nudge override; default = the portal-wide config.nudgeDays
}
export interface Stage {
  key: string;
  label?: string;
  todos?: StageTodo[];
  dueDate?: string | null;                 // NEW — absolute ISO stage-gate deadline (nudges + overdue, NOT advancement)
  defaultAssigneeUserId?: string | null;   // NEW — a new/unassigned ToDo in this stage inherits this owner
  gateCloser?: GateCloser;                 // NEW — 'human' (default) | 'agent_manager'
  agentManagerKey?: string | null;         // NEW — which manager archetype when gateCloser='agent_manager'
  autoAdvance?: boolean;                    // NEW — agent_manager only: auto (guarded, TW-8) vs assisted (one-click)
}
export interface Collaborator { email: string; role: 'manager' | 'collaborator'; stages?: string[]; }
/** Setup-acceptance marker — rides in the open JSONB (no migration). A new portal opens 'pending'
 *  (recommend-but-require); "Accept & Start" flips it to 'accepted'. */
export interface GuardrailSetup { status: 'pending' | 'accepted'; acceptedAt?: string; acceptedBy?: string | null }
export interface GuardrailConfig {
  stages?: Stage[];
  collaborators?: Collaborator[];
  nudgeDays?: number[];
  _setup?: GuardrailSetup;
}

/**
 * Derive a todo's LIVE timing (what lands on the task row + what the nudge sweeper reads).
 * Absolute date wins: todo.dueDate → stage.dueDate → (relative) todo.dueDays from now. Nudge
 * schedule: todo.nudgeDays → the portal-wide config.nudgeDays. One place, so the editor gauge,
 * instantiation, and re-projection can never disagree.
 */
export function projectTodoTiming(
  stage: Stage, todo: StageTodo, config: GuardrailConfig,
): { dueAt: string | null; nudgeDays: number[] } {
  const abs = todo.dueDate ?? stage.dueDate ?? null;
  let dueAt: string | null = null;
  if (abs) {
    const d = new Date(abs);
    if (!Number.isNaN(d.getTime())) dueAt = d.toISOString();
  } else if (typeof todo.dueDays === 'number' && todo.dueDays > 0) {
    dueAt = new Date(Date.now() + todo.dueDays * 86_400_000).toISOString();
  }
  const nudgeDays = Array.isArray(todo.nudgeDays)
    ? todo.nudgeDays
    : (Array.isArray(config.nudgeDays) ? config.nudgeDays : []);
  return { dueAt, nudgeDays };
}

/** The stage's chosen owner for a todo: a specific person wins (todo → stage default), else the role. */
export function resolveTodoAssignee(stage: Stage, todo: StageTodo): { assigneeRole: string | null; assigneeUserId: string | null } {
  const assigneeUserId = todo.assigneeUserId ?? stage.defaultAssigneeUserId ?? null;
  return { assigneeUserId, assigneeRole: assigneeUserId ? null : (todo.assigneeRole ?? 'tenant_user') };
}

/**
 * Rebaseline the whole timeline (TW-5): shift every stage/todo absolute date by `shiftDays`, OR move the
 * timeline so the LAST dated stage (the submission deadline) lands on `anchorLastStageTo` — preserving the
 * intervals between stages. Pure; the caller re-projects via editPortalWorkflow(save). The "set deadline
 * from the solicitation" action passes the opportunity's close_date as the anchor.
 */
export function rebaselineConfig(config: GuardrailConfig, opts: { shiftDays?: number; anchorLastStageTo?: string | null }): GuardrailConfig {
  const clone = JSON.parse(JSON.stringify(config)) as GuardrailConfig;
  const stages = Array.isArray(clone.stages) ? clone.stages : [];
  let shiftMs = 0;
  if (typeof opts.shiftDays === 'number' && Number.isFinite(opts.shiftDays)) {
    shiftMs = Math.round(opts.shiftDays) * 86_400_000;
  } else if (opts.anchorLastStageTo) {
    const anchor = new Date(opts.anchorLastStageTo).getTime();
    let lastDue = NaN;
    for (const s of stages) { if (s.dueDate) { const t = new Date(s.dueDate).getTime(); if (!Number.isNaN(t)) lastDue = t; } }
    if (!Number.isNaN(anchor) && !Number.isNaN(lastDue)) shiftMs = anchor - lastDue;
  }
  if (!shiftMs) return clone;
  const shift = (iso: string | null | undefined): string | null | undefined => {
    if (!iso) return iso;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? iso : new Date(t + shiftMs).toISOString();
  };
  for (const s of stages) {
    if (s.dueDate) s.dueDate = shift(s.dueDate);
    for (const t of s.todos ?? []) { if (t.dueDate) t.dueDate = shift(t.dueDate); }
  }
  return clone;
}

/**
 * Who may edit a portal's Workflow Setup (docs/TENANT_WORKFLOW_SETUP_DESIGN.md): tenant_admin+ — which
 * covers a descended rfp_admin/master_admin shadow admin and a partner_admin descended as tenant_admin —
 * OR a delegated per-portal MANAGER. The manager check needs portal context (the guardrail_config manager
 * list), so callers resolve `isDelegatedManager` and pass it in.
 */
export function canEditWorkflow(role: Role, opts: { isDelegatedManager?: boolean } = {}): boolean {
  return hasRoleAtLeast(role, 'tenant_admin') || opts.isDelegatedManager === true;
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
  // Every stage element must be a non-null object with a non-empty string key. A null/degenerate
  // element passes Array.isArray but then (a) crashes createStageTodos on `null.todos` AFTER the
  // portal row has ALREADY advanced — landing it on a stage with zero gate ToDos, which the
  // all-or-nothing gate then waves straight through (gate-bypass + corrupt state, sweep DEFECT#1),
  // and (b) crashes the editor's applyConfig on `null.key` (DEFECT#2). Reject at this one choke
  // point (the `!s` short-circuits before any property access). A keyless stage also breaks the
  // gate match `params->>'stage' = key`, so the key is required, not just the object shape.
  const hasBadStage = stages.some((s) => !s || typeof s !== 'object' || Array.isArray(s) || typeof s.key !== 'string' || s.key.trim() === '');
  if (hasBadStage) errors.push('each stage must be an object with a non-empty key');
  if (collaborators.length > limits.maxCollaborators) errors.push(`too many collaborators (max ${limits.maxCollaborators})`);
  const managers = collaborators.filter((c) => c && c.role === 'manager').length;
  if (managers > limits.maxManagers) errors.push(`too many managers (max ${limits.maxManagers})`);
  if (nudgeDays.length > limits.maxNudges) errors.push(`too many nudges (max ${limits.maxNudges})`);
  for (const s of stages) {
    if (s && s.gateCloser != null && !GATE_CLOSERS.has(s.gateCloser)) {
      errors.push(`invalid gate closer "${s.gateCloser}" (allowed: ${[...GATE_CLOSERS].join(', ')})`);
    }
    if (s && s.dueDate != null && Number.isNaN(new Date(s.dueDate).getTime())) {
      errors.push(`stage "${s.key}" has an invalid date`);
    }
    for (const t of (Array.isArray(s?.todos) ? s.todos : [])) {
      if (!TODO_TYPES.has(t.type)) errors.push(`invalid todo type "${t.type}" (allowed: ${[...TODO_TYPES].join(', ')})`);
      if (t.dueDate != null && Number.isNaN(new Date(t.dueDate).getTime())) errors.push(`a to-do in "${s.key}" has an invalid date`);
      if (t.nudgeDays != null && !Array.isArray(t.nudgeDays)) errors.push(`a to-do in "${s.key}" has an invalid nudge schedule`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Stricter "ready to Accept & Start" check (docs/TENANT_WORKFLOW_SETUP_DESIGN.md §3½.2) — the required
 * one-time tenant acceptance. Every stage needs a gate date + a way to close its gate (a human stage needs
 * ≥1 ToDo with an owner; an AI-manager stage needs a manager archetype). Advisory to the UI (enables the
 * Accept button); `validateGuardrailConfig` remains the hard limit/shape gate the routes enforce.
 */
export function checkWorkflowComplete(config: GuardrailConfig): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  const stages = Array.isArray(config.stages) ? config.stages : [];
  if (stages.length < 1) missing.push('at least one stage');
  stages.forEach((s, i) => {
    const label = (s?.label || s?.key || `stage ${i + 1}`);
    if (!s?.dueDate) missing.push(`a date for "${label}"`);
    const closer: GateCloser = s?.gateCloser ?? 'human';
    if (closer === 'agent_manager') {
      if (!s?.agentManagerKey) missing.push(`an AI manager for "${label}"`);
    } else {
      const todos = Array.isArray(s?.todos) ? s.todos : [];
      if (todos.length < 1) missing.push(`at least one to-do for "${label}"`);
      const hasOwner = !!s?.defaultAssigneeUserId || todos.some((t) => t.assigneeUserId || t.assigneeRole);
      if (todos.length > 0 && !hasOwner) missing.push(`an owner for "${label}"`);
    }
  });
  return { complete: missing.length === 0, missing };
}

/** Create the ToDos for a given stage (all-or-nothing gate) into the tasks/nudge ledger.
 *  Timing + assignee are derived per todo via projectTodoTiming/resolveTodoAssignee (absolute
 *  stage/todo dates win over relative days; a named person wins over a role). */
async function createStageTodos(
  actor: { id: string; email: string | null; role: Role; tenantId: string },
  tenantId: string,
  portalId: string,
  stage: Stage,
  config: GuardrailConfig,
  limits: GuardrailLimits,
): Promise<number> {
  let n = 0;
  // AGENT-MANAGER stage: the gate is closed by an AI manager (TW-8). Create exactly ONE gate ToDo so the
  // stage is NEVER empty — an empty stage would let the all-or-nothing gate wave straight through with no
  // review (the wave-through the validator guards for null stages). Its completion IS the gate close:
  // assisted → a human ticks it after reviewing the cohort; auto (opt-in) → a service actor completes it
  // when the cohort lands + the adversarial pass reconciles (TW-8c). The cohort itself runs in the engine,
  // launched by the capture:portal.stage_review.requested event this stage's entry emits (TW-8b).
  if (stage?.gateCloser === 'agent_manager') {
    const { dueAt, nudgeDays } = projectTodoTiming(stage, {} as StageTodo, config);
    const assigneeUserId = stage.defaultAssigneeUserId ?? null;
    const mgr = stage.agentManagerKey ? ` (${stage.agentManagerKey.replace(/_/g, ' ')})` : '';
    const res = await createTask({
      actor, tenantId,
      assigneeRole: assigneeUserId ? null : 'tenant_admin',
      assigneeUserId,
      taskType: 'acknowledge',
      title: `AI review gate — ${stage.label ?? stage.key}${mgr}`,
      entityType: 'portal', entityId: portalId,
      dueAt, nudgeDays: nudgeDays.slice(0, limits.maxNudges),
      params: { kind: 'review', portalId, stage: stage.key, agentGate: true, agentManagerKey: stage.agentManagerKey ?? null, autoAdvance: stage.autoAdvance === true },
    });
    return res.ok ? 1 : 0;
  }
  // Defense-in-depth: a legacy row persisted before the validator rejected null stages could
  // still carry one; `stage?.todos` keeps advancePortalStage from throwing on it (sweep DEFECT#1).
  for (const t of stage?.todos ?? []) {
    const { dueAt, nudgeDays } = projectTodoTiming(stage, t, config);
    const { assigneeRole, assigneeUserId } = resolveTodoAssignee(stage, t);
    const res = await createTask({
      actor,
      tenantId,
      assigneeRole,
      assigneeUserId,
      taskType: t.type,
      title: t.title ?? `${stage.label ?? stage.key}: ${t.type.replace(/_/g, ' ')}`,
      entityType: 'portal',
      entityId: portalId,
      dueAt,
      nudgeDays: nudgeDays.slice(0, limits.maxNudges),
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
  await withTenant(tenantId, async (tx) => {
    await tx`UPDATE proposal_portals SET current_stage_index = 0 WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
  });
  const first = config.stages?.[0];
  // Scope task creation to the tenant's RLS context — createTask hits the RLS-forced `tasks` ledger,
  // and a cross-tenant caller (the admin cockpit release) has no ambient tenant context otherwise.
  const tasksCreated = first ? await runInTenant(tenantId, () => createStageTodos(actor, tenantId, portalId, first, config, limits)) : 0;
  if (first) await emitStageReviewRequested(actor, tenantId, portalId, first);
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

  // All-or-nothing gate: block unless every ToDo for this stage is complete (or force). Count via
  // withTenant so the RLS-forced `tasks` ledger is scoped regardless of the caller's ambient context —
  // a bare `sql` here returns 0 under forced-RLS with no context, which would WAVE THE GATE THROUGH.
  if (!opts.force && curKey) {
    const open = await withTenant(tenantId, async (tx) => {
      const [{ open: n }] = await tx<Array<{ open: number }>>`
        SELECT count(*)::int AS open FROM tasks
        WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'portal' AND entity_id = ${portalId}::uuid
          AND params->>'stage' = ${curKey} AND status NOT IN ('completed', 'cancelled')`;
      return n;
    });
    if (open > 0) return { advanced: false, reason: 'incomplete_todos' };
  }

  const nextIndex = portal.currentStageIndex + 1;
  const limits = await getGuardrailLimits();

  if (nextIndex >= stages.length) {
    await withTenant(tenantId, async (tx) => {
      await tx`UPDATE proposal_portals SET status = 'closeout', current_stage_index = ${nextIndex} WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
    });
    await emitPortalStageAdvanced(actor, tenantId, portalId, portal.currentStageIndex, nextIndex, 'closeout');
    return { advanced: true, stageIndex: nextIndex, status: 'closeout' };
  }

  await withTenant(tenantId, async (tx) => {
    await tx`UPDATE proposal_portals SET status = 'executing', current_stage_index = ${nextIndex} WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid`;
  });
  await emitPortalStageAdvanced(actor, tenantId, portalId, portal.currentStageIndex, nextIndex, 'executing');
  // Scope next-stage ToDo creation to the tenant's RLS context — createTask hits the RLS-forced `tasks`
  // ledger, and the callers here (the tasks-route completion hook, closeAgentGate) carry NO ambient
  // tenant context, so a bare call fails the tasks INSERT policy under production RLS (mirrors
  // instantiatePortalWorkflow's runInTenant wrap; found by the govtech_app-faithful TW-8c drive).
  await runInTenant(tenantId, () => createStageTodos(actor, tenantId, portalId, stages[nextIndex], portal.guardrailConfig, limits));
  await emitStageReviewRequested(actor, tenantId, portalId, stages[nextIndex]);
  return { advanced: true, stageIndex: nextIndex, status: 'executing' };
}

/** Audit a portal stage transition so a workflow can consume "portal reached the next stage / closeout".
 *  Both the ToDo-completion auto-advance and the explicit advance-stage action funnel through here. */
async function emitPortalStageAdvanced(
  actor: { id: string; email: string | null },
  tenantId: string, portalId: string, fromStageIndex: number, toStageIndex: number, status: string,
) {
  await emitEventSingle({
    namespace: 'capture',
    type: 'portal.stage_advanced',
    actor: userActor(actor.id, actor.email ?? undefined),
    tenantId,
    payload: { portalId, fromStageIndex, toStageIndex, status },
  });
}

/**
 * TW-8b — when a portal enters an `agent_manager` stage, emit the TRIGGER that launches the manager cohort
 * in the engine: `capture:stage_review.requested` (start/end, carrying the correlation keys proposalId /
 * opportunityId / tenantId so a downstream HITL resume can entity-correlate). A pipeline Workflow reacts to
 * this to run the cohort (advisory_manager / color_team_reviewer + the adversarial overlay) and emit
 * `capture:stage_review.completed` — the trigger→action→action→trigger chain. Best-effort: the gate ToDo
 * already exists (assisted still works) if the emit fails.
 */
async function emitStageReviewRequested(
  actor: { id: string; email: string | null },
  tenantId: string, portalId: string, stage: Stage,
): Promise<void> {
  if (stage?.gateCloser !== 'agent_manager') return;
  try {
    const [p] = await withTenant(tenantId, async (tx) =>
      tx<Array<{ proposalId: string | null; opportunityId: string | null }>>`
        SELECT proposal_id AS "proposalId", opportunity_id AS "opportunityId"
        FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`);
    // The pipeline OnPortalStageReviewRequested triggers on the END event and reads every key off
    // payload.* (resolve_input has NO access to the top-level tenant_id COLUMN) — so `tenantId` MUST
    // ride IN the payload, and the END `result` MUST carry the FULL payload, not a thin echo (mirrors
    // lib/proposal-full-draft.ts, whose end `result` === the start `payload`). Emitting a thin end
    // result would null out proposalId / tenantId / agentManagerKey / autoAdvance in the record step.
    const payload = {
      portalId, tenantId,
      proposalId: p?.proposalId ?? null, opportunityId: p?.opportunityId ?? null,
      stageKey: stage.key, agentManagerKey: stage.agentManagerKey ?? null, autoAdvance: stage.autoAdvance === true,
    };
    const startId = await emitEventStart({
      namespace: 'capture', type: 'stage_review.requested',
      actor: userActor(actor.id, actor.email ?? undefined), tenantId,
      payload,
    });
    await emitEventEnd(startId, { result: payload });
  } catch (e) { console.error('[emitStageReviewRequested] failed (non-fatal)', e); }
}

/** The AI-manager review state for a portal's stage (TW-8c) — the completion TRIGGER the frontend
 *  gate-close consumes. `completed` is true only when a `stage_review.completed` landed AT/AFTER the
 *  latest `stage_review.requested` for the stage, so a re-instantiation's fresh request re-opens the
 *  gate until a NEW cohort lands. system_events is NOT RLS-forced + rows are keyed by payload.portalId,
 *  so a bare `sql` read is correct (no tenant context needed). */
export interface StageReviewState {
  requested: boolean;
  completed: boolean;
  verdict: string | null;
  summary: string | null;
  noteCount: number | null;
  completedAt: string | null;
}
export async function getStageReviewState(
  portalId: string, stageKey: string,
): Promise<StageReviewState> {
  try {
    // Scalar subqueries (always exactly one row, even with no completion yet), pulling the latest
    // completion's verdict + the manager's SUMMARY of what the cohort found (SPINE-T3).
    const [r] = await sql<Array<{ requestedAt: Date | null; completedAt: Date | null; verdict: string | null; summary: string | null; noteCount: string | null }>>`
      SELECT
        (SELECT max(created_at) FROM system_events
           WHERE namespace = 'capture' AND type = 'stage_review.requested'
             AND payload->>'portalId' = ${portalId} AND payload->>'stageKey' = ${stageKey}) AS "requestedAt",
        (SELECT max(created_at) FROM system_events
           WHERE namespace = 'capture' AND type = 'stage_review.completed'
             AND payload->>'portalId' = ${portalId} AND payload->>'stageKey' = ${stageKey}) AS "completedAt",
        (SELECT payload->>'verdict' FROM system_events
           WHERE namespace = 'capture' AND type = 'stage_review.completed'
             AND payload->>'portalId' = ${portalId} AND payload->>'stageKey' = ${stageKey}
           ORDER BY created_at DESC LIMIT 1) AS "verdict",
        (SELECT payload->>'summary' FROM system_events
           WHERE namespace = 'capture' AND type = 'stage_review.completed'
             AND payload->>'portalId' = ${portalId} AND payload->>'stageKey' = ${stageKey}
           ORDER BY created_at DESC LIMIT 1) AS "summary",
        (SELECT payload->>'noteCount' FROM system_events
           WHERE namespace = 'capture' AND type = 'stage_review.completed'
             AND payload->>'portalId' = ${portalId} AND payload->>'stageKey' = ${stageKey}
           ORDER BY created_at DESC LIMIT 1) AS "noteCount"`;
    const requestedAt = r?.requestedAt ? new Date(r.requestedAt) : null;
    const completedAt = r?.completedAt ? new Date(r.completedAt) : null;
    const completed = !!completedAt && (!requestedAt || completedAt >= requestedAt);
    const n = r?.noteCount != null ? Number(r.noteCount) : null;
    return {
      requested: !!requestedAt,
      completed,
      verdict: completed ? (r?.verdict ?? null) : null,
      summary: completed ? (r?.summary ?? null) : null,
      noteCount: completed && Number.isFinite(n) ? n : null,
      completedAt: completed && completedAt ? completedAt.toISOString() : null,
    };
  } catch (e) {
    console.error('[getStageReviewState] failed (non-fatal)', e);
    return { requested: false, completed: false, verdict: null, summary: null, noteCount: null, completedAt: null };
  }
}

/**
 * TW-8c — close an AI-manager stage gate: the FRONTEND authority that consumes `stage_review.completed`
 * and advances the portal. advancePortalStage stays the sole stage-mutation path (the pipeline never
 * advances a business table); this just (1) confirms the cohort's review landed, (2) closes the gate
 * ToDo (recording the AI verdict + who/what closed it), (3) advances, and (4) audits the close as
 * `capture:stage_review.advanced`. Two callers:
 *   • assisted (opts.auto=false): a manager/admin clicks "AI review complete → advance".
 *   • auto     (opts.auto=true) : opt-in only — refuses unless the stage has autoAdvance=true.
 * Idempotent: a non-agent stage, a pending review, or a not-opted-in auto call returns advanced:false
 * with a reason (never throws, never force-waves the gate).
 */
export async function closeAgentGate(
  actor: { id: string; email: string | null; role: Role; tenantId: string },
  tenantId: string,
  portalId: string,
  opts: { auto?: boolean } = {},
): Promise<{ advanced: boolean; reason?: string; stageIndex?: number; status?: string; verdict?: string | null }> {
  const portal = await withTenant(tenantId, async (tx) => {
    const [p] = await tx<Array<{ currentStageIndex: number; guardrailConfig: GuardrailConfig | null }>>`
      SELECT current_stage_index AS "currentStageIndex", guardrail_config AS "guardrailConfig"
      FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
    return p ?? null;
  });
  if (!portal) return { advanced: false, reason: 'not_found' };
  const stages = portal.guardrailConfig?.stages ?? [];
  const stage = stages[portal.currentStageIndex] ?? null;
  if (!stage || stage.gateCloser !== 'agent_manager') return { advanced: false, reason: 'not_agent_gate' };

  // The completion TRIGGER must be present for THIS stage — the cohort has landed its review.
  const review = await getStageReviewState(portalId, stage.key);
  if (!review.completed) return { advanced: false, reason: 'review_pending' };

  // Auto is opt-in per stage — never auto-advance a stage the tenant didn't set to autoAdvance.
  if (opts.auto && stage.autoAdvance !== true) return { advanced: false, reason: 'auto_not_enabled' };

  // Close the gate ToDo (its completion IS the gate close). RLS-scoped update (prod app role is
  // subject to tasks RLS). Record the AI verdict + closer so the ledger shows who/what closed it.
  await withTenant(tenantId, async (tx) => {
    await tx`
      UPDATE tasks SET status = 'completed', completed_at = now(),
        result = ${jsonParam({ closedBy: opts.auto ? 'ai_manager_auto' : 'assisted', verdict: review.verdict, by: actor.id })}
      WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'portal' AND entity_id = ${portalId}::uuid
        AND params->>'stage' = ${stage.key} AND params->>'agentGate' = 'true'
        AND status NOT IN ('completed', 'cancelled')`;
  });

  // Advance (the gate is now clear). advancePortalStage re-checks ALL open ToDos (all-or-nothing) and
  // owns the transition audit (portal.stage_advanced + next-stage ToDos + the next stage_review.requested).
  const result = await advancePortalStage(actor, tenantId, portalId);
  if (result.advanced) {
    await emitEventSingle({
      namespace: 'capture', type: 'stage_review.advanced',
      actor: userActor(actor.id, actor.email ?? undefined), tenantId,
      payload: { portalId, stageKey: stage.key, auto: opts.auto === true, verdict: review.verdict ?? null, agentManagerKey: stage.agentManagerKey ?? null },
    });
  }
  return { ...result, verdict: review.verdict ?? null };
}

/** Is this user a DELEGATED manager of the portal (a guardrail_config collaborator with role='manager')?
 *  Lets a non-admin manager edit the workflow (canEditWorkflow's isDelegatedManager). */
export async function isPortalManager(tenantId: string, portalId: string, userEmail: string | null): Promise<boolean> {
  if (!userEmail) return false;
  const email = userEmail.toLowerCase();
  try {
    return await withTenant(tenantId, async (tx) => {
      const [p] = await tx<Array<{ guardrailConfig: GuardrailConfig | null }>>`
        SELECT guardrail_config AS "guardrailConfig" FROM proposal_portals
        WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
      const cols: Collaborator[] = Array.isArray(p?.guardrailConfig?.collaborators) ? p!.guardrailConfig!.collaborators! : [];
      return cols.some((c: Collaborator) => c && c.role === 'manager' && typeof c.email === 'string' && c.email.toLowerCase() === email);
    });
  } catch { return false; }
}

export interface EditWorkflowResult {
  ok: boolean;
  error?: string; code?: string; status?: number;
  reprojected?: number; created?: number; cancelled?: number; accepted?: boolean;
}

/**
 * Edit a LAUNCHED portal's workflow config + reconcile the current stage's tasks — the post-launch edit
 * path the frozen guardrail model never had (TW-2, docs/TENANT_WORKFLOW_SETUP_DESIGN.md §3-§5). Two modes:
 *   • save (default) — re-project the current stage's OPEN tasks onto the new dates/assignees/nudges
 *     (reset `nudges_sent` so a rescheduled nudge re-fires), create newly-added todos, cancel removed
 *     ones. Bracketed `capture:workflow.reconfigured` (a process touching N tasks).
 *   • accept — the required one-time "Accept & Start": also require checkWorkflowComplete + stamp
 *     `_setup=accepted`. Single `capture:workflow.accepted`.
 * CAS to status IN (launched, executing) so a closeout/archived portal is never re-armed and the
 * pre-launch entry states stay owned by accept/release (adversarial-sweep B4). Runs in the buyer tenant's
 * RLS context (createTask + the task UPDATEs hit the RLS-forced `tasks` ledger). Reconcile matches an open
 * task to a config todo by title, so a pure date/assignee/nudge edit updates in place (task identity +
 * any progress preserved); a title/structure change cancels + recreates.
 */
export async function editPortalWorkflow(
  actor: { id: string; email: string | null; role: Role; tenantId: string },
  tenantId: string,
  portalId: string,
  newConfig: GuardrailConfig,
  opts: { accept?: boolean } = {},
): Promise<EditWorkflowResult> {
  const limits = await getGuardrailLimits();
  const v = validateGuardrailConfig(newConfig, limits);
  if (!v.ok) return { ok: false, error: v.errors.join('; '), code: 'GUARDRAIL_LIMIT', status: 422 };
  if (opts.accept) {
    const c = checkWorkflowComplete(newConfig);
    if (!c.complete) return { ok: false, error: `Complete the setup first — missing: ${c.missing.join(', ')}`, code: 'INCOMPLETE', status: 422 };
  }

  return runInTenant(tenantId, async (): Promise<EditWorkflowResult> => {
    const [portal] = await sql<Array<{ currentStageIndex: number; guardrailConfig: GuardrailConfig; status: string }>>`
      SELECT current_stage_index, guardrail_config, status
      FROM proposal_portals WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
    if (!portal) return { ok: false, error: 'portal not found', code: 'NOT_FOUND', status: 404 };
    if (portal.status !== 'launched' && portal.status !== 'executing') {
      return { ok: false, error: 'the workflow is not editable in this state', code: 'CONFLICT', status: 409 };
    }

    const config: GuardrailConfig = { ...newConfig };
    config._setup = opts.accept
      ? { status: 'accepted', acceptedAt: new Date().toISOString(), acceptedBy: actor.id }
      : (portal.guardrailConfig?._setup ?? newConfig._setup);

    const [wrote] = await sql<Array<{ id: string }>>`
      UPDATE proposal_portals SET guardrail_config = ${jsonParam(config)}
      WHERE tenant_id = ${tenantId}::uuid AND id = ${portalId}::uuid AND status IN ('launched','executing')
      RETURNING id`;
    if (!wrote) return { ok: false, error: 'the workflow is not editable in this state', code: 'CONFLICT', status: 409 };

    // Reconcile the CURRENT stage's tasks onto the new config.
    const stages = Array.isArray(config.stages) ? config.stages : [];
    const curStage = stages[portal.currentStageIndex];
    let reprojected = 0, created = 0, cancelled = 0;
    if (curStage) {
      const existing = await sql<Array<{ id: string; title: string | null }>>`
        SELECT id, title FROM tasks
        WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'portal' AND entity_id = ${portalId}::uuid
          AND params->>'stage' = ${curStage.key} AND status IN ('open','in_progress')`;
      if (curStage.gateCloser === 'agent_manager') {
        // Agent-manager stage: keep exactly ONE gate ToDo (never empty). Cancel any human leftovers from a
        // prior config; create the gate if absent (createStageTodos makes the "AI review gate" ToDo).
        const isGate = (t: { title: string | null }) => (t.title ?? '').startsWith('AI review gate');
        for (const e of existing) {
          if (!isGate(e)) {
            await sql`UPDATE tasks SET status = 'cancelled' WHERE tenant_id = ${tenantId}::uuid AND id = ${e.id}::uuid AND status IN ('open','in_progress')`;
            cancelled++;
          }
        }
        if (existing.some(isGate)) reprojected++;
        else created += await createStageTodos(actor, tenantId, portalId, curStage, config, limits);
      } else {
        const used = new Set<string>();
        for (const todo of curStage.todos ?? []) {
          const title = todo.title ?? `${curStage.label ?? curStage.key}: ${todo.type.replace(/_/g, ' ')}`;
          const { dueAt, nudgeDays } = projectTodoTiming(curStage, todo, config);
          const { assigneeRole, assigneeUserId } = resolveTodoAssignee(curStage, todo);
          const sched = nudgeDays.slice(0, limits.maxNudges);
          const match = existing.find((e) => !used.has(e.id) && e.title === title);
          if (match) {
            used.add(match.id);
            await sql`
              UPDATE tasks SET due_at = ${dueAt}, assignee_role = ${assigneeRole}, assignee_user_id = ${assigneeUserId},
                nudge_schedule = ${jsonParam(sched)}, nudges_sent = '[]'::jsonb
              WHERE tenant_id = ${tenantId}::uuid AND id = ${match.id}::uuid AND status IN ('open','in_progress')`;
            reprojected++;
          } else {
            const res = await createTask({
              actor, tenantId, assigneeRole, assigneeUserId, taskType: todo.type, title,
              entityType: 'portal', entityId: portalId, dueAt, nudgeDays: sched,
              params: { kind: TODO_KIND[todo.type] ?? 'review', portalId, stage: curStage.key },
            });
            if (res.ok) created++;
          }
        }
        for (const e of existing) {
          if (!used.has(e.id)) {
            await sql`UPDATE tasks SET status = 'cancelled' WHERE tenant_id = ${tenantId}::uuid AND id = ${e.id}::uuid AND status IN ('open','in_progress')`;
            cancelled++;
          }
        }
      }
      // On acceptance (or entering an agent stage), fire the engine trigger to run the manager cohort.
      if (opts.accept && curStage.gateCloser === 'agent_manager') {
        await emitStageReviewRequested(actor, tenantId, portalId, curStage);
      }
    }

    if (opts.accept) {
      try {
        await emitEventSingle({
          namespace: 'capture', type: 'workflow.accepted',
          actor: userActor(actor.id, actor.email ?? undefined), tenantId,
          payload: { portalId, stages: stages.length, tasksCreated: created },
        });
      } catch (e) { console.error('[editPortalWorkflow] accepted emit failed (non-fatal)', e); }
    } else {
      try {
        const startId = await emitEventStart({
          namespace: 'capture', type: 'workflow.reconfigured',
          actor: userActor(actor.id, actor.email ?? undefined), tenantId,
          payload: { portalId },
        });
        await emitEventEnd(startId, { result: { portalId, reprojected, created, cancelled } });
      } catch (e) { console.error('[editPortalWorkflow] reconfigured emit failed (non-fatal)', e); }
    }

    return { ok: true, reprojected, created, cancelled, accepted: opts.accept === true };
  });
}
