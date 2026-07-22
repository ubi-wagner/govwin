# Testing Process & Standards — RFP Pipeline Portal

**Generated:** 2026-06-23  
**Owner:** Engineering  
**Companion doc:** `docs/baseline/TEST_COVERAGE_MATRIX.md` (component × use-case matrix with gap analysis)

---

## 1. How to Run Each Suite

### 1.1 Pipeline (pytest / pytest-asyncio)

```bash
cd pipeline

# Install dependencies (first time)
pip install -r requirements.txt
pip install pytest pytest-asyncio

# Run all tests (unit + integration; integration auto-skips if TEST_DATABASE_URL not set)
python -m pytest tests/ -v

# Run only no-DB unit tests
python -m pytest tests/ -v -k "not e2e and not integration and not regression"

# Run integration tests (requires a Postgres instance)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/govtech_intel_test \
  python -m pytest tests/ -v

# Run shredder regression in live mode (requires ANTHROPIC_API_KEY + TEST_DATABASE_URL)
SHREDDER_LIVE=1 \
  TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/govtech_intel_test \
  ANTHROPIC_API_KEY=sk-... \
  python -m pytest tests/test_shredder_regression.py -v

# Run a single test file
python -m pytest tests/test_ingest_framework.py -v
```

**conftest.py** (`pipeline/tests/conftest.py`): sets a dummy `DATABASE_URL` env var so `config.py` does not crash on import during collection. Also auto-applies `asyncio` mark to all coroutine test functions via `pytest-asyncio`.

**DB-gated tests:** `test_ingest_e2e.py`, `test_shredder_runner.py`, `test_shredder_regression.py`, `test_cms_content_integration.py`, `test_content_pages_integration.py` all open a real asyncpg connection. They call `pytest.skip()` if `TEST_DATABASE_URL` is not set or the connection is unreachable. CI never sets `TEST_DATABASE_URL`, so these tests never run in CI.

**Known placeholder tests (4 files, 4 `assert True` each):**
- `pipeline/tests/test_sam_gov.py` — `SamGovIngester.fetch_page()`, rate-limits, date helpers
- `pipeline/tests/test_scoring.py` — `ScoringEngine`, `match_tenants`
- `pipeline/tests/test_agents.py` — `AgentFabric`, all 10 archetypes
- `pipeline/tests/test_memory.py` — `MemoryStore`, all memory lifecycle methods

These files exist in CI but contribute exactly 4 passing tests that assert nothing. They are tracked as **technical debt** (see §6).

---

### 1.2 Frontend (Vitest)

```bash
cd frontend

# Install dependencies
npm ci

# Run all tests (Vitest, no browser)
npm test
# or equivalently:
npx vitest run

# Watch mode (development)
npx vitest

# Run a specific test file
npx vitest run __tests__/rbac.test.ts

# Type-check (separate from test run — both required before commit)
npm run type-check   # npx tsc --noEmit

# Lint (ESLint)
npm run lint

# Build (validates no import-time errors)
npm run build
```

**Test runner:** Vitest with jsdom environment. Config is in `frontend/vitest.config.ts` (or `vite.config.ts`).

**Test file locations:** `frontend/__tests__/*.test.ts` (16 files) + `frontend/__tests__/integration/smoke.test.ts`. No `.test.tsx` files exist — all tests are pure TypeScript using mocked dependencies; no React component rendering tests.

**Integration smoke test** (`__tests__/integration/smoke.test.ts`): tests DB connectivity and basic response shapes for ~5 routes. Requires `DATABASE_URL` pointing to a reachable Postgres instance; skips or fails gracefully if not reachable.

**E2E tests:** No Playwright or Cypress tests exist in this codebase as of the 2026-06-23 baseline. The gap is noted; E2E is listed in §4 below as the correct layer for portal tenant-isolation flows and auth round-trips.

---

### 1.3 CMS Service (pytest)

```bash
cd services/cms

# Install dependencies
pip install -r requirements.txt

# Run all CMS tests (most pass with empty DB URLs)
pytest tests/ -v --tb=short

# Run with explicit empty env (matches CI behavior)
CMS_DATABASE_URL="" SHARED_DATABASE_URL="" pytest tests/ -v --tb=short

# Run only tests that require a live DB
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/govtech_intel_test \
  TEST_CMS_DATABASE_URL=postgresql://user:pass@localhost:5432/govtech_cms_test \
  pytest tests/test_page_blocks_integration.py -v
```

**No-DB tests (pass in CI):** `test_health.py`, `test_rule_matching_phase.py`, `test_no_phantom_executors.py`, `test_notify_templates.py`, `test_templates.py`, `test_error_gating.py`, `test_page_blocks_router.py`, `test_sender_identity.py`, `test_todos_router.py` (~10 files).

**Two-DB integration tests:** `test_page_blocks_integration.py` requires both `TEST_DATABASE_URL` (shared `govtech_intel`) and `TEST_CMS_DATABASE_URL` (CMS `govtech_cms`). Skips if either is absent.

---

### 1.4 CMS Frontend SPA (Vite build only)

```bash
cd services/cms/frontend

# Install
npm ci

# Build (Vite bundles to services/cms/static/)
npm run build

# Verify output file exists (done by CI)
test -f ../static/index.html
```

There are **no unit or component tests** for the CMS React SPA (`services/cms/frontend/src/pages/*.tsx`). The SPA is validated only by successful Vite build in CI.

---

### 1.5 E2E (Playwright) — Not Yet Implemented

As of 2026-06-23, there are **no Playwright or Cypress tests** in this codebase. The appropriate layer for the following tests is E2E:
- Full auth round-trip (login → session → portal tenant gate)
- Proposal creation → advance → export flow
- Admin triage → push flow (with real solicitation push event triggering the workflow)
- Stripe checkout redirect (would require Stripe test mode + webhook forwarding)

When added, place Playwright tests in `frontend/e2e/` and add a `playwright` job to CI after the `frontend` job.

---

## 2. CI Jobs (`.github/workflows/ci.yml`)

All jobs run on `ubuntu-latest` and trigger on `push` to `main` and on `pull_request` targeting `main`.

### Job: `frontend`

| Step | Command | What it checks |
|------|---------|----------------|
| Install | `npm ci` | Dependencies locked |
| Type-check | `npm run type-check` | `tsc --noEmit` — zero TypeScript errors (build gate) |
| Lint | `npm run lint` | ESLint rules pass |
| Test | `npm test` | Vitest — 16 test files, all assertions pass |
| Build | `npm run build` | Next.js production build succeeds; fake DB URL used (`postgresql://fake:fake@localhost:5432/fake`) so no real DB needed |

**DB in CI:** The build step uses `DATABASE_URL=postgresql://fake:fake@localhost:5432/fake`. This is intentional — the Next.js build validates import-time correctness only, not runtime DB access.

### Job: `pipeline`

| Step | Command | What it checks |
|------|---------|----------------|
| Install | `pip install -r requirements.txt && pip install pytest pytest-asyncio` | Dependencies |
| Test | `python -m pytest tests/ -v` | All 31 test files run; DB-gated tests auto-skip since `TEST_DATABASE_URL` is not set in CI |

**Important:** Because `TEST_DATABASE_URL` is never set in CI, all integration tests that require a real Postgres connection (`test_ingest_e2e.py`, `test_shredder_runner.py`, `test_shredder_regression.py`, `test_cms_content_integration.py`, `test_content_pages_integration.py`) are silently skipped in every CI run. This means CI **only validates unit tests** for the pipeline. The 4 placeholder files (`test_sam_gov`, `test_scoring`, `test_agents`, `test_memory`) pass trivially.

### Job: `crm`

| Step | Command | What it checks |
|------|---------|----------------|
| Python syntax check | `python -m py_compile src/main.py src/event_listener.py` | Parse-time syntax only |
| Google auth imports | `python -c "from google.oauth2..."` | google-auth package installed |
| CMS tests | `pytest tests/ -v --tb=short` with empty DB URLs | All no-DB CMS unit tests; DB-gated tests skip |
| CMS frontend build | `npm ci && npm run build` | Vite bundle succeeds |
| Verify SPA output | `test -f static/index.html` | Build artifact present |

### Job: `migrate-crm` (main branch only)

Runs after `crm` job, only on `refs/heads/main`. Spins up a real Postgres 16 container and runs `services/cms/db/run.sh` to apply all 11 CMS migrations. Verifies three tables (`cms_posts`, `email_accounts`, `email_outbox`) exist post-migration.

**Critical gap: No equivalent `migrate-main` job exists for the primary `govtech_intel` database.** The 69 main-DB migrations in `pipeline/` are never validated in CI against a real Postgres instance. A broken migration SQL only fails on first Railway deploy. This is a significant CI gap — it means schema regressions (dropped columns, bad DDL) are not caught before merge.

---

## 3. Test Taxonomy

### Unit Tests

Tests that run with **no external dependencies** (no DB, no S3, no HTTP calls, no Anthropic API). All I/O is replaced with mocks, monkeypatches, or fake objects (fake asyncpg connections, mocked boto3, monkeypatched Anthropic client).

**Pipeline unit examples:** `test_ingest_framework.py`, `test_shredder_compliance_mapping.py`, `test_shredder_namespace.py`, `test_shredder_extractor.py`, `test_shredder_sync_extract.py`, `test_storage_paths.py`, `test_storage_helpers.py`, `test_portal_provisioner.py`, `test_tasks_ledger.py`, `test_engine_single_path.py`, `test_hitl_lifecycle.py`, `test_hitl_wait_alignment.py`, `test_force_advance.py`, `test_on_timeout_escalation.py`, `test_todo_producers.py`, `test_error_gating.py`, `test_shred_consolidation.py`, `test_create_drafts_from_scout.py`, `test_template_catalog.py`, `test_cms_content_vertical.py`.

**Frontend unit examples:** All 16 `__tests__/*.test.ts` files — RBAC, errors, storage paths, process health/filter, task urgency, tools suite (7 files), validation, scenarios.

**CMS unit examples:** `test_health.py`, `test_rule_matching_phase.py`, `test_no_phantom_executors.py`, `test_notify_templates.py`, `test_templates.py`, `test_error_gating.py`, `test_page_blocks_router.py`, `test_sender_identity.py`, `test_todos_router.py`.

### Integration Tests

Tests that exercise **real DB connections** (asyncpg or psycopg2 against a live Postgres instance). These tests are skipped when the required env vars are not set. They test the actual SQL semantics, constraint behavior, upsert idempotency, and cross-table relationships.

**Pipeline integration examples:** `test_ingest_e2e.py` (SAM stub mode → real DB upserts), `test_shredder_runner.py` (mock Anthropic + real DB), `test_shredder_regression.py` (golden fixtures + real DB), `test_cms_content_integration.py`, `test_content_pages_integration.py`.

**CMS integration examples:** `test_page_blocks_integration.py` (two-DB publish bridge).

**Frontend integration examples:** `__tests__/integration/smoke.test.ts` (real DB connectivity + basic route shapes).

### E2E Tests

Tests that drive a **real browser or HTTP client** through complete user flows. As of 2026-06-23, **zero E2E tests exist** in this codebase. The appropriate tool is Playwright. E2E tests should cover auth round-trips, portal tenant-isolation enforcement, and the proposal lifecycle (create → advance → export).

---

## 4. Coverage Philosophy

### Current philosophy (inferred from existing tests)

1. **Unit-test pure functions exhaustively.** Pure transform functions (`_hash`, `normalize`, `compute_namespace_key`, `split_matches`, RBAC helpers, path builders, urgency classifiers) have near-complete coverage.

2. **Use fake connections for workflow logic.** Workflow engine tests (HITL, force-advance, ledger, catalog) use fake asyncpg connections (`asyncpg.Connection` subclasses or mock objects) rather than real DB. This keeps these tests fast and CI-safe.

3. **Architectural guard tests over behavior tests.** Several tests (`test_engine_single_path.py`, `test_shred_consolidation.py`, `test_no_phantom_executors.py`) use source inspection (`inspect.getsource`, `ast.parse`, attribute checks) to assert code structure rather than behavior. These lock architectural invariants (dead code absent, module importable, all action types dispatched).

4. **Integration tests gated by env var.** All tests requiring a real DB call `pytest.skip()` if `TEST_DATABASE_URL` is absent. This means they never block CI but also never run in CI. They are intended for developer-local runs and pre-deploy validation.

5. **Golden fixture regression.** `test_shredder_regression.py` uses recorded Anthropic responses replayed through a fake client to catch prompt-output format regressions without spending API credits.

### Recommended additions to coverage philosophy

1. **All critical API routes must have at least one happy-path + one auth-rejection test** (using mocked DB). The current 3% route coverage is the largest single gap.

2. **All known bugs must have a regression test before or alongside the fix.** The 11 confirmed bugs in `BASELINE_FINDINGS.md §3` should each have a corresponding test before the fix is merged.

3. **ILIKE inputs must be tested with `%`, `_`, and `\` characters.** Any function accepting user-supplied search text must have a test that passes a SQL wildcard character and verifies the output is correct (not matching everything).

4. **Crypto primitives must have round-trip tests.** `crypto.py` AES-256-GCM is used in the SAM.gov ingest path. A round-trip test (encrypt → decrypt → assert equal) must exist and run in CI without external dependencies.

---

## 5. Definition of Done — Tests

A feature or bug fix is **done** when all of the following pass:

| Gate | Command | Required |
|------|---------|----------|
| Type-check | `cd frontend && npm run type-check` | Yes — zero errors |
| Lint | `cd frontend && npm run lint` | Yes — zero warnings/errors |
| Frontend tests | `cd frontend && npm test` | Yes — all pass |
| Frontend build | `cd frontend && npm run build` | Yes — no build errors |
| Pipeline tests | `cd pipeline && python -m pytest tests/ -v` | Yes — all pass (unit) |
| CMS tests | `cd services/cms && pytest tests/ -v` | Yes — all pass (unit) |
| New test for new code | — | Yes — every new function that contains business logic must have at least one unit test |
| Regression test for bugs | — | Yes — every confirmed bug fix must have a test that would have caught it |
| Integration test for DB-critical paths | `TEST_DATABASE_URL=... pytest` | Recommended — required for any route that uses `sql.begin()` or multi-table writes |

---

## 6. Technical Debt: Placeholder Tests

Four pipeline test files contain only a class with a single `assert True`. They pass in CI and create the false impression that these subsystems are covered. They are tracked here as explicit debt.

| File | What should be tested | Priority |
|------|-----------------------|----------|
| `pipeline/tests/test_sam_gov.py` | `SamGovIngester.fetch_page()` pagination, 429 rate-limit → `IngesterRateLimitError`, 502 → `IngesterContractError`, `_parse_date()` edge cases, `_detect_program_type()` | High |
| `pipeline/tests/test_scoring.py` | `match_tenants()` multi-factor scoring (NAICS overlap, keyword match, agency preference, set-aside, program type, timeline weighting); `ScoringEngine.score_all_tenants()` delegation | High |
| `pipeline/tests/test_agents.py` | `AgentFabric` instantiation + archetype registration; `invoke_agent()` tool-use loop (mocked Anthropic); `ToolRegistry.create_default_registry()` tenant-isolation enforcement (9 SQL handlers) | High |
| `pipeline/tests/test_memory.py` | `MemoryStore.store()`, `.recall()`, `.search()` against fake asyncpg; `write_episodic/semantic/procedural`; `promote_to_semantic`; `archive_memories`; `update_decay` | Medium |

**Action:** Replace each `assert True` placeholder with real tests in P3. Do not add more placeholder tests.

---

## 7. CI Gap Summary

| Gap | Impact | Recommended fix |
|-----|--------|-----------------|
| No `migrate-main` CI job | Main-DB schema regressions (bad DDL, dropped columns) only fail at Railway deploy | Add a job that spins up Postgres 16, applies `pipeline/migrations/*.sql` via the migration runner, and asserts key tables exist |
| `TEST_DATABASE_URL` never set in CI | All 5 integration tests permanently skipped in CI | Add a `postgres` service to the `pipeline` CI job; run integration suite against it |
| 4 placeholder test files | False confidence in pipeline coverage | Author real tests (see §6) |
| Zero E2E tests | Auth flow, portal tenant isolation, and Stripe checkout never exercised end-to-end | Add Playwright suite; add `e2e` CI job after `frontend` build |
| No route-level API tests | 133/138 frontend API routes have zero coverage | Add vitest route handler tests with mocked DB for critical paths (see matrix Top 15) |
| CMS worker tests absent | Email delivery, drip cadence, campaign execution untested | Add pytest unit tests with fake DB + fake Gmail client for `email_queue`, `email_sweep`, `drip_engine` |

---

## 8. Quick Reference: Test Counts by File (2026-06-23 baseline)

### Pipeline (`pipeline/tests/` — 31 files)

| Category | Files | Real test functions (approx.) |
|----------|-------|-------------------------------|
| Ingest (framework + e2e) | 2 | ~25 |
| Shredder (runner, extractor, mapping, namespace, sync_extract, regression, consolidation) | 7 | ~40 |
| Storage (paths + helpers) | 2 | ~20 |
| Portal provisioner | 1 | ~5 |
| Tasks ledger | 1 | ~8 |
| Workflow engine (engine, HITL x2, force-advance, timeout, error-gating, todo-producers, template-catalog, create-drafts, cms-content x2, content-pages) | 12 | ~35 |
| **Placeholder** | 4 | 4 (trivial) |
| **Total** | **31** | **~133 real + 4 placeholder** |

### Frontend (`frontend/__tests__/` — 16 files + 1 integration)

| Category | Files | Approximate test count |
|----------|-------|----------------------|
| Lib (rbac, errors, storage-paths, process-health, process-filter, task-urgency, validation) | 7 | ~50 |
| Tools (registry + 6 domain tool suites) | 7 | ~60 |
| Scenarios | 1 | ~5 |
| Integration smoke | 1 | ~5 |
| **Total** | **16 + 1** | **~120** |

### CMS (`services/cms/tests/` — 10 files)

| Category | Files | Approximate test count |
|----------|-------|----------------------|
| No-DB unit tests (health, rule-matching, phantom-executors, notify-templates, templates, error-gating, page-blocks-router, sender-identity, todos-router) | 9 | ~50 |
| Integration (page-blocks two-DB) | 1 | ~5 |
| **Total** | **10** | **~55** |

**Grand total (real tests only):** approximately **305 real tests** across all three suites. The 4 pipeline placeholder files add 4 trivially-passing tests that should not be counted toward coverage.

---

## 9. Pointer to Coverage Matrix

For the component × use-case matrix showing per-row coverage status, existing test files, risk rating, and gap notes:

**`docs/baseline/TEST_COVERAGE_MATRIX.md`**

The Top 15 untested critical paths from that document, with unit-testability assessment, are reproduced in the matrix's "Top 15 Untested Critical Paths" section.
