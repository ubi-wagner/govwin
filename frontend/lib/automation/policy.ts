/**
 * resolveGatePolicy — the single injection point for the global automation-policy
 * layer (#190). See docs/AUTOMATION_POLICY_DESIGN.md.
 *
 * Every human-gate / notify launch site calls this instead of hardcoding
 * nudgeDays / dueMinutes / assigneeRole. It merges the three tunability levels
 * (decision ⑦ / §12) by precedence:
 *
 *     framework-HARD pin  ▸  tenant policy  ▸  gate defaults  ▸  framework default
 *
 * - framework  (automation_framework, mig 126) — the platform, RFP-admin-tunable
 *   defaults + the HARD values (the curation SLA a tenant may NOT move).
 * - tenant     (tenant_automation_policies, mig 127) — the customer's per-trigger tuning.
 * - gate defaults — the call-site's canonical values (== today's hardcoded constants),
 *   so an un-configured tenant behaves EXACTLY as before this layer existed.
 * - explicit override — a caller that must pin a value (the raw admin launch route).
 *
 * FAIL-SAFE: any DB error falls back to the gate defaults (today's behavior), so the
 * policy layer can never break a launch. This is what keeps Phase A/B "inert".
 *
 * The escalation FLOOR (admin-always + managers + RFP-Pipeline backstop, decision ①)
 * is NOT applied here — it is a final-nudge concept enforced downstream by the pipeline
 * sweeper (manager._final_notice_user_ids). This resolver decides the gate's assignee,
 * cadence, timing, and notify recipients; the floor is layered on the terminal nudge.
 */
import { sql } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('automation-policy');

export type PolicyScope = 'discovery' | 'build';
export type PolicyChannel = 'email' | 'todo' | 'both';

export interface GateDefaults {
  assigneeRole: string;
  nudgeDays: number[];
  dueInMinutes: number;
  channel?: PolicyChannel;
}

export interface ResolveGateOptions {
  /** Owning tenant. null for an admin/platform gate → framework + gate defaults only. */
  tenantId: string | null;
  scope: PolicyScope;
  /** Policy lookup key — 'namespace:type' for events, or the taskType for build gates. */
  triggerKey: string;
  /** The call-site's canonical values (today's constants). The regression-safe base. */
  gateDefaults: GateDefaults;
  /**
   * When true, dueInMinutes is PINNED to the framework curation SLA and a tenant
   * policy can NOT move it (decision ⑦ — the 72h SLA is framework-hard). Used by the
   * purchase → curation gate.
   */
  pinnedToCurationSla?: boolean;
}

export interface ResolvedGatePolicy {
  enabled: boolean;
  assigneeRole: string;
  nudgeDays: number[];
  dueInMinutes: number;
  channel: PolicyChannel;
  cooldownMinutes: number;
  maxFiresPerHour: number;
  /** Provenance for observability/tests — which levels actually contributed. */
  source: { tenantPolicy: boolean; frameworkPinned: boolean };
}

interface FrameworkRow {
  curationSlaMinutes: number;
  defaultNudgeDays: number[];
  defaultDueInMinutes: number;
  maxNudgesPerGate: number;
}

interface TenantPolicyRow {
  enabled: boolean;
  nudgeDays: number[] | null;
  dueInMinutes: number | null;
  channel: PolicyChannel | null;
  cooldownMinutes: number;
  maxFiresPerHour: number;
}

/** Read the singleton framework row (mig 126). Null on any error (caller falls back). */
export async function getAutomationFramework(): Promise<FrameworkRow | null> {
  try {
    const [row] = await sql<FrameworkRow[]>`
      SELECT curation_sla_minutes, default_nudge_days, default_due_in_minutes, max_nudges_per_gate
      FROM automation_framework WHERE id = 1
    `;
    return row ?? null;
  } catch (e) {
    log.warn?.({ msg: 'framework read failed — using gate defaults', err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Resolve the effective gate policy for one launch. Never throws — on any failure it
 * returns the gate defaults verbatim (today's behavior).
 */
export async function resolveGatePolicy(opts: ResolveGateOptions): Promise<ResolvedGatePolicy> {
  const { tenantId, scope, triggerKey, gateDefaults, pinnedToCurationSla } = opts;

  // Base = the gate's canonical defaults (regression-safe).
  const resolved: ResolvedGatePolicy = {
    enabled: true,
    assigneeRole: gateDefaults.assigneeRole,
    nudgeDays: gateDefaults.nudgeDays,
    dueInMinutes: gateDefaults.dueInMinutes,
    channel: gateDefaults.channel ?? 'email',
    cooldownMinutes: 0,
    maxFiresPerHour: 0,
    source: { tenantPolicy: false, frameworkPinned: false },
  };

  const framework = await getAutomationFramework();

  // Tenant policy row for this (scope, trigger_key), if the customer configured one.
  let policy: TenantPolicyRow | null = null;
  if (tenantId) {
    try {
      const [row] = await sql<TenantPolicyRow[]>`
        SELECT enabled, nudge_days, due_in_minutes, channel, cooldown_minutes, max_fires_per_hour
        FROM tenant_automation_policies
        WHERE tenant_id = ${tenantId}::uuid AND scope = ${scope} AND trigger_key = ${triggerKey}
      `;
      policy = row ?? null;
    } catch (e) {
      log.warn?.({ msg: 'tenant policy read failed — using gate/framework defaults', tenantId, triggerKey, err: e instanceof Error ? e.message : String(e) });
    }
  }

  // Apply tenant tuning over the gate defaults (only fields the tenant actually set).
  if (policy) {
    resolved.source.tenantPolicy = true;
    resolved.enabled = policy.enabled;
    if (policy.nudgeDays && policy.nudgeDays.length > 0) resolved.nudgeDays = policy.nudgeDays;
    if (policy.dueInMinutes && policy.dueInMinutes > 0) resolved.dueInMinutes = policy.dueInMinutes;
    if (policy.channel) resolved.channel = policy.channel;
    resolved.cooldownMinutes = policy.cooldownMinutes ?? 0;
    resolved.maxFiresPerHour = policy.maxFiresPerHour ?? 0;
  }

  // Framework caps + hard pins win LAST (a tenant cannot exceed them — decision ⑦/⑨).
  if (framework) {
    // Cap the nudge count at the framework maximum (default 3).
    if (framework.maxNudgesPerGate > 0 && resolved.nudgeDays.length > framework.maxNudgesPerGate) {
      resolved.nudgeDays = resolved.nudgeDays.slice(0, framework.maxNudgesPerGate);
    }
    // The curation SLA is framework-HARD: pin the due window, tenant tuning ignored.
    if (pinnedToCurationSla && framework.curationSlaMinutes > 0) {
      resolved.dueInMinutes = framework.curationSlaMinutes;
      resolved.source.frameworkPinned = true;
    }
  }

  return resolved;
}
