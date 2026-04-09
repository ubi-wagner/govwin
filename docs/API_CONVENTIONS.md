# API Conventions

Binding contract every `frontend/app/api/**/route.ts` handler must satisfy. Non-compliance fails PR review.

See also: [ERROR_HANDLING.md](./ERROR_HANDLING.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md), [NAMESPACES.md](./NAMESPACES.md).

---

## Contract summary (invariants)

1. **Response shape** is always `{ data: T }` on 2xx and `{ error: string, code: string, details?: unknown }` on 4xx/5xx.
2. **Every handler** uses `withHandler` from `lib/api-helpers.ts` — no bespoke try/catch, no raw `NextResponse.json`.
3. **Input validation** is zod. Never `typeof` checks. Shared primitives live in `lib/validation.ts`.
4. **Auth-first ordering**: `(1) resolve session → (2) validate input → (3) verify tenant access → (4) business logic → (5) return`.
5. **Logging** via `lib/logger.ts` with a scope from [NAMESPACES.md §"Log scope names"](./NAMESPACES.md). No raw `console.*`.
6. **Errors** are typed `AppError` subclasses thrown from the handler; the wrapper translates them to HTTP via `httpStatus` + `code`.
7. **Events** — significant handlers emit `emitEventStart` + `emitEventEnd` (or `emitEventSingle` for instantaneous events) to `system_events`.

---

## Response shape

### Success

```ts
interface SuccessResponse<T> {
  data: T;
}
```

Example:
```json
{ "data": { "id": "550e8400-...", "title": "SAM opportunity X" } }
```

### Error

```ts
interface ErrorResponse {
  error: string;     // human-readable message
  code: string;      // stable machine-readable code, e.g. "VALIDATION_ERROR"
  details?: unknown; // optional extra context (zod issues, hint, etc.)
}
```

Examples:
```json
{ "error": "authentication required", "code": "UNAUTHENTICATED" }

{ "error": "input validation failed", "code": "VALIDATION_ERROR", "details": { "issues": [{ "path": "email", "message": "invalid email" }] } }

{ "error": "tenant not found", "code": "NOT_FOUND", "details": { "tenantSlug": "bogus" } }
```

**The ONE exception**: `/api/health` returns its own shape with the top-level `ok` field because load balancers and Railway probes expect it. This exception is documented at the route file; no other route gets to skip the envelope.

---

## HTTP status codes

| Code | Meaning | AppError class |
|---|---|---|
| 200 | OK | — |
| 201 | Created (POST that made a new resource) | — |
| 204 | No Content (DELETE, idempotent success) | — |
| 400 | Bad Request (malformed JSON body) | `ValidationError` with `code: VALIDATION_ERROR` |
| 401 | Unauthenticated (missing or invalid session) | `UnauthenticatedError` |
| 403 | Forbidden (session valid, actor lacks permission) | `ForbiddenError` |
| 404 | Not Found | `NotFoundError` |
| 409 | Conflict (state prevents the change) | `ConflictError` |
| 422 | Unprocessable Entity (zod schema validation failure) | `ValidationError` |
| 429 | Rate Limited | `RateLimitError` |
| 500 | Internal Error (unexpected, fallback) | `InternalError` |
| 502 | External Service Error (SAM.gov, Anthropic, Stripe, Resend failed) | `ExternalServiceError` |
| 503 | Service Unavailable (DB down, maintenance) | `ServiceUnavailableError` |

**401 vs 403**: 401 = "we don't know who you are." 403 = "we know who you are and you can't do this."

**422 vs 400**: 422 = "your JSON parsed but failed our schema." 400 = "your JSON didn't parse."

---

## Handler ordering SOP (non-negotiable)

Every handler runs in exactly this order. The `withHandler` wrapper enforces steps 1–3 automatically; the handler body covers steps 4–5.

1. **Resolve session** via `auth()`. Throw `UnauthenticatedError` if missing and `requireAuth: true`.
2. **Parse + validate input** via the `inputSchema` parameter. Throw `ValidationError` with the formatted zod issues on failure.
3. **Check role** if `requiredRole` is set. Throw `ForbiddenError` if the actor's role ranks below the required one per `hasRoleAtLeast`.
4. **Verify tenant access** — for any query against tenant-scoped tables, ensure the actor's `tenantId` matches. Throw `ForbiddenError` on mismatch.
5. **Execute business logic** inside the handler body. Throw typed errors, return the success data.

Handlers that interleave or skip steps fail review. The order prevents information leaks (no `ValidationError` before auth check — that would tell an attacker which fields exist).

---

## `withHandler` wrapper

Every API route reduces to a single `withHandler` call:

```ts
import { withHandler } from '@/lib/api-helpers';
import { z } from 'zod';
import { zUuid, zPassword } from '@/lib/validation';

const InputSchema = z.object({
  userId: zUuid,
  newPassword: zPassword,
});

export const POST = withHandler({
  scope: 'auth',              // log scope, from NAMESPACES.md
  inputSchema: InputSchema,   // zod or null for no-input routes
  requireAuth: true,          // default true; public routes opt out
  requiredRole: 'rfp_admin',  // optional — enforced via hasRoleAtLeast
  method: 'POST',             // default 'POST'; use 'GET' for query-param parsing
  async handler(input, ctx) {
    // input is typed from the schema
    // ctx.actor is { type, id, email, role, tenantId, tenantSlug, tempPassword } | null
    // ctx.log is a scoped pino child logger
    // ctx.requestId is the per-request correlation id

    // throw typed errors for the wrapper to translate:
    // throw new NotFoundError('user not found');
    // throw new ForbiddenError('cross-tenant access denied');

    return { ok: true }; // enveloped as { data: { ok: true } }
  },
});
```

`withHandler` handles:
- Request id generation (`req_<8 hex>`)
- Scoped logger via `createLogger(scope)` with requestId + path already bound
- Session resolution via `auth()` when `requireAuth: true`
- Body parsing (POST/PUT/PATCH) or query-string parsing (GET/DELETE)
- Zod validation with formatted issue details in the response
- AppError → HTTP translation with stable `code`
- Unknown exception catching with stack-trace logging + generic 500 response

---

## Authentication & session

`withHandler` calls `auth()` from `frontend/auth.ts` before touching the input and places the resolved actor on `ctx.actor`. The actor shape comes directly from the NextAuth v5 session callback in `auth.config.ts`:

```ts
interface HandlerActor {
  type: 'user';
  id: string;            // users.id
  email: string;
  role: Role;            // from rbac.ts ROLES
  tenantId: string | null;
  tenantSlug: string | null;
  tempPassword: boolean; // middleware already redirects temp_password users away from most routes
}
```

`ctx.actor` is `null` when `requireAuth: false`. When `requireAuth: true` (the default) and no session exists, `withHandler` throws `UnauthenticatedError` before calling your handler, so inside the handler `ctx.actor` is non-null and you may use `ctx.actor!.id` without the `!` in strict mode once you narrow the type.

**Never** read the session directly via `auth()` inside a handler — you would skip the scoped logging and role check that `withHandler` performs. The one exception is routes that opt out of the wrapper entirely (e.g., `/api/health`); those MUST document why in a top-of-file comment.

### Tenant access checks

For routes under `/api/portal/:tenantSlug/*`, the wrapper calls `verifyTenantAccess(session, params.tenantSlug)` which:

1. Fails with `ForbiddenError` if the actor's `tenantSlug` does not match the URL param (master_admin and rfp_admin bypass this check — they may cross tenants for support).
2. Sets `ctx.tenantId` to the resolved tenant UUID.
3. Sets `ctx.tenantSlug` to the URL param.

Inside the handler you may assume `ctx.tenantId` is a valid UUID the actor has access to, and you use it as the `WHERE tenant_id = ${ctx.tenantId}` scope. **Never** trust `input.tenantId` or any body field named tenant_id — the only trusted source is `ctx.tenantId` set by the wrapper.

---

## Input validation

Always zod. Never `typeof` checks. Import primitives from `lib/validation.ts`:

```ts
import { zUuid, zEmail, zTenantSlug, zPassword, zRole, zPaginationRequest } from '@/lib/validation';

const InputSchema = z.object({
  tenantSlug: zTenantSlug,
  adminEmail: zEmail,          // lowercases + trims on parse
  newPassword: zPassword,      // 12-256 chars
  role: zRole,                 // matches rbac.ts ROLES enum
});
```

Validation failures throw `ValidationError` with `details: { issues: [{ path, message }] }` so the client can surface field-level errors.

---

## Tenant isolation

Every query against a tenant-scoped table MUST include `WHERE tenant_id = ${ctx.actor.tenantId}`.

Tenant-scoped tables (from `001_baseline.sql`):
- `users` (via `tenant_id` column)
- `tenants` (by id)
- `proposals`
- `proposal_sections`
- `tenant_uploads`
- `library_units`
- `episodic_memories`
- `semantic_memories`
- `procedural_memories`
- `agent_task_queue`
- `agent_task_log`
- `agent_task_results`
- `curated_solicitations` (via `tenant_id` if applicable)

**NOT** tenant-scoped (global): `opportunities`, `compliance_variables`, `agent_archetypes`, `system_config`, `api_key_registry`, `pipeline_schedules`, `system_events` (tenant_id is nullable), `tool_invocation_metrics` (tenant_id is nullable).

When in doubt: if the row represents a user's private data, it's tenant-scoped and needs the `WHERE` clause.

---

## Logging

Every handler uses `ctx.log` (a pino child logger already scoped to the route). Never raw `console.error`.

```ts
async handler(input, ctx) {
  ctx.log.info({ userId: input.userId }, 'processing user update');
  try {
    // ...
  } catch (err) {
    ctx.log.error({ err, userId: input.userId }, 'user update failed');
    throw new InternalError();
  }
}
```

Scope values must come from [NAMESPACES.md §"Log scope names"](./NAMESPACES.md). Adding a new scope requires updating the registry doc in the same PR.

---

## Error handling

Handlers throw typed `AppError` subclasses from `lib/errors.ts`:

```ts
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '@/lib/errors';

async handler(input, ctx) {
  const [row] = await sql`SELECT ... FROM users WHERE id = ${input.userId}`;
  if (!row) throw new NotFoundError('user not found');
  if (row.tenantId !== ctx.actor.tenantId) throw new ForbiddenError('cross-tenant access');
  if (row.archivedAt) throw new ConflictError('user is archived');
  // ... business logic
  return { id: row.id };
}
```

The wrapper catches the throw and produces the correct HTTP status + `{ error, code, details? }` envelope. **Never write bespoke `return NextResponse.json({ error })` in a handler** — that bypasses the audit logging in the wrapper's error path.

---

## Pagination contract

List endpoints use cursor-based pagination. The request schema comes from `zPaginationRequest` in `lib/validation.ts`:

```ts
const InputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  // ... other filters
});
```

The response envelope wraps a `PaginatedResult<T>`:

```json
{
  "data": {
    "items": [...],
    "nextCursor": "eyJpZCI6IjU1MGU4NDAwIn0="
  }
}
```

`nextCursor` is `null` when there are no more pages. Cursors are opaque base64-encoded JSON the client passes back unchanged.

---

## Idempotency

POST endpoints that create resources accept an `Idempotency-Key` header. The server stores recent keys for 24 hours and returns the original response for duplicates.

Phase 5 enforces this; Phase 0.5b documents the contract so client code can start sending the header today and the server silently ignores it until the enforcement lands.

---

## Rate limiting

Contract: exceeding a rate limit returns 429 with `{ error, code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds } }`.

Phase 5 enforces this; Phase 0.5b documents the contract.

---

## Dual-use API ↔ Tool bridge

Every API route that corresponds to an agent tool should be a thin adapter over `registry.invoke(toolName, input, ctx)`. See [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md) and the generic adapter at `frontend/app/api/tools/[name]/route.ts`.

Pattern:
```ts
export const POST = withHandler({
  scope: 'tools',
  inputSchema: z.object({ input: z.unknown() }),
  async handler(body, ctx) {
    const toolCtx = {
      actor: { type: 'user', id: ctx.actor!.id, role: ctx.actor!.role, email: ctx.actor!.email },
      tenantId: ctx.actor!.tenantId,
      requestId: ctx.requestId,
      log: ctx.log,
    };
    return await invoke('memory.search', body.input, toolCtx);
  },
});
```

When possible, use the generic `/api/tools/[name]` endpoint instead of writing a per-tool adapter. Write a custom adapter only when the route needs behavior the generic endpoint can't express (streaming, file upload, custom auth).

---

## Worked examples

### Example 1 — Public read: opportunity list

`frontend/app/api/portal/[tenantSlug]/opportunities/route.ts` — a GET that returns the tenant's pipeline of scored opportunities. Public within the tenant (any `tenant_user+` can read), cursor-paginated, filters via query string.

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { sql } from '@/lib/db';
import { zPaginationRequest } from '@/lib/validation';

const InputSchema = zPaginationRequest.extend({
  minScore: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(['new', 'reviewing', 'qualified', 'pursuing', 'dropped']).optional(),
});

interface OpportunityListItem {
  id: string;
  title: string;
  agency: string | null;
  dueDate: string | null;
  totalScore: number;
  pursuitStatus: string;
}

export const GET = withHandler({
  scope: 'api',
  method: 'GET',
  inputSchema: InputSchema,
  requireAuth: true,
  requiredRole: 'tenant_user',
  async handler(input, ctx) {
    // ctx.tenantId is set by verifyTenantAccess; cast narrows after wrapper guards
    const tenantId = ctx.tenantId!;
    const limit = input.limit;
    const afterId = input.cursor ? JSON.parse(Buffer.from(input.cursor, 'base64').toString()).id : null;

    const rows = await sql<OpportunityListItem[]>`
      SELECT o.id, o.title, o.agency, o.due_date AS "dueDate",
             tpi.total_score AS "totalScore", tpi.pursuit_status AS "pursuitStatus"
      FROM tenant_pipeline_items tpi
      JOIN opportunities o ON o.id = tpi.opportunity_id
      WHERE tpi.tenant_id = ${tenantId}
        AND (${input.minScore ?? null}::numeric IS NULL OR tpi.total_score >= ${input.minScore ?? 0})
        AND (${input.status ?? null}::text IS NULL OR tpi.pursuit_status = ${input.status ?? ''})
        AND (${afterId}::uuid IS NULL OR o.id > ${afterId})
      ORDER BY tpi.total_score DESC, o.id ASC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ id: items[items.length - 1].id })).toString('base64')
      : null;

    ctx.log.info({ tenantId, count: items.length, hasMore }, 'opportunity list served');
    return { items, nextCursor };
  },
});
```

Notes:
- `ctx.tenantId` is the only trusted tenant identifier. `params.tenantSlug` is only used by the wrapper to enforce access.
- The zod input uses `z.coerce.number()` for numeric query params because the URL-encoded value is always a string.
- The SQL `LIMIT ${limit + 1}` trick cheaply detects a next page without a `COUNT(*)` query.
- No event is emitted for reads; events are for state changes.

---

### Example 2 — Tenant-scoped write: create proposal section

`frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/route.ts` — POST that drafts a new section inside a proposal the actor owns. Validates tenant + proposal ownership, writes the row, emits a `proposal.section.drafted` event.

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { sql } from '@/lib/db';
import { emitCustomerEvent, userActor } from '@/lib/events';
import { NotFoundError, ForbiddenError } from '@/lib/errors';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({
  proposalId: zUuid,                       // from the URL, validated by wrapper
  title: z.string().trim().min(1).max(200),
  order: z.number().int().min(0).max(999),
  initialBody: z.string().max(200_000).default(''),
});

export const POST = withHandler({
  scope: 'api',
  method: 'POST',
  inputSchema: InputSchema,
  requireAuth: true,
  requiredRole: 'tenant_user',
  async handler(input, ctx) {
    const tenantId = ctx.tenantId!;
    const actorId = ctx.actor!.id;

    // Verify the proposal belongs to this tenant before any write.
    const [proposal] = await sql<{ id: string; stage: string }[]>`
      SELECT id, stage FROM proposals
      WHERE id = ${input.proposalId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (!proposal) throw new NotFoundError('proposal not found');
    if (proposal.stage === 'submitted') {
      throw new ForbiddenError('cannot edit a submitted proposal');
    }

    const [section] = await sql<{ id: string; createdAt: Date }[]>`
      INSERT INTO proposal_sections (proposal_id, title, "order", body, created_by)
      VALUES (${input.proposalId}, ${input.title}, ${input.order}, ${input.initialBody}, ${actorId})
      RETURNING id, created_at AS "createdAt"
    `;

    await emitCustomerEvent({
      eventType: 'proposal.section.drafted',
      tenantId,
      userId: actorId,
      metadata: {
        actor: userActor(actorId, ctx.actor!.email),
        refs: { proposal_id: input.proposalId, section_id: section.id },
        payload: { title: input.title, order: input.order },
      },
    });

    ctx.log.info({ tenantId, proposalId: input.proposalId, sectionId: section.id }, 'section drafted');
    return { id: section.id, createdAt: section.createdAt };
  },
});
```

Notes:
- The tenant check happens BEFORE any write. This is non-negotiable.
- The event emission uses the correct namespace from `NAMESPACES.md` (`proposal.section.drafted`).
- If the event emission fails, it is logged but does not fail the request — events are write-ahead audit, not a transaction anchor.

---

### Example 3 — Admin action: claim RFP for curation

`frontend/app/api/admin/rfp-curation/[solId]/claim/route.ts` — POST that lets an `rfp_admin` user claim an unclaimed solicitation into their triage queue. Admin-only, uses `requiredRole`, writes a tenant-less global event, enforces the claim-is-atomic invariant via `UPDATE ... WHERE claimed_by IS NULL`.

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { sql } from '@/lib/db';
import { emitOpportunityEvent, userActor } from '@/lib/events';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({
  solId: zUuid, // from URL
});

export const POST = withHandler({
  scope: 'api',
  method: 'POST',
  inputSchema: InputSchema,
  requireAuth: true,
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    const actorId = ctx.actor!.id;

    // Atomic claim: only one admin wins the race.
    const [claimed] = await sql<{ id: string; opportunityId: string | null }[]>`
      UPDATE curated_solicitations
      SET claimed_by = ${actorId},
          claimed_at = now(),
          status = 'claimed',
          updated_at = now()
      WHERE id = ${input.solId}
        AND claimed_by IS NULL
      RETURNING id, opportunity_id AS "opportunityId"
    `;

    if (!claimed) {
      // Either the sol doesn't exist or it's already claimed. Disambiguate.
      const [existing] = await sql<{ id: string; claimedBy: string | null }[]>`
        SELECT id, claimed_by AS "claimedBy" FROM curated_solicitations
        WHERE id = ${input.solId} LIMIT 1
      `;
      if (!existing) throw new NotFoundError('solicitation not found');
      throw new ConflictError('solicitation already claimed');
    }

    await emitOpportunityEvent({
      eventType: 'finder.rfp.triage_claimed',
      opportunityId: claimed.opportunityId ?? undefined,
      metadata: {
        actor: userActor(actorId, ctx.actor!.email),
        refs: { sol_id: claimed.id },
      },
    });

    ctx.log.info({ solId: claimed.id, actorId }, 'solicitation claimed for triage');
    return { id: claimed.id, claimedBy: actorId };
  },
});
```

Notes:
- The `UPDATE ... WHERE claimed_by IS NULL` pattern is the ONLY correct way to implement claim. Never `SELECT` then `UPDATE`; that creates a race window.
- The 404/409 disambiguation after a zero-row update costs one extra query but gives the client a useful error.
- No tenant scoping — curated_solicitations is a global admin table. The `requiredRole: 'rfp_admin'` check substitutes for tenant isolation here.

---

### Example 4 — reference files in-repo

- `frontend/app/api/auth/change-password/route.ts` — the existing reference handler for authenticated state change. Predates `withHandler` and currently uses bespoke try/catch; Phase 0.5b will migrate it to the wrapper without changing behavior.
- `frontend/app/api/tools/[name]/route.ts` (Phase 0.5b) — the generic dual-use adapter that exposes every registered tool over HTTP. See `TOOL_CONVENTIONS.md` for the full wiring pattern.
- `frontend/app/api/health/route.ts` — the only route exempt from the `{ data }` envelope, documented inline.
