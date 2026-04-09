# Error Handling SOP

Binding specification for error classes, handling rules, and logging across every layer of the stack. Expands [CLAUDE.md §"SOP: Error Handling"](../CLAUDE.md) into an actionable contract.

See also: [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md).

---

## Philosophy

Errors are data, not exceptions to hide. Every error has:
- **Type** — an `AppError` subclass or `ToolError` subclass
- **Code** — stable machine-readable string (`VALIDATION_ERROR`, `NOT_FOUND`, etc.)
- **Human message** — safe to return to the client
- **Optional details** — structured extra context (zod issues, hint, affected field)
- **HTTP status** — 4xx or 5xx, mapped 1:1 from the class

Logging captures the full stack + request context. Responses return only `{ error, code, details? }` — stack traces never go to the client in production.

---

## Error class hierarchy

All error classes live in `frontend/lib/errors.ts` and `frontend/lib/tools/errors.ts`. Tools error classes extend `AppError` so the HTTP mapping in `withHandler` works transparently.

```ts
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;
  toResponseBody(): { error: string; code: string; details?: unknown };
}
```

### Base hierarchy

| Class | HTTP | `code` | When to throw |
|---|---|---|---|
| `UnauthenticatedError` | 401 | `UNAUTHENTICATED` | Session missing, expired, or invalid |
| `ForbiddenError` | 403 | `FORBIDDEN` | Session valid, actor lacks permission |
| `NotFoundError` | 404 | `NOT_FOUND` | Resource doesn't exist (or actor has no visibility) |
| `ConflictError` | 409 | `CONFLICT` | Resource state prevents the change |
| `ValidationError` | 422 | `VALIDATION_ERROR` | Input failed schema validation |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | Rate limit hit (Phase 5 enforcement) |
| `InternalError` | 500 | `INTERNAL_ERROR` | Fallback for unclassified failures |
| `ExternalServiceError` | 502 | `EXTERNAL_SERVICE_ERROR` | SAM.gov, Anthropic, Stripe, Resend failed |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | DB down, maintenance window |

### Tool-specific subclasses (extend `AppError`)

| Class | HTTP | `code` |
|---|---|---|
| `ToolValidationError` | 422 | `TOOL_VALIDATION_ERROR` |
| `ToolAuthorizationError` | 403 | `TOOL_AUTHORIZATION_ERROR` |
| `ToolNotFoundError` | 404 | `TOOL_NOT_FOUND` |
| `ToolExecutionError` | 500 (overridable) | `TOOL_EXECUTION_ERROR` |
| `ToolExternalError` | 502 | `TOOL_EXTERNAL_ERROR` |

**Prefer the most specific class.** `InternalError` is the fallback when nothing else fits — reaching for it repeatedly is a sign the error taxonomy needs a new subclass.

---

## Per-layer rules

### Server components (e.g., `app/admin/system/page.tsx`)

```ts
export default async function Page() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  try {
    const data = await sql`SELECT ...`;
    return <Dashboard data={data} />;
  } catch (err) {
    // NEXT_REDIRECT from redirect() must re-throw
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err;

    log.error({ err, userId: session.user.id }, 'dashboard load failed');
    return <ErrorBanner message="Something went wrong." />;
  }
}
```

- Try/catch around every `await sql` — server components run on every request and a DB hiccup must not crash the response
- Always re-throw `NEXT_REDIRECT` digest errors — these are Next.js's internal redirect mechanism, not real failures
- Log via scoped logger, then render a friendly fallback UI. Never render a stack trace.

### API routes (every `app/api/**/route.ts`)

**DO NOT** write try/catch in the route body. Use `withHandler`:

```ts
export const POST = withHandler({
  scope: 'api',
  inputSchema: InputSchema,
  requireAuth: true,
  async handler(input, ctx) {
    const row = await findRow(input.id);
    if (!row) throw new NotFoundError('row not found');
    if (row.tenantId !== ctx.actor!.tenantId) throw new ForbiddenError();
    return { id: row.id };
  },
});
```

`withHandler` catches `AppError` subclasses and maps them to `err(error)` with the correct `httpStatus`. Unknown exceptions are logged with full stack + wrapped in `InternalError` for a clean 500 response. Handlers just throw typed errors.

**Anti-pattern**: `return NextResponse.json({ error: '...' })` inside a handler. That bypasses the wrapper's audit logging.

### Client components

```tsx
'use client';

async function onSubmit(e) {
  e.preventDefault();
  setError(null);
  try {
    const res = await fetch('/api/something', { method: 'POST', body: JSON.stringify(data) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'request failed' }));
      setError(body.error ?? 'unknown error');
      return;
    }
    const { data: result } = await res.json();
    // ...
  } catch {
    setError('network error');
  }
}
```

- Check `res.ok` on every fetch
- Parse JSON safely with `.catch(() => fallback)` to handle non-JSON error responses
- Convert errors to React state, never `throw` from an event handler
- Show the user-friendly `body.error` field, not the raw exception

### DB layer (`lib/db.ts`)

- Validate `DATABASE_URL` at load time (already done via `_isBuildPhase` guard)
- Attach `.on('error')` handlers to pools
- Query helper functions in `lib/` that legitimately return `null` when a row doesn't exist are allowed (e.g., `getTenantBySlug(slug) → Tenant | null`) — this is "not found is a valid result," not "swallowing errors"
- Query helpers that encounter a real error (connection refused, query syntax error) MUST throw — never swallow

### Auth (`auth.ts::authorize`)

Separate try/catch per operation — a failed `touchLastLogin` call shouldn't block sign-in:

```ts
async authorize(credentials) {
  // ... parse credentials

  let user: UserRow | null;
  try {
    user = await findUserByEmail(credentials.email);
  } catch (err) {
    log.error({ err, scope: 'authorize.lookup' }, 'user lookup failed');
    return null;
  }
  if (!user) return null;
  if (!user.isActive || !user.passwordHash) return null;

  let passwordOk = false;
  try {
    passwordOk = await bcrypt.compare(credentials.password, user.passwordHash);
  } catch (err) {
    log.error({ err, scope: 'authorize.bcrypt' }, 'bcrypt compare failed');
    return null;
  }
  if (!passwordOk) return null;

  try {
    await touchLastLogin(user.id);
  } catch (err) {
    // Non-critical — don't fail the sign-in on a stale last_login_at
    log.warn({ err, userId: user.id }, 'touchLastLogin failed');
  }

  return { id: user.id, email: user.email, role: user.role, ... };
}
```

- `authorize()` MUST return `null` on any failure (that's NextAuth's contract — returning an object means success)
- Every failure path logs distinctly so incident response can see WHERE the chain broke

### Tools

Tools throw `ToolError` subclasses (from `lib/tools/errors.ts`). See [TOOL_CONVENTIONS.md §"Error handling"](./TOOL_CONVENTIONS.md).

- Never return `null` to signal an error — empty result sets return `{ items: [] }`, not `null`
- Unknown exceptions from the handler are wrapped in `ToolExecutionError` by the registry
- Typed `AppError` subclasses (`NotFoundError`, `ForbiddenError`) thrown by the handler propagate as-is

### Pipeline worker (`pipeline/src/main.py`)

Every job handler is wrapped in try/except that emits an `agent.task.failed` event with the error payload, then continues the main loop. A single bad job must not take down the worker:

```python
async def handle_task(task):
    try:
        result = await dispatch(task)
        await mark_completed(task, result)
    except Exception as err:
        log.error(f"task {task.id} failed: {err}")
        await mark_failed(task, {"message": str(err), "type": type(err).__name__})
        # Don't re-raise — the main loop must keep running
```

---

## Logging rules

**Log every caught error with the scoped logger BEFORE handling it.**

```ts
import { createLogger } from '@/lib/logger';
const log = createLogger('auth');

try {
  await somethingRisky();
} catch (err) {
  log.error({ err, userId, context: 'extra' }, 'somethingRisky failed');
  throw new InternalError(); // or handle as appropriate
}
```

Pino automatically serializes `Error` objects into `{ message, stack, name }` when passed as the `err` field. Always use that field name — the redaction + serialization rules assume it.

### Redaction

The `lib/logger.ts` pino redact paths remove these keys before serialization:
- `password`, `passwordHash`, `password_hash`, `currentPassword`, `newPassword`
- `authSecret`, `AUTH_SECRET`, `apiKey`, `api_key`, `apiKeyEncryptionSecret`, `encrypted_key`
- `stripeSecretKey`, `sessionToken`
- `cookie`, `Cookie`, `authorization`, `Authorization`
- Nested paths: `*.password`, `*.api_key`, `req.headers.cookie`, etc.

If you introduce a new sensitive field, **add it to the redact list in `lib/logger.ts` in the same PR**.

### `console.*` is banned

`grep -rn 'console\.log' frontend/app frontend/lib` must return zero hits.

`console.error` is banned except inside `lib/logger.ts` itself (as a fallback when pino fails to initialize). This is enforced by the `DEFINITION_OF_DONE.md` per-commit checklist.

---

## Anti-patterns (reject in review)

- **Catching and returning `null` without logging** — hides the failure entirely
- **Catching and re-throwing as plain `Error`** — loses the type info the rest of the stack relies on
- **Catching and ignoring** — silent failure
- **Raw `console.error`** — bypasses structured logging + redaction
- **`any` in catch without narrowing** — the type system can't help if you erase it
- **Exposing stack traces in production responses** — security footgun, reveals internals
- **Using `ValidationError` as a generic 400 bucket** — if the issue isn't schema validation, use a more specific class
- **`throw new Error('...')`** in new code — use the AppError hierarchy

---

## Testing errors

Every error path has a test:

```ts
import { expect, it, describe } from 'vitest';
import { ValidationError, NotFoundError } from '@/lib/errors';
import { handlerUnderTest } from '@/app/api/whatever/route';

describe('handler error paths', () => {
  it('throws ValidationError on bad input', async () => {
    await expect(handlerUnderTest({ input: 'garbage' }, ctx)).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when the row is missing', async () => {
    await expect(handlerUnderTest({ id: 'missing' }, ctx)).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

See `frontend/__tests__/tools-registry.test.ts` for the reference test file that covers every error path in the tool registry.

---

## Worked examples

### 1. Server component with redirect re-throw

```tsx
// app/admin/system/page.tsx
export default async function Page() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'master_admin') redirect('/');
  try {
    const data = await fetchSystemSnapshot();
    return <Dashboard data={data} />;
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err;
    log.error({ err }, 'system snapshot failed');
    return <div>Unable to load system snapshot.</div>;
  }
}
```

### 2. API handler throwing `ForbiddenError`

```ts
// app/api/portal/[tenantSlug]/proposals/route.ts
export const POST = withHandler({
  scope: 'api',
  inputSchema: CreateProposalSchema,
  requireAuth: true,
  async handler(input, ctx) {
    if (ctx.actor!.tenantSlug !== input.tenantSlug) {
      throw new ForbiddenError('cross-tenant proposal creation denied');
    }
    const proposal = await createProposal(ctx.actor!.tenantId, input);
    return { id: proposal.id };
  },
});
```

Wrapper translates to 403 `{ error: "cross-tenant proposal creation denied", code: "FORBIDDEN" }`.

### 3. Tool throwing `ToolExecutionError`, registry wrapping + emitting

```ts
// lib/tools/opportunity-score.ts
export const opportunityScore = defineTool({
  name: 'opportunity.score',
  namespace: 'opportunity',
  description: 'Compute the tenant fit score for an opportunity.',
  inputSchema: z.object({ opportunityId: zUuid }),
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    try {
      return await computeScore(input.opportunityId, ctx.tenantId!);
    } catch (err) {
      throw new ToolExecutionError('score computation failed', 500, {
        opportunityId: input.opportunityId,
        cause: String(err),
      });
    }
  },
});
```

The registry catches `ToolExecutionError`, emits `tool.invoke.end` with the error payload, records a `tool_invocation_metrics` row with `success: false, error_code: 'TOOL_EXECUTION_ERROR'`, and re-throws. The HTTP adapter at `/api/tools/[name]` receives the throw, `withHandler` translates to 500 `{ error: 'score computation failed', code: 'TOOL_EXECUTION_ERROR', details: { opportunityId, cause } }`.
