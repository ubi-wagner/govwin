/**
 * Response builders + handler wrapper for API routes.
 *
 * See docs/API_CONVENTIONS.md for the binding contract every API route
 * must satisfy. Every `app/api/**\/route.ts` file should reduce to a
 * thin `withHandler(schema, handler)` call — the wrapper handles auth,
 * zod validation, tenant-scope checks, error translation, logging, and
 * response envelope construction so individual routes stay focused on
 * business logic.
 *
 * Usage:
 *
 *   const InputSchema = z.object({ tenantSlug: zTenantSlug });
 *   export const POST = withHandler({
 *     scope: 'api',
 *     inputSchema: InputSchema,
 *     requireAuth: true,
 *     handler: async (input, ctx) => {
 *       // throw typed errors (ValidationError, ForbiddenError, etc.)
 *       // return the success data directly — the wrapper envelopes it
 *       return { ok: true };
 *     },
 *   });
 */

import { NextResponse } from 'next/server';
import type { ZodError, ZodSchema } from 'zod';
import { auth } from '@/auth';
import {
  AppError,
  InternalError,
  UnauthenticatedError,
  ValidationError,
  isAppError,
} from '@/lib/errors';
import { createLogger, type Logger } from '@/lib/logger';
import type { Role } from '@/lib/rbac';
import { hasRoleAtLeast } from '@/lib/rbac';

// ─── Response envelopes ─────────────────────────────────────────────

/**
 * Success envelope. ALWAYS `{ data: T }` per API_CONVENTIONS.md.
 * Never return a bare object from a handler — the wrapper envelopes it.
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, init);
}

/**
 * Error envelope. ALWAYS `{ error: string, code: string, details? }`
 * with the AppError's httpStatus. Typically called by the wrapper, not
 * directly — handlers should `throw` typed errors instead.
 */
export function err(error: AppError): NextResponse<{ error: string; code: string; details?: unknown }> {
  return NextResponse.json(error.toResponseBody(), { status: error.httpStatus });
}

// ─── Handler context ────────────────────────────────────────────────

/**
 * Shape passed to every handler wrapped by `withHandler`. Gives the
 * handler a single place to read auth state, request id, tenant
 * context, and the scoped logger — no ad-hoc `await auth()` calls
 * inside the handler body.
 */
export interface HandlerContext {
  /** Authenticated actor, null for `requireAuth: false` public routes. */
  actor: {
    type: 'user' | 'system';
    id: string;
    email: string;
    role: Role;
    tenantId: string | null;
    tenantSlug: string | null;
    tempPassword: boolean;
  } | null;
  /** Per-request correlation id (used by events.ts + logger). */
  requestId: string;
  /** Scoped logger, already bound to the route's scope. */
  log: Logger;
}

// ─── withHandler ────────────────────────────────────────────────────

export interface WithHandlerOptions<I, O> {
  /** Log scope — must come from docs/NAMESPACES.md §"Log scope names". */
  scope: string;
  /**
   * Zod schema for the request body (POST/PUT/PATCH) or query params
   * (GET/DELETE). Pass `null` for routes that take no input.
   */
  inputSchema: ZodSchema<I> | null;
  /**
   * If true (default), the handler requires an authenticated session;
   * the wrapper resolves it via `auth()` and throws
   * `UnauthenticatedError` if missing. Public routes must opt out
   * explicitly by passing `requireAuth: false`.
   */
  requireAuth?: boolean;
  /**
   * Optional minimum role. The wrapper verifies the actor's role is
   * at or above this level before calling the handler. Middleware
   * already enforces path-level gates; this is belt-and-suspenders
   * for routes that need finer-grained checks.
   */
  requiredRole?: Role;
  /** Business logic — throw typed errors, return data to be enveloped. */
  handler: (input: I, ctx: HandlerContext) => Promise<O>;
  /** Method — used to decide whether to parse body or query. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}

/**
 * Wraps a handler with the boilerplate every API route needs.
 *
 * The wrapper runs in exactly this order (per API_CONVENTIONS.md
 * §"Handler ordering SOP"):
 *   1. Generate a request id + scoped logger
 *   2. Resolve session (if requireAuth)
 *   3. Parse + validate input via zod
 *   4. Verify role (if requiredRole)
 *   5. Call the handler
 *   6. Envelope the return value via ok()
 *   7. On exception: translate AppError to HTTP, unknown to 500,
 *      log both, return via err()
 */
export function withHandler<I = unknown, O = unknown>(
  opts: WithHandlerOptions<I, O>,
): (request: Request) => Promise<NextResponse> {
  const { scope, inputSchema, requireAuth = true, requiredRole, handler, method = 'POST' } = opts;
  const log = createLogger(scope);

  return async (request: Request): Promise<NextResponse> => {
    const requestId = generateRequestId();
    const scopedLog = log.child({ requestId, path: new URL(request.url).pathname });

    try {
      // ── Step 1: auth ────────────────────────────────────────────
      let actor: HandlerContext['actor'] = null;
      if (requireAuth) {
        const session = await auth();
        const sessionUser = session?.user as
          | {
              id?: string;
              email?: string;
              role?: Role;
              tenantId?: string | null;
              tenantSlug?: string | null;
              tempPassword?: boolean;
            }
          | undefined;
        if (!sessionUser?.id || !sessionUser.email || !sessionUser.role) {
          throw new UnauthenticatedError();
        }
        actor = {
          type: 'user',
          id: sessionUser.id,
          email: sessionUser.email,
          role: sessionUser.role,
          tenantId: sessionUser.tenantId ?? null,
          tenantSlug: sessionUser.tenantSlug ?? null,
          tempPassword: sessionUser.tempPassword ?? false,
        };
      }

      // ── Step 2: role check ──────────────────────────────────────
      if (requiredRole && actor && !hasRoleAtLeast(actor.role, requiredRole)) {
        const { ForbiddenError } = await import('@/lib/errors');
        throw new ForbiddenError();
      }

      // ── Step 3: input validation ────────────────────────────────
      let input: I;
      if (inputSchema) {
        const raw = method === 'GET' || method === 'DELETE'
          ? Object.fromEntries(new URL(request.url).searchParams)
          : await parseJsonBody(request);
        const parsed = inputSchema.safeParse(raw);
        if (!parsed.success) {
          throw new ValidationError('input validation failed', formatZodError(parsed.error));
        }
        input = parsed.data;
      } else {
        input = undefined as unknown as I;
      }

      // ── Step 4: business logic ──────────────────────────────────
      const ctx: HandlerContext = {
        actor,
        requestId,
        log: scopedLog,
      };
      const result = await handler(input, ctx);

      // ── Step 5: envelope ────────────────────────────────────────
      return ok(result);
    } catch (error) {
      // ── Error translation + logging ─────────────────────────────
      if (isAppError(error)) {
        // Expected error — log at info/warn level with the code
        scopedLog.warn(
          { err: { message: error.message, code: error.code }, details: error.details },
          `handler returned ${error.code}`,
        );
        return err(error);
      }
      // Unexpected error — log the full object, return a generic 500
      scopedLog.error(
        { err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
        'unhandled error in handler',
      );
      return err(new InternalError());
    }
  };
}

// ─── Internals ──────────────────────────────────────────────────────

/** Generates a per-request correlation id. Format: `req_<8 hex chars>`. */
function generateRequestId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `req_${hex}`;
}

/** Parse a JSON body safely; throws ValidationError on malformed JSON. */
async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('request body must be valid JSON');
  }
}

/** Format a ZodError into the `details` field of a ValidationError. */
function formatZodError(error: ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
