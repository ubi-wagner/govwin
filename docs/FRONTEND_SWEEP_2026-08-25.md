# FRONTEND SWEEP — 2026-08-25

**A brand-new box, a brand-new database, and every frontend file enumerated before anything was
run.** Postgres initialised empty, all 213 migrations applied from `001`, dependencies installed
from the lockfile, the app built and served exactly as production serves it (`govtech_app`, RLS
enforced). Nothing in this report was measured against surviving state.

Eight defects found and fixed (**B122–B129**). Five were in code that every green run had already
passed over, because they lived where no instrument was looking; three were in the instruments
themselves. The sweep's durable output is not the fixes — it is the two things that now make that
scope visible: a manifest of everything a sweep has to touch, and a lens for the 213 write verbs
nothing walked.

---

## 1. The box

| | |
|---|---|
| Postgres | fresh cluster, `govtech_intel` created empty · **213/213 migrations from `001`** · 113 tables |
| RLS | **49 force-RLS tables · 58 policies** · served as `govtech_app` (NOBYPASSRLS), owner only for bootstrap and the legitimate cross-tenant reads |
| Isolation fixture | `seed-isolation-fixture.mts` applied — 2 owning tenants, 3 unlocked in-flight sections, two-sided `canvas_versions`, a contract per owner |
| Frontend | `npm ci` from the lockfile · `next build` clean · standalone server, static + public staged |
| Stack | emulated-Claude (:8787) · pipeline worker (owner role) · local storage driver |

**One thing a fresh box needs that no doc mentioned:** migration `001` requires the **pgvector**
extension (`atom_embeddings`, mig 171) and it is not installed by default. `migrate.mjs` fails at
`001_baseline.sql` with `extension "vector" is not available` — after `000_drop_all.sql` has already
run, so the database is left empty and the error names an extension rather than a missing package.
`apt-get install -y postgresql-16-pgvector`, then `CREATE EXTENSION vector`. Now recorded in
docs/CONTINUATION.md §2.

---

## 2. What a sweep has to touch — `docs/FRONTEND_INVENTORY.md`

Every sweep in this repo has enumerated its own scope. `verify-surfaces` walks `page.tsx`,
`verify-api-contract` walked two `route.ts` directories. Anything belonging to neither walk had
never appeared in a coverage number at all — and CLAUDE.md is explicit that *a surface a lens has no
expectation for is uncovered, not passing.* You cannot say which those are without writing down the
whole set first, so that is what got written down.

`frontend/scripts/inventory-frontend.mjs` parses the tree with the **TypeScript compiler API** (not
regex — see §5) and emits the manifest plus a machine-readable twin.

| kind | files | | kind | files |
|---|---:|---|---|---:|
| api-route | 250 | | lib | 286 |
| page | 116 | | test | 192 |
| component | 162 | | e2e | 81 |
| app-component | 26 | | script | 183 |
| layout · boundary · middleware · auth · action | 15 | | **total** | **1,315 files · 224,599 lines** |

### Coverage, stated per layer, because one number would be a lie

| layer | population | reached by | not reached |
|---|---:|---|---:|
| pages | 116 | `verify-surfaces` (admin + portal trees) | 35 |
| API routes (GET) | 130 | `verify-api-contract` | 0 — it now reconciles |
| API routes (write verbs) | 213 | **`verify-write-contract` — new** | 0 |
| lib modules | 286 | vitest 149 · `sweep-mold-quality` 39 | **98** |
| components | 188 | only transitively, via a page that renders them | not measured |

The 35 unreached pages are the marketing and auth trees, which no lens claims. The 98 lib modules
that nothing loads are listed by name and size in the manifest — that is the largest remaining
honest gap, and it is a gap in the unit suite, not in a lens.

---

## 3. Verification — everything, on the fresh box

| check | result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `vitest run` | **1,931 tests · 1,929 passed · 2 env-skipped · 192 files** (CLAUDE.md said 1,915 — drift corrected) |
| `next build` | clean |
| `check-rls-posture` | correct — isolation, not deny-all; 4 cross-tenant tables each with a stated reason |
| **Lens 1** `verify-surfaces` | **78 driven · 78 clean · 0 broken** · 3 not driven, each with its reason |
| **Lens 2** `verify-api-contract` | **130 GET on disk · 110 graded · 4 exempt · 16 unbound · 0 unaccounted** · 0 violations |
| **Lens 3** `verify-db-crud` | every write landed where it should and nowhere else; fixture restored |
| **Lens 4** `verify-ui-vs-db` | every number the UI states is the number the table holds |
| **Lens 5** `verify-write-contract` **(new)** | **213 write verbs · 213 called · 0 violations** |
| `sweep-mold-quality` | 39/39 clean · 5 over-counts (safe) · **0 under-counts** |
| `verify-ruler-on-proposals` | 8/8 authored volumes exact · **0 under-counts** |
| `verify-ruler-on-stored-artifacts` | 18 stored volumes · **0 under-counts** · 1 over by a page (safe) |
| `calibrate-page-ruler` | 36/36 against Chromium |
| `calibrate-slide-ruler` | 7/7 against a rendered `.pptx` |
| `probe-deck-overlap` | **0 under-declared · 0 unmeasured** — with a real Impress filter installed |
| `verify-exports-on-stored-artifacts` | **18 stored volumes · 36 exports · 0 failures** (1 volume over its soft page budget, recorded not failed) |
| `crosscheck-shipped-fixes` | B79 + B80 hold under curl+psql, sharing nothing with the lenses |
| `crosscheck-canvas-normalize` | no stored or partial canvas can reach a renderer incomplete |
| `schema-check` | **2,586 references verified across app + lib · 0 contradictions** |
| **branch drive suite** (39 drives) | first full run **35 pass · 4 fail**; after B128/B129 a confirming full re-run is **39 pass · 0 fail · 0 could-not-run**. None of the four was a product defect. |

Bug log: **128 entries · 0 open · 5 deferred** (deferred by choice, named in the log).

### The drive suite's four reds, and why none was the product

The 39-drive branch suite is the broadest thing here — it drives whole journeys, both spines, as
real actors. Its first run on the fresh box was **35 pass · 4 fail**, and every failure was
environment or harness:

| drive | what it was |
|---|---|
| `opp-scout` | `anthropic` never installed — the AI half of the product was inert (B128) |
| `cms-generate` | the same missing module, on the content-generation vertical |
| `page-scale` | a missing guard + a dependency on state the drive before it deletes (B129) |
| `canvas-structural` | asserted on the one TOC entry the design deliberately omits (B129) |

**Re-measured, then confirmed.** Each of the four was re-run on its own after its fix and passed —
`opp-scout` with a real tool-loop recorded, `cms-generate` through draft + review ToDo, `page-scale`
authoring and disposing of its own document, `canvas-structural` on all five structural checks. Four
individual greens are weaker than a suite, so the whole suite was then re-run end to end from a
clean output directory: **39 passed · 0 failed · 0 could-not-run**. Until that finished this
document said so and declined to claim 39/39, which is the distinction it exists to make.

**B128 is the one that matters.** With `anthropic` absent the fabric **safe-skips** — a deliberate
invariant — so every workflow still reported `completed` and **37 of 39 drives passed with the agent
workforce doing nothing at all.** Only the two drives that assert on AI behaviour specifically
noticed. That is B115's shape with a different cause, and the reason it is worth a log entry rather
than a shrug: on this box `pip install -r requirements.txt` **aborts** on a Debian-managed
`cryptography` and silently skips every line after it, and piping the install into `tail` makes `$?`
report tail's success instead of pip's failure.

---

## 4. The eight defects

### B122 — the collaborator invite flow was dead
`/invite/<token>` was public; `/api/invite`, which it depends on, was not. An invitee — who by
definition has no account — got `401 {"error":"unauthenticated"}` on the fetch that shows them who
invited them, and again on the POST that sets their password. The route's own header said *"the
token IS the credential, no session yet."*

This is a **repeat of a bug documented four lines above it in the same file**: `CRON_EXACT_PATHS`
exists because two cron routes authenticated by bearer token and were made unreachable by the
session gate in front of them. That was fixed for those two paths and never swept for the shape.
No test caught it because both halves passed in isolation — the middleware test asserts the *page*
is public, the route test calls the handler directly and never runs middleware. The defect lived
only in their composition.

### B123 — a malformed invite token read as a server fault
Found on the first anonymous request after B122 opened the path. The token is a `uuid` column, so
`WHERE pc.id = 'abc'` raises `invalid input syntax` and the catch returned `500 DB_ERROR`. A typo in
a pasted link reported the server breaking. Both handlers now validate the shape first and answer
the same 404 as an unknown token — identical answers deliberately, so a now-public, rate-limited
endpoint cannot confirm which tokens are well-formed.

*Fixing one layer exposes the next.* This was unreachable while middleware refused the route and
appeared within a minute of opening it — an argument for re-running the probes immediately after a
gate change, not for being cautious about making one.

### B124 — the layer that answers first carried no `code`
All 250 route handlers honour the envelope — **2,525 error responses, every one conforming**. The
middleware in front of all of them answered `{"error":"unauthenticated"}` with no `code` on its 401
and both 403s, so a client switching on `code` fell through to its default on the most common
failure in the product. The tell that it was an oversight: the two rate-limit branches in the same
file already carried `RATE_LIMITED`.

Uncovered, not passing: `verify-api-contract` drives every route through a real session — correctly,
and its header argues the case — so no lens had ever seen a middleware 401, and the unit assertions
checked `error` and never `code`.

### B125 — a lens reporting green over a scope smaller than its claim
`verify-api-contract` closed with *"every reachable GET honours the response contract"* and walked
two directories. Its own arithmetic held the contradiction: 104 called + 12 unbound against 130 GET
routes on disk. Fourteen were never enumerated, never called, never listed as uncalled — the whole
`/api/partner/*` console among them. It also matched one export form, so
`export const GET = withHandler({…})` was skipped in silence (**B74 exactly**).

### B126 — an upload endpoint reported a storage failure for a client error
`await request.formData()` throws on a non-multipart body and fell to the outer catch as
`500 STORAGE_ERROR` — telling the caller storage broke, and the ops dashboard that a storage
incident happened, when the request was malformed. Two lines below, a *missing* file is correctly
`422 VALIDATION_ERROR`. Fixed alongside: `stripe/webhook` answered `500 DB_ERROR` for absent Stripe
keys, disagreeing with the two sibling routes that have always answered `STRIPE_NOT_CONFIGURED`.

### B127 — the surface lens called four healthy monitor pages broken
`/admin/process`, `/admin/system`, `/admin/system-state` and `/portal/<t>/activity` are event
monitors. Their job is to display `system_events` rows, and the shared matcher's `\bnot found\b`
was matching the payload they were displaying.

**Worse than four wrong rows:** on a freshly migrated database they pass, because no error events
exist yet. After any real failure anywhere in the product they fail forever — the lens goes
permanently red, aimed at the four pages an operator uses to find real problems, because the product
logged an error it was designed to log. They passed this morning only because the box was hours old.

### B128 — the install lied, and the whole AI half went quiet
`pip install -r pipeline/requirements.txt` aborted on a Debian-managed `cryptography` and skipped
every line after it — `anthropic`, `boto3`, `pymupdf4llm`. Piping it into `tail` meant `$?` was
tail's status, so a failed install exited 0. Then the fabric's safe-skip invariant hid the
consequence completely: every workflow reported `completed` while no agent ran. Restarting the
worker after installing (it imports at module load) produced a real tool-loop —
`rounds=2 · tool_calls=2 · tokens=365`.

### B129 — two drives failing on things the product never promised
`page-scale` died with a `TypeError` because the only document on a fresh box belongs to the house
tenant, which has zero tenant_admin memberships **by design**; the `!doc` case was guarded and the
`!member` case was not. It also could not have run inside the suite at all — `drive-canvas-authoring`
runs immediately before it and correctly disposes of the documents it authored (**B103's shape**).
It now authors its own document through the product's own POST, measures, and removes it.
`canvas-structural` reported the TOC broken; the TOC deliberately omits the first `h1` as the
document's own title, and the probe counted exactly that heading. Verified against the renderer
before changing anything — the block reads `Table of Contents · Second Chapter Heading · 1`.

---

## 5. What this sweep is really about: the instruments

Five of the six defects were invisible to a green suite. None of them was subtle in the code — each
was in plain sight in a file that nothing looked at from the angle that would show it. So the
findings are cheaper than the lesson, and the lesson repeated itself four times in one day:

> **A new or widened harness's first output describes the harness.**

Measured, not asserted:

| harness | first output | how much was real |
|---|---|---|
| the inventory's gate check (regex draft) | 61 "ungated" API routes | **0** — gates reached via helpers and wrapper exports |
| the inventory's snake_case row-type check | 3 crash-class defects | **0** — the file builds its own client with no `toCamel` |
| the 39-drive branch suite, on a fresh box | 4 failing journeys | **0** — two missing SDK, two harness assumptions |
| `verify-api-contract`, widened | 5 envelope violations | **1** — the rest: the one documented exception + three redirect-only routes |
| `verify-write-contract`, new | 19 write violations | **3** — the rest: routes whose fields are all optional by design |

That is 92 candidate findings, 4 real. Every one of the 88 was killed by the same step — reading the
source before believing the tool — and each is now encoded as a stated exception rather than a
filter, so the counts still say what was measured and what was deliberately not.

The new lens also **reproduced a bug this repo had already written down**: it sliced the response
body to 400 characters before `JSON.parse`, so `/api/applications` — which answers a textbook
702-byte `{error, code, details}` — was graded unparseable. `verify-api-contract`'s own header
describes that exact failure (38 well-formed responses reported as "not JSON"). Recorded, and
repeated anyway, which is an argument for putting a lesson in the shared grader rather than in prose.

### Three checks that now cannot quietly stop working

1. **`verify-api-contract` reconciles against the tree.** Every enumerated route must end up graded,
   exempt, unbound, or actor-less, or the lens exits **2 as a HARNESS DEFECT** before printing any
   verdict. A coverage claim that does not reconcile is a claim about the harness. This is the check
   that would have caught B125 on the day it was introduced.
2. **`verify-surfaces` proves its detector before believing it.** Each actor lane opens by driving a
   route that is definitely an error surface and requiring a non-zero count; otherwise it exits 2
   with *"every clean below would be unearned."* That detector has now been wrong in **both**
   directions — too narrow once (an error page captioned as a working screen in the admin guide),
   too broad once (B127) — which is the argument for a preflight, since the vocabulary will be
   edited again.
3. **`inventory-frontend` self-tests its parser** against hand-verified answers for the constructs an
   earlier draft got wrong, and refuses to be trusted when they fail.

Every fix in this sweep was proven **red first** — the new tests fail on the unfixed files with the
exact assertion (`expected 401 not to be 401`, `expected undefined to be 'UNAUTHENTICATED'`,
`expected 500 to be 404`), and the preflight fires at exit 2 on a deliberately blinded detector.

---

## 6. Known, stated, and deliberately not closed

- **98 lib modules no harness loads.** Named in the manifest. The largest remaining gap, and it
  belongs to the unit suite.
- **Components are measured only transitively.** 188 of them, exercised only insofar as a driven
  page renders one. No lens claims otherwise now.
- **3 routes `verify-surfaces` cannot address** — an object-storage-backed document page, a tenant
  document with no row, and `library/foundation/[foundationId]`, which needs a `grain='foundation'`
  atom the fresh box has not been given. Each prints its reason; the third names the seed that would
  close it.
- **16 GET routes with no row to bind their parameters**, listed by the lens every run.
- **`verify-write-contract` is not read-only.** Several routes take no required input by design and
  duly do their work, so it prints its mutation footprint every run (sweep/audit/mint tables).
  Sandbox, never production — stated in its header.
- **A deliberate behaviour change:** `stripe/webhook` now answers **503** where it answered 500.
  Safe for the only caller that matters — Stripe retries the whole 5xx class — but it is a contract
  change, and its test carries the reasoning.
