# TESTING_STRATEGY.md — Binding Test Strategy

**Status: BINDING.** Every new feature must have tests at the appropriate level. "No tests" is not an acceptable state for a PR to land.

See also: [CLAUDE.md](../CLAUDE.md), [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md), [API_CONVENTIONS.md](./API_CONVENTIONS.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [DEFINITION_OF_DONE.md](./DEFINITION_OF_DONE.md), [MASTER_MIRROR_OPP_DESIGN.md](./MASTER_MIRROR_OPP_DESIGN.md) (opportunity→purchase→proposal design), [HITL_IMMOBILEYES_CLICKPLAN.md](./HITL_IMMOBILEYES_CLICKPLAN.md) (the comp-code purchase→curation→release click spine).

---

## Test pyramid

Three levels, in order of speed and cost:

1. **Unit tests** — pure functions in `frontend/lib/`. No DB. No HTTP. No filesystem. Fast (<50ms per test). Run on every save. Live under `frontend/__tests__/unit/`.
2. **Integration tests** — API routes + tools exercised against a throwaway PostgreSQL. Medium speed (~100ms-1s per test). Run in CI and before every PR. Live under `frontend/__tests__/integration/`.
3. **E2E smoke tests** — Playwright against the running app. Slow (seconds per test). Run on PR and merge-to-main. Specs live under `frontend/e2e/*.spec.ts` (the Playwright-default location — ~19 specs split across the `admin` and `tenant` projects), NOT under `frontend/__tests__/e2e/`.

Most tests should be unit or integration. E2E is for the critical paths only — "can a user log in, change their password, and see their dashboard" — not for exhaustive coverage.

---

## What goes at each level

| Subject | Level | Why |
|---|---|---|
| Pure function in `lib/` (rbac, validation, formatters) | Unit | Fast, deterministic, no side effects |
| New API route | Integration | Routes pull in auth, DB, validation, error handling — must be tested end-to-end within the process |
| New tool | Integration (via `registry.invoke`) | Tools must be tested through the registry, not called directly — that's how they are invoked in production |
| User flow (login → dashboard → logout) | E2E smoke | Only way to catch middleware + client JS interactions |
| Schema change | Integration | Add a test that exercises the new column/table via an API route or tool |
| `lib/db.ts` connection logic | Integration | Touches real PG |
| `lib/logger.ts` format | Unit | Pure |
| `lib/errors.ts` class hierarchy | Unit | Pure |
| `middleware.ts` path gating | Unit (path logic) + Integration (full cookie round-trip) | Both — the decision table is unit-testable, the cookie parsing is not |

Rule of thumb: if it touches the network, the filesystem, or Postgres, it's an integration test. Everything else is a unit test.

---

## Vitest setup

`frontend/vitest.config.ts` skeleton:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['__tests__/setup/pg.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    exclude: ['__tests__/e2e/**', 'node_modules/**'],
    testTimeout: 10_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serialize DB access
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

`pool: 'forks'` with `singleFork: true` serializes test suites so they share one PG instance without cross-talk. If we grow past ~5s total runtime, revisit by spawning one PG per worker.

---

## Throwaway PG setup

`frontend/__tests__/setup/pg.ts` algorithm:

1. **If `TEST_DATABASE_URL` is set in env**, use it. This is the CI path — the workflow spins up a service container and hands us the URL. Run migrations against it once on first import (guarded by a module-level promise).
2. **Otherwise, spawn a local PG16** via `pg_ctl`:
   - Allocate a temp data directory under `os.tmpdir()`.
   - `initdb -D <tmp>` with trust authentication.
   - Pick a random free port (bind a throwaway socket, read its port, release).
   - `pg_ctl start -D <tmp> -o "-p <port>"`.
   - `createdb -p <port> govtech_intel_test`.
   - Set `process.env.DATABASE_URL = 'postgresql://localhost:<port>/govtech_intel_test'`.
   - Run all migrations via `bash db/migrations/run.sh` (with the temp `DATABASE_URL`).
3. **`beforeEach` in each suite**: `TRUNCATE` all tenant-scoped tables, cascade. Keep seed data in `compliance_variables`, `agent_archetypes`, `promo_codes` (the `rfppipelinetest` comp code, migration 105), and the `master_admin` user row.
4. **`afterAll`**: stop PG via `pg_ctl stop`, remove the temp data directory.

The helper exports:

```ts
export async function getTestDb(): Promise<Sql>;
export async function resetTestDb(): Promise<void>;
```

Tests import `getTestDb` when they need direct SQL access (rare — prefer using actor request helpers). `resetTestDb` is called from `beforeEach` in tests that need isolation from neighbors.

---

## Fixture pattern

Fixtures are factory functions under `frontend/__tests__/fixtures/`. They INSERT real rows into the test DB — they are not mocks.

```
__tests__/fixtures/
  users.ts         # createUser, createMasterAdmin, createTenantAdmin, createTenantUser, createPartnerUser
  tenants.ts       # createTenant
  opportunities.ts # createOpportunity, createOpportunityWithDocuments
  memories.ts      # createMemory
```

Example factory signature:

```ts
export async function createUser(opts: {
  role?: Role;
  tenantSlug?: string;
  email?: string;
  tempPassword?: boolean;
  name?: string;
} = {}): Promise<UserRow> {
  const sql = await getTestDb();
  const email = opts.email ?? `test-${randomUUID()}@example.com`;
  const role = opts.role ?? 'tenant_user';
  const tenantId = opts.tenantSlug ? await resolveTenantId(opts.tenantSlug) : null;
  const [row] = await sql<UserRow[]>`
    INSERT INTO users (email, role, tenant_id, password_hash, temp_password, name)
    VALUES (${email}, ${role}, ${tenantId}, ${await hashPassword('test-password')},
            ${opts.tempPassword ?? false}, ${opts.name ?? null})
    RETURNING *
  `;
  return row;
}
```

Rules:

- Factories return the full row with all generated fields (UUID, timestamps).
- Sensible defaults — tests should be one-liners: `await createUser({ role: 'tenant_admin' })`.
- Factories never mock. If the real INSERT fails, the test fails.
- Factories are composable: `createTenant` calls nothing; `createTenantAdmin` calls `createTenant` + `createUser`.

---

## Actor pattern

Actors are per-role request helpers under `frontend/__tests__/actors/`. Each actor knows how to make authenticated requests as a specific role.

```
__tests__/actors/
  anonymous.ts   # no cookie
  master.ts      # master_admin
  rfp_admin.ts   # rfp_admin
  tenant_admin.ts
  tenant_user.ts
  partner_user.ts
```

Each actor exports a `request` helper:

```ts
export async function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: { body?: unknown; query?: Record<string, string> } = {}
): Promise<{ status: number; data?: unknown; error?: string }>;
```

Example usage in a test:

```ts
const res = await masterAdmin.request('POST', '/api/admin/tenants', {
  body: { slug: 'acme', name: 'Acme Corp' },
});
expect(res.status).toBe(201);
expect(res.data).toMatchObject({ slug: 'acme' });
```

Under the hood, the helper:

1. On first call, creates a user via the appropriate fixture (e.g., `createMasterAdmin`).
2. Mints a NextAuth JWT directly using `AUTH_SECRET` and the same claims shape the real `authorize()` produces.
3. Stores the signed cookie on the actor instance.
4. Invokes the Next.js route handler directly (importing `route.ts` and calling the method export), passing a `NextRequest` that includes the cookie.
5. Returns `{ status, data }` on success or `{ status, error }` on failure.

This simulates the full auth chain: middleware runs, session parses, role check fires. No HTTP server is involved — we import route handlers and call them. This is fast, deterministic, and exercises 100% of the production auth path.

---

## Scenario pattern

Scenarios live under `frontend/__tests__/scenarios/` and compose multiple actors across a workflow.

```
__tests__/scenarios/
  login-and-change-password.test.ts
  invite-colleague-full-flow.test.ts
  curate-and-push-rfp.test.ts
  purchase-curation-release.test.ts
```

Example skeleton:

```ts
describe('invite-colleague-full-flow', () => {
  it('lets a tenant_admin invite a user who then accepts and sets a password', async () => {
    const admin = await tenantAdmin.instance({ tenantSlug: 'acme' });
    const inviteRes = await admin.request('POST', '/api/portal/acme/team', {
      body: { email: 'newbie@example.com', role: 'tenant_user' },
    });
    expect(inviteRes.status).toBe(201);
    const token = (inviteRes.data as any).inviteToken;

    const acceptRes = await anonymous.request('POST', `/api/invite/${token}`, {
      body: { password: 'newpass-123' },
    });
    expect(acceptRes.status).toBe(200);

    const loginRes = await anonymous.request('POST', '/api/auth/callback/credentials', {
      body: { email: 'newbie@example.com', password: 'newpass-123' },
    });
    expect(loginRes.status).toBe(302); // redirect to dashboard
  });
});
```

Scenarios are the closest thing we have to production-like tests without full E2E overhead. Prefer them over bespoke integration tests when a feature spans multiple actors.

> **Purchase → curation → release scenario.** `purchase-curation-release.test.ts` exercises the
> founding-cohort spine: pin an opportunity card → `POST /api/portal/[slug]/purchase` with comp code
> `rfppipelinetest` → assert the portal is `curation_pending` with a ~72h `curation_due_at` and a
> `$0` `purchases` row → admin `action=release` → assert the proposal + `proposal_compliance_matrix`
> provision **unlocked** (V0). Design: [`MASTER_MIRROR_OPP_DESIGN.md`](./MASTER_MIRROR_OPP_DESIGN.md);
> click spine: [`HITL_IMMOBILEYES_CLICKPLAN.md`](./HITL_IMMOBILEYES_CLICKPLAN.md).

---

## Live drives: build the scenario, then take it away

The drive estate (`frontend/scripts/drive-*.mts`, run together by
`scripts/run-branch-drives.sh`) exercises the product over HTTP as real signed-in people. Every one
of those drives needs a situation to exist — two companies and a person who belongs to both, a
submitted build with no contract yet, a master with undecided required items. **The drive builds
that situation itself and disposes it.** It does not look for one and it does not assume one.

`frontend/scripts/lib/scenario.mts` is the factory: `s.tenant()`, `s.user()`, `s.partnerOrg()`,
`s.build()`, `s.admin()`, and `s.track()` for anything the caller creates itself. `runScenario(name,
fn)` wraps a drive so disposal happens on every exit path, including a throw, and reports what it
removed. Teardown reads the catalog rather than a maintained list of tables, and retries until a
pass makes no progress, so it stays correct when the next migration adds a foreign key.

**Why this is not merely tidier.** A drive that borrows a fixture rots the day the database is
rebuilt, and it rots *invisibly* — the failure looks like a regression in the thing the drive tests.
Every one of these was a live example:

| what was pinned | what the drive reported |
|---|---|
| a tenant slug that had been rebuilt away | `Cannot read properties of undefined (reading 'id')` |
| four uuids from a proposal that had moved on | ten assertions saying the section-ToDo spine was broken |
| a `.test` account, deactivated on purpose by mig 124 | a 30-second `waitForURL` timeout in the isolation half |
| a demo tenant's submitted build | CANNOT-RUN, and for a while a false pass |

Three further properties fall out, and they are the reason this is a rule rather than a preference:

- **A drive can run twice.** Anything a drive stages must carry a per-run identifier, because the
  schema's unique keys are real: a fixed intake notice collides on `opportunities.content_hash`, a
  fixed portal label collides on `(tenant_id, opportunity_id, label)`. A drive that stages a fixed
  identifier is green the day it is written and red forever after, and the redness looks exactly
  like a regression.
- **A crashed run cannot poison the next one.** If a drive mutates shared state to establish a
  precondition, it must ESTABLISH both sides rather than read one off ambient state, and restore
  exactly what it found. A readiness check that read "not ready" from the fixture stopped being able
  to observe a refusal the first time a run died before its restore — and then reported a failure
  caused by its own earlier crash.
- **A mutating drive stops constraining the other harnesses.** `award-to-contract` used to carry
  "⚠️ RUN THIS BEFORE `capture-guides.mjs`, NEVER AFTER", because winning a demo company's build
  archived it out of the dashboard the guide screenshots show. Winning inside a company that is
  disposed at the end of the run removes the constraint rather than documenting it.

**Two connections, because the suite genuinely needs both.** Isolation drives must run with
`DATABASE_URL` = the scoped `govtech_app` role — under the owner, RLS is bypassed and "no
cross-tenant rows visible" is unfalsifiable (B86). Scenario drives must run with the OWNER, because
creating a company is a platform-plane act and the product's own helpers use the context-aware
`sql`; under a scoped role with no tenant context those writes are half-applied (tenant yes,
membership no) and the drive then fails on assertions that have nothing to do with the product. The
runner hands each group the connection its job requires, `DATABASE_URL_APP` always names the scoped
role for checks that need it regardless, and the factory refuses loudly rather than half-working if
it is ever handed the wrong one.

---

## Running tests

Commands (defined in `frontend/package.json`):

| Command | What it does | Expected exit |
|---|---|---|
| `npm test` | Vitest — unit only, no DB | 0 |
| `npm run test:unit` | Vitest — explicit unit file list | 0 |
| `npm run test:integration` | Vitest — integration suite with throwaway PG | 0 |
| `npm run test:e2e` | Playwright full smoke | 0 |
| `npm run test:all` | Type check + unit + integration + e2e | 0 |
| `npm run test:ci` | What CI runs — `test:all` + coverage + junit XML output | 0 |

Developer loop: run `npm test` on save via vitest watch; run `npm run test:integration` before pushing; let CI run `test:ci`.

`scripts/test-all.sh` at the repo root is the cross-service runner (frontend + pipeline). Use it when making a change that touches both.

---

## Verification backbone (the change-verification sequence)

The test pyramid above is *what* to write; this is the ordered sequence every change is *driven through*
before it is called done. Each gate must pass before the next is meaningful:

1. **Type check** — `cd frontend && npx tsc --noEmit` → **0 errors**. First gate, always.
2. **Unit + integration** — `cd frontend && npx vitest run` → full suite green (**1680/1680**, 173 files,
   at migration head 205). Run on every change, not only schema changes. In a resource-constrained
   sandbox the default worker pool can collapse with `Cannot find package '@/...'` across ~all files —
   that is worker exhaustion, not a code fault; confirm with `--no-file-parallelism` before chasing it.
3. **Migration (schema changes only)** — apply the new migration through the `db/migrations/migrate.mjs`
   runner with `DATABASE_URL` pointed at the sandbox, then confirm with a probe query. The runner tracks
   applied files in `_migration_history`, so re-running must be a clean no-op (idempotency proof).
4. **Build (risk changes)** — `cd frontend && npx next build` → **exit 0**. Catches ESLint, page-data
   collection, and edge-runtime errors `tsc` misses. Required for any change touching page structure,
   dynamic imports, the server/client boundary, or config.
5. **Live drive** — Playwright-drive the changed surface against the running app. Specs live in
   `frontend/e2e/*.spec.ts`. Drive one self-contained spec with
   `npx playwright test e2e/<name>.spec.ts --project=tenant --no-deps` (or `--project=admin`); `--no-deps`
   skips the `setup` project so the spec runs standalone. A change is not verified until its surface has
   been driven live.
6. **Adversarial multi-agent bug sweep (large changes)** — for large or cross-cutting changes, fan out an
   adversarial sweep that splits the diff by concern (API / React / SQL), each agent hunting for defects
   in its lane. Every reported finding must be **PROVEN** — reproduced against the running app or the
   sandbox DB — before it is filed. An unproven "possible bug" is discarded, not reported; the sweep's
   value is that it lands only defects it can demonstrate.
7. **The four lenses (any UI/API/DB change, and any backward review)** — `verify-surfaces` ·
   `verify-api-contract` · `verify-db-crud` · `verify-ui-vs-db`, against a running box. Detailed below;
   the fourth is not optional, because the other three were all green through B80.

**Sandbox DB coordinates:** `postgresql://govtech:changeme@localhost:5432/govtech_intel` (local PG16).
This is the target for steps 3, 5, 7 and the SQL lane of step 6.

> ⚠️ This line used to name `postgres://claude:claude@127.0.0.1:5433/govtech_intel`, and it stayed wrong
> for a long time after the sandbox moved. That is not a cosmetic doc rot: `verify-surfaces.mjs` carried
> the same stale default and spent several runs **binding row ids from a database the server was not
> reading** (B81). Ids that existed in both clusters rendered 200 and the sweep reported "clean". If you
> change where the sandbox lives, change it *here and in every script default in the same commit*, and
> make the tools print the DSN they used.

### The four lenses (step 7) — and the reconciliation they exist for

Steps 1–6 answer "does the code compile, pass its tests, and not crash". They do not answer *is the
product telling the customer the truth*. These four do, each driven against a running box as a real
signed-in actor, each reporting what it could **not** reach rather than skipping it silently:

| lens | question | blind to |
|---|---|---|
| `scripts/verify-surfaces.mjs` | does every page RENDER (no boundary, no client throw)? | a page that renders a wrong value perfectly |
| `scripts/verify-api-contract.mjs` | does every addressable GET honour `{data}` / `{error,code}`? | the *value* inside the envelope |
| `scripts/verify-db-crud.mjs` | do writes LAND — and do the guards refuse what they promise to? | what the customer is shown afterwards |
| `scripts/verify-ui-vs-db.mjs` | is the number the page STATES the number the table HOLDS? | anything it has no expectation for |

The fourth is the reconciliation lens and it exists because the first three were **all green** while the
tenant dashboard told a customer with 8 active builds that they had 6 (B80). Three green lenses are not
three independent confirmations — they are three answers to three questions, none of which was "is this
number right".

**Apply all four to backward review too.** A retrospective audit of existing code is exactly where
"it's been in production for months" substitutes for evidence. B80 had shipped and survived every prior
sweep. When reviewing code you did not just write, run the lenses against it before forming an opinion,
and treat a lens that has no expectation for a surface as *uncovered*, not *passing*.

### Four rules, each learned by breaking it

1. **Red first.** A check that has never failed proves nothing. Show it failing against the unfixed
   code, then fix, then show it passing — on the same build. `verify-ui-vs-db` creates scratch
   proposals to push past the dashboard's 6-card cap for precisely this reason: below the cap a correct
   and a broken implementation return the same answer, so a check that stays under it is decoration.
2. **The instrument before the finding.** A new harness's first output describes the *harness*, not the
   system. Validate it against a known answer before reporting anything from it. The contract lens's
   first run reported **38 envelope violations**; every one was a well-formed `{data:…}` that had been
   truncated to 2000 chars before `JSON.parse`.
3. **The expectation is the page's own query, copied from source.** Never a predicate you believe is
   equivalent. Re-typing a filter from memory manufactures confident, wrong findings — and the failure
   mode is symmetric: it invents defects that aren't there *and* blesses ones that are.
4. **Assert the contract the system has.** `DELETE` on a bucket is a *deactivation* — the Archivable
   contract says nothing is hard-deleted, the route says "deactivate", the response says
   `{deactivated:true}`. Asserting "the row is gone" against that is a harness bug, not a finding. Read
   the route before writing the assertion.

### Cross-checking a lens (when "the harness said so" isn't enough)

The four lenses share a stack — Playwright, one postgres.js client, assertion code written in one
sitting — so a green lens is evidence that *the lens and the product agree*, which is weaker than
evidence that the product is right. When a result matters enough, confirm it by a method that shares
nothing with the lens that produced it:

- `scripts/crosscheck-shipped-fixes.sh` — raw HTTP via `curl` against the server's own bytes, with
  expectations from `psql`. No browser, no Node, no shared helper.
- `scripts/crosscheck-canvas-normalize.mts` — calls the shipped normalizer directly over every canvas
  the database actually holds. Stronger than the unit tests, which assert against shapes we invented.

These are **not** a fifth lens and must not grow into one. A cross-check that cannot dissent from the
lens it checks is decoration.

### The canvas measurement harnesses (steps 2 and 5, for anything touching layout or export)

These are not unit tests — each one runs the product's real writer and compares against the artifact
that comes out. Any change to `lib/types/canvas-document.ts`, `lib/export/*`, or a template body
should be driven through all of them; each exits non-zero on drift.

| harness | what it measures |
|---|---|
| `scripts/verify-ruler-on-proposals.mts` | the ruler against 8 REAL authored proposals — the safety gate: it must never UNDER-count |
| `scripts/calibrate-page-ruler.mts` | 36 synthetic cases, one variable each, against Chromium's printed page count |
| `scripts/calibrate-slide-ruler.mts` | 7 deck cases against a real rendered `.pptx` |
| `scripts/sweep-mold-quality.mts` | all 39 shipped templates: rendered pages, compliance violations, page furniture, token leaks |
| `scripts/verify-ruler-on-stored-artifacts.mts` | every `proposal_artifacts` row in the DB, assembled exactly as the layout route does |
| `scripts/verify-exports-on-stored-artifacts.mts` | the question under the ruler: does the file come out AT ALL, in every format offered for its shape |
| `scripts/probe-deck-overlap.mts` | the question under THAT: does a slide node's declared frame actually HOLD its content, measured against an engine that shares no code with ours (B121) |
| `scripts/render-artifact-pages.mts` | no pass/fail — renders `.pdf`/`.pptx`/`.docx`/`.xlsx` to page images so a person can look at what the customer receives |
| `scripts/verify-surfaces.mjs` | **every** `page.tsx` under `app/admin` and `app/portal/[tenantSlug]`, driven as the right actor: does the page RENDER — no error boundary, no client throw (B78 · B79) |
| `scripts/capture-guides.mjs` | the ~35 surfaces the two front-door guides document, captured as evidence and gated the same way |

When one of them disagrees, `scripts/diagnose-mold-ruler.mts` says WHY: `--nodes` charges every node
against the height Chromium gives that same node in place, `--segments` does it per page-break
segment, `--pages` replays the ruler's own placement. Prefer it over amplifying one node type ×N —
that method lies about anything carrying a vertical margin, because a long run of them collapses
margins a real document does not.

### The measurement gap these did not cover, and how it was found (B121)

Every harness above measures OUR writer against OUR ruler, or against Chromium rendering OUR HTML.
None of them opened an Office artifact with an Office engine. That gap hid a defect for as long as it
existed: six slide node types sized their frames without reading their text, so a wrapping table was
CLIPPED and a wrapping list was painted underneath the callout below it. **Delivered decks were
missing rows and bullets the author wrote.**

Every check above passed it, correctly. The row text is all present in the slide XML, so the bytes
are complete, the vocabulary probe finds all 22 node types, the export gate reports no violations and
the ruler counts the slides right. The loss happens at RENDER, and nothing rendered.

Two rules come out of it:

- *An artifact is not verified until an engine that did not write it has opened it.* `.docx` and
  `.pdf` flow, so a bad height estimate shows up as untidy spacing; `.pptx` places absolutely and
  PowerPoint **clips rather than spilling**, so the same class of error deletes content silently.
- *Check that the converter works before concluding anything about the file.* This box ships
  `libreoffice-core` with no filter packages, so `soffice` fails on **everything** — including a
  plain `.txt`. That bare failure was once written up as "LibreOffice cannot open the .pptx this
  product writes," which blamed the artifact for a broken tool and ruled out the only instrument
  that could see B121. Convert a plain text file first. Install line in `CONTINUATION.md §2`.

**Four instruments for one defect, three of them wrong.** Each was plausible, and each would have
been reported as a clean result:

| instrument | why it failed |
|---|---|
| declared geometry (`<a:off>`/`<a:ext>`) | always clean — the writer leaves a tidy gap under the frame it believes in. The frame is the lie. |
| ink position on the rendered page | caught the table (grew past its frame), passed the list (stayed inside one). A tick on a slide that had lost a third of its content. |
| text presence in the page's text layer | found every authored phrase *including the invisible one* — occluded text is still painted into the PDF |
| **node height measured in isolation** | works: export the node ALONE with the whole body band free, render it, compare the ink SPAN to the declared height |

The fourth was wrong on its first run too — it computed `inkBottom − BODY_TOP`, which charges the
vertical-balance offset to the node as if it were content, and reported every node type
under-declared including pages that were visibly perfect. And a node that paints its own fill is
reported INDETERMINATE, never green: there the ink measures the box, so declared and realised agree
by construction and a tick would mean nothing.

**Two rules these harnesses exist to enforce**, both learned by violating them (bug log B66-B72):

- *A default that switches off the thing under test is not coverage.* Every page-ruler case once used
  the one preset declaring `header: null, footer: null`, so the running-header path — which every
  agency mold uses — had no measurement at all, and carried an 11%-per-page error for as long as it
  existed. Two other cases passed override keys that were not fields of `CanvasRules`, so they
  silently re-ran a case that already existed.
- *Synthetic filler must break like the real thing.* The prose filler was one lowercase sentence
  repeated. Measured against Chromium (`scripts/measure-char-width.mts`), Times New Roman averages
  0.41 of the font size on lowercase prose and 0.58 on acronym-dense text, so a lowercase-only corpus
  was exercising the ruler in the single register where its constant has the most slack.

`__tests__/node-vocabulary-coverage.test.ts` is the cheap always-on companion: every member of the
`NodeType` union, through all four writers, asserting each type comes out as text or as the raster
it deliberately became. `VOCAB` is typed `Record<NodeType, …>`, so adding a node type without adding
a case is a compile error rather than an uncovered type.

---

## Coverage targets

We do not chase 100% coverage. We chase **meaningful coverage**:

- Every function in `lib/` — at least a happy path + one error path.
- Every API route — happy path + unauthenticated rejection + validation failure + (if tenant-scoped) cross-tenant rejection.
- Every tool — happy path + tenant isolation check + invalid input rejection.
- Every user flow in `CLAUDE_CLIFFNOTES.md`'s "Known-good local dev stack" — E2E smoke.

If coverage on a file is below 70% lines, the PR reviewer should ask why.

---

## Test naming

Use Vitest's `describe` and `it`. Do **not** use `test()`. Do **not** use "should" phrasing.

Prefer:

- `it('returns 401 when unauthenticated', ...)`
- `it('throws ValidationError when email is missing', ...)`
- `it('isolates memories by tenant', ...)`

Avoid:

- `it('should return 401', ...)`
- `test('auth works', ...)`
- `it('does the thing', ...)`

`describe` blocks name the feature or subject under test: `describe('POST /api/auth/change-password', ...)`, `describe('hasRoleAtLeast', ...)`, `describe('memory.search tool', ...)`.

---

## Mocking rules

**Mock external services only.** Anthropic, Stripe, Resend, SAM.gov API — use `vi.mock()` to stub these out. Provide a test double that returns canned responses.

The founding-cohort **purchase path uses a comp code** (`rfppipelinetest`), so it records a `$0` purchase with no live Stripe call — test it as a normal integration path, not a Stripe mock. Mock Stripe only for the (⚠ future) live self-serve checkout.

**Do NOT mock our own code.** Use the real `lib/db` (against the throwaway PG), the real `lib/logger`, the real `lib/tools/registry`. Mocking internal code hides integration bugs and makes refactors painful.

If a test is hard to write because of deep dependencies, the solution is usually to add a fixture or an actor, not to mock.

---

## Worked examples

### 1. Unit test — `lib/rbac.ts` `hasRoleAtLeast`

```ts
// __tests__/unit/rbac.test.ts
import { describe, it, expect } from 'vitest';
import { hasRoleAtLeast } from '@/lib/rbac';

describe('hasRoleAtLeast', () => {
  it('returns true when actual role outranks required', () => {
    expect(hasRoleAtLeast('master_admin', 'tenant_user')).toBe(true);
  });

  it('returns true when actual role equals required', () => {
    expect(hasRoleAtLeast('tenant_admin', 'tenant_admin')).toBe(true);
  });

  it('returns false when actual role is below required', () => {
    expect(hasRoleAtLeast('tenant_user', 'rfp_admin')).toBe(false);
  });

  it('returns false for unknown role strings', () => {
    expect(hasRoleAtLeast('guest' as any, 'tenant_user')).toBe(false);
  });
});
```

### 2. Integration test — `POST /api/auth/change-password`

```ts
// __tests__/integration/change-password.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb } from '../setup/pg';
import { anonymous, tenantUser } from '../actors';
import { createUser } from '../fixtures/users';

describe('POST /api/auth/change-password', () => {
  beforeEach(async () => { await resetTestDb(); });

  it('returns 401 when unauthenticated', async () => {
    const res = await anonymous.request('POST', '/api/auth/change-password', {
      body: { currentPassword: 'x', newPassword: 'y' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when new password is too short', async () => {
    const user = await createUser({ role: 'tenant_user', tempPassword: true });
    const actor = await tenantUser.instance({ userId: user.id });
    const res = await actor.request('POST', '/api/auth/change-password', {
      body: { currentPassword: 'test-password', newPassword: 'abc' },
    });
    expect(res.status).toBe(400);
    expect(res.error).toMatch(/password/i);
  });

  it('updates password and clears temp_password flag on success', async () => {
    const user = await createUser({ role: 'tenant_user', tempPassword: true });
    const actor = await tenantUser.instance({ userId: user.id });
    const res = await actor.request('POST', '/api/auth/change-password', {
      body: { currentPassword: 'test-password', newPassword: 'a-real-password-42' },
    });
    expect(res.status).toBe(200);
    // Verify DB state directly
    const sql = await getTestDb();
    const [row] = await sql`SELECT temp_password FROM users WHERE id = ${user.id}`;
    expect(row.tempPassword).toBe(false);
  });
});
```

### 3. Integration test — `memory.search` tool via registry

```ts
// __tests__/integration/memory-search.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, getTestDb } from '../setup/pg';
import { registry } from '@/lib/tools';
import { createTenant } from '../fixtures/tenants';
import { createMemory } from '../fixtures/memories';

describe('memory.search tool', () => {
  beforeEach(async () => { await resetTestDb(); });

  it('returns memories matching the query for the caller tenant', async () => {
    const tenant = await createTenant({ slug: 'acme' });
    await createMemory({ tenantId: tenant.id, content: 'acme wins on price' });
    await createMemory({ tenantId: tenant.id, content: 'nothing relevant here' });

    const res = await registry.invoke('memory.search', {
      args: { query: 'price', limit: 10 },
      ctx: { tenantId: tenant.id, userId: 'test-user', role: 'tenant_admin' },
    });

    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(1);
    expect(res.data.items[0].content).toContain('price');
  });

  it('isolates memories across tenants', async () => {
    const tenantA = await createTenant({ slug: 'acme' });
    const tenantB = await createTenant({ slug: 'beta' });
    await createMemory({ tenantId: tenantA.id, content: 'secret to acme only' });

    const res = await registry.invoke('memory.search', {
      args: { query: 'secret', limit: 10 },
      ctx: { tenantId: tenantB.id, userId: 'test-user', role: 'tenant_admin' },
    });

    expect(res.ok).toBe(true);
    expect(res.data.items).toHaveLength(0); // tenantB cannot see tenantA's memories
  });

  it('rejects invalid input shapes', async () => {
    const tenant = await createTenant({ slug: 'acme' });
    const res = await registry.invoke('memory.search', {
      args: { query: '' }, // empty query
      ctx: { tenantId: tenant.id, userId: 'test-user', role: 'tenant_admin' },
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION_ERROR');
  });
});
```

---

## CMS Visual Editor Test Scenarios

The CMS SPA visual page editor (`/pages`) exposes 13 API endpoints for page/block CRUD, ordering, AI content tools, and the review workflow. The following scenarios must be covered.

### Unit tests (`lib/` helpers)

| Subject | File | Scenarios |
|---|---|---|
| Block ordering logic | `lib/cms/blocks.ts` (or equivalent) | move-up first block is no-op, move-down last block is no-op, add blank block at correct index, atomic reorder preserves sort_order contiguity |
| Content status transitions | `lib/cms/status.ts` (or equivalent) | draft->submitted, submitted->approved, submitted->rejected, approved->published, reject returns to draft, cannot publish from draft directly |

### Integration tests (API routes)

| Route | Happy path | Error paths |
|---|---|---|
| `POST /api/admin/content/pages` | Create page, verify slug auto-generated and persisted | Missing title returns 422 |
| `PATCH /api/admin/content/pages/[pageId]/blocks/[blockId]` | Update block body, verify new content persists | Stale version returns 409 |
| `POST /api/admin/content/pages/[pageId]/blocks/[blockId]/move` | Move block up/down, verify sort_order recalculated | Move-up on first block returns 400 or is no-op |
| `POST /api/admin/content/pages/[pageId]/blocks` | Add blank block, verify inserted at correct position | Invalid position returns 422 |
| `POST /api/admin/content/pages/[pageId]/blocks/reorder` | Atomic reorder, verify all sort_order values updated in one transaction | Partial reorder (missing block IDs) returns 422 |
| `POST /api/admin/content/pages/[pageId]/submit-for-review` | Status transitions from draft to submitted_for_review | Already-submitted page returns 409 |
| `POST /api/admin/content/pages/[pageId]/approve` | Status transitions from submitted to approved, ISR revalidation triggered | Approving own submission blocked (if enforced) |
| `POST /api/admin/content/pages/[pageId]/reject` | Status returns to draft, rejection reason persisted | Missing reason returns 422 |
| `POST /api/admin/content/pages/[pageId]/publish` | Status transitions to published, ISR revalidation fires | Publishing unapproved content returns 403 |
| `POST /api/admin/content/ai/generate` | AI generates content block body, returns structured content | Missing prompt returns 422; ANTHROPIC_API_KEY unset returns 503 |
| `POST /api/admin/content/ai/revise` | AI revises existing block body, returns revised text | Empty body returns 422 |
| `POST /api/admin/content/ai/from-url` | AI extracts and generates content from external URL | Invalid URL returns 422; unreachable URL returns 502 |

### Scenario tests (multi-actor workflows)

| Scenario | Actors | Steps |
|---|---|---|
| Save draft -> preview -> publish | master_admin | Create page, add blocks, save draft, preview in iframe, publish, verify public page renders |
| Content review workflow | editor (rfp_admin), reviewer (master_admin) | Editor creates content, submits for review, reviewer approves, content published, ISR revalidation confirmed |
| Content rejection | editor, reviewer | Editor submits, reviewer rejects with reason, editor sees rejection reason, content reverts to draft |
| Block reorder | master_admin | Add 4 blocks, reorder via move-up/move-down, verify final order matches expectations after page reload |
| AI generate + revise | master_admin | Generate block content via AI, revise with "make shorter" prompt, verify both versions tracked |
| Preview mode on marketing pages | master_admin | Navigate to preview for each of the 6 marketing pages (how-it-works, engine, the-expert, value, infosec, apply), verify admin toolbar renders and content displays correctly |

---

## Scoring Unification Test Scenarios

> **Surface note (⚠ superseded routes).** The canonical opportunity surface is now the
> **opportunity-card spine** (`/portal/[slug]/cards`, ranked via `tenant_spotlight_buckets` /
> `tenant_bucket_scores`); `/spotlights` and `/pipeline` **redirect** to `/cards`. The scenarios
> below predate that rename — the scoring assertions still hold, but new tests should target the card
> feed and bucket ranking. See [`MASTER_MIRROR_OPP_DESIGN.md`](./MASTER_MIRROR_OPP_DESIGN.md).

Spotlights scoring is now unified: pipeline pre-computed scores are used when available, with estimation as fallback. Dead `pipeline_jobs` references have been removed from AI draft/review routes. Three API routes have been fixed with proper try/catch on SQL calls.

### Unit tests

| Subject | Scenarios |
|---|---|
| Score display logic | Pipeline-scored opportunity shows solid badge with numeric score; unscored opportunity shows dashed "Est." badge; null score shows no badge |
| Score sorting | Pipeline-scored items sort before estimated items at equal score values; within each group, higher scores sort first |

### Integration tests

| Route | Happy path | Error paths |
|---|---|---|
| `GET /api/portal/[slug]/spotlights` | Returns opportunities with `score_source` field (`pipeline` or `estimated`); pipeline-scored items sorted first | Unauthenticated returns 401 |
| `GET /api/portal/[slug]/spotlights/[id]` | Detail page returns score breakdown with source indicator | Non-existent spotlight returns 404 |
| AI draft/review routes (post-cleanup) | Draft and review routes operate without referencing `pipeline_jobs` table | Verify no SQL errors from removed `pipeline_jobs` references |

### Scenario tests

| Scenario | Steps |
|---|---|
| Mixed scoring display | Push solicitation with pipeline scores for Tenant A, create Tenant B with no scores yet. Tenant A spotlight shows solid badges, Tenant B shows dashed "Est." badges. Both feeds sort correctly. |
| Score refresh after profile update | Tenant updates profile (new NAICS, keywords), re-scoring runs, spotlight scores update and pipeline-scored items retain priority over estimated |

---

## Content Pipeline Event Tracking Tests

Content pipeline events use the `system` namespace for infrastructure-level actions and the `finder` namespace for content curation.

### Integration tests

| Event | Trigger | Verification |
|---|---|---|
| `system:content.published` | Publish a CMS page or blog post | Event logged with `contentId`, `contentType`, `slug` in payload; `tenantId` is null (admin action) |
| `system:content.unpublished` | Unpublish a CMS page or blog post | Event logged with `contentId` |
| `system:content.submitted_for_review` | Submit content for review | Event logged with `contentId`, `submittedBy` |
| `system:content.approved` | Approve submitted content | Event logged with `contentId`, `approvedBy` |
| `system:content.rejected` | Reject submitted content | Event logged with `contentId`, `rejectedBy`, `reason` |
| `system:email.queued` | Automation rule fires and queues an email | Event logged with `ruleId`, `recipientEmail`, `templateId` |
| `system:email.sent` | Queued email approved and sent | Event logged with `emailId`, `recipientEmail` |
| `system:email.rejected` | Admin rejects queued email | Event logged with `emailId`, `rejectedBy` |

### Scenario test

| Scenario | Steps |
|---|---|
| Full content lifecycle event chain | Create draft -> submit for review -> approve -> publish -> unpublish. Query `/admin/events` filtered by `system` namespace and `content.*` type. Verify 5 events in chronological order with correct `parent_event_id` links where applicable. |

---

## Deviations

If you cannot follow this strategy for a specific test, call it out in the PR description and propose an amendment. "I couldn't figure out how to test it" is not a valid excuse — ask for help before skipping.
