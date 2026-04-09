/**
 * Structured event emitter for the RFP Pipeline platform.
 *
 * Writes to the `system_events` table created in migration
 * 007_system_events.sql. Every significant action across the
 * platform emits via one of three entry points:
 *
 *   emitEventStart(params) → Promise<string>  // returns event id
 *   emitEventEnd(startId, params) → Promise<void>
 *   emitEventSingle(params) → Promise<void>
 *
 * See docs/EVENT_CONTRACT.md for the binding specification of the
 * event shape, the start/end pattern, and the namespace registry.
 * See docs/NAMESPACES.md §"Event namespaces" for the authoritative
 * list of namespaces and what each owns.
 *
 * IMPORTANT: these functions MUST NEVER throw. Instrumentation
 * failures are logged via lib/logger.ts but never propagate —
 * event emission is best-effort and must not break the business
 * logic that it's instrumenting.
 */

import { sql } from './db';
import { createLogger } from './logger';

const log = createLogger('events');

// ─── Types ──────────────────────────────────────────────────────────

/**
 * Actor types — see docs/EVENT_CONTRACT.md §"Event shape".
 * `user`    — authenticated end user (admin or tenant)
 * `system`  — platform-level action not attributable to a specific user
 * `pipeline` — background worker dequeueing jobs
 * `agent`   — AI agent invoked via the tool registry
 */
export type ActorType = 'user' | 'system' | 'pipeline' | 'agent';

export interface EventActor {
  type: ActorType;
  id: string;
  email?: string;
}

export interface EmitStartParams {
  namespace: string;
  type: string;
  actor: EventActor;
  tenantId?: string | null;
  payload?: Record<string, unknown>;
  parentEventId?: string | null;
}

export interface EmitEndParams {
  result?: Record<string, unknown>;
  error?: { message: string; code?: string; details?: unknown } | null;
}

export interface EmitSingleParams {
  namespace: string;
  type: string;
  actor: EventActor;
  tenantId?: string | null;
  payload?: Record<string, unknown>;
}

// ─── Actor helpers (preserved from the pre-0.5b events.ts) ──────────

export function userActor(userId: string, email?: string): EventActor {
  return { type: 'user', id: userId, email };
}

export function systemActor(id = 'system'): EventActor {
  return { type: 'system', id };
}

export function pipelineActor(workerId: string): EventActor {
  return { type: 'pipeline', id: workerId };
}

export function agentActor(agentRole: string, tenantId: string): EventActor {
  return { type: 'agent', id: `${agentRole}:${tenantId}` };
}

// ─── Emitters ───────────────────────────────────────────────────────

/**
 * In-memory cache of start-event timestamps so emitEventEnd can
 * compute duration_ms without the caller tracking it. Scoped to a
 * single Node process; start/end pairs always happen within the same
 * request so there's no cross-process concern.
 */
const startTimestamps = new Map<string, number>();

/**
 * Emit a `start` phase event and return its id. The id is passed to
 * `emitEventEnd` when the action completes to link the pair via
 * parent_event_id.
 *
 * Returns an empty string on failure so callers can still call
 * emitEventEnd without undefined checks — the end call no-ops on a
 * missing parent.
 */
export async function emitEventStart(params: EmitStartParams): Promise<string> {
  try {
    const startedAt = Date.now();
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO system_events (
        namespace, type, phase, actor_type, actor_id, actor_email,
        tenant_id, parent_event_id, payload
      ) VALUES (
        ${params.namespace},
        ${params.type},
        'start',
        ${params.actor.type},
        ${params.actor.id},
        ${params.actor.email ?? null},
        ${params.tenantId ?? null},
        ${params.parentEventId ?? null},
        ${JSON.stringify(params.payload ?? {})}::jsonb
      )
      RETURNING id
    `;
    startTimestamps.set(row.id, startedAt);
    return row.id;
  } catch (err) {
    log.error(
      { err: serializeError(err), namespace: params.namespace, type: params.type },
      'emitEventStart failed',
    );
    return '';
  }
}

/**
 * Emit an `end` phase event referencing the earlier `start` event
 * via parent_event_id. Duration is computed from the timestamp
 * cached at emitEventStart.
 *
 * On error: the `error` field is populated and the event is still
 * written. Callers pass the error object explicitly.
 */
export async function emitEventEnd(
  startEventId: string,
  params: EmitEndParams = {},
): Promise<void> {
  if (!startEventId) {
    // Start event failed earlier — skip the end event rather than
    // producing an orphan row with no parent.
    return;
  }
  try {
    const startedAt = startTimestamps.get(startEventId);
    const durationMs = startedAt !== undefined ? Date.now() - startedAt : null;
    startTimestamps.delete(startEventId);

    // Fetch namespace + type + actor from the start row so the end
    // row satisfies NOT NULL constraints without the caller having
    // to re-pass them.
    const [start] = await sql<
      {
        namespace: string;
        type: string;
        actorType: ActorType;
        actorId: string;
        actorEmail: string | null;
        tenantId: string | null;
      }[]
    >`
      SELECT namespace, type, actor_type, actor_id, actor_email, tenant_id
      FROM system_events
      WHERE id = ${startEventId}
      LIMIT 1
    `;
    if (!start) {
      log.warn(
        { startEventId },
        'emitEventEnd: start event not found (possibly rolled back)',
      );
      return;
    }

    await sql`
      INSERT INTO system_events (
        namespace, type, phase, actor_type, actor_id, actor_email,
        tenant_id, parent_event_id, payload, error, duration_ms
      ) VALUES (
        ${start.namespace},
        ${start.type},
        'end',
        ${start.actorType},
        ${start.actorId},
        ${start.actorEmail},
        ${start.tenantId},
        ${startEventId},
        ${JSON.stringify(params.result ?? {})}::jsonb,
        ${params.error ? JSON.stringify(params.error) : null}::jsonb,
        ${durationMs}
      )
    `;
  } catch (err) {
    log.error(
      { err: serializeError(err), startEventId },
      'emitEventEnd failed',
    );
  }
}

/**
 * Emit a single instantaneous event — no start/end pair needed.
 * Use this for events that don't bracket an operation: user sign-in,
 * password changed, system deploy completed, etc.
 */
export async function emitEventSingle(params: EmitSingleParams): Promise<void> {
  try {
    await sql`
      INSERT INTO system_events (
        namespace, type, phase, actor_type, actor_id, actor_email,
        tenant_id, payload
      ) VALUES (
        ${params.namespace},
        ${params.type},
        'single',
        ${params.actor.type},
        ${params.actor.id},
        ${params.actor.email ?? null},
        ${params.tenantId ?? null},
        ${JSON.stringify(params.payload ?? {})}::jsonb
      )
    `;
  } catch (err) {
    log.error(
      { err: serializeError(err), namespace: params.namespace, type: params.type },
      'emitEventSingle failed',
    );
  }
}

// ─── Internal ───────────────────────────────────────────────────────

function serializeError(err: unknown): { message: string; stack?: string } | unknown {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return err;
}
