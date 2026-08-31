/**
 * What a project's reminders do — resolved, not hard-coded.
 *
 * ── THE THIRD LEVEL ──────────────────────────────────────────────────────────────────────────
 *   platform    `automation_framework` — the operator's floor and caps
 *   tenant      `tenant_automation_policies` — the customer's default per trigger
 *   PROJECT     `projects.notification_policy` — this project only (mig 235)
 *
 * The first two are already resolved by `resolveGatePolicy` (`lib/automation/policy.ts`), and this
 * calls it rather than reimplementing the merge — which also keeps the catalog's honesty test
 * satisfied, because that test asks whether an "active" dial has a real `resolveGatePolicy`
 * consumer behind it. A second resolver would have been a dial that lies by construction.
 *
 * ── EMPTY MEANS INHERIT ──────────────────────────────────────────────────────────────────────
 * A project nobody has configured has `{}`, and behaves exactly as the tenant policy says — not as
 * a COPY of the tenant policy taken at creation. The difference only shows up months later, when
 * the customer changes their default and half their projects ignore it because they were stamped
 * with the old one.
 *
 * ── AND AN UNPARSEABLE OVERRIDE DEGRADES TO INHERIT ──────────────────────────────────────────
 * Never raises. A stored key this cannot make sense of is ignored, because the alternative is a
 * project page that 500s on a value somebody typed into a form six months ago.
 */
import { sql } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';
import { resolveGatePolicy, type PolicyChannel } from '@/lib/automation/policy';

/**
 * The project triggers a customer may tune. Kept in lockstep with
 * `lib/automation/catalog.ts` — the catalog is what the editor RENDERS and this is what the
 * resolver ACCEPTS, and a key in one and not the other is a control that saves nothing.
 */
export const PROJECT_TRIGGERS = ['project:task.assigned', 'project:milestone.due_soon'] as const;
export type ProjectTrigger = (typeof PROJECT_TRIGGERS)[number];

/** Today's constants, which stay the answer for anyone who configures nothing. */
export const PROJECT_GATE_DEFAULTS: Record<ProjectTrigger, { nudgeDays: number[]; channel: PolicyChannel }> = {
  // Front-loaded on purpose: a reminder that arrives the morning something is due is not a
  // reminder, it is a report.
  'project:task.assigned': { nudgeDays: [7, 2, 0], channel: 'both' },
  'project:milestone.due_soon': { nudgeDays: [7, 2, 0], channel: 'both' },
};

export interface ProjectNotifyPolicy {
  enabled: boolean;
  nudgeDays: number[];
  channel: PolicyChannel;
  /** Which levels actually contributed — for observability, and for a UI that says so. */
  source: { tenantPolicy: boolean; projectOverride: boolean };
}

interface StoredOverride {
  enabled?: unknown;
  nudgeDays?: unknown;
  channel?: unknown;
}

/** What actually gets written — narrowed, so `sql.json` accepts it as a JSON value. */
interface WrittenOverride {
  enabled?: boolean;
  nudgeDays?: number[];
  channel?: PolicyChannel;
}

/** A stored nudge cadence, or null when it is not one. Ignored rather than raised on. */
function asNudgeDays(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return null;
  const days = v.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return null;
  // Descending — the cadence is "days BEFORE due", and an ascending list would nudge on the day
  // first and a week later, which is a reminder about something that has already happened.
  return [...new Set(days)].sort((a, b) => b - a);
}

function asChannel(v: unknown): PolicyChannel | null {
  return v === 'email' || v === 'todo' || v === 'both' ? v : null;
}

export async function resolveProjectNotify(
  tenantId: string,
  projectId: string,
  trigger: ProjectTrigger,
): Promise<ProjectNotifyPolicy> {
  const defaults = PROJECT_GATE_DEFAULTS[trigger] ?? PROJECT_GATE_DEFAULTS['project:task.assigned'];

  // Levels 1 and 2, by the shared resolver.
  const gate = await resolveGatePolicy({
    tenantId,
    scope: 'project',
    triggerKey: trigger,
    gateDefaults: {
      assigneeRole: 'tenant_user',
      nudgeDays: defaults.nudgeDays,
      dueInMinutes: 0,
      channel: defaults.channel,
    },
  });

  let override: StoredOverride | null = null;
  try {
    const [row] = await sql<{ notificationPolicy: unknown }[]>`
      SELECT notification_policy FROM projects
       WHERE id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1`;
    const all = coerceJsonb<Record<string, StoredOverride>>(row?.notificationPolicy, {});
    override = all?.[trigger] ?? null;
  } catch (err) {
    // The project's own dial is a refinement, not a prerequisite. Failing to read it must not stop
    // a reminder going out on the tenant's settings.
    console.error('[projects/notify-policy] project override read failed:', err);
  }

  const overrideDays = asNudgeDays(override?.nudgeDays);
  const overrideChannel = asChannel(override?.channel);
  const overrideEnabled = typeof override?.enabled === 'boolean' ? override.enabled : null;

  return {
    // A project may switch a reminder OFF that the tenant left on, and may not switch one ON that
    // the tenant switched off — the narrower scope can only narrow. Otherwise a customer who turned
    // something off centrally would find it still firing from forty projects.
    enabled: gate.enabled && (overrideEnabled ?? true),
    nudgeDays: overrideDays ?? gate.nudgeDays,
    channel: overrideChannel ?? gate.channel,
    source: {
      tenantPolicy: gate.source.tenantPolicy,
      projectOverride: overrideDays !== null || overrideChannel !== null || overrideEnabled !== null,
    },
  };
}

/**
 * Write (or clear) one trigger's per-project override.
 *
 * `null` for a field CLEARS it back to inherit, which is a different act from setting it to the
 * value the tenant currently has: the second stops tracking the moment the tenant changes theirs.
 */
export async function setProjectNotify(
  tenantId: string,
  projectId: string,
  trigger: ProjectTrigger,
  patch: { enabled?: boolean | null; nudgeDays?: number[] | null; channel?: PolicyChannel | null },
): Promise<boolean> {
  const next: WrittenOverride = {};
  if (patch.enabled !== null && patch.enabled !== undefined) next.enabled = patch.enabled;
  const days = patch.nudgeDays === null || patch.nudgeDays === undefined ? null : asNudgeDays(patch.nudgeDays);
  if (days) next.nudgeDays = days;
  const ch = patch.channel === null || patch.channel === undefined ? null : asChannel(patch.channel);
  if (ch) next.channel = ch;

  try {
    if (Object.keys(next).length === 0) {
      // Clearing: remove the key entirely rather than storing an empty object, so "inherit" reads
      // as ABSENT and a later reader cannot mistake `{}` for a configured no-op.
      await sql`
        UPDATE projects SET notification_policy = notification_policy - ${trigger}, updated_at = now()
         WHERE id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid`;
      return true;
    }
    // `sql.json`, NOT `JSON.stringify(...)::jsonb` — the latter reads back as a STRING and every
    // consumer then iterates its characters.
    await sql`
      UPDATE projects
         SET notification_policy = notification_policy || ${sql.json({ [trigger]: next } as unknown as Parameters<typeof sql.json>[0])},
             updated_at = now()
       WHERE id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid`;
    return true;
  } catch (err) {
    console.error('[projects/notify-policy] setProjectNotify failed:', err);
    return false;
  }
}
