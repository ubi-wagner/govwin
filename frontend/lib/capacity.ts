/**
 * Capacity metrics — tool invocation counters + system health
 * snapshot readers used by the /admin/system page.
 *
 * See db/migrations/008_capacity_and_system_health.sql for the
 * underlying tables.
 *
 * Writers:
 *   recordInvoke()      — called by the tool registry after every
 *                         tool.invoke.end event, one row per call
 *
 * Readers (for the admin panel):
 *   recentToolStats()   — aggregate metrics over a time window,
 *                         grouped by tool
 *   errorRate()         — failure rate in the window
 *   queueDepth()        — current agent_task_queue pending count
 *   recentErrors()      — last N error events from system_events
 *
 * All writers are best-effort (try/catch that logs but never throws)
 * so instrumentation failures can't break business logic, same
 * contract as lib/events.ts.
 */

import { sql } from './db';
import { createLogger } from './logger';

const log = createLogger('capacity');

// ─── Writer: record one tool invocation ────────────────────────────

export interface RecordInvokeParams {
  toolName: string;
  toolNamespace: string;
  actorType: 'user' | 'system' | 'pipeline' | 'agent';
  actorId: string;
  tenantId: string | null;
  success: boolean;
  errorCode?: string;
  durationMs: number;
}

/**
 * Insert one row into tool_invocation_metrics. Best-effort — failures
 * are logged but never propagate. Called by the registry's end-event
 * path so every invocation (success or failure) is recorded.
 */
export async function recordInvoke(params: RecordInvokeParams): Promise<void> {
  try {
    await sql`
      INSERT INTO tool_invocation_metrics (
        tool_name, tool_namespace, actor_type, actor_id,
        tenant_id, success, error_code, duration_ms
      ) VALUES (
        ${params.toolName},
        ${params.toolNamespace},
        ${params.actorType},
        ${params.actorId},
        ${params.tenantId},
        ${params.success},
        ${params.errorCode ?? null},
        ${params.durationMs}
      )
    `;
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err, toolName: params.toolName },
      'recordInvoke failed',
    );
  }
}

// ─── Reader: tool stats aggregated over a window ───────────────────

export interface ToolStatRow {
  toolName: string;
  toolNamespace: string;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  p50DurationMs: number;
  p95DurationMs: number;
}

/**
 * Aggregate tool_invocation_metrics over the last `windowHours` hours.
 * Returns one row per tool. Used by /admin/system to show the hot
 * tools and their latency percentiles.
 */
export async function recentToolStats(windowHours = 24): Promise<ToolStatRow[]> {
  try {
    const rows = await sql<
      {
        toolName: string;
        toolNamespace: string;
        totalCalls: string;
        successCalls: string;
        errorCalls: string;
        p50DurationMs: string | null;
        p95DurationMs: string | null;
      }[]
    >`
      SELECT
        tool_name,
        tool_namespace,
        COUNT(*)                                                      AS total_calls,
        COUNT(*) FILTER (WHERE success = true)                        AS success_calls,
        COUNT(*) FILTER (WHERE success = false)                       AS error_calls,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)     AS p50_duration_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)     AS p95_duration_ms
      FROM tool_invocation_metrics
      WHERE created_at >= now() - (${windowHours} || ' hours')::interval
      GROUP BY tool_name, tool_namespace
      ORDER BY total_calls DESC
    `;
    return rows.map((r) => ({
      toolName: r.toolName,
      toolNamespace: r.toolNamespace,
      totalCalls: Number(r.totalCalls),
      successCalls: Number(r.successCalls),
      errorCalls: Number(r.errorCalls),
      p50DurationMs: Math.round(Number(r.p50DurationMs ?? 0)),
      p95DurationMs: Math.round(Number(r.p95DurationMs ?? 0)),
    }));
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      'recentToolStats failed',
    );
    return [];
  }
}

// ─── Reader: queue depth ───────────────────────────────────────────

export async function queueDepth(): Promise<number> {
  try {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM agent_task_queue
      WHERE status = 'pending'
    `;
    return Number(row?.count ?? 0);
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      'queueDepth failed',
    );
    return 0;
  }
}

// ─── Reader: recent error events ───────────────────────────────────

export interface RecentErrorRow {
  id: string;
  namespace: string;
  type: string;
  actorType: string;
  actorId: string;
  tenantId: string | null;
  error: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Pull the most recent error events from system_events. The index
 * `idx_system_events_errors` makes this fast even with millions of
 * total rows.
 */
export async function recentErrors(limit = 20): Promise<RecentErrorRow[]> {
  try {
    const rows = await sql<
      {
        id: string;
        namespace: string;
        type: string;
        actorType: string;
        actorId: string;
        tenantId: string | null;
        error: Record<string, unknown> | null;
        createdAt: Date;
      }[]
    >`
      SELECT id, namespace, type, actor_type, actor_id, tenant_id,
             error, created_at
      FROM system_events
      WHERE error IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      namespace: r.namespace,
      type: r.type,
      actorType: r.actorType,
      actorId: r.actorId,
      tenantId: r.tenantId,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      'recentErrors failed',
    );
    return [];
  }
}

// ─── Reader: event rates ───────────────────────────────────────────

export interface EventRate {
  eventsLastHour: number;
  errorsLastHour: number;
}

export async function eventRates(): Promise<EventRate> {
  try {
    const [row] = await sql<{ eventsLastHour: string; errorsLastHour: string }[]>`
      SELECT
        COUNT(*)                                AS events_last_hour,
        COUNT(*) FILTER (WHERE error IS NOT NULL) AS errors_last_hour
      FROM system_events
      WHERE created_at >= now() - interval '1 hour'
    `;
    return {
      eventsLastHour: Number(row?.eventsLastHour ?? 0),
      errorsLastHour: Number(row?.errorsLastHour ?? 0),
    };
  } catch (err) {
    log.error(
      { err: err instanceof Error ? { message: err.message } : err },
      'eventRates failed',
    );
    return { eventsLastHour: 0, errorsLastHour: 0 };
  }
}
