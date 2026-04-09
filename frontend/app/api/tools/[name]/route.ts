/**
 * POST /api/tools/[name]
 *
 * Generic HTTP adapter over the tool registry. Every registered tool
 * is automatically invokable via this endpoint — no per-tool route
 * file needed unless a tool needs custom behavior (streaming, file
 * upload, etc.).
 *
 * Request body: { input: unknown }
 *   The input is passed to the tool's inputSchema for parsing. The
 *   registry will throw ToolValidationError if it doesn't match.
 *
 * Response shape (per API_CONVENTIONS.md):
 *   2xx: { data: <tool-specific output> }
 *   4xx/5xx: { error, code, details? }
 *
 * Authentication: standard NextAuth session via the withHandler
 * wrapper. The HandlerContext.actor is turned into a ToolContext
 * and passed to `registry.invoke()`. Middleware enforces that the
 * caller is at least authenticated; the individual tool's
 * `requiredRole` is enforced by the registry.
 *
 * See docs/TOOL_CONVENTIONS.md §"Dual-use entry points" item 2.
 */

import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { UnauthenticatedError } from '@/lib/errors';
// Side-effect import — triggers tool registration at module load.
import { invoke } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools';

const BodySchema = z.object({
  input: z.unknown(),
});

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * The withHandler wrapper doesn't know about route params (they
 * come from Next.js's dynamic segment, not the body), so the
 * route exports a thin POST function that extracts the param
 * and then delegates to withHandler for the rest.
 */
export async function POST(
  request: Request,
  routeCtx: RouteContext,
): Promise<Response> {
  const params = await routeCtx.params;
  const toolName = params.name;

  const handler = withHandler({
    scope: 'tools',
    inputSchema: BodySchema,
    requireAuth: true,
    async handler(body, ctx) {
      if (!ctx.actor) {
        throw new UnauthenticatedError();
      }

      // Build the ToolContext from the HandlerContext. The tool
      // registry takes over from here, handling role checks,
      // tenant scope validation, input parsing, and audit logging.
      const toolCtx: ToolContext = {
        actor: {
          type: 'user',
          id: ctx.actor.id,
          email: ctx.actor.email,
          role: ctx.actor.role,
        },
        tenantId: ctx.actor.tenantId,
        requestId: ctx.requestId,
        log: ctx.log.child({ tool: toolName }),
      };

      // Any exception thrown by invoke() (ToolNotFoundError,
      // ToolAuthorizationError, ToolValidationError,
      // ToolExecutionError) is an AppError subclass — withHandler's
      // outer catch will translate it to the correct HTTP status
      // with the standard { error, code, details } body.
      const result = await invoke(toolName, body.input, toolCtx);
      return result;
    },
  });

  return handler(request);
}
