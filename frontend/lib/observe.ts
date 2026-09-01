/**
 * The observation window — what the system ACTUALLY did in the last N minutes.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * Every defect found this week was a discrepancy between what happened and what should have
 * happened, and **not one of them looked wrong**: a form that posted 201 while sending no session,
 * an accept route that provisioned six things and not the seventh, a `terms_version` column
 * recording v1 for a v4 signature, a waitlist sign-up that emitted an event nothing consumed.
 *
 * A person driving the product live cannot see any of that. They see a success page. This assembles
 * the other half — the events, the writes, the work items, the mail, the agent calls — so that an
 * action and its consequences can be looked at together.
 *
 * ── THE DISCREPANCIES ARE ARITHMETIC, NOT JUDGEMENT ──────────────────────────────────────────
 * Nothing here uses AI. Each finding is a countable mismatch:
 *
 *   an operation that started and never ended    → a throw walked out of the bracket
 *   a ledger row reserved and never confirmed    → a crash between reserve and dispatch
 *   a workflow started and never advanced        → a stuck instance
 *   a task raised into a role nobody queries     → a notification nobody receives
 *
 * That is deliberate. An advisory pass over these observations is the NEXT phase
 * (docs/ADMIN_COMPANION_DESIGN.md §4) and it is only as good as this is. Read-only, keyless, and
 * it works when the AI is down.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * rfp_admin+, cross-tenant by design — the point is to watch the whole platform during a drive —
 * so every read goes through `sqlBypass` (docs/RLS_CUTOVER.md).
 */
import { sqlBypass } from '@/lib/db';
import { describeEvent } from '@/lib/event-labels';
// Mail comes through the SEND SEAM, never by querying the ledger tables from here —
// they are owned by lib/email and denied to the app role (migration 215). The
// boundary test caught this file doing exactly that.
import { sendsSince } from '@/lib/email';

export type Severity = 'finding' | 'note';

export interface Discrepancy {
  severity: Severity;
  what: string;
  detail: string;
  /** What this shape usually means, so the reader is not left to infer it. */
  meaning: string;
}

export interface ObservedEvent {
  id: string;
  namespace: string;
  type: string;
  phase: string;
  actorEmail: string | null;
  tenantId: string | null;
  error: string | null;
  durationMs: number | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  sentence: string;
}

export interface Observation {
  windowMinutes: number;
  since: Date;
  events: ObservedEvent[];
  eventCount: number;
  tasks: Array<{ id: string; taskType: string; title: string; assigneeRole: string | null; tenantId: string | null; createdAt: Date }>;
  mail: Array<{ toEmail: string; template: string | null; status: string; createdAt: Date }>;
  agents: Array<{ toolName: string; success: boolean; errorCode: string | null; durationMs: number | null; createdAt: Date }>;
  workflows: Array<{ id: string; workflowName: string; status: string; currentStep: number | null; createdAt: Date; updatedAt: Date | null }>;
  discrepancies: Discrepancy[];
}

/** Minutes are clamped: a window of 0 observes nothing and a window of a week is not a window. */
export function clampWindow(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(Math.round(n), 240));
}

export async function observe(windowMinutes: number): Promise<Observation> {
  const mins = clampWindow(windowMinutes);
  const since = new Date(Date.now() - mins * 60_000);

  const [events, tasks, mail, agents, workflows] = await Promise.all([
    sqlBypass<Omit<ObservedEvent, 'sentence'>[]>`
      SELECT id, namespace, type, phase, actor_email, tenant_id, error, duration_ms, payload, created_at
        FROM system_events WHERE created_at >= ${since}
       ORDER BY created_at DESC LIMIT 400`,
    sqlBypass<Observation['tasks']>`
      SELECT id, task_type, title, assignee_role, tenant_id, created_at
        FROM tasks WHERE created_at >= ${since} ORDER BY created_at DESC LIMIT 100`,
    sendsSince(since, 100),
    sqlBypass<Observation['agents']>`
      SELECT tool_name, success, error_code, duration_ms, created_at
        FROM tool_invocation_metrics WHERE created_at >= ${since} ORDER BY created_at DESC LIMIT 100`,
    sqlBypass<Observation['workflows']>`
      SELECT id, workflow_name, status, current_step, created_at, updated_at
        FROM process_instances WHERE created_at >= ${since} ORDER BY created_at DESC LIMIT 100`,
  ]);

  const withSentences: ObservedEvent[] = events.map((e) => ({
    ...e,
    // Written English, not a de-punctuated identifier — 33 event types once reached a customer as
    // raw type strings, and an observation window is exactly where that would hurt most.
    // The real payload, not an empty object: describeEvent reads it to build the sentence, so
    // passing {} silently degrades every label to the humanized type — the exact de-punctuated
    // identifier this is meant to avoid.
    sentence: describeEvent({
      namespace: e.namespace, type: e.type, phase: e.phase,
      payload: e.payload ?? {}, durationMs: e.durationMs,
    }),
  }));

  return {
    windowMinutes: mins,
    since,
    events: withSentences,
    eventCount: events.length,
    tasks, mail, agents, workflows,
    discrepancies: findDiscrepancies(withSentences, tasks, mail, workflows),
  };
}

/**
 * The findings. Each is a countable mismatch with a stated meaning — never a guess.
 *
 * A `note` is something worth seeing that is not necessarily wrong (an agent failure may be a
 * deliberate refusal). A `finding` is a shape that is wrong in every case I know of.
 */
export function findDiscrepancies(
  events: ObservedEvent[],
  tasks: Observation['tasks'],
  mail: Observation['mail'],
  workflows: Observation['workflows'],
): Discrepancy[] {
  const out: Discrepancy[] = [];

  // ── a bracket that opened and never closed ────────────────────────────────────────────────
  // `emitEventStart` must be matched by an `end` on EVERY exit path. 31 handlers once returned
  // from a catch without closing (B139), which is invisible except by counting.
  const starts = new Map<string, ObservedEvent>();
  for (const e of events) if (e.phase === 'start') starts.set(`${e.namespace}:${e.type}`, e);
  for (const e of events) if (e.phase === 'end') starts.delete(`${e.namespace}:${e.type}`);
  for (const [key, e] of starts) {
    out.push({
      severity: 'finding',
      what: `operation started and never finished — ${key}`,
      detail: `by ${e.actorEmail ?? 'system'} at ${e.createdAt.toISOString().slice(11, 19)}`,
      meaning: 'a throw walked out of the event bracket, so the operation has no recorded outcome. '
        + 'Use withEventBracket() — see docs/AUTOMATION_SPINE_AUDIT.md (B139).',
    });
  }

  // ── mail reserved and never confirmed ─────────────────────────────────────────────────────
  // The send seam RESERVES before dispatch precisely so a crash in between is visible instead of
  // invisible. A row still `pending` after the window is that crash.
  const stuck = mail.filter((m) => m.status === 'pending');
  if (stuck.length) {
    out.push({
      severity: 'finding',
      what: `${stuck.length} mail row(s) reserved and never confirmed`,
      detail: stuck.map((m) => `${m.template ?? 'no template'} → ${m.toEmail}`).slice(0, 4).join(' · '),
      meaning: 'the seam reserved a ledger row and never recorded an outcome — a crash between '
        + 'reserve and dispatch. The recipient may or may not have been mailed.',
    });
  }
  const failed = mail.filter((m) => m.status === 'failed');
  if (failed.length) {
    out.push({
      severity: 'note',
      what: `${failed.length} mail row(s) failed`,
      detail: failed.map((m) => `${m.template ?? '—'} → ${m.toEmail}`).slice(0, 4).join(' · '),
      meaning: 'expected when no provider is configured. With EMAIL_DRIVER=postmark set, this '
        + 'reading is the production gate failing.',
    });
  }

  // ── a workflow that started and did not move ──────────────────────────────────────────────
  const idle = workflows.filter((w) => w.status === 'running'
    && (!w.updatedAt || w.updatedAt.getTime() === w.createdAt.getTime()));
  if (idle.length) {
    out.push({
      severity: 'finding',
      what: `${idle.length} workflow(s) started and never advanced`,
      detail: idle.map((w) => `${w.workflowName} (step ${w.currentStep ?? '?'})`).slice(0, 4).join(' · '),
      meaning: 'the instance was created and its first step never completed — a missing action '
        + 'implementation, an unmet wait_for, or a worker that is not running.',
    });
  }

  // ── an event with an error ────────────────────────────────────────────────────────────────
  const errored = events.filter((e) => e.error);
  if (errored.length) {
    out.push({
      severity: 'finding',
      what: `${errored.length} event(s) carry an error`,
      detail: errored.map((e) => `${e.namespace}:${e.type} — ${String(e.error).slice(0, 60)}`).slice(0, 4).join(' · '),
      meaning: 'the operation recorded its own failure. This is the system telling you plainly; '
        + 'it is here because a live driver will not be reading the event stream.',
    });
  }

  // ── a task raised into a role nobody queries ──────────────────────────────────────────────
  // A platform task is READABLE from anywhere under RLS; what decides whether a person sees it is
  // the app-layer predicate in listOpenTasksForActor, which scopes non-admins to three roles.
  const VISIBLE = new Set(['rfp_admin', 'master_admin', 'partner_admin', 'tenant_admin', 'tenant_user', 'partner_user']);
  const unseen = tasks.filter((t) => t.assigneeRole && !VISIBLE.has(t.assigneeRole));
  if (unseen.length) {
    out.push({
      severity: 'finding',
      what: `${unseen.length} task(s) assigned to a role no queue reads`,
      detail: unseen.map((t) => `${t.title.slice(0, 40)} → ${t.assigneeRole}`).slice(0, 4).join(' · '),
      meaning: 'a task created into a bucket nobody queries is the same as no task. RLS will not '
        + 'catch this — the app-layer predicate is what decides whether a person is told.',
    });
  }

  // ── agent failures ────────────────────────────────────────────────────────────────────────
  const agentFail = events.filter((e) => e.namespace === 'tool' && e.error);
  if (agentFail.length) {
    out.push({
      severity: 'note',
      what: `${agentFail.length} agent tool call(s) failed`,
      detail: agentFail.map((e) => e.type).slice(0, 4).join(' · '),
      meaning: 'may be a deliberate refusal (a guardrail, a spend cap) rather than a fault — check '
        + 'the error before treating it as one.',
    });
  }

  return out;
}
