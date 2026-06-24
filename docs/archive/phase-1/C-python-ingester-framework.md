# Phase 1 §C — Python Ingester Framework

**Mini-TODO scope:** Pipeline-side worker code that polls SAM.gov, SBIR.gov, and Grants.gov on cron, dedupes by `content_hash`, and inserts new rows into `opportunities`. Three concrete ingesters + a shared base class + a cron dispatcher in `pipeline/src/main.py`.

**Depends on:** §B (needs `opportunities.content_hash` UNIQUE constraint)
**Blocks:** §E (curation tools query `opportunities`), §J (e2e test starts with a real ingest)

## Why this section exists

Phase 0.5 left `pipeline/src/main.py` as a sleep loop with TODO comments. There's no actual data flowing into the system. Phase 1 starts here: real opportunities arrive, get hashed, get deduped, get inserted, and emit `finder.opportunity.ingested` events. The pre-V2 codebase had three working ingesters at `02d6b70:pipeline/src/ingest/{sam_gov,sbir_gov,grants_gov}.py` that we can lift and adapt.

## Items

- [ ] **C1.** `pipeline/src/ingest/__init__.py` (empty marker) and `pipeline/src/ingest/base.py` — shared base class:
  - Class `BaseIngester(ABC)` with attributes `name: str`, `source: str`, `log: Logger`
  - Abstract methods: `async def fetch_page(cursor: str | None) -> tuple[list[dict], str | None]` (returns `(items, next_cursor)`), `def normalize(raw: dict) -> OpportunityRow`
  - Concrete methods:
    - `async def run(self, run_type: 'incremental' | 'full') -> IngestResult` — outer loop: emit `finder.ingest.run.start`, walk pages, normalize each item, compute `content_hash` via `_hash(normalized)`, INSERT with `ON CONFLICT (content_hash) DO NOTHING`, count inserted/updated/skipped, emit `finder.ingest.run.end` with totals
    - `_hash(row: OpportunityRow) -> str` — deterministic hash of the canonical fields (source + source_id + title + close_date + description first 500 chars). This is what `opportunities.content_hash` is checked against. **Critical:** the hash MUST be deterministic — the same input ALWAYS produces the same hash, otherwise dedupe breaks.
    - `_emit_event(phase: 'start' | 'end', payload: dict, parent_id: str | None = None)` — wraps `lib/events.py emitEventStart/End` (see §B for whether `lib/events.py` exists yet — if not, write a minimal Python emitter for now and document the asymmetry with `frontend/lib/events.ts`)
    - `_check_rate_limit(headers: dict)` — inspects upstream response headers for rate-limit indicators; if hit, raise `IngesterRateLimitError` (defined in `pipeline/src/errors.py` — also need to write that file as part of §C, mirroring `frontend/lib/errors.ts` from 0.5b)
  - Type definitions: `OpportunityRow` is a TypedDict mirroring the `opportunities` table columns
  - **Acceptance:** `python3 -m py_compile pipeline/src/ingest/base.py` exits 0; the `_hash` method has a unit test in `pipeline/tests/test_ingest_base.py` proving determinism (same input → same hash, single-character change → different hash).

- [ ] **C2.** `pipeline/src/errors.py` — Python error class hierarchy mirroring `frontend/lib/errors.ts` from 0.5b. Classes:
  - `AppError(Exception)` base with `code`, `http_status`, `details`
  - `IngesterRateLimitError(AppError)` — `INGESTER_RATE_LIMITED`, 429
  - `IngesterContractError(AppError)` — `INGESTER_CONTRACT_VIOLATED`, 502
  - `ShredderBudgetError(AppError)` — `SHREDDER_BUDGET_EXCEEDED`, 503
  - `ExternalServiceError(AppError)` — `EXTERNAL_SERVICE_ERROR`, 502
  - **Acceptance:** Python compile passes; a unit test at `pipeline/tests/test_errors.py` instantiates each and verifies the code/http_status pair.
  - **Cross-language note:** the Python and TypeScript error class hierarchies must agree on `code` strings — when an ingester throws `INGESTER_RATE_LIMITED`, the system_events row will be queryable from the frontend admin panel using the same code constant. Verify: `grep -c "INGESTER_RATE_LIMITED" frontend/lib/errors.ts pipeline/src/errors.py docs/ERROR_HANDLING.md` returns 3 (one per file).

- [ ] **C3.** `pipeline/src/ingest/sam_gov.py` — SAM.gov ingester. Port from pre-V2 `git show 02d6b70:pipeline/src/ingest/sam_gov.py` (1125 lines per the earlier audit) but tighten:
  - API endpoint: `https://api.sam.gov/opportunities/v2/search`
  - Auth: API key from `os.environ["SAM_GOV_API_KEY"]` OR encrypted DB row in `api_key_registry` table (mirror the pre-V2 pattern that prefers DB-encrypted over env)
  - Page size 100, max pages per run = 50 (5000 items max per single ingest cycle)
  - Rate limit: respect `X-RateLimit-Remaining` header; bail with `IngesterRateLimitError` if `< 10`
  - `normalize(raw)` maps SAM.gov fields → `OpportunityRow`: `noticeId → source_id`, `title → title`, `fullParentPathName → agency`, `office → office`, `solicitationNumber → solicitation_number`, `naicsCode → naics_codes` (split on commas), `classificationCode → classification_code`, `typeOfSetAsideDescription → set_aside_type`, `noticeType → program_type`, `responseDeadLine → close_date`, `postedDate → posted_date`, `description → description` (fetch from the `description` URL if it's a link)
  - Stub mode (`USE_STUB_DATA=true` env var) — generates 5 synthetic opportunities for offline dev
  - **Acceptance:** unit test in `pipeline/tests/test_sam_gov_ingester.py` exercises the normalize function against a fixture JSON file (saved real SAM.gov response) and verifies the output `OpportunityRow` matches a hand-checked expected value.

- [ ] **C4.** `pipeline/src/ingest/sbir_gov.py` — SBIR.gov ingester. Port from pre-V2 `git show 02d6b70:pipeline/src/ingest/sbir_gov.py` (758 lines, three sub-ingesters: solicitations, awards, companies). For Phase 1 we ONLY need the solicitations ingester. Awards + companies are deferred to a Phase 1.5 if data quality demands them.
  - API endpoint: `https://api.www.sbir.gov/public/api/solicitations`
  - No auth required (public API)
  - Page size 50
  - `normalize(raw)`: maps `topics[].topic_number → source_id` (each topic is its own opportunity), `solicitation_title → title`, `agency → agency`, `branch → office`, `program (SBIR/STTR) + phase (I/II) → program_type` (e.g., `sbir_phase_1`), `solicitation_close_date → close_date`, `release_date → posted_date`
  - **Acceptance:** unit test against a saved fixture file.

- [ ] **C5.** `pipeline/src/ingest/grants_gov.py` — Grants.gov ingester. Port from pre-V2 `git show 02d6b70:pipeline/src/ingest/grants_gov.py` (428 lines).
  - API endpoint: `https://api.grants.gov/v1/api/search2`
  - No auth required
  - Page size 250
  - Filter to SBIR/STTR/BAA opportunities only via the `oppStatuses=forecasted|posted` and a keyword filter on the title
  - `normalize(raw)`: maps `id → source_id`, `title → title`, `agencyName → agency`, `cfdaNumbers → naics_codes` (yes, repurposed since Grants.gov uses CFDA not NAICS — document this in a comment), `closeDate → close_date`, `openDate → posted_date`
  - **Acceptance:** unit test against a saved fixture file.

- [ ] **C6.** `pipeline/src/ingest/dispatcher.py` — cron dispatcher logic invoked from `pipeline/src/main.py`:
  - `async def dispatch_pending_jobs(conn)` — reads `pipeline_schedules` for due jobs (where `next_run_at <= now()` and `enabled = true`), inserts a `pipeline_jobs` row for each, advances `next_run_at` per the cron expression
  - `async def consume_jobs_loop(conn)` — main worker loop: `LISTEN pipeline_worker`, dequeue jobs from `pipeline_jobs` where `status = 'pending'`, atomically claim with `UPDATE ... WHERE status = 'pending' AND id = ... RETURNING *`, dispatch to the right ingester (`source = 'sam_gov' → SamGovIngester().run('incremental')`), handle errors via `IngesterRateLimitError` (re-queue with backoff) vs other exceptions (mark `failed`, alert)
  - Replaces the sleep loop in `main.py` while preserving graceful shutdown
  - **Acceptance:** `python3 -m py_compile` passes; a manual end-to-end test in §J runs `pipeline/src/main.py`, sees a job get dequeued, sees opportunities row INSERTed, sees the `finder.opportunity.ingested` event in `system_events`.

- [ ] **C7.** `pipeline/src/main.py` — wire C6 into the existing main loop. Replace the `while not shutdown_event.is_set(): await asyncio.sleep(1)` with the proper consumer loop. Keep the line-buffered stdout reconfigure from 0.5b. Keep the `ALLOW_SCHEMA_RESET` skip. Add a tick that calls `dispatch_pending_jobs` every 60 seconds.
  - **Acceptance:** `python3 -m py_compile` passes; the worker boots locally against docker-compose db without crashing; the deploy logs on Railway show `[pipeline] consumer loop started` after the next deploy.

- [ ] **C8.** Idempotency test — run `sam_gov` ingester twice against a stub fixture and verify zero duplicate rows in `opportunities`. The `content_hash` UNIQUE constraint from §B does the heavy lifting; this test just proves the constraint is respected.
  - **Acceptance:** test exists and passes; a manual `psql -c "SELECT count(*) FROM opportunities WHERE source='sam_gov'"` after two runs returns the same count both times.

- [ ] **C9.** Cross-language hash determinism test — pick the same `OpportunityRow` payload, hash it in both Python (`base.py _hash`) and TypeScript (a stub helper in `frontend/lib/test-helpers/hash.ts` or similar), verify they produce the same hex string. This is the cross-language contract from the meta-rules.
  - **Acceptance:** the test exists, is in `pipeline/tests/test_cross_lang_hash.py`, and passes. If we don't need a TypeScript-side hash for Phase 1, document that in a comment and skip — but at least add a Python-only deterministic test that pickles the input and verifies stability across two Python interpreter invocations.

## Anti-patterns from Phase 0.5

- ❌ **Don't import `from src.something`.** The 0.5b debugging hell came from `from src.seeds.master_admin import seed_master_admin` failing because the script's directory is on `sys.path[0]`, not the cwd. New imports use `from ingest.base import BaseIngester` (bare). Verified by `pipeline/src/main.py` running cleanly.
- ❌ **Don't write to `system_events` from Python without confirming the table exists in the schema and the column shape matches `frontend/lib/events.ts`.** Either share a single `lib/events.py` Python module that mirrors the TS version (preferred), or document the asymmetry loudly.
- ❌ **Don't skip the rate-limit test against a real fixture.** SAM.gov silently rate-limits — the only way to catch a regression is to mock the upstream response with `X-RateLimit-Remaining: 0` and assert the ingester throws.
- ❌ **Don't ship `print(...)` statements without `flush=True`.** 0.5b's pipeline boot was invisible because Python stdout in Docker is block-buffered. The `sys.stdout.reconfigure(line_buffering=True)` at the top of `main.py` solves this — if a new file forks main.py's pattern, it must inherit the same fix.

## Definition of Done for §C

- All 9 items checked
- `python3 -m py_compile pipeline/src/**/*.py` exits 0
- `pytest pipeline/tests/test_ingest_base.py pipeline/tests/test_sam_gov_ingester.py pipeline/tests/test_sbir_gov_ingester.py pipeline/tests/test_grants_gov_ingester.py` passes (4 tests minimum)
- Manual end-to-end against the local docker-compose db: a `pipeline_jobs` row gets created by `dispatch_pending_jobs`, gets consumed by `consume_jobs_loop`, an `opportunities` row appears, a `finder.opportunity.ingested` event is in `system_events`
- Commit message: `feat(phase-1-C): Python ingester framework + sam_gov/sbir_gov/grants_gov + cron dispatcher`
- `docs/PHASE_1_PLAN.md` Section completion tracker has §C ticked
