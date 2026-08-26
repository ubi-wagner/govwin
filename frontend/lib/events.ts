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
/**
 * THE EVENT-NAMESPACE REGISTRY — the one TypeScript copy.
 *
 * Eight namespaces. `project` = post-award delivery: baselines, milestone gates, deliverable
 * acceptance. None of the other seven owns that — `proposal` is the PRE-award workspace, `capture`
 * is the customer lifecycle up to purchase, `system` is infra.
 *
 * ── WHY THIS IS EXPORTED, AND WHY THAT IS NOT ENOUGH ─────────────────────────────────────────
 * The registry was written out as a literal in NINE places across three languages, a SQL CHECK and
 * four documents. Adding `project` updated four of them and left five on the old seven — including
 * `app/api/events/route.ts`, which would have answered **422 to every project event**, and
 * `pipeline/tests/test_observability_contract.py`, which would have failed the first one the
 * pipeline emitted.
 *
 * Every TypeScript reader now imports THIS constant. Python has one equivalent
 * (`pipeline/src/observability/event_namespaces.py`), because it cannot import TypeScript, and the
 * database has a CHECK, because it cannot import either.
 *
 * Three copies is the floor — so `__tests__/event-namespace-registry.test.ts` reconciles all of
 * them, plus the migration SQL and every document that writes the list out, and fails naming which
 * one disagreed. **You cannot have one source of truth across a database constraint, two languages
 * and a doc. You can have one test that refuses to let them diverge.**
 */
export const EVENT_NAMESPACES = [
  'finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool',
  'project',
] as const;

export type EventNamespace = (typeof EVENT_NAMESPACES)[number];

/** Never these, in any position (docs/EVENT_CONTRACT.md §4). */
export const FORBIDDEN_NAMESPACES = ['admin', 'cms', 'spotlight'] as const;

// This set only WARNS on an unknown namespace. The ENFORCEMENT is
// `system_events_namespace_chk` (migration 217), which raises 23514 at the insert.
const KNOWN_NAMESPACES = new Set<string>(EVENT_NAMESPACES);
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

/**
 * Bracket an operation so the `end` cannot be lost, whatever happens inside.
 *
 * THE PROBLEM THIS EXISTS FOR. `emitEventStart` returns an id the `end` needs, so the natural way
 * to write it puts `const startId = await emitEventStart(...)` inside the handler's `try` — and
 * then the binding is not in scope in the `catch`, which makes closing the bracket there a syntax
 * error rather than an oversight. Thirty-one route handlers had that exact shape, each leaving a
 * permanently-unterminated `start` row whenever the handler threw.
 *
 * That is not only untidy. The workflow engine's `EventTrigger.matches()` is written around the
 * guarantee that a failed operation still emits a terminal `end` carrying `error` — it inspects
 * that field to avoid spawning junk instances off failures. A handler that emits nothing gives the
 * engine no terminal event at all, so anything waiting on the operation waits forever with no
 * signal that it never will arrive. An unclosed bracket is a broken link in the chain that lets a
 * small automation nest inside a bigger one.
 *
 * Prefer this over hand-pairing start/end in new code:
 *
 *     return withEventBracket(
 *       { namespace: 'finder', type: 'source.created', actor: userActor(userId), payload: { name } },
 *       async () => {
 *         const row = await createSource(...);
 *         return { result: { sourceId: row.id }, value: NextResponse.json({ data: row }) };
 *       },
 *     );
 *
 * The callback returns the `end` payload and the handler's own return value together, so success
 * emits `end` with a result and a throw emits `end` with `error` **and rethrows** — the caller's
 * own `catch` still runs and still shapes the HTTP response. Instrumentation never changes control
 * flow; it only guarantees the bracket closes first.
 */
export async function withEventBracket<T>(
  params: EmitStartParams,
  fn: () => Promise<{ result?: Record<string, unknown>; value: T }>,
): Promise<T> {
  const startId = await emitEventStart(params);
  try {
    const { result, value } = await fn();
    await emitEventEnd(startId, { result });
    return value;
  } catch (err) {
    await emitEventEnd(startId, {
      error: {
        message: err instanceof Error ? err.message : String(err),
        code: 'HANDLER_THREW',
      },
    });
    throw err;
  }
}

// ─── Internal ───────────────────────────────────────────────────────

function serializeError(err: unknown): { message: string; stack?: string } | unknown {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return err;
}
