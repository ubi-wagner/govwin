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
 * event shape, the start/end pattern, the namespace registry, and the
 * full event-type catalog. The event-contract + audit-coverage vitest
 * guards (frontend/__tests__/) enforce it in CI.
 *
 * IMPORTANT: these functions MUST NEVER throw. Instrumentation
 * failures are logged via lib/logger.ts but never propagate —
 * event emission is best-effort and must not break the business
 * logic that it's instrumenting.
 */

import { sql } from './db';
import { createLogger } from './logger';

const log = createLogger('events');

// The event-namespace registry (docs/EVENT_CONTRACT.md §Namespace registry). The static
// event-contract guard enforces this for LITERAL call sites; this runtime set catches DYNAMIC
// namespaces (computed at call time) the static check can't see. Non-fatal by contract — emitters
// never throw — so an unregistered namespace only logs a warning (drift signal, not a break).
const KNOWN_NAMESPACES = new Set(['finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool']);
function warnUnknownNamespace(namespace: string, type: string): void {
  if (!KNOWN_NAMESPACES.has(namespace)) {
    log.warn({ namespace, type }, 'event uses an unregistered namespace (see docs/EVENT_CONTRACT.md)');
  }
}

// Write jsonb payloads as OBJECTS via sql.json (NOT `${JSON.stringify(x)}::jsonb`,
// which stores a jsonb string scalar so `payload->>'field'` returns null for every
// audit/automation consumer). sql.json's JSONValue type is stricter than our loose
// payloads, so cast at the boundary (same idiom as lib/opportunity-bridge).
const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

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
    warnUnknownNamespace(params.namespace, params.type);
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
        ${jsonParam(params.payload ?? {})}
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
        ${jsonParam(params.result ?? {})},
        ${params.error ? jsonParam(params.error) : null},
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
    warnUnknownNamespace(params.namespace, params.type);
    const [row] = await sql<{ id: string }[]>`
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
        ${jsonParam(params.payload ?? {})}
      )
      RETURNING id
    `;
    // #107: fire any automation rules watching this event. Best-effort + gated out
    // of the test env so it never touches unit-test expectations on the emit path.
    if (process.env.NODE_ENV !== 'test') {
      const { evaluateAutomationRules } = await import('@/lib/automation/triggers');
      await evaluateAutomationRules({
        eventId: row?.id ?? null,
        namespace: params.namespace,
        type: params.type,
        tenantId: params.tenantId ?? null,
        payload: (params.payload ?? {}) as Record<string, unknown>,
      });
    }
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
