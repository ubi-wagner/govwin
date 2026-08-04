# V1 Launch Punch List — 2026-08-04

**Status going in:** code is **V1-complete + hardened** — migrations **148**, `tsc 0 · vitest 855 ·
next build`, adversarial bug-hunt closed (12 fixes), toast polish, all three manuals + docs synced,
and a live front-to-back / side-to-side test with **zero product bugs** (see docs/V1_READY_REPORT.md).
What's left is **environment / config + one QA-fixture build** — nothing in the product itself.

Ordered by launch-criticality. Ops details for gates 1–4 live in docs/PRE_LAUNCH_CHECKLIST.md
(numbers below refreshed to mig 148); run them against **prod**.

---

## A. Blocking — do before flipping the switch (prod ops/config)

- [ ] **A1 · Migrations applied through 148 + `user_memberships` backfilled.** Most load-bearing.
      `DATABASE_URL=<prod> node db/migrations/migrate.mjs` (idempotent; never set `ALLOW_SCHEMA_RESET`).
      **Pass:** `_migration_history` contains `111_user_memberships` + `148_*`; **0** active non-admin
      users without an active membership (the offboarding-fix invariant — query in PRE_LAUNCH §1).
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

## C. Next-cycle QA — a full deploy-testing environment (this cycle's finding)

The unit backbone is green (vitest 855) and the **product** is proven (45 e2e surface specs pass; the
purchase→release→build lifecycle fired end-to-end). But **8–13 stateful e2e specs can't currently go
green in a bare sandbox** — they need a CI fixture chain that `seed_dev_accounts.mjs` doesn't build.
**None are product bugs** (all verified: paywall-by-design 402, missing-fixture 404/403, flaky-timeout).
To get the WHOLE suite green for real deploy-gating next cycle, close these — full recipe in
**CLAUDE_CLIFFNOTES.md → "Deploy testing environment (fast + full refresh)"**:

- [ ] **C1 · Serve e2e with `FOUNDING_COHORT_BYPASS=true`** — unblocks the paywalled `/proposals/create`
      direct-hook that matrix/lock/fullloop/atomloop use (the real flow uses purchase→release, which needs
      no bypass).
- [ ] **C2 · Seed the fixture solicitations** the specs hardcode (`c3000000…`, `c4000000…`) for
      `ranking`/`fanout`, plus a provisioned proposal + atoms + a collaborator-on-a-proposal for
      `lock`/`collab`/`library`. (No fixture-seeder exists yet → build one: `scripts/seed_e2e_fixtures.mjs`.)
- [ ] **C3 · Fix the stale e2e auth** — `auth.setup.ts` defaults (`RFPAdmin2026!`, `collab@lighthouse.com`)
      drift from the Foundation demo seed. Either seed the e2e accounts with those exact passwords or pass
      `RFP_ADMIN_PW`/`COLLAB_*` env overrides; seed `collab@lighthouse.com` (fused role+tenant) — it isn't created by default.
- [ ] **C4 · De-flake `reach.tenant`** — the sweep uses `page.goto(…domcontentloaded)` + default timeout
      and rapid iteration → intermittent `-1` (client abort; server logs clean). Serialize with `waitUntil:'load'`
      + a per-route timeout, or assert on `page.request.get()` status instead of navigation.

## D. Known-descoped (tracked, NOT blocking)

- [ ] **D1 · Self-serve Stripe checkout** — descoped for V1; the comp code `rfppipelinetest` + the RFP-admin
      comped-portal grant ($0 audited purchase) are the two paths in.
- [ ] **D2 · `scoring_strategist` agent overlay** — bucket ranking is deterministic today; the agent overlay
      is forthcoming (guides already note this).

---

### One-glance gate
| Wave | Item | Pass |
|---|---|---|
| **A (block)** | migs@148 + membership · email · ANTHROPIC (both) · opps flowing | all 4 green |
| **B (fast-follow)** | RLS cutover · TVSF demo refresh | scheduled post-go-live |
| **C (QA next cycle)** | bypass env · fixture seeder · e2e auth · de-flake reach | full e2e suite green |
| **D (known)** | Stripe self-serve · scoring overlay | intentionally deferred |

**Wave A green → launch.** B right after. C before we gate deploys on the full e2e suite.
