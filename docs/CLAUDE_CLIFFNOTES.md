# CLAUDE_CLIFFNOTES.md — Session Handoff

**Purpose:** running handoff document. Updated at every phase milestone. Any future Claude session (or human contributor) reading this should be able to pick up cleanly from the last state.

**Last updated:** 2026-04-09 — Phase 0.5b COMPLETE, tag `v0.5b-foundation-complete` cut.

See also: [CLAUDE.md](../CLAUDE.md), [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md), [TESTING_STRATEGY.md](./TESTING_STRATEGY.md), [NAMESPACES.md](./NAMESPACES.md), [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md), [ERROR_HANDLING.md](./ERROR_HANDLING.md), [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md), [MIGRATIONS_RUNBOOK.md](./MIGRATIONS_RUNBOOK.md), [../CHANGELOG.md](../CHANGELOG.md).

---

## Current state

**Phase:** 0.5b is **COMPLETE**. Phase 1 (RFP Curation) is **STARTING**.

**Tag:** `v0.5b-foundation-complete` — tagged locally at commit `2c5578a` on branch `claude/analyze-project-status-KbAhg`. 8 commits total on the branch. Not yet pushed to `main`.

**Login works end-to-end:** `eric@rfppipeline.com` / `!Wags$$` → middleware forces `/change-password` → admin dashboard. Verified against a fresh `docker compose down -v && docker compose up -d` this morning.

**Architecture:** V5 as documented in [ARCHITECTURE_V5.md](./ARCHITECTURE_V5.md). A Phase 1 addendum is appended at the end of that file — read it before touching ingesters or the curation workspace.

### What landed in 0.5b (8 commits, all on branch `claude/analyze-project-status-KbAhg`)

| Section | Commit | Deliverable |
|---|---|---|
| A | `2e076ea` | 9 binding conventions docs (3164 lines total) |
| B | `3977608` | Core libs: errors, logger, validation, api-helpers, events rewrite, 007_system_events migration, legacy storage deleted |
| C | `ea20623` | Dual-use tool framework: base, registry, errors, memory-search, memory-write, README, pipeline dispatcher skeleton |
| D | `a4e2ca6` | Refactored `/api/auth/change-password` + `/api/health` to withHandler; NEW `/api/tools/[name]` generic adapter |
| E | `2b9b8bf` | Capacity metrics (migration 008 + `lib/capacity.ts`), `/admin/system` page + `/api/admin/system` endpoint, registry auto-records every invocation |
| F | `b6b65a0` | 85 vitest tests (52 new): errors, validation, registry enforcement chain |
| G | `92d5a80` | Background agent straggler — doc expansion of `ERROR_HANDLING.md` (350 → 457 lines) |
| H | `2c5578a` | Closeout: MIGRATIONS_RUNBOOK, CHANGELOG, CLIFFNOTES update, full validation, tag `v0.5b-foundation-complete` |

**Previously shipped in Phase 0.5 (a):**
- Auth (NextAuth v5 credentials provider, JWT, role encoding).
- Middleware (path gate + auth enforcement, edge-safe split with `auth.config.ts`).
- Storage paths (tenant-scoped, SHA-256 addressed).
- Migration runner (`db/migrations/run.sh`).
- `master_admin` bootstrap seeded in `001_baseline.sql`.
- Debug pass on login/redirect loops.
- postgres.js transform fix (`{ from: toCamel, to: fromCamel }`).
- `pipeline_schedules` dedupe (migration 005).
- Email normalization trigger (migration 006).

**Tags:**
- `v0.5-foundation-partial` — **not created** (Phase 0.5a was merged without a tag — see "Lessons from Phase 0.5a and 0.5b" below for why).
- `v0.5b-foundation-complete` — **cut locally** at `2c5578a`. Will be pushed with the PR that contains this file and `docs/PHASE_1_PLAN.md`.

**Phase 1 scope:** see [PHASE_1_PLAN.md](./PHASE_1_PLAN.md) (sibling commit in the same PR as this cliffnotes update — will exist by the time you read this).

---

## Lessons from Phase 0.5a and 0.5b

Read this before writing any Phase 1 code. Every rule below was paid for with a real bug in 0.5. Skipping them is how you re-earn the same bugs.

### What happened in 0.5a

Phase 0.5 (the original, pre-rebaseline) promised 8 commits: conventions docs, core libs, tool framework, storage layer, auth, capacity/health, test infra, and a cliffnotes-tag closeout. Only partial scope actually shipped. The core libs (logger, errors, api-helpers), the entire dual-use tool framework, all 9 conventions docs, the capacity panel, and the test infrastructure were silently skipped. Auth and storage shipped; everything else was claimed in chat and never committed.

The cause was mechanical, not intellectual: Claude sessions treated "file exists" as "scope done" without cross-checking against the plan. Nobody grep'd the promised file list. Nobody `ls -la`'d the promised directories. Commits were declared complete in conversation and the session moved on. The gap wasn't discovered until the 0.5b rebaseline audit, at which point 5 of 8 commits had to be rebuilt from scratch. Phase 0.5a was merged without a tag precisely because what landed did not match what was promised, and there was no clean artifact to tag.

### What happened in 0.5b

The first half of the day was spent chasing symptoms: failed Railway builds, redirect loops, stale JWT cookies, a missing `master_admin` row. Each symptom looked like its own problem. Each turned out to be a layer deeper than the initial read suggested. The root causes that were actually blocking progress:

1. **postgres.js column transform had `to` and `from` swapped** in `lib/db.ts`. Every field access returned `undefined`, including `user.password_hash`, so `authorize()` never reached `bcrypt.compare`. Login failed with "invalid credentials" while the DB row was perfectly valid. Fixed in PR #67 by swapping to `{ from: toCamel, to: fromCamel }`.
2. **NextAuth v5 middleware was still using the v4 `getToken()` API.** v4's `getToken()` cannot decrypt v5's JWE session cookie, so middleware saw every request as unauthenticated and redirected to `/login`, creating a loop for users who were actually signed in. Fixed in commit `add9907` with the canonical v5 `auth.config.ts` + edge-safe middleware split.
3. **`pipeline_schedules` INSERT used unscoped `ON CONFLICT DO NOTHING` but the table had no UNIQUE constraint.** `ON CONFLICT` with no target is a no-op against a table without a unique index, so every migration run inserted duplicate rows. Fixed in migration `005_dedupe_pipeline_schedules.sql` (which deletes dupes) plus a UNIQUE constraint added to `001_baseline.sql`.
4. **`scripts/seed_admin.ts` read `ADMIN_EMAIL` from env without `.toLowerCase().trim()`.** A mixed-case `.env` value would seed a mixed-case row that the lowercased login query could not find. Fixed in the script and reinforced by migration `006_normalize_user_emails.sql`, which adds a BEFORE INSERT/UPDATE trigger that normalizes email to lowercase at the DB level.

Every one of these four bugs had been flagged as "🟡 SUSPICIOUS but not urgent" in an earlier audit and deferred. Every one of them was the active bug. Nothing that is 🟡 SUSPICIOUS is safe.

### The meta-rules Phase 1 must follow

1. **Scope conformance is not optional.** Before declaring any commit done, open the plan file, extract the list of promised files, and run `ls -la` on every single one. If anything is missing or zero-bytes, the commit is incomplete. The check: `for f in $(grep -oE 'frontend/[^ ]*\.ts[x]?|db/migrations/[^ ]*\.sql' docs/PHASE_1_PLAN.md); do ls -la "$f" || echo MISSING; done`. 0.5a skipped 5 of 8 commits because nobody did this.

2. **`tsc --noEmit` is not sufficient.** Every commit that touches the frontend runs `NODE_ENV=production NEXT_PHASE=phase-production-build npx next build` before push. `tsc` misses ESLint rules (the `react/no-unescaped-entities` apostrophe bug that failed CI twice in 0.5a), page data collection (the `DATABASE_URL` guard bug that only surfaces during static analysis), and edge runtime violations (the middleware v4→v5 migration bug). The check: exit code 0 from the full `next build`, not just from `tsc`.

3. **Run real SQL against real Postgres.** Migrations get applied against a throwaway PostgreSQL 16 instance (spin up as the `postgres` OS user via `pg_ctl -D /tmp/pgtest initdb && pg_ctl -D /tmp/pgtest -l /tmp/pg.log start`) BEFORE push. Apply twice in a row and diff the schema — idempotency is part of the contract. This would have caught the `pipeline_schedules` duplicate accumulation bug on day 1 instead of day 14. The check: two consecutive `bash db/migrations/run.sh` runs produce identical `\dt` output and no new rows in any non-seed table.

4. **Cross-layer contract checks.** Any time two layers share state — frontend auth ↔ middleware, postgres.js column casing ↔ caller camelCase, Python ↔ TypeScript serialization, ingester dedupe hash ↔ DB UNIQUE constraint — put them side by side and verify the contract with a real round-trip. Both the middleware v4/v5 bug and the postgres.js transform bug were "layer A is fine, layer B is fine, but they disagree." Each layer passed its own unit tests. The check: write one integration test that exercises both layers together for every contract.

5. **Cross-language contract checks.** Python and TypeScript implementations of the same concept — storage paths, crypto, event shapes, S3 keys — get round-tripped with real code, not by eyeballing. `lib/storage/paths.ts` ↔ `pipeline/src/storage/paths.py` were byte-verified this way in 0.5b: a test writes a path in TS, reads it in Python, asserts equality, then reverses. Phase 1 ingesters ↔ frontend admin types need the same treatment. The check: at least one round-trip test per shared concept, run as part of `bash scripts/test-all.sh`.

6. **Tool-first, not route-first.** Phase 1 features are implemented as tools first (the canonical place for business logic), then wrapped by thin API adapters that call `executeTool(name, ctx, input)`. Never write a bespoke route handler that isn't backed by a registered tool. This is the dual-use architecture built in 0.5b section C — Phase 1 is its first real test. The check: grep every new `app/api/**/route.ts` for `executeTool` or `registry.get(`; a route that does direct DB work is a regression.

7. **Events are mandatory, not optional.** Every significant Phase 1 action (ingest start/end, triage claim, release for analysis, shredding start/end, curation push) emits start/end events to `system_events` via `lib/events.ts`. Phase 4 agents will subscribe to these; Phase 5 dashboards will replay them; Phase 6 audit logs will query them. If you can't emit an event, you can't do the action. The check: grep every new tool for `emitEvent(` with both a start and end namespace; a tool without events does not pass review.

8. **SUSPICIOUS is not a valid commit state.** Audit findings flagged as "🟡 SUSPICIOUS but not urgent" must either (a) be verified safe with a concrete, committed test, or (b) get fixed in the same commit they were found in. Nothing gets deferred with "I'll come back to it." Every single 0.5a deferral became an active 0.5b bug. The check: before any commit, grep the working tree for `SUSPICIOUS` or `TODO: verify` and resolve every hit.

9. **Tenant isolation is tested, not assumed.** Every Phase 1 tool that reads or writes tenant-scoped data gets a test that seeds two tenants, executes the tool as tenant A, and asserts that tenant B's data is invisible. No exceptions, no "this one is obviously fine." The check: for every new file under `lib/tools/**`, there is a matching test under `tests/unit/tools/**` containing `'isolates tenant'` or `'does not leak cross-tenant'` in a test name.

10. **Background agents get tight scope or they time out.** The 2hr+ agent timeouts last night all happened on agents with vague "write this doc" prompts. The agents that shipped clean had (a) specific file paths, (b) specific section outlines with line-count targets, and (c) "return a brief summary under N words" as the final instruction. Phase 1 background work follows the same pattern. The check: every background agent invocation includes an absolute file path, a section-by-section outline, and an explicit response budget.

### What's intentionally not in this section

Generic software engineering advice ("write tests", "use types"), aspirational statements without mechanism ("be careful with state"), and apologies or emotional language. Every rule above has a specific 0.5 bug behind it and a specific check that prevents its return. If a rule doesn't, it doesn't belong here.

---

## Known-good local dev stack

Commands that are proven to work today. If any of these fail, the stack is broken — fix it before doing new work.

```bash
# First time setup
cd /home/user/govwin
docker compose up -d                        # starts PG (pgvector) with auto-init migrations
cd frontend && npm ci
cd frontend && npm run dev                  # → http://localhost:3000

# Log in as master_admin
#   Email:    eric@rfppipeline.com
#   Password: !Wags$$                       (seeded in 001_baseline.sql)
# Middleware will redirect to /change-password — set a real password on first login.
```

If `docker compose up -d` complains about the PG image, rebuild: `docker compose down -v && docker compose up -d`. The `-v` wipes the data volume and re-runs migrations from scratch.

If the frontend fails to start with a type error, run `cd frontend && npx tsc --noEmit` to isolate; then `npx next build` to catch ESLint issues that tsc misses.

---

## Running tests

(See [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) for the full strategy. Exit status 0 is expected on a clean tree.)

```bash
cd /home/user/govwin/frontend
npm test                   # unit only, <10s
npm run test:unit          # explicit unit list
npm run test:integration   # unit + integration with throwaway PG, ~60s
npm run test:e2e           # Playwright smoke, slow
npm run test:all           # everything — what you run before pushing
npm run test:ci            # same as test:all + coverage + junit XML (CI)
```

Cross-service runner (frontend + pipeline) at the repo root:

```bash
bash scripts/test-all.sh
```

---

## Applying migrations to Railway

See [RAILWAY.md](../RAILWAY.md) Step 6 for the full procedure. Short version:

- Migrations live under `db/migrations/` and are applied in lexical order by `db/migrations/run.sh`.
- In production, migrations are applied via the `.github/workflows/migrate.yml` workflow — **NOT** from inside the pipeline worker. The pipeline Dockerfile does not copy the `db/` directory into the image.
- The workflow is manually dispatched from GitHub Actions. It uses the Railway-injected `DATABASE_URL` and runs `bash db/migrations/run.sh`.
- For emergency manual application: `railway run --service govtech-frontend -- bash db/migrations/run.sh` (the frontend image *does* include `db/` for this purpose).

---

## Environment variables

**Required for local dev** (see `.env.example`):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/govtech_intel` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com (only needed once agent features are active) |

**Railway-injected** (do NOT set these locally):

- `DATABASE_URL` (Postgres plugin reference)
- `AUTH_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_APP_URL`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`

**Pipeline-only** (see RAILWAY.md Step 5):
- `SAM_GOV_API_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `DOCUMENT_STORE_PATH`, `UPLOAD_STORE_PATH`, `LOG_LEVEL`.

---

## Active branches

- `main` — production. Auto-deploys to Railway on push.
- `claude/analyze-project-status-KbAhg` — current Phase 0.5b working branch. Merges to `main` when 0.5b is signed off against the DEFINITION_OF_DONE checklist.

No other long-lived branches. Feature work branches off the Phase 0.5b branch and merges back into it.

---

## Known landmines

Things that will bite you if you don't know:

1. **`pipeline/Dockerfile` only copies `src/`, not `db/`.** Migrations must be applied via the GitHub Actions workflow, **not** from the worker. Do not write migration code inside `pipeline/src/`.
2. **`lib/storage.ts` is legacy** and slated for deletion in 0.5b section B8. Use `lib/storage/s3-client.ts` + `lib/storage/paths.ts` instead. If you see an import from `lib/storage` (no subpath), it's dead code — migrate it.
3. **`middleware.ts` must stay edge-safe.** Never import `lib/db` or `auth.ts` directly. Use `auth.config.ts`. Edge runtime has no `pg`, no Node `crypto`, no `fs`.
4. **postgres.js transform config must be `{ from: toCamel, to: fromCamel }`.** Swapping them silently breaks every DB field access — the bug looks like "all my data is undefined" and you'll spend an afternoon finding it.
5. **`console.log` is banned** — the project policy is `console.error` only, and even that is being migrated to `lib/logger.ts`. If a grep for `console.log` returns anything, the build should be considered broken.
6. **Every JSX apostrophe must be `&apos;`** — ESLint `react/no-unescaped-entities` is on and will fail the build. `can't` → `can&apos;t`.
7. **Test locally with `npx next build`, not just `npx tsc --noEmit`.** tsc misses ESLint errors that only surface at build time.
8. **`master_admin` is seeded with a temp password** (`!Wags$$`) in `001_baseline.sql`. Middleware forces a password change on first login. Do not remove the seed — tests and dev rely on it.
9. **Email addresses are normalized to lowercase** via the trigger from migration 006. Do not manually lowercase emails in application code — rely on the trigger.
10. **`lib/tools/*` cannot import `lib/auth.ts`.** Tools receive the session via `ctx`; they never resolve it themselves. This keeps tools usable from both the API route and the pipeline dispatcher.

---

## What's coming next (after Phase 0.5b)

**Phase 1 — RFP Curation.** The core value prop: RFP experts curate federal opportunities into high-quality, pre-analyzed proposal starting points. Work items:

1. Ingesters (SAM.gov, SBIR.gov, Grants.gov) running on a schedule via `pipeline_schedules`.
2. RFP shredder worker — AI analysis of incoming opportunities, extracts metadata, scores against archetypes.
3. Admin triage queue — `app/admin/rfp-curation/page.tsx` — RFP admin claims opportunities, dismisses junk, holds for review, releases for curation.
4. Curation workspace — `app/admin/rfp-curation/[solId]/page.tsx` — document viewer, compliance picker, metadata panel, annotation layer.
5. Compliance HITL extraction — human-in-the-loop variable extraction using the compliance master list from `003_seed_compliance.sql`.
6. Namespace memory — agent memory keyed by namespace (see NAMESPACES.md) so curation insights persist for later use by tenant-side agents.
7. Push-to-pipeline flow — `POST /api/admin/rfp-curation/[solId]/push` — moves a curated opportunity into the tenant-facing finder pipeline.

Phase 1 depends on every deliverable in Phase 0.5b. Do not start Phase 1 until the 0.5b DoD checklist is green.

---

## Contacts / ownership

- **Eric** — master_admin, founder. Owns RFP curation in V1. Owns customer support in V1. Is the only person with production Railway access.
- **Claude (this agent)** — foundation work, scaffolding, tests, conventions. Pair-programs with Eric on design decisions.
- No other contributors in V1.

For customer service issues in V1, the answer is always "page Eric." There is no other tier.

---

## Tooling

- **Next.js 15.5** (App Router, Server Components, middleware)
- **Node 20** (LTS)
- **Python 3.12** (pipeline)
- **PostgreSQL 16** with `pgvector`, `pg_trgm`, `uuid-ossp`
- **NextAuth v5 beta** (credentials provider, JWT strategy)
- **Tailwind CSS 3.4**
- **Vitest 4** (unit + integration)
- **Playwright** (E2E smoke)
- **postgres.js** (primary DB client; `pg` Pool retained for specific cases)
- **AWS S3** (storage; local dev may fall back to filesystem — TBD in 0.5b)
- **Railway** (deployment — frontend, pipeline, managed Postgres)

---

## If you're reading this in the future as a new Claude session

Onboarding path, in order:

1. **Read `CLAUDE.md`.** It's the short-form project standards. Five minutes.
2. **Read this file (`CLAUDE_CLIFFNOTES.md`).** It tells you what state the project is in. Ten minutes.
3. **Read the binding conventions docs in order:**
   1. [NAMESPACES.md](./NAMESPACES.md) — agent memory + event namespaces.
   2. [API_CONVENTIONS.md](./API_CONVENTIONS.md) — how API routes are structured.
   3. [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md) — how agent tools are written and registered.
   4. [EVENT_CONTRACT.md](./EVENT_CONTRACT.md) — the `system_events` shape.
   5. [ERROR_HANDLING.md](./ERROR_HANDLING.md) — error class hierarchy + handling patterns.
   6. [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md) — the checklist that must be green to ship.
   7. [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md) — where files live.
   8. [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) — how tests are organized and written.
4. **Run the local dev stack** from the "Known-good local dev stack" section above. Sign in as `eric@rfppipeline.com`, change the password, land on the dashboard.
5. **Run the test suite** — `cd frontend && npm run test:all`. If anything fails, that's your first job: fix the red.
6. **Read the Phase 1 plan** in [IMPLEMENTATION_PLAN_V2.md](./IMPLEMENTATION_PLAN_V2.md) so you know where the project is heading.
7. **Update this file** when you hit the next milestone. Future you will thank present you.

Don't skip steps. The binding docs are binding. The landmines are real. The tests are the contract.
