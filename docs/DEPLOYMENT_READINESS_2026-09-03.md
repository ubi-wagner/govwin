# DEPLOYMENT READINESS — 2026-09-03

**Question asked:** *what should we do to ensure full deployment readiness?*

Context: curation starts this week — scouts, then ingest, on real solicitations. This is the pass
that asks what would break on the way to production and what only the operator can settle.

Companion docs: **docs/LAUNCH_GAPS_2026-09-01.md** (the customer-facing gap list, still current) and
**docs/CONTINUATION.md §2** (how to bring a box up).

---

## 0. The one-line answer

**Two environment variables and a DNS record stand between this branch and a production deploy.**
Everything else on the readiness list is now verified, and the four defects found during this pass
were all in the *verification machinery* rather than in the product — which is its own finding,
because a broken instrument is how a real defect gets to stay.

---

## 1. What only the operator can do

Neither of these can be closed from the repository. Both are already documented as ➕ ADD in
`docs/RAILWAY_ENV_VARS.md`; this pass re-verified that both are still open.

### 1a. ⛔ Outbound email — the one hard blocker

`email_send_ledger` is **empty**: not one message has ever been sent or attempted through the seam.
No transport is configured.

On the **frontend** service:

```
EMAIL_DRIVER=postmark
POSTMARK_SERVER_TOKEN     # the SERVER token. The ACCOUNT token cannot send, and its 401
                          # is indistinguishable from a wrong key
POSTMARK_WEBHOOK_SECRET   # webhook URL: https://postmark:<secret>@<host>/api/webhooks/postmark
```

Plus **DKIM and Return-Path DNS** on the sending domain. Without them delivery is a coin flip and
`email_suppressions` fills with bounces that were never the recipient's fault — which is worse than
not sending, because the suppression outlives the misconfiguration.

Why it blocks: the welcome message carries the temporary password. Onboarding also returns it in the
API response, so nobody is locked out — but reading a password down the phone is not the product,
and it is the first thing a customer experiences.

`/admin/crm` shows the moment it is on: transport in force, 30-day sent/failed, rows reserved and
never confirmed, webhook callbacks, and the blocked list.

### 1b. ⚠️ `DATABASE_URL_OWNER` on the frontend service

`sqlBypass` falls back to `DATABASE_URL` when this is unset (`lib/db.ts`). In production
`DATABASE_URL` is `govtech_app`, which is `NOBYPASSRLS`. So the "bypass" pool bypasses nothing, and
every legitimate cross-tenant admin read — the agent-workforce rollup, Customer Interest, the funnel,
the outbound-mail console, the project explorer — runs with no tenant context against FORCE-RLS
tables and returns **empty**.

Measured on this box, same query, two roles:

```
as govtech      (owner — what sqlBypass should be):  574 rows
as govtech_app  (what it falls back to):               0 rows
```

No error, no exception, no log line. Just a different number — and on a new deployment "0" is
indistinguishable from the truth.

`entrypoint.sh` already warns when the variable is absent, but only about the *migration*
consequence, and only as a boot-time echo nobody queries afterwards. The runtime consequence is now
reported by `/api/health` (§2d) so the deploy gate can see it.

### 1c. ◻ Self-serve payment — a decision, not a gap

The purchase modal carries both paths and degrades honestly. The comp-code motion
(`rfppipelinetest` → `curation_pending`, 72h SLA) is complete and drives end to end. Set the Stripe
keys or keep the comp motion; both are supported. Nothing here blocks curation.

---

## 2. What this pass found and fixed

Four defects. Every one of them is the same shape: **an absence that looked like something else.**
None was in the product.

### 2a. The branch suite reported its own environment as five product defects

A container restart took the pipeline worker. The next full run returned five `FAIL`s:

```
real-solicitation   ✗ the shred rolled it up onto the solicitation — 0 chars
curate-baa          ✗ governing passages marked — 0 of 8
end-to-end          ✗ nothing reached a tenant card
opp-scout           ✗ worker ran opportunity_scout on the emulator (agent.invoked) — 8 → 8
project-lifecycle   ✗ timed out after 45s waiting for a process_instance for OnContractStarted
```

Every failing assertion names a shred that never ran, an instance that never appeared, or an agent
that never fired — because there was nothing to process the event. `run-branch-drives.sh` stated the
requirement in two comments (*"Needs the worker and the Claude emulator up"*) and checked it nowhere.
Documentation is not a check, and five environmental FAILs in a results table send someone hunting
five defects that do not exist.

**`scripts/check-async-workers.mjs`** is the check, in the shape the runner already uses for
LibreOffice and RLS posture. The five drives are `WORKER_DRIVES` and go **CANT-RUN** — uncovered, not
passing, and not a finding either.

It checks four things, each red-tested by breaking it:

| condition | why it is not enough to check the cheap version |
| --- | --- |
| worker answers `/healthz` | `/health` is shallow — it answers `ok` from a process that has reached nothing |
| worker is on the **same database** | a worker on a stale `DATABASE_URL` is alive, healthy, and consuming from somewhere no drive is writing |
| exactly **one** worker | two workers are two checkout moments; a drive reading "the latest invocation" gets whichever answered last |
| emulator returns a **well-formed message** | a listening socket is not an emulator; the agent reads `content[0].text` |

It reads `/proc` rather than shelling out to `pgrep`, because **`pgrep -f "python3 src/main.py"`
matches the shell that ran it** — the self-match documented in CONTINUATION.md, which fired again
while this file was being written.

Proof, on the same box: with the worker down `opp-scout` reported `FAIL(1)` before and `CANT-RUN`
after. With the worker up, **all five pass.**

### 2b. The deploy gate could never pass

`deploy-verify.yml` read `.db.ok` from the frontend's `/api/health`. The frontend carries it at
`.checks.db.ok`. `.db.ok` is the **pipeline's** shape — and the comment above the line documented the
pipeline's body, which is how it happened. Against a live, healthy frontend:

```
what deploy-verify.yml read:    .db.ok         -> null
what the body actually carries: .checks.db.ok  -> true
gate: ::error::frontend DB not ok   ← on a perfectly healthy frontend
```

So either the gate has never run against a live deployment, or it has been red and ignored. A gate
nobody can satisfy is a gate people learn to skip, which is worse than not having one.

Fixed — and an **absent** field now reports *"the response shape changed; this gate is not checking
what it claims"* rather than *"the database is down"*. The next shape change should not produce a
confident wrong error either.

### 2c. Two files the app opens at runtime were never in the image

`output: 'standalone'` traces **imports**. A file opened by **path** is invisible to the tracer, so
it reaches the image only if a human wrote a `COPY` line — and nothing checked that they did.

* `docs/guide-coverage.json` — `/admin/guides` rendered its own *"artifact is not in this build"*
  notice in production. Honest, and dead. (Found earlier this session, fixed in `314dbcb9`.)
* `ocr-data/eng.traineddata.gz` — **2.9 MB, committed, read from `process.cwd()` at runtime, absent
  from every image ever shipped.** `resolveLangPath()` returns null, one `console.error` goes to the
  Railway log, and OCR of uploaded image crops returns `''` with engine `none`. The source comment
  asserted the file was *"staged"* in the standalone directory. Nothing staged it.

Finding two by hand is the signal there is a third, so **`scripts/audit-runtime-assets.mjs`** now
asks the question in CI. Three things make it honest:

1. **Only the FINAL Dockerfile stage counts.** The builder does `COPY frontend/ .`, so counting its
   COPY lines would mark every asset present and the audit would pass unconditionally. That is also
   exactly why this class is invisible when reading the Dockerfile.
2. **Comments are stripped before source is scanned.** This repo documents each defect at its own
   site; a scan of raw source finds the prose about a missing asset and reports the fix as the bug.
3. **An unresolvable path is UNCHECKED, never present.** A `process.cwd()` join whose first segment
   is a variable cannot be resolved statically.

Its first run reported `..` as a missing asset — a finding **no COPY line can answer**, since the
image has no parent directory. Parent-relative dev fallbacks are now classified and printed rather
than reported, and that is pinned in the self-test.

### 2d. Nothing asserted the privileged pool was privileged

The box carefully asserts its **scoped** pool is scoped: `check-rls-posture.mjs` refuses to let an
isolation drive report a verdict from a superuser connection. The other half was never asserted.
Both are load-bearing, and the unguarded one fails **empty** (§1b).

`/api/health` now reports it:

```json
"bypass": { "ok": true,  "detail": "role=govtech" }
"bypass": { "ok": false, "detail": "role=govtech_app cannot bypass RLS — DATABASE_URL_OWNER is not set, so sqlBypass fell back to DATABASE_URL" }
```

Both verified by running the built server twice, once with the variable and once without.

It asks the **capability** (`rolsuper OR rolbypassrls`), not whether some cross-tenant read returned
rows — that would need fixture data and would report "no rows yet" as a fault on a fresh install.
`rolsuper` is checked as well as `rolbypassrls` because a superuser bypasses RLS with
`rolbypassrls = f`. Owning the table is **not** sufficient: migs 212/213 FORCE row security, and
FORCE applies to the owner too.

It is **deliberately excluded from the top-level `ok`**, and that exclusion is stated in the code
rather than left silent: a frontend whose bypass pool cannot bypass still serves every
customer-facing surface correctly, and failing the Railway liveness probe would take the product
down to report a degraded admin view. The deploy gate surfaces it as a warning naming the fix.

---

## 3. What is verified

| | evidence |
| --- | --- |
| **Migration delta vs `main`** | exactly one file, `244_working_notes.sql`. No `FORCE RLS`, no `CREATE POLICY`, no `GRANT`, no `CREATE EXTENSION` — nothing needing owner privilege beyond what `entrypoint.sh` already does |
| **`working_notes` exposure** | grants are `govtech_app` SELECT/INSERT/UPDATE/DELETE + `rfp_agent` SELECT; named by no file under `app/portal` or `app/partner`, pinned by `prospect-tables-admin-only.test.ts` (it has no `tenant_id`, so RLS protects nothing and the source scan is the guard) |
| **Environment completeness** | `audit-env-inventory.mjs` exit 0 — 88 variables read across three services, every one documented; 4 doc-only names are candidates, not findings; 8 exempt with a stated reason each |
| **Runtime assets** | `audit-runtime-assets.mjs` exit 0, 10 self-tests, red-tested against the pre-fix Dockerfile |
| **Types** | `npx tsc --noEmit` — 0 |
| **Unit/integration** | `npx vitest run` — **2645 passed**, 251 files |
| **Branch drives** | see §4 |

---

## 4. The suite, and an honest note about coverage

The previous full run **was never a full run**. The container died at 32 of 63 drives, so 31 were
never reached:

```
application-intake archive atomization bridge-buckets canvas-authoring canvas-demo
canvas-structural cms-generate cms-publish coherence commercial-path customer-finish
deck-ruler env-inventory full-build-cost identity-deeplink measure-grid
mobile-interaction oversight-surfaces page-scale pin rls-pages rls-portal row-types
ruler-overlays spend-guardrails spine-anchor spine-buildout spine-section-todo
uncovered-triggers vault-isolation
```

Reporting "27 passed" from that run would have described a third of the suite as the whole of it.
**A surface a lens has no expectation for is uncovered, not passing** — and a suite that was
interrupted is uncovered in exactly the same way.

<!-- SUITE RESULT -->

---

## 5. Deploy order

1. Set **`DATABASE_URL_OWNER`** on the frontend service. Cheapest, and it silently degrades the
   admin consoles until it is done.
2. Deploy the branch. `entrypoint.sh` migrates 244 automatically.
3. `GET /api/health` — require `checks.db.ok`, `checks.s3.ok` **and `checks.bypass.ok`**. The third
   is the one that was previously unobservable.
4. Run **Deploy Verify** from the Actions tab. It now checks the right jq paths, so a green means
   something for the first time.
5. Turn on **email** (§1a) and send one message to a real inbox. Check `/admin/crm` for the ledger
   row and the delivery callback — a reserved row that never confirms is the failure this seam was
   built to make visible.
6. Then curate. `/admin/guides` carries the in-page guides for sources → scouts → intake → triage →
   curation → provisioning, and the note box on every step writes to the shared board.

---

## 6. Not blocking, worth knowing

* **The guide notes are the instrument for next week.** Every guide step has a note box with three
  dispositions (gap · defect · friction), attributed server-side. The point of the first curation
  week is to fill it.
* **`tsc` does not check the drives.** `tsconfig.json` includes `**/*.ts`/`**/*.tsx`; `.mts` matches
  neither. `node scripts/check-harness-syntax.mjs` is the part that pays — syntax and
  declared-twice across 269 files, making no claim about types.
* **The suite is not read-only.** `run-branch-drives.sh` mutates; `pg_dump` before, restore after.
  Sandbox only, never production.
