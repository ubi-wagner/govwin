# V1 Launch Punch List — 2026-08-04

**Status going in:** code is **V1-complete + hardened** — migrations **152**, `tsc 0 · vitest 855 ·
next build`, adversarial bug-hunt closed (12 fixes), toast polish, all three manuals + docs synced,
and a live front-to-back / side-to-side test with **zero product bugs** (see docs/V1_READY_REPORT.md).
What's left is **environment / config + one QA-fixture build** — nothing in the product itself.

**As-built since (migs 149–152, all idempotent + self-guarding):** the dogfooded sales collateral
canvas doc (149), six shared SYSTEM `document_templates` (150/151 — capability statement, exec summary,
pitch deck, past performance, platform overview + cut sheet; `is_system`, surface in **both** RFP-admin
and every tenant-admin chooser), and the **`system_starter` MASTER LIBRARY** (152 — the 18-foundation
`STARTER_SET` decomposed into the rfp-pipeline platform tenant). New tenants now **eager-copy** that
master library into their OWN space on creation (`copyStarterSetToTenant`, both create paths), so a
fresh workspace lands with a populated, tenant-isolated library — proven 6/6 (copies are `my_library`
with `derived_from` lineage; zero master leakage; masters untouched; idempotent). Templates stay shared;
the empty-library OFFER remains as the fallback. **No new launch blocker** — 152 seeds on the standard
`migrate.mjs` run and no-ops if the platform tenant is absent.

Ordered by launch-criticality. Ops details for gates 1–4 live in docs/PRE_LAUNCH_CHECKLIST.md
(numbers below refreshed to mig 152); run them against **prod**.

---

## A. Blocking — do before flipping the switch (prod ops/config)

- [ ] **A1 · Migrations applied through 152 + `user_memberships` backfilled.** Most load-bearing.
      `DATABASE_URL=<prod> node db/migrations/migrate.mjs` (idempotent; never set `ALLOW_SCHEMA_RESET`).
      **Pass:** `_migration_history` contains `111_user_memberships` + `152_*`; **0** active non-admin
      users without an active membership (the offboarding-fix invariant — query in PRE_LAUNCH §1); and
      `152` seeded the master library — `system_starter` foundations **= 18** under the rfp-pipeline tenant
      (so new-tenant starter-copy has content to copy).
- [ ] **A2 · Email provider wired in the FRONTEND service** (Gmail 4-var *or* `RESEND_API_KEY`).
      **Pass:** a real send (invite yourself / accept a throwaway app) reports `provider:'gmail'|'resend'`,
      not `'skipped'`. `skipped` = no nudges = the automation value-prop is dark.
- [ ] **A3 · `ANTHROPIC_API_KEY` set in BOTH pipeline and frontend.** Pipeline hard-raises without it
      (every woken agent fails); frontend silently falls back to a `placeholder` draft.
      **Pass:** release a portal / hit the draft route → a section returns a **real model id**, not `placeholder`.
- [ ] **A4 · Opportunities flowing.** `opportunity_bridge` > 0, `tenant_opportunity_cards` > 0, and
      `max(created_at)` on `finder` events is **fresh** (scout/ingest loop live, not a stale snapshot).
      **Pass:** a launch tenant's `/cards` is populated.

## B. Fast-follow — right after go-live (belt-and-suspenders)

- [ ] **B1 · RLS cutover** — the one-op prod `DATABASE_URL` flip off the owner role onto `NOBYPASSRLS`
      `govtech_app` (agents → `rfp_agent`). Built + applied in schema (migs 136/137), **inert** until the
      flip. Single-layer (`WHERE tenant_id` predicates, audited complete) is defensible for launch; this
      is the second layer. Checklist: **docs/RLS_CUTOVER.md**. Cross-tenant admin/CMS reads must move to a
      BYPASS/owner-view connection at the same time.
- [ ] **B2 · Foundation TVSF demo refresh** — a fresh deploy seeds the pre-canonical demo proposal (mig
      140 snapshot). Numbering is fine (mig 143 backfills `sort_index`), but to match the delivered PDFs:
      `DATABASE_URL=<prod> node scripts/rebuild-tvsf.mjs` **or** regenerate 140 via
      `scripts/gen-foundation-seed-migration.mjs`. Not launch-blocking — refreshable post-deploy.

## C. Next-cycle QA — a full deploy-testing environment ✅ CLOSED (2026-08-04)

The driven Playwright persona+drive suite now goes green **reproducibly — 62 passed · 0 failed · 1
skipped, run-over-run** (up from the 45 pass / 13 fail / 5 did-not-run baseline). **No product bugs**
were found: every gap was a stale/absent fixture or an environmental dependency. One command serves +
gates it: `DATABASE_URL=<db> bash scripts/serve-e2e.sh &` then `npx playwright test --project=setup
--project=admin --project=tenant` (globalSetup auto-re-seeds the fixtures each run). Recipe in
**CLAUDE_CLIFFNOTES.md → "Running the e2e suite"**.

- [x] **C1 · `scripts/serve-e2e.sh`** — committed E2E serve front door with `FOUNDING_COHORT_BYPASS=true`
      (matrix/lock/fullloop/atomloop hit the paywalled `/proposals/create` direct-hook; the real
      purchase→release path needs no bypass). heartbeat.sh still never sets it; prod never should.
- [x] **C2 · `scripts/seed_e2e_fixtures.mjs`** (+ the already-existing `scripts/e2e_fixtures.sql`, extended)
      — seeds the hardcoded solicitations (`c3000000`/`c4000000` + AF SBIR topics with
      agency/programType/`close_date`; a `spotlight_summary` — both were push validations added AFTER the
      SQL was written), the provisioned-proposal/atoms/collaborator fixtures, AND the zzaudit (pinned card)
      + zzblockers (free-portal opp + submitted/locked proposal) drive fixtures. Wired into Playwright
      **globalSetup** (reset-then-run) so the gate is reproducible; also cleans the atoms fullloop/atomloop
      leak each run.
- [x] **C3 · e2e auth seeded durably** — `collab@lighthouse.com` (partner_user) + `member@ubihere.com`
      (tenant_user) are now created by `seed_dev_accounts.mjs`, so a fresh refresh runs the whole suite.
- [x] **C4 · `reach.tenant` de-flaked** — `waitUntil:'load'` + a per-route 30s timeout + one retry on the
      transient client-abort. Verified stable 3/3.
- [ ] **C5 (new, deferred) · `ranking.tenant` needs the pipeline** — the ONE spec not green frontend-only:
      bucket scoring is event-driven + **pipeline-side** (`OnCardApplied` → `rescore.py` writes
      `tenant_bucket_scores`, which `/cards` reads). Skipped in the frontend-only gate with a precise reason;
      set **`E2E_WITH_PIPELINE=1`** in the full two-service env (app + pipeline worker) to exercise it. Its
      fixtures ARE seeded. Not launch-blocking (ranking works in prod where the pipeline runs).

## D. Known-descoped (tracked, NOT blocking)

- [ ] **D1 · Self-serve Stripe checkout** — descoped for V1; the comp code `rfppipelinetest` + the RFP-admin
      comped-portal grant ($0 audited purchase) are the two paths in.
- [ ] **D2 · `scoring_strategist` agent overlay** — bucket ranking is deterministic today; the agent overlay
      is forthcoming (guides already note this).

---

### One-glance gate
| Wave | Item | Pass |
|---|---|---|
| **A (block)** | migs@152 + membership · email · ANTHROPIC (both) · opps flowing | all 4 green |
| **B (fast-follow)** | RLS cutover · TVSF demo refresh | scheduled post-go-live |
| **C (QA)** ✅ | serve-e2e bypass · fixture seeder + globalSetup · e2e auth · de-flake reach | **62 pass · 0 fail · 1 skip (reproducible)** |
| **D (known)** | Stripe self-serve · scoring overlay · ranking-needs-pipeline (C5) | intentionally deferred |

**Wave A green → launch.** B right after. **C is CLOSED** — the e2e suite is deploy-gateable now
(one spec, `ranking`, is skipped until the pipeline runs alongside the app; see C5).
