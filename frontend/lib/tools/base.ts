/**
 * Tool interface — the canonical dual-use construct.
 *
 * See docs/TOOL_CONVENTIONS.md for the binding specification. A Tool
 * is the business-logic implementation of a capability; an API route
 * is a thin adapter over a Tool (via `/api/tools/[name]`); a pipeline
 * worker dequeues agent tasks and invokes Tools through the same
 * registry. One implementation, three entry points.
 *
 * Invariants enforced by the registry (lib/tools/registry.ts):
 *   1. Tool `name` is unique across the whole registry
 *   2. `inputSchema` validates every input before the handler runs
 *   3. `requiredRole` is enforced against ctx.actor.role via rbac.ts
 *   4. `tenantScoped = true` requires ctx.tenantId to be non-null
 *   5. Every invocation emits `tool.invoke.start` + `tool.invoke.end`
 *      events to system_events via lib/events.ts
 *   6. Handlers throw ToolError subclasses (see lib/tools/errors.ts);
 *      they NEVER return null to signal errors
 */

import type { ZodSchema } from 'zod';
import type { Logger } from '@/lib/logger';
import type { Role } from '@/lib/rbac';

// ─── Actor types (mirrors lib/events.ts) ────────────────────────────

export type ToolActorType = 'user' | 'system' | 'pipeline' | 'agent';

export interface ToolActor {
  type: ToolActorType;
  id: string;
  email?: string;
  role?: Role;
}

// ─── Tool context ───────────────────────────────────────────────────

/**
 * Context passed to every tool handler. Built by the caller (API
 * route, pipeline dispatcher, direct in-process invocation) and
 * handed through registry.invoke() unchanged.
 *
 * The tool implementation reads `tenantId` (NEVER from input) to
 * scope its queries. `log` is a scoped logger already bound to
 * 'tools' with the tool name attached. `requestId` correlates across
 * events, logs, and downstream tool calls.
 */
export interface ToolContext {
  actor: ToolActor;
  /**
   * The tenant whose data this invocation can touch. MUST be
   * non-null when the tool declares `tenantScoped: true` (the
   * registry enforces this before calling the handler).
   */
  tenantId: string | null;
  /** Per-invocation correlation id. */
  requestId: string;
  /** Event id of the parent start event, for event-tree correlation. */
  parentEventId?: string;
  /** Scoped logger, already bound to the tool namespace. */
  log: Logger;
}

// ─── Tool definition ────────────────────────────────────────────────

/**
 * The canonical Tool shape. Every tool in frontend/lib/tools/ exports
 * a `defineTool()` result that matches this interface exactly.
 */
export interface Tool<I = unknown, O = unknown> {
  /**
   * Unique name across the registry. Dotted, e.g., `memory.search`,
   * `opportunity.get_by_id`. Must match the `namespace` field
   * — i.e., if namespace is 'memory', name must start with 'memory.'.
   */
  name: string;

  /**
   * Top-level bucket from docs/NAMESPACES.md §"Tool namespaces":
   * memory, opportunity, compliance, proposal, library, tenant,
   * solicitation.
   */
  namespace: string;

  /**
   * Human-readable description for the agent catalog + admin UI.
   * First sentence should work as a tooltip; full text can elaborate.
   */
  description: string;

  /**
   * Zod schema that the registry uses to parse `input` before the
   * handler runs. Callers can pass anything typed as `unknown`; the
   * registry throws `ToolValidationError` on parse failure.
   */
  inputSchema: ZodSchema<I>;

  /**
   * Minimum role required to invoke. The registry checks this
   * against `ctx.actor.role` via `hasRoleAtLeast` before calling the
   * handler. Undefined = any authenticated actor can invoke.
   * master_admin implicitly satisfies any requiredRole.
   */
  requiredRole?: Role;

  /**
   * If true, the registry throws `ValidationError` when
   * `ctx.tenantId` is null before calling the handler. Handlers of
   * tenantScoped tools can assume `ctx.tenantId` is non-null.
   *
   * Tenant-scoped tools MUST use `ctx.tenantId` in every SQL query
   * that touches tenant data; this is the ONLY way a tool reaches
   * tenant scope (never read it from `input`).
   */
  tenantScoped: boolean;

  /**
   * The business logic. Receives parsed+typed input and the context.
   * Throws ToolError subclasses on failure; returns the success
   * value directly (the registry + API adapter envelope it).
   */
  handler: (input: I, ctx: ToolContext) => Promise<O>;
}

/**
 * Type-inference helper for authoring tools. Lets you define a tool
 * without repeating the <I, O> generic args — TypeScript infers them
 * from the inputSchema and the handler return type.
 *
 *   export const memorySearch = defineTool({
 *     name: 'memory.search',
 *     namespace: 'memory',
 *     description: '...',
 *     inputSchema: z.object({ ... }),
 *     requiredRole: 'tenant_user',
 *     tenantScoped: true,
 *     handler: async (input, ctx) => { ... },
 *   });
 */
export function defineTool<I, O>(tool: Tool<I, O>): Tool<I, O> {
  return tool;
}

// ─── Tool result envelope (for cross-process invocations) ──────────

/**
 * Used by the HTTP entry point (`/api/tools/[name]`) and the pipeline
 * dispatcher to exchange tool results across process boundaries. In-
 * process callers get the unwrapped value directly from
 * `registry.invoke()` — this envelope is only for the wire format.
 */
export type ToolResult<O> =
  | { ok: true; data: O }
  | { ok: false; error: { message: string; code: string; details?: unknown } };
