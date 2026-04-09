# Error Handling SOP

## Philosophy

Errors are data, not exceptions to hide. Every error in this codebase has five things:

1. A **type** (class) — `ValidationError`, `ForbiddenError`, `ToolExecutionError`, etc.
2. A **code** — a stable, machine-readable string like `VALIDATION_ERROR` or `TOOL_EXTERNAL_ERROR`. Clients pattern-match on the code, not the human message.
3. A **human message** — a short sentence a developer (and sometimes a user) can read.
4. **Optional details** — a serializable, non-sensitive payload that gives the caller enough context to act (zod issue lists, conflicting resource ids, the name of the failing upstream).
5. A **mapped HTTP status** — `httpStatus` on `AppError`, translated 1:1 by the API wrapper.

Logging captures the full stack + context. Responses return only what the client needs. We never leak stack traces, bcrypt hashes, API keys, or raw DB error messages across the network boundary.

The rule of thumb: **if a caller could plausibly recover from it, give them a typed error; otherwise log it and return a generic 500**. The middle ground — catching an error, logging nothing, and returning `null` — is the single worst anti-pattern in this codebase and is called out in the Don't do section below.

## Error class hierarchy

All errors that cross a layer boundary inherit from `AppError` (in `frontend/lib/errors.ts`). The class carries `code`, `httpStatus`, optional `details`, and a `toResponseBody()` method that the API wrapper calls to serialize the response envelope.

```ts
// frontend/lib/errors.ts

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
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }

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
```

### Subclasses

| Class | HTTP | Code | Meaning |
| --- | --- | --- | --- |
| `UnauthenticatedError` | 401 | `UNAUTHENTICATED` | Session missing, expired, or invalid. |
| `ForbiddenError` | 403 | `FORBIDDEN` | Session valid, but actor lacks permission for this resource. |
| `NotFoundError` | 404 | `NOT_FOUND` | Resource does not exist (or the actor has no visibility into it). |
| `ConflictError` | 409 | `CONFLICT` | Resource state conflicts with the requested change. |
| `ValidationError` | 422 | `VALIDATION_ERROR` | Input failed zod schema validation. `details` carries the issue list. |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | Caller exceeded the rate limit. |
| `InternalError` | 500 | `INTERNAL_ERROR` | Fallback when a path legitimately cannot classify the failure. |
| `ExternalServiceError` | 502 | `EXTERNAL_SERVICE_ERROR` | A dependency we called failed (SAM.gov, Anthropic, Stripe, Resend). |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | Service is temporarily unavailable (maintenance, DB down). |

Prefer the most specific subclass. `InternalError` exists so error paths that can't classify the failure still route through the same envelope — reach for it last, not first.

### Tool subclasses

Tools throw errors defined in `frontend/lib/tools/errors.ts`. They extend `AppError` so the same HTTP mapping works transparently — the registry doesn't need a second translation layer.

```ts
// frontend/lib/tools/errors.ts

import { AppError } from '@/lib/errors';

export class ToolValidationError extends AppError {
  constructor(message = 'tool input validation failed', details?: unknown) {
    super(message, 'TOOL_VALIDATION_ERROR', 422, details);
  }
}

export class ToolAuthorizationError extends AppError {
  constructor(message = 'tool authorization failed', details?: unknown) {
    super(message, 'TOOL_AUTHORIZATION_ERROR', 403, details);
  }
}

export class ToolNotFoundError extends AppError {
  constructor(toolName: string) {
    super(`tool not found: ${toolName}`, 'TOOL_NOT_FOUND', 404, { toolName });
  }
}

export class ToolExecutionError extends AppError {
  constructor(
    message = 'tool execution failed',
    httpStatus = 500,
    details?: unknown,
  ) {
    super(message, 'TOOL_EXECUTION_ERROR', httpStatus, details);
  }
}

export class ToolExternalError extends AppError {
  constructor(message = 'external service failure', details?: unknown) {
    super(message, 'TOOL_EXTERNAL_ERROR', 502, details);
  }
}
```

Because `ToolExecutionError extends AppError`, a route that invokes a tool and lets the error propagate will be translated to the correct HTTP response by `withHandler` without any tool-specific branch.

## Per-layer rules

### Server components (`app/**/page.tsx`, `app/**/layout.tsx`)

1. **Every `await sql` call sits inside a try/catch.** No exceptions. A loose DB call on a server component bricks the whole route segment.
2. **Re-throw `NEXT_REDIRECT` digest errors.** Next uses thrown errors to implement `redirect()`. Catching them and eating them prevents the redirect. Pattern:
   ```ts
   try {
     const rows = await sql`...`;
     if (!rows[0]) redirect('/not-found');
     return <Page data={rows[0]} />;
   } catch (err) {
     if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
     log.error({ scope: 'page', err }, 'failed to load tenant page');
     return <ErrorBoundaryFallback />;
   }
   ```
3. **Log via `createLogger('page')`** (or the matching scope from `docs/NAMESPACES.md`), not `console.error`.
4. **Render friendly error UI** on unexpected catches. Never dump the raw error object to the user.
5. **Never swallow.** If you catch something, either re-throw, log+render-fallback, or translate to a typed error. A bare `catch {}` fails code review.

### API routes (`app/api/**/route.ts`)

**Do not write try/catch in the route body.** Use `withHandler` from `frontend/lib/api-helpers.ts`. The wrapper runs the handler, catches `AppError` subclasses, logs them, and maps them to HTTP responses via `err()`.

```ts
export const POST = withHandler({
  scope: 'api',
  inputSchema: InputSchema,
  requireAuth: true,
  handler: async (input, ctx) => {
    const tenant = await lookupTenant(input.tenantSlug);
    if (!tenant) throw new NotFoundError('tenant not found');
    if (tenant.id !== ctx.actor!.tenantId) throw new ForbiddenError();
    return { tenant };
  },
});
```

Inside the handler:
- Throw typed errors — never `return { error: ... }` directly.
- Return the success shape directly; the wrapper wraps it in `{ data: ... }`.
- Call `ctx.log` for any logging (it is pre-scoped with `requestId` and the route path).
- Auth is already resolved for you — read `ctx.actor`. If `requireAuth: true` and no session, the wrapper has already thrown `UnauthenticatedError` before your handler runs.

The wrapper's exception path logs `AppError` subclasses at `warn` level (expected) and anything else at `error` level (unexpected) before replacing the unexpected throw with a generic `InternalError` so no internal stack leaks to the client.

### Client components (`components/**/*.tsx` marked `'use client'`)

1. **Check `res.ok` on every fetch.** A non-2xx response is not an exception on the client — it's a regular value you handle.
2. **Parse JSON safely** via a helper. A failing JSON parse must not crash the component.
3. **Set error state.** The component renders an inline error, a toast, or both. It does **not** re-throw.
4. **Never throw from a fetch handler.** Convert the error to state. A thrown error inside an event handler will break React's error boundaries in unexpected ways.

```ts
async function submit() {
  setLoading(true);
  setError(null);
  try {
    const res = await fetch('/api/tenants', { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setError(json?.error ?? 'request failed');
      return;
    }
    onSuccess(json.data);
  } catch {
    setError('network error');
  } finally {
    setLoading(false);
  }
}
```

### DB layer (`lib/db/*.ts`, `lib/queries/*.ts`)

1. **Validate `DATABASE_URL` at load time.** If the env var is missing or malformed, throw synchronously at module import — fail loud, fail early.
2. **Attach `.on('error')` handlers on pools.** A silent pool error manifests as hanging requests ten minutes later; catch it at the source and log via the scoped logger.
3. **Query functions in `lib/` return `null` ONLY if "not found" is semantically meaningful.** `getTenantBySlug` returning `null` for a missing slug is fine — callers know to branch on it. Returning `null` from a catch block because something blew up is **forbidden** — that hides errors from operators and gives callers a false negative.
4. **Parameterize all SQL.** Use `postgres.js` tagged templates. No string concatenation, no interpolation of user input.

### Auth (`frontend/auth.ts`, `authorize()` callback)

NextAuth's `authorize()` contract says: return a user on success, `null` on failure, and **never throw for expected failures** (bad password, missing user) — throwing causes NextAuth to surface a generic 500 to the client instead of the "Invalid credentials" UI.

We split the internal work into three try/catch blocks so each failure mode logs distinctly:

1. **DB lookup** — if the user query throws, log it as an infrastructure error and return `null`. Do not leak "database down" to the client.
2. **bcrypt compare** — if bcrypt throws (should be impossible), log separately and return `null`.
3. **Session touch (non-critical)** — wrap the `last_login_at` update in its own try/catch. If it fails, log it but still return the user — a failed session touch must never block login.

Every unexpected error in `authorize()` is logged via `createLogger('auth')` **before** returning `null`. Expected failures (user not found, wrong password) are logged at `info` level, infrastructure failures at `error`.

### Tools (`frontend/lib/tools/*.ts`)

1. **Throw `ToolError` subclasses.** Never return `null` to signal failure. Never return `{ error: ... }`.
2. **Pick the right subclass**: `ToolValidationError` for bad input, `ToolAuthorizationError` for missing permissions or tenant mismatch, `ToolExternalError` for upstream failures (SAM.gov, Anthropic), `ToolExecutionError` for internal bugs.
3. **Emit the `tool.invoke.end` event** with the error payload from the registry — the registry does this for you as long as you throw. The registry then re-raises so the caller (API route, agent runner) can handle it.
4. **Never catch and rewrap unless you're adding context.** If you catch an upstream `fetch` failure, wrap it in `ToolExternalError` with the upstream name in `details` — don't let a raw `TypeError: fetch failed` bubble up.

### Pipeline worker (`pipeline/**/worker.py`)

1. **Every job handler is wrapped in a top-level try/except** in the worker loop.
2. **On failure, emit `agent.task.failed`** with the error payload (task id, error class, message, stack trace in non-production, redacted details in production).
3. **Continue the main loop.** A single failing task must never crash the worker. The crash loop that follows causes cascading delays across every tenant on the shared worker.
4. **Log via the Python structured logger** with `scope="worker"` and the task id as a binding.

## Logging rules

Log **every caught error** via the scoped logger **before** handling it. This is non-negotiable.

```ts
import { createLogger } from '@/lib/logger';
const log = createLogger('tenants');

try {
  await doThing();
} catch (err) {
  log.error({ err, tenantId }, 'failed to provision tenant');
  throw new InternalError();
}
```

Rules:

- **Never raw `console.error`.** The only exception is `lib/logger.ts` itself, which uses `console.error` as a fallback when pino fails to initialize (breaks the circular dependency of logging a logging failure).
- **Never `console.log` anywhere.** Enforced by a grep in CI.
- **Log `err` as a field** (`log.error({ err }, 'msg')`), not interpolated into the message — pino serializes the former with the stack, the latter loses it.
- **Use the scope from `docs/NAMESPACES.md`** Log scope names section. Adding a new scope requires updating the registry in the same PR.
- **Log before re-throwing.** If the wrapper above you also logs, you will see two lines — that's fine, the correlation id ties them together.

## Redaction

`lib/logger.ts` configures pino with a redaction path list. Any field matching one of these paths is replaced with `[REDACTED]` before serialization:

```
password
passwordHash
password_hash
currentPassword
newPassword
authSecret
AUTH_SECRET
apiKey
api_key
apiKeyEncryptionSecret
encrypted_key
stripeSecretKey
sessionToken
cookie
Cookie
authorization
Authorization
*.password
*.passwordHash
*.password_hash
*.api_key
*.apiKey
*.cookie
*.authorization
req.headers.cookie
req.headers.authorization
```

**Redaction is a safety net, not a license to be sloppy.** Never log raw request bodies, environment variables, DB rows from sensitive tables (`users`, `api_keys`, `sessions`), or error `details` that came from an upstream without a sanitization pass. The redaction list covers the common leak vectors; it cannot catch a secret that you interpolated into a message string.

## Don't do (anti-patterns)

All of these fail code review:

- **Catching and returning `null` without logging.** You've hidden a failure and now the caller can't distinguish "not found" from "DB fell over".
- **Catching and re-throwing as a plain `Error`.** You've thrown away the class, code, and HTTP mapping. Re-throw the same error, or translate to a typed one.
- **Catching and ignoring** (`try { ... } catch {}`). If a failure is truly safe to ignore, write a one-line comment explaining why. Otherwise, log it.
- **Raw `console.error` / `console.log`.** Use the scoped logger.
- **`any` in catch without narrowing.** TypeScript catch bindings are `unknown`. Narrow with `instanceof Error` or `isAppError()` before touching `.message` or `.stack`.
- **Exposing stack traces in production responses.** `AppError.toResponseBody()` deliberately omits the stack. Do not add it.
- **Writing try/catch in an API route body.** Use `withHandler`.
- **Returning `{ error: ... }` from a handler.** Throw a typed error; the wrapper builds the envelope.
- **Throwing a string or a plain object.** Always throw an `Error` subclass.

## Testing errors

Every error path in the codebase has a test. The pattern is:

```ts
import { ValidationError, ForbiddenError } from '@/lib/errors';

test('rejects empty slug', async () => {
  await expect(createTenant({ slug: '' })).rejects.toThrow(ValidationError);
});

test('rejects cross-tenant access', async () => {
  await expect(
    fetchProposal({ actorTenantId: 'a', proposalTenantId: 'b' }),
  ).rejects.toThrow(ForbiddenError);
});
```

For API routes, test both the throw inside the handler and the HTTP shape that `withHandler` produces:

```ts
const res = await POST(mockRequest({ slug: '' }));
expect(res.status).toBe(422);
const body = await res.json();
expect(body.code).toBe('VALIDATION_ERROR');
expect(body.details.issues).toHaveLength(1);
```

If a code path has no test for its error case, it is considered untested regardless of how well the happy path is covered.

## Worked examples

### 1. Server component fetching tenant data

```ts
// app/(tenant)/[tenantSlug]/page.tsx
import { redirect } from 'next/navigation';
import { createLogger } from '@/lib/logger';
import { getTenantBySlug } from '@/lib/queries/tenants';

const log = createLogger('page');

export default async function TenantPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  try {
    const tenant = await getTenantBySlug(params.tenantSlug);
    if (!tenant) {
      redirect('/404');
    }
    return <TenantDashboard tenant={tenant} />;
  } catch (err) {
    // redirect() throws a NEXT_REDIRECT digest error — re-throw so
    // Next can actually perform the redirect.
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;

    log.error(
      { err, tenantSlug: params.tenantSlug },
      'failed to load tenant page',
    );
    return <ErrorFallback message="We couldn't load this workspace." />;
  }
}
```

Key points: the `getTenantBySlug` query legitimately returns `null` for a missing slug (that's a semantic "not found"), which we convert to a `redirect()`. Any other throw is an unexpected failure — we log with full context and render a friendly fallback. The redirect re-throw is mandatory; forgetting it leaves the user on a broken page.

### 2. API route throwing `ForbiddenError`, `withHandler` mapping to 403

```ts
// app/api/proposals/[id]/route.ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { getProposalById } from '@/lib/queries/proposals';

const InputSchema = z.object({ id: z.string().uuid() });

export const GET = withHandler({
  scope: 'api',
  method: 'GET',
  inputSchema: InputSchema,
  requireAuth: true,
  handler: async (input, ctx) => {
    const proposal = await getProposalById(input.id);
    if (!proposal) {
      throw new NotFoundError('proposal not found');
    }
    if (proposal.tenantId !== ctx.actor!.tenantId) {
      throw new ForbiddenError('proposal belongs to a different tenant');
    }
    return { proposal };
  },
});
```

When the cross-tenant check fails, `withHandler` catches the `ForbiddenError`, logs it at `warn` level with the code `FORBIDDEN` and the request id, and returns:

```json
{ "error": "proposal belongs to a different tenant", "code": "FORBIDDEN" }
```

with HTTP status `403`. The route itself contains no try/catch — the wrapper handles the full error pipeline. If the client wants to branch on the specific error they match on `code`, not on `error` (the message is advisory and can change).

### 3. Tool throwing `ToolExecutionError`, registry emitting end event, API path returning 502 via `withHandler`

```ts
// frontend/lib/tools/search-opportunities.ts
import { ToolExecutionError, ToolExternalError } from '@/lib/tools/errors';

export async function searchOpportunities(input, ctx) {
  let response;
  try {
    response = await fetch(
      `${SAM_GOV_URL}?q=${encodeURIComponent(input.query)}`,
    );
  } catch (cause) {
    throw new ToolExternalError('sam.gov fetch failed', {
      cause: String(cause),
    });
  }
  if (!response.ok) {
    throw new ToolExternalError('sam.gov returned non-2xx', {
      status: response.status,
    });
  }
  try {
    return { results: await response.json() };
  } catch {
    throw new ToolExecutionError('sam.gov returned invalid JSON', 502);
  }
}
```

Flow when the JSON parse fails:

1. The tool throws `ToolExecutionError` with `httpStatus: 502`.
2. The registry catches it inside the `invoke()` wrapper, emits `tool.invoke.end` with
   ```json
   {
     "status": "error",
     "error": {
       "code": "TOOL_EXECUTION_ERROR",
       "message": "sam.gov returned invalid JSON"
     }
   }
   ```
   then re-raises.
3. If the tool was called from an API route via `withHandler`, the wrapper catches the same error (because `ToolExecutionError extends AppError`), logs it at `warn` with the code `TOOL_EXECUTION_ERROR`, and returns:
   ```json
   { "error": "sam.gov returned invalid JSON", "code": "TOOL_EXECUTION_ERROR" }
   ```
   with HTTP status `502`.
4. If the tool was called from an agent runner, the runner catches it, records the failure on the task, emits `agent.task.failed`, and continues the worker loop.

At every step the error carries its class, code, and HTTP mapping. No layer has to invent its own translation, and no layer swallows the error silently.
