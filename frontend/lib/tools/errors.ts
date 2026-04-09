/**
 * Tool-specific error classes. Extend AppError so the HTTP mapping
 * in lib/api-helpers.ts withHandler works unchanged.
 *
 * Tools NEVER return null to signal errors — they throw one of
 * these. The registry catches, emits the `tool.invoke.end` error
 * event, and re-raises for the caller to handle.
 *
 * See docs/TOOL_CONVENTIONS.md §"Error handling" and
 * docs/ERROR_HANDLING.md §"Per-layer rules".
 */

import { AppError } from '@/lib/errors';

/** Input failed the tool's zod schema. Always 422. */
export class ToolValidationError extends AppError {
  constructor(message = 'tool input validation failed', details?: unknown) {
    super(message, 'TOOL_VALIDATION_ERROR', 422, details);
  }
}

/** Actor lacks the required role or tenant context. Always 403. */
export class ToolAuthorizationError extends AppError {
  constructor(message = 'tool authorization failed', details?: unknown) {
    super(message, 'TOOL_AUTHORIZATION_ERROR', 403, details);
  }
}

/** Tool name not found in the registry. Always 404. */
export class ToolNotFoundError extends AppError {
  constructor(toolName: string) {
    super(`tool not found: ${toolName}`, 'TOOL_NOT_FOUND', 404, { toolName });
  }
}

/**
 * Internal failure inside the tool handler — unexpected DB error,
 * logic bug, etc. Defaults to 500 but can be overridden (e.g., a
 * tool that fails because upstream is unavailable might use 503).
 */
export class ToolExecutionError extends AppError {
  constructor(
    message = 'tool execution failed',
    httpStatus = 500,
    details?: unknown,
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', httpStatus, details);
  }
}

/**
 * External dependency the tool called failed (SAM.gov, Anthropic,
 * Stripe, Resend). 502.
 */
export class ToolExternalError extends AppError {
  constructor(message = 'external service failure', details?: unknown) {
    super(message, 'TOOL_EXTERNAL_ERROR', 502, details);
  }
}
