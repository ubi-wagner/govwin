/**
 * resolveAutomationPolicy — the single injection point for per-tenant
 * automation parameterisation (#190, docs/AUTOMATION_POLICY_DESIGN.md §4).
 *
 * Precedence (highest wins): explicit launch override → portal config →
 * tenant policy row → platform framework row (tenant_id IS NULL).
 *
 * Returns null ONLY when the trigger is not in the framework at all (i.e. the
 * trigger_key was never seeded). Callers treat null as "skip gracefully"
 * (the engine's safe-skip rule: never dead-end a workflow).
 *
 * enabled=false → { enabled: false } — callers must honour this and skip
 * the gate/notify.
 */

import { sql } from '@/lib/db';
import { conditionsMatch } from '@/lib/automation/match';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PolicyContext {
  /** Event payload to match against the policy row's condition predicate. */
  payload?: Record<string, unknown>;
  /** For portal-config precedence (not yet wired — reserved for §13 build wizard). */
  portalId?: string | null;
}

export interface ResolvedPolicy {
  enabled: boolean;
  /** Roles to resolve into user IDs at fire time. */
  recipientRoles: string[];
  /** Explicit user IDs (additive to roles). */
  recipientUsers: string[];
  /** Sentinel flags: 'delegated_managers' | 'collaborators_at_stage'. */
  recipientFlags: string[];
  /** Absolute due window in minutes (build-side). Null = use relative anchor. */
  dueMinutes: number | null;
  /** Relative timing anchor (discovery-side). */
  relativeAnchor: 'open_date' | 'close_date' | 'stage_entered' | null;
  /** Signed offset in minutes from relativeAnchor. */
  relativeOffsetMinutes: number | null;
  /** Nudge cadence relative to due_at (last beat always adds the admin floor). */
  nudgeDays: number[];
  /** Delivery channel. */
  channel: 'email' | 'todo' | 'both';
  /** Rate-limit cooldown. */
  cooldownMinutes: number;
  maxFiresPerHour: number;
}

// DB row shape (snake_case from postgres.js)
interface PolicyRow {
  enabled: boolean;
  recipient_roles: string[];
  recipient_users: string[];        // postgres.js returns UUID[] as string[]
  recipient_flags: string[];
  condition: Record<string, unknown>;
  due_in_minutes: number | null;
  relative_anchor: string | null;
  relative_offset_minutes: number | null;
  nudge_days: number[];
  channel: string;
  cooldown_minutes: number;
  max_fires_per_hour: number;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Resolve the automation policy for a given (tenant, trigger_key).
 *
 * Reads at most two rows from tenant_automation_policies:
 *   1. The tenant-specific row (if any)
 *   2. The platform framework row (tenant_id IS NULL) as fallback
 *
 * Merges them: tenant row wins for any field it sets explicitly; otherwise
 * falls back to the framework row. Framework row is the canonical default —
 * if it doesn't exist either, returns null (safe-skip).
 */
export async function resolveAutomationPolicy(
  tenantId: string | null,
  triggerKey: string,
  ctx: PolicyContext = {},
): Promise<ResolvedPolicy | null> {
  let rows: PolicyRow[];
  try {
    if (tenantId) {
      rows = await sql<PolicyRow[]>`
        SELECT enabled, recipient_roles, recipient_users, recipient_flags,
               condition, due_in_minutes, relative_anchor, relative_offset_minutes,
               nudge_days, channel, cooldown_minutes, max_fires_per_hour
        FROM tenant_automation_policies
        WHERE trigger_key = ${triggerKey}
          AND (tenant_id = ${tenantId}::uuid OR tenant_id IS NULL)
        ORDER BY tenant_id NULLS LAST
        LIMIT 2
      `;
    } else {
      // Admin/system context — only the platform framework row applies.
      rows = await sql<PolicyRow[]>`
        SELECT enabled, recipient_roles, recipient_users, recipient_flags,
               condition, due_in_minutes, relative_anchor, relative_offset_minutes,
               nudge_days, channel, cooldown_minutes, max_fires_per_hour
        FROM tenant_automation_policies
        WHERE trigger_key = ${triggerKey}
          AND tenant_id IS NULL
        LIMIT 1
      `;
    }
  } catch (e) {
    console.error('[resolveAutomationPolicy] DB error:', e);
    return null;
  }

  if (rows.length === 0) return null;

  // rows[0] = tenant row (if any); rows[1] = platform framework row.
  // When no tenant row exists rows[0] IS the framework row.
  const tenantRow = rows.length === 2 ? rows[0] : null;
  const frameworkRow = rows.length === 2 ? rows[1] : rows[0];

  // Merge first so condition check uses the effective (merged) predicate.
  // mergeRows falls back to the framework condition when the tenant row has
  // an empty condition — matching is always against the governing rule.
  const merged = tenantRow ? mergeRows(tenantRow, frameworkRow) : frameworkRow;

  // Condition predicate: if the effective row has a non-empty condition it must
  // match the event payload, otherwise treat the policy as disabled (safe-skip).
  if (
    ctx.payload &&
    merged.condition &&
    Object.keys(merged.condition).length > 0
  ) {
    if (!conditionsMatch(merged.condition, ctx.payload)) {
      return { ...toResolved(merged), enabled: false };
    }
  }

  return toResolved(merged);
}

function mergeRows(tenant: PolicyRow, framework: PolicyRow): PolicyRow {
  return {
    // enabled: tenant wins
    enabled: tenant.enabled,
    // recipients: tenant wins if non-empty, else framework
    recipient_roles:  tenant.recipient_roles.length  > 0 ? tenant.recipient_roles  : framework.recipient_roles,
    recipient_users:  tenant.recipient_users.length  > 0 ? tenant.recipient_users  : framework.recipient_users,
    recipient_flags:  tenant.recipient_flags.length  > 0 ? tenant.recipient_flags  : framework.recipient_flags,
    condition:        Object.keys(tenant.condition ?? {}).length > 0 ? tenant.condition : framework.condition,
    // timing: tenant wins if set
    due_in_minutes:         tenant.due_in_minutes         ?? framework.due_in_minutes,
    relative_anchor:        tenant.relative_anchor         ?? framework.relative_anchor,
    relative_offset_minutes: tenant.relative_offset_minutes ?? framework.relative_offset_minutes,
    // escalation + delivery: tenant wins
    nudge_days:         tenant.nudge_days.length > 0 ? tenant.nudge_days : framework.nudge_days,
    channel:            tenant.channel ?? framework.channel,
    cooldown_minutes:   tenant.cooldown_minutes,
    max_fires_per_hour: tenant.max_fires_per_hour,
  };
}

function toResolved(row: PolicyRow): ResolvedPolicy {
  return {
    enabled:               row.enabled,
    recipientRoles:        row.recipient_roles  ?? [],
    recipientUsers:        row.recipient_users  ?? [],
    recipientFlags:        row.recipient_flags  ?? [],
    dueMinutes:            row.due_in_minutes   ?? null,
    relativeAnchor:        (row.relative_anchor as ResolvedPolicy['relativeAnchor']) ?? null,
    relativeOffsetMinutes: row.relative_offset_minutes ?? null,
    nudgeDays:             row.nudge_days        ?? [1, 3],
    channel:               (row.channel as ResolvedPolicy['channel']) ?? 'email',
    cooldownMinutes:       row.cooldown_minutes  ?? 0,
    maxFiresPerHour:       row.max_fires_per_hour ?? 0,
  };
}

// ── Convenience helper for launchProjectCollaboration call sites ───────────────

export interface CollaborationOverlay {
  /** Primary assignee role for the HITL gate (recipientRoles[0]). */
  assigneeRole: string;
  nudgeDays: number[];
  dueMinutes: number;
}

/**
 * Resolve the timing/assignment overlay for a launchProjectCollaboration call.
 *
 * Returns null when the policy is disabled (enabled=false) — callers MUST skip
 * the launch in that case (the engine's safe-skip rule: never dead-end a workflow).
 * If the trigger is unknown (not seeded, policy=null), falls back to the provided
 * `defaults` so behaviour is identical to today.
 *
 * Usage:
 *   const overlay = await resolveCollaborationOverlay(tenantId, 'proposal:proposal.created',
 *     { assigneeRole: 'rfp_admin', nudgeDays: [1,3], dueMinutes: 4320 });
 *   if (!overlay) return; // policy disabled — safe-skip
 *   await launchProjectCollaboration({ ...rest, ...overlay });
 */
export async function resolveCollaborationOverlay(
  tenantId: string | null,
  triggerKey: string,
  defaults: CollaborationOverlay,
): Promise<CollaborationOverlay | null> {
  const policy = await resolveAutomationPolicy(tenantId, triggerKey).catch(() => null);
  if (policy === null) return defaults;          // unknown trigger — use caller defaults
  if (!policy.enabled) return null;              // explicitly disabled — safe-skip
  return {
    assigneeRole:  policy.recipientRoles[0] ?? defaults.assigneeRole,
    nudgeDays:     policy.nudgeDays.length > 0  ? policy.nudgeDays  : defaults.nudgeDays,
    dueMinutes:    policy.dueMinutes            ?? defaults.dueMinutes,
  };
}
