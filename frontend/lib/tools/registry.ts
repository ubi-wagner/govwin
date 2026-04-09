/**
 * Tool registry — the single entry point for invoking any tool.
 *
 * The registry holds every Tool registered via `register()` at module
 * load time and provides `invoke()` as the ONLY way to execute one.
 * All three dual-use entry points go through `invoke()`:
 *
 *   1. API route (same process): `await registry.invoke(name, input, ctx)`
 *   2. HTTP `POST /api/tools/:name`: cross-process via NextAuth session
 *   3. Pipeline dispatcher: dequeues agent_task_queue, POSTs to (2)
 *
 * `invoke()` runs in strict order (see docs/TOOL_CONVENTIONS.md):
 *
 *   1. Look up the tool by name     → ToolNotFoundError
 *   2. Check requiredRole            → ToolAuthorizationError
 *   3. Check tenantScoped vs tenantId → ToolValidationError
 *   4. Parse input via zod           → ToolValidationError
 *   5. Emit `tool.invoke.start`      → events.ts
 *   6. Call tool.handler inside try  → business logic
 *   7a. on success: emit `tool.invoke.end` with result_shape, return
 *   7b. on failure: emit `tool.invoke.end` with error payload, re-throw
 *
 * The registry is the audit point — every invocation produces exactly
 * one start event and one end event. Individual tool handlers can
 * emit additional nested events (with parentEventId = ctx.parentEventId)
 * for sub-operations, but they never skip the outer pair.
 */

import {
  emitEventEnd,
  emitEventStart,
  type EventActor,
} from '@/lib/events';
import { recordInvoke } from '@/lib/capacity';
import { createLogger } from '@/lib/logger';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import type { Tool, ToolContext } from './base';
import {
  ToolAuthorizationError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolValidationError,
} from './errors';

const log = createLogger('tools');

// ─── Registry state ─────────────────────────────────────────────────

/**
 * In-memory map of toolName → Tool. Populated by calls to `register()`
 * from lib/tools/index.ts at module load time.
 */
const tools = new Map<string, Tool>();

// ─── Registration ───────────────────────────────────────────────────

/**
 * Register a tool. Throws if a tool with the same name is already
 * registered — duplicate names are a programming error, not a runtime
 * condition.
 */
export function register<I, O>(tool: Tool<I, O>): void {
  if (tools.has(tool.name)) {
    throw new Error(`[tools] duplicate tool name: ${tool.name}`);
  }
  // Sanity check: name must start with namespace.
  if (!tool.name.startsWith(`${tool.namespace}.`)) {
    throw new Error(
      `[tools] tool name "${tool.name}" does not match namespace "${tool.namespace}"`,
    );
  }
  tools.set(tool.name, tool as Tool);
  log.info(
    { tool: tool.name, namespace: tool.namespace, tenantScoped: tool.tenantScoped },
    'registered tool',
  );
}

/** Look up a tool by name. Returns null if not registered. */
export function get(name: string): Tool | null {
  return tools.get(name) ?? null;
}

/**
 * List every registered tool. Used by the admin panel and the agent
 * tool catalog in Phase 4. Returns a shallow copy so callers can't
 * mutate the internal map.
 */
export function list(): Tool[] {
  return Array.from(tools.values());
}

/** Reset the registry — intended for test setup only. */
export function __resetForTest(): void {
  tools.clear();
}

// ─── Invocation ─────────────────────────────────────────────────────

/**
 * Invoke a tool by name. This is the ONLY way to execute a tool; any
 * other code path that calls the handler directly bypasses the audit
 * layer, the authz checks, and the input validation — don't do that.
 *
 * Returns the handler's raw return value on success. Throws one of:
 *
 *   - ToolNotFoundError      (tool name not registered)
 *   - ToolAuthorizationError (requiredRole check failed)
 *   - ToolValidationError    (tenantScoped violation or input parse failure)
 *   - ToolExecutionError     (handler threw an AppError or unknown error)
 *   - Any AppError subclass  (handler threw an intentional typed error — re-raised as-is)
 */
export async function invoke<O = unknown>(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<O> {
  // ── 1. Look up ──────────────────────────────────────────────────
  const tool = tools.get(name);
  if (!tool) {
    throw new ToolNotFoundError(name);
  }

  // Build a scoped logger for this invocation so downstream logs
  // carry the tool name + request id + tenant.
  const invokeLog = log.child({
    tool: name,
    requestId: ctx.requestId,
    actor: ctx.actor.id,
    tenantId: ctx.tenantId,
  });

  // ── 2. Role check ───────────────────────────────────────────────
  if (tool.requiredRole) {
    if (!ctx.actor.role) {
      throw new ToolAuthorizationError(
        `tool ${name} requires role ${tool.requiredRole} but actor has no role`,
        { tool: name, requiredRole: tool.requiredRole },
      );
    }
    if (!hasRoleAtLeast(ctx.actor.role, tool.requiredRole)) {
      throw new ToolAuthorizationError(
        `tool ${name} requires role ${tool.requiredRole}`,
        { tool: name, actorRole: ctx.actor.role, requiredRole: tool.requiredRole },
      );
    }
  }

  // ── 3. Tenant scope check ───────────────────────────────────────
  if (tool.tenantScoped && !ctx.tenantId) {
    throw new ToolValidationError(
      `tool ${name} is tenant-scoped but ctx.tenantId is null`,
      { tool: name },
    );
  }

  // ── 4. Input validation ─────────────────────────────────────────
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ToolValidationError('tool input failed schema validation', {
      tool: name,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  // ── 5. Emit start event ─────────────────────────────────────────
  const eventActor: EventActor = {
    type: ctx.actor.type,
    id: ctx.actor.id,
    email: ctx.actor.email,
  };
  const startEventId = await emitEventStart({
    namespace: 'tool',
    type: 'invoke.start',
    actor: eventActor,
    tenantId: ctx.tenantId,
    payload: {
      tool: name,
      input_keys: parsed.data && typeof parsed.data === 'object' ? Object.keys(parsed.data as Record<string, unknown>) : [],
    },
    parentEventId: ctx.parentEventId ?? null,
  });

  invokeLog.info({ tool: name }, 'invoking tool');

  // ── 6. Call the handler ─────────────────────────────────────────
  const handlerCtx: ToolContext = {
    ...ctx,
    log: invokeLog,
    parentEventId: startEventId || ctx.parentEventId,
  };

  const startedAt = Date.now();

  try {
    const result = (await tool.handler(parsed.data, handlerCtx)) as O;
    const durationMs = Date.now() - startedAt;

    // ── 7a. Success end event + capacity metric ──────────────────
    await emitEventEnd(startEventId, {
      result: {
        tool: name,
        outcome: 'success',
        result_shape:
          result && typeof result === 'object'
            ? Object.keys(result as Record<string, unknown>)
            : typeof result,
      },
    });
    await recordInvoke({
      toolName: name,
      toolNamespace: tool.namespace,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      tenantId: ctx.tenantId,
      success: true,
      durationMs,
    });
    invokeLog.info({ tool: name, durationMs }, 'tool invocation succeeded');
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // ── 7b. Error end event + capacity metric ───────────────────
    const errorPayload =
      err instanceof Error
        ? {
            message: err.message,
            code: (err as { code?: string }).code ?? 'UNKNOWN',
            details: (err as { details?: unknown }).details,
          }
        : { message: String(err), code: 'UNKNOWN' };

    await emitEventEnd(startEventId, {
      result: { tool: name, outcome: 'error' },
      error: errorPayload,
    });
    await recordInvoke({
      toolName: name,
      toolNamespace: tool.namespace,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      tenantId: ctx.tenantId,
      success: false,
      errorCode: errorPayload.code,
      durationMs,
    });

    invokeLog.warn(
      { tool: name, err: errorPayload, durationMs },
      'tool invocation failed',
    );

    // Re-raise typed errors as-is; wrap unknown errors so callers
    // can rely on ToolExecutionError having the standard shape.
    if (err instanceof ToolValidationError || err instanceof ToolAuthorizationError) {
      throw err;
    }
    if (err instanceof Error && 'httpStatus' in err) {
      // Already an AppError subclass — let it propagate.
      throw err;
    }
    throw new ToolExecutionError(
      err instanceof Error ? err.message : 'unknown tool error',
      500,
      errorPayload,
    );
  }
}
