# Changelog

## v0.5b — Foundation Complete (2026-04-09)

Closes the Phase 0.5 scope gap. Every binding convention doc, every
core library, and the dual-use Tool framework are now in place so
Phase 1 (RFP Curation) can start with a shared foundation instead
of reinventing conventions per route.

### Section A — Conventions docs (9 files, 3164 lines)

Binding standards every future commit checks against.

- `docs/NAMESPACES.md` — canonical registry for event, tool, and log scopes
- `docs/API_CONVENTIONS.md` — response shapes, status codes, handler ordering, `withHandler` usage
- `docs/TOOL_CONVENTIONS.md` — dual-use `Tool` interface, registry enforcement chain, authoring guide
- `docs/EVENT_CONTRACT.md` — `system_events` shape, start/end pattern, correlation via `parent_event_id`
- `docs/ERROR_HANDLING.md` — per-layer SOP, full `AppError` + `ToolError` hierarchy
- `docs/DEFINITION_OF_DONE.md` — per-commit/PR/phase checklists
- `docs/FOLDER_STRUCTURE.md` — import rules + file layout
- `docs/TESTING_STRATEGY.md` — test pyramid, fixtures, actors, scenarios
- `docs/CLAUDE_CLIFFNOTES.md` — running session handoff

### Section B — Core libraries

- `frontend/lib/errors.ts` — `AppError` hierarchy (UnauthenticatedError, ForbiddenError, NotFoundError, ConflictError, ValidationError, RateLimitError, InternalError, ExternalServiceError, ServiceUnavailableError) with stable `code` + HTTP mapping
- `frontend/lib/logger.ts` — pino wrapper with scope-based child loggers, redaction for passwords/secrets/tokens, env-aware transport (JSON in prod, pino-pretty in dev, silent in tests)
- `frontend/lib/validation.ts` — shared zod primitives (`zUuid`, `zEmail`, `zTenantSlug`, `zDottedName`, `zPassword`, `zRole`, `zPaginationRequest`, `zSortOrder`)
- `frontend/lib/api-helpers.ts` — `ok()`, `err()`, `withHandler({ scope, inputSchema, requireAuth, requiredRole, handler })` — the wrapper every future API route uses
- `frontend/lib/events.ts` — rewritten for structured events: `emitEventStart`, `emitEventEnd`, `emitEventSingle` writing to `system_events`, never throws (best-effort instrumentation)
- `db/migrations/007_system_events.sql` — new `system_events` table with 5 indexes, `pg_notify` trigger on `events:{namespace}` channels
- Deleted `frontend/lib/storage.ts` (legacy filesystem layer) — `frontend/lib/storage/` is the authoritative S3 layer
- Added `zod` ^4.3.6, `pino` ^10.3.1, `pino-pretty` to `frontend/package.json`

### Section C — Dual-use Tool framework

- `frontend/lib/tools/base.ts` — `Tool<I, O>` interface, `ToolContext`, `ToolActor`, `defineTool<I, O>()` helper
- `frontend/lib/tools/errors.ts` — `ToolValidationError`, `ToolAuthorizationError`, `ToolNotFoundError`, `ToolExecutionError`, `ToolExternalError` (all extend `AppError`)
- `frontend/lib/tools/registry.ts` — in-memory registry with `register()`, `get()`, `list()`, `invoke()`. The enforcement chain: lookup → role check → tenant scope check → zod parse → `tool.invoke.start` event → handler → `tool.invoke.end` event + `tool_invocation_metrics` row
- `frontend/lib/tools/memory-search.ts` — reference tool: tenant-scoped text search over `episodic_memories`, `semantic_memories`, `procedural_memories`
- `frontend/lib/tools/memory-write.ts` — reference tool: discriminated-union input by `memory_type`, inserts into the correct memory table
- `frontend/lib/tools/index.ts` — module barrel + registration side effects
- `frontend/lib/tools/README.md` — authoring guide
- `pipeline/src/tools/dispatcher.py` — skeleton for the Phase 4 agent task queue consumer

### Section D — Reference route refactors + dual-use HTTP adapter

- Refactored `frontend/app/api/auth/change-password/route.ts` to use `withHandler` + zod + `lib/errors` + `lib/events` — the canonical pattern every future route follows
- Refactored `frontend/app/api/health/route.ts` to use scoped logger (kept custom envelope as the documented exception for load balancer probes)
- NEW `frontend/app/api/tools/[name]/route.ts` — generic HTTP adapter over the tool registry. Every registered tool is automatically invokable via `POST /api/tools/<name>` with `{ input }` body, no per-tool route file needed

### Section E — Capacity tracking + admin panel

- `db/migrations/008_capacity_and_system_health.sql` — `tool_invocation_metrics` table (actor_type CHECK, FK to tenants, indexes on tool_name/tenant_id/errors) + `system_health_snapshots` table
- `frontend/lib/capacity.ts` — `recordInvoke()` writer + `recentToolStats()`, `queueDepth()`, `recentErrors()`, `eventRates()` readers. All readers return safe empty defaults on failure.
- Registry integration: every `invoke()` call now automatically records a `tool_invocation_metrics` row alongside the `tool.invoke.end` event
- `frontend/app/api/admin/system/route.ts` — GET endpoint returning the full system snapshot, gated by `master_admin`
- `frontend/app/admin/system/page.tsx` — server component rendering the master-admin dashboard (queue depth, event rates, tool stats, registered tool catalog, recent errors)
- `lib/rbac.ts` `PATH_MIN_ROLE` updated: `/admin/system` and `/api/admin/system` require `master_admin` (more-specific prefixes placed before `/admin` which requires only `rfp_admin`)

### Section F — Test infrastructure + unit tests

- `frontend/vitest.config.ts` — updated to include `__tests__/**/*.test.ts`
- `frontend/__tests__/errors.test.ts` — 24 tests covering the `AppError` hierarchy + `isAppError` type guard
- `frontend/__tests__/validation.test.ts` — 12 tests covering every zod primitive in `lib/validation.ts`
- `frontend/__tests__/tools-registry.test.ts` — 16 tests covering the registry enforcement chain: duplicate name rejection, name/namespace mismatch, lookup failure, role check, tenant scope check, zod parse, error wrapping, AppError passthrough, audit + metrics integration. **These 16 tests are the executable contract for the Tool framework.**
- Total: 85 passing tests (33 pre-existing + 52 new)
- Added `vitest` ^4.1.3 dev dependency

### Section G — Closeout (this commit)

- `docs/MIGRATIONS_RUNBOOK.md` — exact commands for throwaway test PG, local docker-compose PG, Railway production PG
- `CHANGELOG.md` — this file
- `docs/CLAUDE_CLIFFNOTES.md` updated with Phase 0.5b state
- Full-stack validation run before tagging
- Tag `v0.5b-foundation-complete` cut at the closeout commit

### What's explicitly NOT in 0.5b

Deferred to Phase 1 per the Phase 0.5b plan §"What's NOT in this commit":
- Integration test harness with throwaway PG spin-up (meaningful only once there are feature flows to exercise)
- Playwright E2E smoke tests (same reason)
- Fixture factories for users/tenants/opportunities (Phase 1 builds them alongside the first real route)
- Actor helpers for signed-in request simulation
- The pipeline agent dispatcher's full httpx + queue + retry logic (skeleton exists; Phase 4 wires it alongside the agent runtime)
- System health snapshot writer job (table exists; Phase 4 adds the cron)
- CI wiring that auto-runs all per-commit gates (Phase 1 updates `.github/workflows/ci.yml`)

### Commits in this phase (in order)

| Commit | Scope |
|---|---|
| `3977608` | Section B — core libs + system_events migration + legacy cleanup |
| `ea20623` | Section C — dual-use tool framework + memory reference tools + pipeline dispatcher skeleton |
| `a4e2ca6` | Section D — refactor change-password, health, add `/api/tools/[name]` |
| `2b9b8bf` | Section E — capacity metrics + `/admin/system` dashboard + registry integration |
| `b6b65a0` | Section F — vitest unit tests for errors, validation, tool registry |
| `2e076ea` | Section A — 9 binding conventions docs |
| (pending) | Section G — runbook, changelog, cliffnotes, tag v0.5b-foundation-complete |

---

## Before v0.5b

Previous tag: **v0.5-foundation-partial** (not actually cut as a git tag, but this is the state at the start of today's Phase 0.5b work).

Phase 0.5 shipped (partially): NextAuth v5 + middleware, storage path helpers (frontend + pipeline Python mirror), migration runner restoration, master_admin bootstrap in `001_baseline.sql`, bug fixes (postgres.js transform direction swap, middleware v4→v5 migration, redirect loop, pipeline_schedules dedup, email normalization trigger, apostrophe escaping, import path fixes).

Phase 0.5 was explicitly incomplete: missing the 9 conventions docs, missing core libs (logger/errors/api-helpers/validation), missing the dual-use tool framework entirely, missing capacity tracking + admin dashboard, missing test infrastructure. Phase 0.5b closes all of those gaps.
