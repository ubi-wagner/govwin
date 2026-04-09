# FOLDER_STRUCTURE.md — Where Every File Lives

**Status: BINDING.** Moving a file to a different directory requires updating this document. If you find yourself wanting to put a file in a location not covered here, update this doc in the same PR.

See also: [CLAUDE.md](../CLAUDE.md), [NAMESPACES.md](./NAMESPACES.md), [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md), [ERROR_HANDLING.md](./ERROR_HANDLING.md), [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md).

---

## Top-level repo layout

```
govwin/
  frontend/          # Next.js 15 app (UI + API routes)
  pipeline/          # Python worker (ingest, scoring, agents)
  services/cms/      # Dormant V1 placeholder (FastAPI)
  db/migrations/     # Numbered SQL migrations (applied in order)
  scripts/           # Dev helpers + one-off tasks
  docs/              # Architecture + binding convention docs
  .github/workflows/ # CI + migrate workflow
  CLAUDE.md          # Dev standards (binding)
  RAILWAY.md         # Deployment runbook
  docker-compose.yml # Local dev stack (PG + optional services)
  Makefile           # Dev loop targets
```

Rule: anything that is neither a service (`frontend/`, `pipeline/`, `services/cms/`) nor shared infrastructure (`db/`, `scripts/`, `docs/`, `.github/`) belongs at the root only if it is universal (`CLAUDE.md`, `RAILWAY.md`, `docker-compose.yml`, `Makefile`). Do not add feature code at the root.

---

## frontend/ layout

```
frontend/
  app/                           # Next.js App Router
    (marketing)/                 # public marketing routes (no auth)
      page.tsx                   # home
      about/, features/, pricing/, engine/, team/, customers/, get-started/
      legal/                     # terms, privacy, acceptable-use, ai-disclosure
    (auth)/                      # unauthenticated auth flows
      login/
      change-password/
    admin/                       # rfp_admin+ area
      dashboard/
      tenants/[tenantId]/
      rfp-curation/[solId]/
      pipeline/, sources/, agents/, purchases/, events/, analytics/, waitlist/
    portal/                      # tenant portal (tenant_user+)
      page.tsx                   # tenant selector
      [tenantSlug]/
        dashboard/, pipeline/, spotlights/, proposals/, library/, documents/, team/, profile/
    invite/[token]/              # invite acceptance
    dashboard/                   # post-login redirect target
    api/                         # API route handlers (see API_CONVENTIONS.md)
      auth/[...nextauth]/
      auth/change-password/
      health/                    # health check (unauth)
      admin/                     # admin-scoped APIs (rfp_admin+)
        tenants/, rfp-curation/, pipeline/, sources/, agents/, purchases/, analytics/, waitlist/, dashboard/
      portal/[tenantSlug]/       # tenant-scoped APIs (tenant_user+)
        dashboard/, proposals/, spotlights/, library/, opportunities/, team/, profile/, notifications/, uploads/, purchases/, agents/
      tools/[name]/              # dual-use tool invocation endpoint (0.5b)
      events/                    # SSE event stream (optional)
    error.tsx                    # route error boundary
    global-error.tsx             # root error boundary
    layout.tsx                   # root layout
  components/                    # React components (PascalCase exports)
    ui/                          # base components (buttons, cards, modals)
    admin/                       # admin-only components
    portal/                      # portal-only components
    marketing/                   # marketing page components
    proposals/                   # proposal workspace (section-editor, compliance-sidebar, stage-pipeline, review-form)
    rfp-curation/                # curation workspace (document-viewer, compliance-picker, metadata-panel, annotation-layer)
  lib/                           # shared libraries — NO React, NO Next imports in edge-safe files
    tools/                       # Tool implementations + registry (0.5b)
      index.ts                   # barrel — registry export
      memory-search.ts, memory-write.ts, opportunity-search.ts, ...
    storage/                     # S3 client + path helpers (authoritative)
      s3-client.ts               # S3 client singleton
      paths.ts                   # tenant-scoped path builders
      index.ts                   # barrel
    logger.ts                    # structured logger (0.5b)
    errors.ts                    # error class hierarchy (0.5b)
    api-helpers.ts               # response helpers + withHandler wrapper (0.5b)
    validation.ts                # shared zod schemas (0.5b)
    events.ts                    # system_events emitter (rewritten in 0.5b)
    db.ts                        # postgres.js client (the one DB handle)
    rbac.ts                      # role hierarchy + path gates
    crypto.ts                    # AES-256-GCM for API key storage
    auth.ts                      # NextAuth v5 full config (Node-only)
    # legacy, slated for deletion in 0.5b B8:
    # storage.ts                 # DELETED — use storage/ subdirectory
  types/
    index.ts                     # shared TypeScript types
  __tests__/                     # vitest tests (0.5b)
    setup/pg.ts                  # throwaway PG spin-up
    fixtures/                    # row factories (users, tenants, opportunities, memories)
    actors/                      # per-role request helpers
    scenarios/                   # cross-actor flows
    unit/                        # pure function tests
    integration/                 # API route + tool tests
  auth.ts                        # re-exports from lib/auth.ts for Node runtime
  auth.config.ts                 # edge-safe NextAuth config (no DB imports)
  middleware.ts                  # path gate + auth enforcement (edge runtime)
  next.config.mjs
  tailwind.config.ts
  tsconfig.json
  vitest.config.ts
  playwright.config.ts
  package.json
  Dockerfile
```

Depth-3 is enough. If you need to nest deeper, do it — the directory names are the doc.

---

## pipeline/ layout

```
pipeline/
  src/
    main.py                      # worker entry point — LISTEN/NOTIFY + dequeue loop
    config.py                    # loads env vars (DATABASE_URL, ANTHROPIC_API_KEY, etc.)
    crypto.py                    # mirrors frontend/lib/crypto.ts (AES-256-GCM)
    events.py                    # mirrors frontend/lib/events.ts (emit to system_events)
    health.py                    # optional healthcheck for pipeline
    storage/                     # Python S3 mirror of frontend/lib/storage/
      __init__.py
      s3_client.py               # boto3 client
      paths.py                   # tenant-scoped path builders
    tools/                       # Python tool dispatcher (0.5b)
      __init__.py                # dequeues agent_task_queue, POSTs to /api/tools/:name
    ingest/                      # Phase 1 ingesters
      sam_gov.py, sbir_gov.py, grants_gov.py
    scoring/
      engine.py                  # curated-pipeline scoring
    workers/                     # Phase 1-3 background workers
      rfp_shredder.py            # AI RFP analysis
      grinder.py                 # document → library units
      embedder.py                # vector embedding generation
      document_fetcher.py        # download RFP PDFs
      reminder.py                # deadline nudges
      emailer.py                 # Resend delivery
    agents/                      # Phase 4 Agent Fabric
      fabric.py                  # orchestrator
      context.py                 # context assembly
      memory.py                  # memory CRUD + hybrid search
      tools.py                   # tool registry (Python side)
      archetypes/                # archetype classes (one per role)
      learning/                  # diff_analyzer, preference_extractor, pattern_promoter, outcome_attributor, calibrator
      lifecycle/                 # decay, compactor, gc, contradiction_resolver
    automation/
      engine.py
  tests/                         # pytest
  requirements.txt
  Dockerfile                     # ONLY copies src/ into the image
```

The pipeline Dockerfile copies `src/` into the image. It does **not** copy `db/`, `scripts/`, or repo root files. See "Import rules" #6 below.

---

## db/migrations/ layout

Migrations are numbered, sorted lexically, and applied in order by `db/migrations/run.sh`. Current state at end of Phase 0.5b:

| File | Purpose |
|---|---|
| `000_drop_all.sql` | destructive reset, gated by `ALLOW_SCHEMA_RESET=true` |
| `001_baseline.sql` | full schema + `master_admin` seed |
| `002_seed_system.sql` | `system_config`, `pipeline_schedules`, feature flags |
| `003_seed_compliance.sql` | compliance variables master list |
| `004_seed_agents.sql` | agent archetypes |
| `005_dedupe_pipeline_schedules.sql` | cleanup (earlier 0.5b commit) |
| `006_normalize_user_emails.sql` | email lowercase trigger (earlier 0.5b commit) |
| `007_system_events.sql` | structured event stream (0.5b B7) |
| `008_capacity_and_system_health.sql` | capacity metrics + health view (0.5b E2) |

Every migration must be idempotent — re-running must not break a clean or a previously-migrated DB. Use `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`.

New migrations are applied in production via the `.github/workflows/migrate.yml` workflow, **not** from inside the pipeline worker. See RAILWAY.md.

---

## Import rules (hard constraints)

These are enforced by code review; violating any of them will break a build.

1. **`frontend/middleware.ts` must be edge-safe.** It cannot import `lib/db`, `lib/crypto`, or `auth.ts` (which transitively pulls `lib/db`). It may only import from `auth.config.ts`.
2. **`frontend/auth.config.ts` must be edge-safe.** Zero Node-only imports — no `pg`, no `postgres`, no `crypto` module, no `fs`. Use Web Crypto or delegate to `auth.ts` (Node-side).
3. **`frontend/lib/*.ts` must never import from `frontend/app/*`.** Libraries are lower-level than application code. Crossing this boundary creates circular dependencies and breaks tree-shaking.
4. **`frontend/components/*.tsx` must never import from `frontend/lib/db` directly.** Client components call API routes; server components may call API helpers but should prefer the same lib functions the API routes use.
5. **`frontend/lib/tools/*.ts` may import `frontend/lib/db`, `frontend/lib/events`, `frontend/lib/errors`** — but **NOT** `frontend/lib/auth.ts`. Tools receive the session as `ctx`; they never resolve it themselves.
6. **`pipeline/src/*.py` must not assume `db/` is in the container.** The Dockerfile only copies `src/`. Migrations are applied via the GitHub Actions workflow, not from the worker.
7. **Every new file under `frontend/lib/` that is part of a module group must be exported via an index barrel** (e.g., `lib/tools/index.ts`, `lib/storage/index.ts`). Top-level singletons (`lib/db.ts`, `lib/logger.ts`) are imported by path, no barrel needed.

---

## Naming rules

| Kind | Convention | Example |
|---|---|---|
| TypeScript files | kebab-case | `api-helpers.ts`, not `apiHelpers.ts` |
| React components | PascalCase export, kebab-case filename | `section-editor.tsx` exports `SectionEditor` |
| SQL migrations | `NNN_snake_case_description.sql` | `007_system_events.sql` |
| Python files | snake_case | `rfp_shredder.py` |
| Test files | `<subject>.test.ts` under `__tests__/` | `rbac.test.ts`, `change-password.test.ts` |
| Env vars | `SCREAMING_SNAKE_CASE` | `DATABASE_URL`, `AUTH_SECRET` |
| DB tables | snake_case, plural | `users`, `system_events` |
| DB columns | snake_case | `created_at`, `tenant_id` |

Filenames are the API. Renaming a file is a refactor; don't do it casually.

---

## Where to add a new X (cheat sheet)

| I want to add... | Put it here | Also do |
|---|---|---|
| A new API route | `frontend/app/api/<scope>/<resource>/route.ts` | Wrap handler with `withHandler` from `lib/api-helpers.ts` |
| A new tool | `frontend/lib/tools/<namespace-dash>.ts` | Register in `frontend/lib/tools/index.ts` barrel |
| A new React component | `frontend/components/<feature>/<ComponentName>.tsx` | Kebab-case filename, PascalCase export |
| A new shared lib function | `frontend/lib/<name>.ts` | Obey the edge-safety rules above |
| A new migration | `db/migrations/NNN_description.sql` | Increment `NNN`; must be idempotent |
| A new convention doc | `docs/<NAME>.md` | Link from `CLAUDE.md` and cross-link sibling docs |
| A new background worker | `pipeline/src/workers/<name>.py` | Register in `pipeline/src/main.py` dispatch |
| A new agent archetype | `pipeline/src/agents/archetypes/<name>.py` | Add seed row in `004_seed_agents.sql` (or a follow-up migration) |
| A new zod schema | `frontend/lib/validation.ts` | Export named; reuse across routes and tools |
| A fixture for tests | `frontend/__tests__/fixtures/<name>.ts` | Export factory function |
| A new scenario test | `frontend/__tests__/scenarios/<name>.test.ts` | Use actors from `__tests__/actors/` |

---

## Deviations from this document

If a PR needs to deviate, the PR description must say so and update this file in the same commit. Reviewers should reject PRs that put files in undocumented locations without an accompanying FOLDER_STRUCTURE.md update.
