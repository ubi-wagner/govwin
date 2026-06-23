# Development Standards

Consolidated reference for all code quality rules, security standards, testing requirements, event naming conventions, database rules, and error handling protocols. Sourced from CLAUDE.md, ERROR_HANDLING.md, API_CONVENTIONS.md, TOOL_CONVENTIONS.md, DEFINITION_OF_DONE.md, and TESTING_STRATEGY.md.

**Architecture reference:** `ARCHITECTURE_V9.md` (root) is the authoritative as-built system design (supersedes V5–V8). All service topology, storage, and CMS facts in this document should be read in light of V9.

---

## 1. Code Quality Rules

### TypeScript (Frontend)

**Build gates -- every commit must pass:**

- `cd frontend && npx tsc --noEmit` must exit 0 (zero type errors)
- `cd frontend && npx next build` must exit 0 (catches ESLint, page data, edge-runtime errors that tsc misses)

**Bans:**

- No `console.log` anywhere under `frontend/app` or `frontend/lib`. Verify: `grep -rn 'console.log' frontend/app frontend/lib` must return 0.
- No `console.error` outside `frontend/lib/logger.ts` (the fallback when pino init fails is the only allowed site).
- No new `any` types. `grep` for `: any` and `as any` in the diff. Exception: boundaries with untyped external libraries, must be narrowed before the value flows anywhere.
- No `// @ts-ignore`. Use `// @ts-expect-error <reason>` instead.
- No `throw new Error('...')`. Use `AppError` subclasses from `lib/errors.ts` or tool error subclasses from `lib/tools/errors.ts`.
- No raw `NextResponse.json({ error })` in API routes. Use `withHandler` wrapper or throw typed errors.
- No `typeof` checks for input validation. Use zod schemas. Shared primitives from `lib/validation.ts`.

**Required:**

- Every new public function must have a JSDoc block with at least one sentence of intent.
- Every new file must have a header comment explaining its purpose and listing its `docs/*.md` reference.
- No `// TODO` or `// FIXME` without an accompanying issue/PR reference.

### Python (Pipeline)

**Build gates:**

- `python3 -m py_compile <changed files>` must exit 0 for every pipeline change.

**Required:**

- All action functions must accept `conn: asyncpg.Connection` as first positional arg.
- All action functions must be async (or return a coroutine).
- All action functions must return a dict that becomes the step's result.
- Every function must have a docstring.

### Shell

- `bash -n <changed scripts>` must exit 0.

### SQL

- All queries must use parameterized templates:
  - Frontend: postgres.js tagged templates (`` sql`SELECT ... WHERE id = ${id}` ``)
  - Pipeline: asyncpg parameterized queries (`$1`, `$2`, etc.)
- Before writing SQL, verify column names in `CLAUDE_CLIFFNOTES.md` section 1.
- ILIKE patterns must be escaped: `input.replace(/[%_\\]/g, '\\$&')`.
- Migrations must be idempotent (apply twice against throwaway PG16 with no errors). Use `IF NOT EXISTS` for DDL.

### Response Shapes

**Success:**

```json
{ "data": { "id": "...", "title": "..." } }
```

**Error (every error response must include both `error` and `code`):**

```json
{ "error": "human-readable message", "code": "MACHINE_READABLE_CODE", "details": {} }
```

The one exception: `/api/health` returns its own shape with top-level `ok` field for load balancer compatibility.

---

## 2. Security Standards

### Auth Checks First

Every handler runs in exactly this order -- no exceptions:

1. **Resolve session** via `auth()`. Throw `UnauthenticatedError` (401) if missing and `requireAuth: true`.
2. **Parse + validate input** via zod schema. Throw `ValidationError` (422) on failure.
3. **Check role** if `requiredRole` is set. Throw `ForbiddenError` (403) if insufficient.
4. **Verify tenant access** -- for tenant-scoped queries, `ctx.tenantId` must match. Throw `ForbiddenError` on mismatch.
5. **Execute business logic.**

This order prevents information leaks (no `ValidationError` before auth check -- that would reveal which fields exist).

### Tenant Isolation

- Every query against a tenant-scoped table MUST include `WHERE tenant_id = ${ctx.actor.tenantId}` (API routes) or `WHERE tenant_id = ${ctx.tenantId}` (tools).
- Never trust `input.tenantId` or any body field named `tenant_id`. The only trusted source is `ctx.tenantId` set by the framework.
- New tenant-scoped tables must include `tenant_id UUID NOT NULL REFERENCES tenants(id)` and an index on `tenant_id`.
- Portal routes MUST verify tenant access -- never query by ID alone.

**Tenant-scoped tables include:** `users`, `proposals`, `proposal_sections`, `proposal_comments`, `proposal_reviews`, `purchases`, `library_units`, `tenant_pipeline_items`, `tenant_profiles`, `spotlights`, `agent_task_queue`, `agent_memories`, `episodic_memories`, `tool_invocation_metrics`.

### Input Validation

- Always zod. Never `typeof` checks.
- Import shared primitives: `zUuid`, `zEmail`, `zTenantSlug`, `zPassword`, `zRole`, `zPaginationRequest` from `lib/validation.ts`.
- Validation failures throw `ValidationError` with `details: { issues: [{ path, message }] }` for field-level errors.

### ILIKE Escaping

Any user input used in an ILIKE clause must be escaped:

```ts
const safeInput = input.replace(/[%_\\]/g, '\\$&');
```

### No Secrets in Code

- No passwords, API keys, tokens, or connection strings in the diff.
- Pre-push check: `git diff --cached | grep -E 'password|secret|api_key|bearer' -i`.
- No new sensitive fields logged. If adding one, update the redact list in `lib/logger.ts`.

### Agent Security

- RLS is ENABLED on 4 memory tables (`episodic_memories`, `semantic_memories`,
  `procedural_memories`, `agent_task_log`) but **zero policies exist** in any migration.
  In practice RLS is bypassed because both services connect as the DB owner. Tenant
  isolation relies exclusively on explicit `WHERE tenant_id = $1` in every query.
- Agent tools enforce `tenant_id` -- agents never construct SQL directly.
- User content clearly delimited in agent prompts (prompt injection defense).

### CMS Service Auth

- API key authentication via `X-CMS-API-Key` header (constant-time comparison via `hmac.compare_digest`).
- If `CMS_API_KEY` env var is not set, all API requests are rejected (fail closed).
- SPA users authenticated via signed session cookie.
- Health, docs, and SPA static routes bypass auth.

---

## 3. Testing Matrix

### Test Pyramid

| Level | Location | Speed | When |
|-------|----------|-------|------|
| Unit | `frontend/__tests__/unit/` | <50ms per test | Every save |
| Integration | `frontend/__tests__/integration/` | ~100ms-1s per test | CI + pre-PR |
| E2E Smoke | `frontend/__tests__/e2e/` (Playwright) | seconds per test | PR + merge |

### What Goes Where

| Subject | Level | Reason |
|---------|-------|--------|
| Pure function in `lib/` (rbac, validation, formatters) | Unit | Fast, deterministic, no side effects |
| New API route | Integration | Routes pull in auth, DB, validation, error handling |
| New tool | Integration (via `registry.invoke`) | Tools must be tested through the registry, not called directly |
| User flow (login -> dashboard -> logout) | E2E | Only way to catch middleware + client JS interactions |
| Schema change | Integration | Exercise new column/table via API route or tool |
| `lib/errors.ts` class hierarchy | Unit | Pure |
| `middleware.ts` path gating | Unit (path logic) + Integration (cookie round-trip) | Both |

### Frontend Testing

**Framework:** Vitest (unit + integration), Playwright (E2E)

**Setup:** `frontend/vitest.config.ts` with `pool: 'forks'`, `singleFork: true` to serialize DB access.

**Throwaway PG:** Tests use `TEST_DATABASE_URL` (CI) or spawn a local PG16 via `pg_ctl` with a temp data directory. Migrations applied once on first import. `TRUNCATE` all tenant-scoped tables in `beforeEach`.

**Fixture pattern:** Factory functions in `frontend/__tests__/fixtures/` that INSERT real rows (not mocks). Sensible defaults, composable. Return full row with all generated fields.

**Actor pattern:** Per-role request helpers in `frontend/__tests__/actors/` that mint NextAuth JWTs and invoke route handlers directly (no HTTP server). Exercises the full auth chain.

**Requirements per PR:**

- At least one unit test for every new pure function in `frontend/lib/`
- At least one integration test for every new API route
- At least one test for every new tool (invoked through registry)
- Every error path has a corresponding `expect(...).rejects.toBeInstanceOf(SomeError)` assertion
- Full test suite passes: `cd frontend && npm test`

### Pipeline Testing

**Framework:** pytest + pytest-asyncio

**Pattern:** Tests against throwaway PostgreSQL. Mocked external APIs (Anthropic, SAM.gov). Tests verify:

- Ingester normalization (pure function, unit-testable)
- Content hashing determinism
- Upsert logic (insert, update, skip)
- Event emission
- Workflow step execution
- Action function behavior

### CMS Testing

**Framework:** pytest with mocked DB pools

**Pattern:** Mock `asyncpg.Pool` for unit tests. Integration tests against a test CMS database.

### CI Jobs

| Job | Runs | What It Tests |
|-----|------|---------------|
| `tsc --noEmit` | Every commit | Zero type errors |
| `next build` | Every commit | ESLint, page data, edge-runtime |
| `py_compile` | Every pipeline commit | Python syntax |
| `vitest run` | Every commit | Unit + integration tests |
| Migration idempotency | Schema changes | Apply twice against throwaway PG |
| `console.log` ban | Every commit | Grep step |

Note: As of Phase 0.5b, CI is not fully wired -- developers must run checks locally before pushing.
Note: **No DB migration check runs in CI** -- migrations are applied manually via `db/migrations/migrate.mjs`
(or the GitHub Actions `migrate.yml` workflow). The CI pipeline does NOT validate that a new migration
applies cleanly against production state.

For the full test-run command reference, CI job inventory, and per-subsystem coverage gaps, see:
- `docs/baseline/TESTING_PROCESS.md` — how to run tests for frontend, pipeline, and CMS
- `docs/baseline/TEST_COVERAGE_MATRIX.md` — what is and is not covered, highest-risk untested paths

---

## 4. Event Naming Convention

### Format

`namespace.entity.verb_past_tense`

Where:
- **namespace** is the domain owner (see table below)
- **entity** is singular, snake_case
- **verb** is past tense, snake_case

### The 7 Namespaces (Closed Set)

| Namespace | Owner | Scope | Admin tenantId | Portal tenantId |
|-----------|-------|-------|----------------|-----------------|
| `finder` | Admin curation | RFP upload, triage, curation, topics, sources, ingestion | `null` | n/a |
| `capture` | Customer lifecycle | Application, subscription, purchase, pin/unpin | `null` (app) | tenant UUID |
| `identity` | Auth only | Login, password change, role change | varies | varies |
| `proposal` | Proposal workspace | Create, section save, comment, stage, lock | n/a | tenant UUID |
| `library` | Content library | Upload, atomize, save atom, delete, bulk ops | n/a | tenant UUID |
| `system` | Infrastructure | Storage, health, errors, capacity, config, workflow events | `null` | n/a |
| `tool` | Tool invocations | Registry dispatch start/end | varies | varies |

### Banned Namespaces

**NEVER use:** `admin`, `cms`, `spotlight`, `pipeline` as namespaces.

### Naming Rules

- Entity is singular: `solicitation` not `solicitations`
- Verb is past tense: `created` not `create` or `creating`
- Max two segments after namespace: `entity.verb` -- no `entity.sub.verb`
- Snake_case for multi-word: `review_requested` not `reviewRequested`

### Good vs Bad Examples

```
Good:  solicitation.claimed, proposal.created, section.saved
       subscription.started, topic.pinned, file.uploaded

Bad:   rfp.triage_claimed        (namespace leaking into type)
       admin.storage.uploaded     (double namespace)
       proposal.workspace_locked  (noun phrase, not verb)
```

### Phase

| Phase | When | Purpose |
|-------|------|---------|
| `start` | Before a multi-step operation begins | Stuck detection, duration tracking |
| `end` | After the operation completes (success or failure) | Retry on failure, chain next job |
| `single` | Instantaneous event | Most events |

Start/end events are correlated via `parent_event_id` (end event references start event).

### Required Event Fields

Every event row in `system_events`:

| Field | Required | Notes |
|-------|----------|-------|
| `namespace` | Yes | One of the 7 namespaces |
| `type` | Yes | `entity.verb_past_tense` |
| `phase` | Yes | `start`, `end`, or `single` |
| `actor_type` | Yes | `user`, `system`, `pipeline`, or `agent` |
| `actor_id` | Yes | User UUID, `system`, worker ID, or agent role |
| `tenant_id` | Nullable | `null` for admin/system events, tenant UUID for portal events |
| `parent_event_id` | Nullable | Links `end` to `start` for paired events |
| `payload` | Yes | JSONB with operation-specific data |

### Emit Patterns

- Frontend: `emitEventStart` / `emitEventEnd` for paired operations, `emitEventSingle` for instantaneous
- Pipeline: `emit_event(conn, namespace, type, payload)` or `BaseIngester._emit_event()`
- CMS: `emit_event(event_type, entity_type=..., entity_id=..., diff_summary=..., payload=...)`
- Tools: Never emit `tool.*` events manually -- the registry is the single emitter via `invoke()`

---

## 5. Database Rules

### Column Name Verification

Before writing SQL, verify column names in `CLAUDE_CLIFFNOTES.md` section 1. This is the authoritative quick reference for all table schemas.

### Migration Standards

- Migrations must be idempotent: apply twice with no errors.
- Use `IF NOT EXISTS` for DDL (CREATE TABLE, CREATE INDEX, ADD COLUMN).
- Destructive migrations (DROP, TRUNCATE) must be gated by `ALLOW_SCHEMA_RESET` checks.
- New tables must include `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` and an update trigger.
- New tenant-scoped tables must include `tenant_id UUID NOT NULL REFERENCES tenants(id)` with an index.
- Migrations are applied via GitHub Actions workflow (`.github/workflows/migrate.yml`), not by the pipeline worker.

### Pool Management

- Frontend: `lib/db.ts` manages the postgres.js connection pool. Validates `DATABASE_URL` at load time. Has `.on('error')` handler.
- Pipeline: Uses `asyncpg.connect()` per task (consumer loop, workflow processor each get their own connection). Reconnects on `PostgresConnectionError`.
- CMS: Two pools -- `get_pool()` for CMS-local database, `get_event_pool()` for shared main database (read-only bridge for profile resolution and event emission).

### Query Patterns

- Always use parameterized queries. Never string concatenation.
- Frontend tagged templates: `` sql`SELECT ... WHERE id = ${id}` ``
- Pipeline asyncpg: `await conn.fetch("SELECT ... WHERE id = $1", some_id)`
- Use `FOR UPDATE SKIP LOCKED` for job queue consumption (prevents double-processing).
- Use `ON CONFLICT ... DO UPDATE SET ... WHERE` for upserts with change detection.
- Use `RETURNING` to get generated values back from INSERT/UPDATE.

---

## 6. Error Handling Protocol

### Error Class Hierarchy

All errors that cross a layer boundary inherit from `AppError` (`frontend/lib/errors.ts`):

| Class | HTTP | Code | When |
|-------|------|------|------|
| `UnauthenticatedError` | 401 | `UNAUTHENTICATED` | Session missing, expired, or invalid |
| `ForbiddenError` | 403 | `FORBIDDEN` | Session valid, but lacks permission |
| `NotFoundError` | 404 | `NOT_FOUND` | Resource doesn't exist |
| `ConflictError` | 409 | `CONFLICT` | State conflicts with requested change |
| `ValidationError` | 422 | `VALIDATION_ERROR` | Input failed zod schema |
| `RateLimitError` | 429 | `RATE_LIMIT_EXCEEDED` | Rate limit exceeded |
| `InternalError` | 500 | `INTERNAL_ERROR` | Unclassifiable failure (last resort) |
| `ExternalServiceError` | 502 | `EXTERNAL_SERVICE_ERROR` | Dependency failed (SAM.gov, Anthropic, Stripe) |
| `ServiceUnavailableError` | 503 | `SERVICE_UNAVAILABLE` | Temporarily unavailable (DB down) |

**Phase 1 domain-specific errors:**

| Class | HTTP | Code | When |
|-------|------|------|------|
| `IngesterRateLimitError` | 429 | `INGESTER_RATE_LIMITED` | Upstream API returned 429 |
| `IngesterContractError` | 502 | `INGESTER_CONTRACT_VIOLATED` | Upstream API schema mismatch |
| `ShredderBudgetError` | 503 | `SHREDDER_BUDGET_EXCEEDED` | Claude token budget exhausted |
| `StateTransitionError` | 409 | `INVALID_STATE_TRANSITION` | Illegal state transition |
| `ClaimConflictError` | 409 | `CLAIM_CONFLICT` | Claim race condition |
| `ReviewSelfApprovalError` | 403 | `SAME_PERSON_REVIEW` | Self-approval attempt |

**Tool-specific errors** (extend `AppError`):

| Class | HTTP | Code | When |
|-------|------|------|------|
| `ToolValidationError` | 422 | `TOOL_VALIDATION_ERROR` | Tool input validation failed |
| `ToolAuthorizationError` | 403 | `TOOL_AUTHORIZATION_ERROR` | Tool authorization failed |
| `ToolNotFoundError` | 404 | `TOOL_NOT_FOUND` | Tool not registered |
| `ToolExecutionError` | 500 | `TOOL_EXECUTION_ERROR` | Tool execution failed |
| `ToolExternalError` | 502 | `TOOL_EXTERNAL_ERROR` | External service failure |

### Per-Service Error Handling

#### Server Components (`app/**/page.tsx`, `app/**/layout.tsx`)

1. Every `await sql` call sits inside a try/catch. No exceptions.
2. Re-throw `NEXT_REDIRECT` digest errors (Next.js uses thrown errors for `redirect()`).
3. Log via `createLogger('page')` -- not `console.error`.
4. Render friendly error UI on unexpected catches. Never dump raw error to user.
5. Never swallow. Bare `catch {}` fails code review.

#### API Routes (`app/api/**/route.ts`)

- Use `withHandler` from `lib/api-helpers.ts`. The wrapper catches `AppError` subclasses, logs them, maps to HTTP responses.
- Throw typed errors inside the handler -- never `return { error: ... }`.
- Return success shape directly; wrapper wraps in `{ data: ... }`.
- Use `ctx.log` for logging (pre-scoped with requestId and route path).
- Auth already resolved -- read `ctx.actor`.
- `AppError` subclasses logged at `warn` level (expected). Unknown exceptions logged at `error` level and replaced with generic `InternalError` (no stack leak).

#### Client Components (`components/**/*.tsx`)

1. Check `res.ok` on every fetch.
2. Parse JSON safely via helper. Failing JSON parse must not crash component.
3. Set error state. Render inline error or toast. Never re-throw from fetch handler.
4. Never throw from a fetch handler (breaks React error boundaries).

#### Pipeline (Python)

- Per-item errors in ingest runs: caught, logged, counted in `result.failed`, run continues.
- Job-level errors: caught by `consume_one_job`, job marked `failed` with error JSON.
- Consumer loop errors: caught, logged, 10s sleep before retry.
- Workflow step errors: caught, `workflow.step_failed` event emitted, workflow continues to next step.
- DB connection loss: attempts reconnect.

#### CMS Workers (Python)

- Per-item try/catch within each worker loop (per-campaign, per-enrollment, per-send, per-message).
- Failed items do not block the batch.
- Persistent failures mark individual records as `failed` with error message.
- Worker loops themselves have outer try/catch -- errors logged, loop continues on next poll.

### Retry Policies

**Honest assessment:**

| Component | Retry Policy |
|-----------|-------------|
| Pipeline jobs | No automatic retry. Failed jobs stay failed. |
| Workflow steps | `retry_count` and `retry_delay_seconds` are declared but NOT executed in V1 processor. |
| Ingester consumer loop | Retries on error with 10s backoff (restarts polling, not individual jobs). |
| Workflow processor | Reconnects on DB loss. Retries polling on error. |
| Email queue | Configurable `max_attempts` per queue item (default 3). Retry on next poll if under limit. |
| Social poster | 3 retries with 5-minute delay between attempts. |
| Drip engine | No retry. Failed enrollments marked `failed`. |
| Campaign executor | No retry. Failed campaigns logged. |
| Content generator | No retry. Failed generations marked `failed`. |
| Email sweep | Per-message/per-account error handling. No retry for individual messages. |

### Logging Standards

- Frontend: `createLogger(scope)` from `lib/logger.ts` with scope from `NAMESPACES.md`. Pino-based, structured JSON.
- Pipeline: Standard library `logging` with format `%(asctime)s [%(levelname)s] %(name)s: %(message)s`.
- CMS: Standard library `logging` with named loggers per module.
- Never `console.log` (frontend) or `print` (pipeline, except for startup messages via reconfigured stdout).
- Never expose internal error details (stack traces, bcrypt hashes, API keys, raw DB errors) to clients.

### What To Do When Things Fail

1. **If a caller could plausibly recover:** give them a typed error with stable `code`.
2. **If nobody can recover:** log the full context and return a generic 500.
3. **The worst anti-pattern:** catching an error, logging nothing, and returning `null`. This is explicitly called out as the single worst pattern in this codebase.
4. **Every catch must do one of:** re-throw, log+render-fallback, or translate to a typed error.
5. **Python workers:** mark the individual item as failed, log the error, continue processing the batch.
6. **Pipeline jobs:** mark job as `failed` with error JSON in `result`. Do not retry automatically.
7. **Workflow steps:** emit `workflow.step_failed` event, continue to next step. Dependent steps run but receive None inputs.

### Escape Hatches (with Required Justification)

| Escape | Rule |
|--------|------|
| ESLint disable | `// eslint-disable-next-line <rule> -- <justification>` -- justification required |
| `console.error` | Only inside `lib/logger.ts` as pino init fallback |
| `any` | Only at untyped external library boundaries, must be narrowed before use |
| `// @ts-expect-error` | Allowed with explanation (becomes stale when fixed) |
| `test.skip(...)` | Requires `// test:skip: <reason>` AND issue/PR link |
