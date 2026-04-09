/**
 * Canonical error class hierarchy for the RFP Pipeline frontend.
 *
 * See docs/ERROR_HANDLING.md for the full specification. Every error
 * that crosses an API boundary must be an instance of AppError or a
 * subclass. The `withHandler` wrapper in lib/api-helpers.ts translates
 * AppError subclasses into `{ error: string, code: string, details? }`
 * response bodies with the appropriate HTTP status.
 *
 * Rules (from docs/ERROR_HANDLING.md):
 *   - Tools throw ToolError subclasses (defined in lib/tools/errors.ts)
 *     which extend AppError so the same mapping applies.
 *   - Handlers throw AppError subclasses; the registry/withHandler
 *     translates. Handlers NEVER return `{ error }` directly.
 *   - `code` is a stable, machine-readable string (snake_case upper).
 *   - `httpStatus` maps 1:1 to the response code.
 *   - `details` is optional extra context (serializable, non-sensitive).
 *   - Stack traces are captured on construction but NEVER returned to
 *     the client in production; they're available via logging only.
 */

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    httpStatus: number,
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    // Preserve the stack across the V8 boundary.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serializes the error to the on-the-wire shape used in API responses.
   * `details` is included only if the caller set it explicitly — catch-all
   * error paths omit it to avoid leaking internals.
   */
  toResponseBody(): { error: string; code: string; details?: unknown } {
    const body: { error: string; code: string; details?: unknown } = {
      error: this.message,
      code: this.code,
    };
    if (this.details !== undefined) {
      body.details = this.details;
    }
    return body;
  }
}

/** 401 — session missing, expired, or invalid. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'authentication required', details?: unknown) {
    super(message, 'UNAUTHENTICATED', 401, details);
  }
}

/** 403 — session valid but actor lacks permission for this resource. */
export class ForbiddenError extends AppError {
  constructor(message = 'forbidden', details?: unknown) {
    super(message, 'FORBIDDEN', 403, details);
  }
}

/** 404 — resource does not exist (or actor has no visibility into it). */
export class NotFoundError extends AppError {
  constructor(message = 'not found', details?: unknown) {
    super(message, 'NOT_FOUND', 404, details);
  }
}

/** 409 — resource state conflicts with the requested change. */
export class ConflictError extends AppError {
  constructor(message = 'conflict', details?: unknown) {
    super(message, 'CONFLICT', 409, details);
  }
}

/**
 * 422 — input failed schema validation. Used by the zod adapter in
 * `withHandler` to report field-level errors. `details` typically
 * contains the zod issue list.
 */
export class ValidationError extends AppError {
  constructor(message = 'invalid input', details?: unknown) {
    super(message, 'VALIDATION_ERROR', 422, details);
  }
}

/** 429 — rate limit exceeded (Phase 5 enforcement, contract documented now). */
export class RateLimitError extends AppError {
  constructor(message = 'rate limit exceeded', details?: unknown) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, details);
  }
}

/**
 * 500 — unexpected internal error. Handlers should prefer throwing a
 * more specific subclass; `InternalError` is the fallback for paths
 * that legitimately cannot classify the failure.
 */
export class InternalError extends AppError {
  constructor(message = 'internal error', details?: unknown) {
    super(message, 'INTERNAL_ERROR', 500, details);
  }
}

/**
 * 502 — a dependency we called failed (SAM.gov, Anthropic, Stripe,
 * Resend, Railway Postgres). Distinct from InternalError so callers
 * (and monitoring) can route retries/alerts appropriately.
 */
export class ExternalServiceError extends AppError {
  constructor(
    message = 'external service failure',
    details?: unknown,
  ) {
    super(message, 'EXTERNAL_SERVICE_ERROR', 502, details);
  }
}

/** 503 — service temporarily unavailable (maintenance, DB down, etc.). */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'service unavailable', details?: unknown) {
    super(message, 'SERVICE_UNAVAILABLE', 503, details);
  }
}

/**
 * Type guard — narrows unknown errors to AppError so the withHandler
 * wrapper can call `.toResponseBody()` / read `.httpStatus` safely.
 */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
