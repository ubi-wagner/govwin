# CLAUDE_CLIFFNOTES.md — Session Handoff

**Purpose:** running handoff document. Updated at every phase milestone. Any future Claude session (or human contributor) reading this should be able to pick up cleanly from the last state.

**Last updated:** Phase 0.5b in progress (2026-04-09).

See also: [CLAUDE.md](../CLAUDE.md), [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md), [TESTING_STRATEGY.md](./TESTING_STRATEGY.md), [NAMESPACES.md](./NAMESPACES.md), [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md), [ERROR_HANDLING.md](./ERROR_HANDLING.md), [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md).

---

## Current state

**Phase:** 0.5b — Foundation completion.

**In flight:**
- Foundation standards docs landing (NAMESPACES, API_CONVENTIONS, TOOL_CONVENTIONS, EVENT_CONTRACT, ERROR_HANDLING, FOLDER_STRUCTURE, TESTING_STRATEGY, DEFINITION_OF_DONE, CLAUDE_CLIFFNOTES).
- Core libs landing: `lib/logger.ts`, `lib/errors.ts`, `lib/api-helpers.ts`, `lib/validation.ts`, `lib/events.ts` rewrite, `lib/storage/` (s3-client + paths).
- Tool framework landing: `lib/tools/` registry + `app/api/tools/[name]/route.ts` + `pipeline/src/tools/` dispatcher.
- Capacity + system_health migration (`008_capacity_and_system_health.sql`).
- Test framework: `__tests__/setup/pg.ts`, fixtures, actors, scenarios.

**Previously shipped in Phase 0.5:**
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
- `v0.5-foundation-partial` — **not yet created** (Phase 0.5 was merged without a tag).
- `v0.5b-foundation-complete` — target tag at the end of the current work.

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
