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

---

## Phase 1 worked examples — curation routes

These three routes are the reference implementations of the tool-adapter pattern for the Phase 1 curation workspace. They demonstrate three shapes every admin curation route falls into: (A) a paper-thin single-tool adapter, (B) a list endpoint with cursor pagination, and (C) a multi-tool orchestration route with a rich error matrix. The business logic lives in the tools referenced from `TOOL_CONVENTIONS.md §"Phase 1 worked examples"`; these routes contribute only HTTP plumbing.

### Example 5 — `POST /api/admin/rfp-curation/[solId]/claim`

**File:** `frontend/app/api/admin/rfp-curation/[solId]/claim/route.ts`

The tool-adapter pattern at its thinnest: six lines of handler body, zero business logic, every error path translated for free.

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { invoke } from '@/lib/tools/registry';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({ solId: zUuid });

export const POST = withHandler({
  scope: 'api',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    return invoke('solicitation.claim', { solicitationId: input.solId }, {
      actor: { type: 'user', id: ctx.actor!.id, email: ctx.actor!.email, role: ctx.actor!.role },
      tenantId: ctx.actor!.tenantId,
      requestId: ctx.requestId,
      log: ctx.log,
    });
  },
});
```

What each piece does:

- **Path param parsing:** the dynamic `[solId]` segment is passed through the `InputSchema`. Next.js 15 makes dynamic segments available via `params`; the wrapper reads the URL and zod validates the shape. Any malformed UUID returns 422 before the tool is ever called.
- **`invoke('solicitation.claim', ...)`:** the single call into the tool registry. The registry runs the enforcement chain (look up → role check → tenant scope → zod input parse → emit `tool.invoke.start` → call the handler → emit `tool.invoke.end`). The handler body in the route is blissfully unaware of all of this.
- **`return ok(result)` is implicit:** the `withHandler` wrapper envelopes whatever the handler returns as `{ data: result }`. No manual `NextResponse.json` call.
- **Error translation is automatic.** The tool throws `NotFoundError`, `ConflictError`, or `ToolAuthorizationError`; each is an `AppError` subclass with its own `httpStatus`; the wrapper calls `.toResponseBody()` and returns the right status code. No try/catch in the route.
- **No business logic.** The invariant that a claim must be race-safe lives inside the tool (see `TOOL_CONVENTIONS.md §"Phase 1 worked examples" Example D`). The route literally cannot get it wrong because it has no state to manage.

This is the shape every curation route should converge toward. If a route grows past ~8 lines of handler body, the right fix is almost always "extract the logic into a tool and make the route an adapter over it."

---

### Example 6 — `GET /api/admin/rfp-curation?status=new&limit=50`

**File:** `frontend/app/api/admin/rfp-curation/route.ts`

A list endpoint with cursor pagination. Uses `z.coerce.number()` for URL query params (which arrive as strings), returns the standard `{ items, nextCursor }` envelope, and delegates the actual SQL to a `solicitation.list_triage` tool.

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { invoke } from '@/lib/tools/registry';

const CURATED_STATUS = z.enum([
  'new', 'claimed', 'released', 'ai_analyzed', 'curation_in_progress',
  'review_requested', 'approved', 'pushed_to_pipeline', 'dismissed',
]);

const QuerySchema = z.object({
  status: CURATED_STATUS.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  namespace: z.string().optional(),
});

interface TriageItem {
  id: string;
  opportunityId: string;
  namespace: string;
  status: string;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export const GET = withHandler({
  scope: 'api',
  method: 'GET',
  inputSchema: QuerySchema,
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    const result = await invoke<{ items: TriageItem[]; nextCursor: string | null }>(
      'solicitation.list_triage',
      {
        status: input.status ?? 'new',
        limit: input.limit,
        cursor: input.cursor,
        namespace: input.namespace,
      },
      {
        actor: { type: 'user', id: ctx.actor!.id, email: ctx.actor!.email, role: ctx.actor!.role },
        tenantId: ctx.actor!.tenantId,
        requestId: ctx.requestId,
        log: ctx.log,
      },
    );
    return result;
  },
});
```

Returned shape (wrapped by `withHandler` as `{ data: ... }`):

```json
{
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "opportunityId": "7b2c...",
        "namespace": "afrl:afwerx:sbir:phase_1",
        "status": "new",
        "claimedBy": null,
        "claimedAt": null,
        "createdAt": "2026-04-08T14:22:11.000Z"
      }
    ],
    "nextCursor": "eyJsYXN0SWQiOiI1NTBlODQwMC0uLi4iLCJsYXN0Q3JlYXRlZEF0IjoiMjAyNi0wNC0wOFQxNDoyMjoxMS4wMDBaIn0="
  }
}
```

**Cursor format.** The cursor is an opaque base64-encoded JSON blob with the last row's `id` and `createdAt`. The tool (not the route) encodes and decodes it:

```ts
// Inside solicitation.list_triage
function encodeCursor(row: TriageItem): string {
  return Buffer.from(JSON.stringify({ lastId: row.id, lastCreatedAt: row.createdAt })).toString('base64');
}

function decodeCursor(raw: string | undefined): { lastId: string; lastCreatedAt: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString());
    if (typeof parsed?.lastId !== 'string' || typeof parsed?.lastCreatedAt !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
```

The client treats the cursor as an opaque string and passes it back unchanged on the next request. The server is free to change the encoding at any time without breaking clients.

**Why `z.coerce.number()` for `limit`.** Query-string values arrive as strings (`"50"`, not `50`). `z.coerce.number()` runs `Number(value)` before validating the shape, which is the whole point of the helper — it lets you declare `limit: z.coerce.number().int().min(1).max(200).default(50)` and have it accept both `?limit=50` and a programmatic default.

**Tenant scope.** None — `curated_solicitations` is a global admin table. `requiredRole: 'rfp_admin'` substitutes for tenant isolation; there is no `WHERE tenant_id` clause inside the tool because there is no `tenant_id` column on the table.

---

### Example 7 — `POST /api/admin/rfp-curation/[solId]/push`

**File:** `frontend/app/api/admin/rfp-curation/[solId]/push/route.ts`

A multi-tool orchestration route. The route itself is still thin, but the underlying `solicitation.push` tool composes `solicitation.push` → `memory.write` into a single atomic flow. This is the correct pattern when you need more than one tool call behind a single HTTP endpoint: wrap them in a higher-level tool, not in the route.

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { invoke } from '@/lib/tools/registry';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({ solId: zUuid });

interface PushResult {
  solicitationId: string;
  opportunityId: string;
  pushedAt: string;
}

export const POST = withHandler({
  scope: 'api',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    const result = await invoke<PushResult>('solicitation.push', { solicitationId: input.solId }, {
      actor: { type: 'user', id: ctx.actor!.id, email: ctx.actor!.email, role: ctx.actor!.role },
      tenantId: ctx.actor!.tenantId,
      requestId: ctx.requestId,
      log: ctx.log,
    });
    // UI uses opportunityId to redirect to the tenant-facing view.
    return result;
  },
});
```

**What `solicitation.push` does internally:**

1. **Atomic state transition.** `UPDATE curated_solicitations SET status = 'pushed_to_pipeline', pushed_at = now() WHERE id = ${solId} AND status = 'approved' RETURNING opportunity_id`. Zero rows → `ConflictError('solicitation not in approved state')`.
2. **Required-variable check.** Before the UPDATE, the tool fetches the row's compliance matrix and verifies every `compliance_variables.is_system = true` row has a corresponding value on `solicitation_compliance`. Missing required variables → `ValidationError` with `details: { missingVariables: [...] }` → 422.
3. **Domain event.** `emitEventSingle({ namespace: 'finder', type: 'rfp.curated_and_pushed', ... })` fires after the UPDATE commits. This event is what downstream scoring workers subscribe to.
4. **Procedural memory write.** `invoke('memory.write', { memoryType: 'procedural', ... }, ctx)` records a cross-cycle learning artifact: "for namespace X, curation took N rounds, these variables were hardest, these annotations were most common." The inner tool invocation reuses `ctx.parentEventId` so the event tree reconstructs cleanly (see `TOOL_CONVENTIONS.md §"Audit logging"`).
5. **Return** `{ solicitationId, opportunityId, pushedAt }` so the UI can redirect to `/portal/[tenantSlug]/opportunities/[opportunityId]`.

**Error matrix:**

| Case | Thrown from | AppError | Status | Client handling |
|---|---|---|---|---|
| `solId` doesn't parse as UUID | zod in `withHandler` | `ValidationError` | 422 | form field error |
| Row doesn't exist | tool step 1 pre-check | `NotFoundError` | 404 | toast "solicitation not found" |
| Row exists but not in `approved` state | tool step 1 UPDATE returns zero rows | `ConflictError` | 409 | toast "solicitation must be approved before pushing" |
| Missing required compliance variables | tool step 2 | `ValidationError` with `details.missingVariables` | 422 | highlight the missing fields in the curation UI |
| Actor is not `rfp_admin` | `withHandler` role check | `ForbiddenError` | 403 | middleware normally catches this first |
| DB is down | postgres.js | unknown → wrapped to `InternalError` by `withHandler` | 500 | generic "try again" toast |

**Test matrix for the three business-logic error paths:**

```ts
import { POST } from '@/app/api/admin/rfp-curation/[solId]/push/route';

async function callPush(solId: string, session: { user: { id: string; role: string; email: string; tenantId: null } }) {
  const req = new Request(`http://localhost/api/admin/rfp-curation/${solId}/push`, { method: 'POST' });
  // In real tests, mock `auth()` to return `session`.
  return POST(req);
}

test('404 when solicitation does not exist', async () => {
  const res = await callPush('00000000-0000-0000-0000-000000000000', adminSession(ADMIN_A));
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.code).toBe('NOT_FOUND');
});

test('409 when solicitation is not in approved state', async () => {
  const solId = await seedSolicitation({ status: 'curation_in_progress' });
  const res = await callPush(solId, adminSession(ADMIN_A));
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.code).toBe('CONFLICT');
});

test('422 when required compliance variables are missing', async () => {
  const solId = await seedSolicitation({ status: 'approved' });
  await seedSystemComplianceVariables(['page_limit_technical', 'font_family']);
  // Do NOT seed any solicitation_compliance row, so every required variable is missing.
  const res = await callPush(solId, adminSession(ADMIN_A));
  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.code).toBe('VALIDATION_ERROR');
  expect(body.details.missingVariables).toEqual(
    expect.arrayContaining(['page_limit_technical', 'font_family']),
  );
});

test('happy path: returns opportunityId, writes procedural memory, emits event', async () => {
  const solId = await seedApprovedSolicitationWithAllVariables();
  const res = await callPush(solId, adminSession(ADMIN_A));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.opportunityId).toBeDefined();

  // Side effects
  const [row] = await sql`SELECT status, pushed_at FROM curated_solicitations WHERE id = ${solId}`;
  expect(row.status).toBe('pushed_to_pipeline');
  expect(row.pushed_at).not.toBeNull();

  const events = await sql`SELECT type FROM system_events WHERE type = 'finder.rfp.curated_and_pushed'`;
  expect(events).toHaveLength(1);

  const memories = await sql`SELECT id FROM procedural_memories WHERE name LIKE 'curation:%'`;
  expect(memories.length).toBeGreaterThan(0);
});
```

**Why the orchestration lives in a tool, not the route.** If the route called `solicitation.push` and then `memory.write` directly, a failure between the two would leave the system in a half-committed state — the solicitation marked pushed but no procedural memory recorded. By wrapping both inside a single `solicitation.push` tool, the tool gets to decide the transaction boundary (and, in Phase 4, can be re-invoked by an agent without re-implementing the orchestration). The route stays a thin adapter; the complexity is testable in one place.
