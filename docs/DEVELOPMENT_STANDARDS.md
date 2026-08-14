# Development Standards

Consolidated reference for all code quality rules, security standards, testing requirements, event naming conventions, database rules, and error handling protocols. Sourced from CLAUDE.md, ERROR_HANDLING.md, API_CONVENTIONS.md, TOOL_CONVENTIONS.md, DEFINITION_OF_DONE.md, and TESTING_STRATEGY.md.

**Architecture reference:** `ARCHITECTURE_V10.md` (root) is the authoritative as-built system design (the as-built successor to V9; supersedes V5–V9). Read this document's service-topology, storage, and CMS facts in light of V10.

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

**Client-only library bug-classes (Next 15 App Router):**

- **`next/dynamic({ ssr: false })` does NOT forward `ref`.** Next 15.5 assigns the loadable's own
  object to `ref.current` (a truthy non-handle), so a parent that needs the child's
  `useImperativeHandle` API gets garbage instead of the handle. Pass the imperative handle through a
  normal prop (e.g. `innerRef`), never `ref`, when the component is loaded via `next/dynamic`. Fixed
  in `components/rfp-curation/pdf-viewer.tsx` (the `innerRef` prop) with the dynamic caller in
  `curation-workspace.tsx`.
- **`react-pdf` / `pdfjs` crash SSR at module-eval.** They touch browser globals and set up the PDF
  worker on import, which throws the instant Next server-renders the module — and a static import into
  a `'use client'` component is *still* SSR'd. Load such client-only libraries via
  `next/dynamic({ ssr: false })`, never a static import. (A static `react-pdf` import was crashing the
  entire curation workspace.)

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

**Tenant-scoped tables include:** `users`, `proposals`, `proposal_sections`, `proposal_comments`, `purchases`, `library_atoms`, `tenant_opportunity_cards`, `tenant_profiles`, `agent_task_queue`, `episodic_memories`, `semantic_memories`, `procedural_memories`, `tool_invocation_metrics`. (The retired `proposal_reviews`, `library_units`, and `tenant_pipeline_items` were dropped in migrations 121/125 — see the drop rule in §5.)

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

- RLS is ENABLED + FORCED with `tenant_isolation` policies on the memory tables (migs 116/119).
  The frontend connects as `govtech_app` (NOBYPASSRLS) and sets `app.tenant_id` per request, so RLS
  enforces underneath the explicit `WHERE tenant_id = $1` predicate (defense-in-depth). (Pipeline agents
  connect as `rfp_agent` when `AGENT_DATABASE_URL` is provisioned — a separate deploy-gated step.)
- Agent tools enforce `tenant_id` -- agents never construct SQL directly.
- User content clearly delimited in agent prompts (prompt injection defense).

### CMS Service Auth

- API key authentication via `X-CMS-API-Key` header (constant-time comparison via `hmac.compare_digest`).
- If `CMS_API_KEY` env var is not set, all API requests are rejected (fail closed).
- SPA users authenticated via signed session cookie.
- Health, docs, and SPA static routes bypass auth.

---

## 3. Testing Matrix

### Verification backbone (the standard change-verification sequence)

Every change is verified through this exact sequence, in order. Each gate must pass before the
next is meaningful — do not skip ahead:

1. **Type check** — `cd frontend && npx tsc --noEmit` → **0 errors**. Non-negotiable first gate.
2. **Unit + integration** — `cd frontend && npx vitest run` → full suite green (**828/828** at
   migration head 178). Run on every change, not just schema changes.
3. **Migration (schema changes only)** — apply the new migration via the `db/migrations/migrate.mjs`
   runner with `DATABASE_URL` pointed at the sandbox, then confirm with a probe query. The runner is
   idempotent (tracks applied files in `_migration_history`); re-running must be a clean no-op.
4. **Build (risk changes)** — `cd frontend && npx next build` → **exit 0**. Catches ESLint, page-data
   collection, and edge-runtime errors that `tsc` misses. Required for anything that touches page
   structure, dynamic imports, the server/client boundary, or config.
5. **Live drive** — Playwright-drive the changed surface against the running app. Specs live in
   `frontend/e2e/*.spec.ts`; drive a single self-contained spec with
   `npx playwright test e2e/<name>.spec.ts --project=tenant --no-deps` (or `--project=admin`). The
   `--no-deps` flag skips the setup project so one spec runs standalone. A change is not verified
   until its surface has been driven live.
6. **Adversarial bug sweep (large changes)** — for large or cross-cutting changes, run an adversarial
   multi-agent sweep that splits the diff by concern (API / React / SQL). Every reported finding must
   be **PROVEN** — reproduced against the running app or the sandbox DB — not merely asserted. An
   unproven "possible bug" is discarded, not filed.

Sandbox DB coordinates: **`postgres://claude:claude@127.0.0.1:5433/govtech_intel`** (local PG16, trust
auth). Migration head is **178**.

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
- `docs/archive/baseline/TESTING_PROCESS.md` — how to run tests for frontend, pipeline, and CMS
- `docs/archive/baseline/TEST_COVERAGE_MATRIX.md` — what is and is not covered, highest-risk untested paths

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
- Migrations are applied via the `db/migrations/migrate.mjs` runner (GitHub Actions
  `.github/workflows/migrate.yml` in CI; the same runner against the sandbox for local verification),
  never by the pipeline worker.

### Table Retirement (the drop rule)

Drop a table ONLY when **both** conditions hold:

1. It is **superseded by a named successor**, and
2. It has **zero live code references** across every service (frontend + pipeline + CMS).

**"Empty in the sandbox" is NOT a drop signal** — most empty tables are live-but-unused. Tables such
as `verification_tokens` and `invitations` (auth/invite surface), `agent_archetypes` (agent workforce),
`rate_limit_state`, and `system_health_snapshots` (monitoring) are intentionally inert and MUST NOT be
dropped. Before dropping: grep every service for the table name, repoint any last live reads onto the
successor, and in the same migration drop the orphaned indexes and rebuild any dependent views.
Migration 125 dropped 12 superseded, zero-referenced tables (incl. `tenant_pipeline_items`,
`proposal_reviews`, `solicitation_templates`) and rebuilt `v_opportunity_rollup` onto
`tenant_opportunity_cards`; migration 121 dropped the `library_units` family (superseded by
`library_atoms`).

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
- **FK-before-audit ordering.** When a route writes a hard-FK column (e.g.
  `purchases.opportunity_id → opportunities`) alongside a soft-ref column that has NO FK (e.g.
  `proposal_portals.opportunity_id`), validate the FK target exists BEFORE the soft write. Otherwise a
  bad UUID commits the soft write, then the audit/FK-bearing INSERT throws the FK violation — orphaning
  an un-audited row and 500-ing the request. See `app/api/portal/[tenantSlug]/portals/route.ts` (the
  opportunity-existence check that precedes portal creation).

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

- Frontend: `createLogger(scope)` from `lib/logger.ts` with scope from ARCHITECTURE_V9.md §8. Pino-based, structured JSON.
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
