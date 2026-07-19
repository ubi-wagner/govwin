/**
 * Automation trigger evaluator (#107) — the "completion" that turns stored
 * automation_rules into REAL firings off the event queue.
 *
 * When an event is emitted (see lib/events emitEventSingle/emitEventEnd), this
 * finds enabled+active rules whose (trigger_namespace, trigger_type) match, checks
 * the rule's conditions against the payload, honours cooldown + hourly rate limits,
 * and executes the action — writing every outcome to automation_log so the admin
 * automation surface shows what actually fired.
 *
 * Executable actions (additive, non-duplicating):
 *   - create_todo  → an admin ToDo (task_type 'admin_review' — a defined workflow)
 *   - notify_admin → an admin broadcast ToDo (task_type 'broadcast' — acknowledge)
 * Deferred actions (recorded, NOT executed here to avoid double-sending — email /
 * social / publish are already handled by their own routes/services):
 *   - send_email, distribute_social, publish_content, unpublish_content
 *
 * Everything is best-effort: a failure here must NEVER affect the event emit.
 */
import { sql } from '@/lib/db';
import { type AutomationEvent, EXECUTABLE, interpolate, conditionsMatch } from '@/lib/automation/match';

export type { AutomationEvent } from '@/lib/automation/match';

interface RuleRow {
  id: string;
  name: string;
  conditions: Record<string, unknown> | null;
  actionType: string;
  actionConfig: Record<string, unknown> | null;
  cooldownMinutes: number;
  maxFiresPerHour: number;
}

type JsonArg = Parameters<typeof sql.json>[0];

export interface EvalOutcome { fired: number; deferred: number; skipped: number }

/**
 * Evaluate + fire matching rules for one event. Best-effort: returns zeroed
 * counts (never throws) on any error. Skips entirely when no rules match — the
 * common case — so the hot event path pays only one indexed lookup.
 */
export async function evaluateAutomationRules(event: AutomationEvent): Promise<EvalOutcome> {
  const out: EvalOutcome = { fired: 0, deferred: 0, skipped: 0 };
  try {
    const rules = await sql<RuleRow[]>`
      SELECT id, name, conditions, action_type, action_config, cooldown_minutes, max_fires_per_hour
      FROM automation_rules
      WHERE enabled = true AND is_active = true
        AND trigger_namespace = ${event.namespace}
        AND trigger_type = ${event.type}
    `;
    if (rules.length === 0) return out;

    for (const rule of rules) {
      try {
        if (!conditionsMatch(rule.conditions, event.payload)) { out.skipped++; continue; }

        // Cooldown: a recent successful fire within the window suppresses this one.
        if (rule.cooldownMinutes > 0) {
          const [recent] = await sql<Array<{ one: number }>>`
            SELECT 1 AS one FROM automation_log
            WHERE rule_id = ${rule.id}::uuid AND status = 'success'
              AND executed_at > now() - (${rule.cooldownMinutes} || ' minutes')::interval
            LIMIT 1`;
          if (recent) { out.skipped++; continue; }
        }
        // Hourly rate limit.
        if (rule.maxFiresPerHour > 0) {
          const [{ n }] = await sql<Array<{ n: number }>>`
            SELECT count(*)::int AS n FROM automation_log
            WHERE rule_id = ${rule.id}::uuid AND status = 'success'
              AND executed_at > now() - interval '1 hour'`;
          if (n >= rule.maxFiresPerHour) { out.skipped++; continue; }
        }

        const cfg = (rule.actionConfig ?? {}) as Record<string, unknown>;
        if (EXECUTABLE.has(rule.actionType)) {
          await executeTodoAction(rule.actionType, cfg, event);
          out.fired++;
          await logAutomation(rule.id, event.eventId ?? null, rule.actionType, 'success', 'fired', { name: rule.name });
        } else {
          // Recorded so the automation is observable, but not executed here.
          out.deferred++;
          await logAutomation(rule.id, event.eventId ?? null, rule.actionType, 'deferred', 'recorded', { name: rule.name });
        }
      } catch (ruleErr) {
        out.skipped++;
        await logAutomation(rule.id, event.eventId ?? null, rule.actionType, 'error', 'failed', {
          error: ruleErr instanceof Error ? ruleErr.message : String(ruleErr),
        }).catch(() => {});
      }
    }
  } catch {
    // swallow — automation must never break event emission
  }
  return out;
}

/** create_todo / notify_admin → an admin ToDo (a step in a defined #101 workflow). */
async function executeTodoAction(
  actionType: string,
  cfg: Record<string, unknown>,
  event: AutomationEvent,
): Promise<void> {
  const isNotify = actionType === 'notify_admin';
  const taskType = isNotify ? 'broadcast' : 'admin_review';
  const rawTitle =
    (typeof cfg.title_template === 'string' && cfg.title_template) ||
    (typeof cfg.subject === 'string' && cfg.subject) ||
    `Automation: ${event.namespace}.${event.type}`;
  const title = interpolate(rawTitle, event.payload).slice(0, 300) || `Automation: ${event.namespace}.${event.type}`;
  const description = `Auto-created by an automation rule on ${event.namespace}.${event.type}.`;
  const params = isNotify ? { kind: 'acknowledge', automated: true } : { automated: true };

  await sql`
    INSERT INTO tasks (tenant_id, assignee_role, task_type, title, description, status, nudge_schedule, params)
    VALUES (${event.tenantId}::uuid, 'rfp_admin', ${taskType}, ${title}, ${description}, 'open',
            ${sql.json([])}, ${sql.json(params as JsonArg)})
  `;
}

async function logAutomation(
  ruleId: string,
  triggerEventId: string | null,
  actionType: string,
  status: string,
  actionTaken: string,
  result: Record<string, unknown>,
): Promise<void> {
  await sql`
    INSERT INTO automation_log (rule_id, trigger_event_id, action_type, status, action_taken, result)
    VALUES (${ruleId}::uuid, ${triggerEventId}::uuid, ${actionType}, ${status}, ${actionTaken}, ${sql.json(result as JsonArg)})
  `;
}
