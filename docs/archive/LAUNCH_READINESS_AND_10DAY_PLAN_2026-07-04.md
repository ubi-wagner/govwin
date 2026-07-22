# Launch Readiness + 10-Day Plan — 2026-07-04

> **Update since this 2026-07-04 snapshot:** the comp-code **purchase → curation → release** flow shipped (migs **105–108**); pricing is **Spotlight $499/mo, Phase I $1,999, Phase II $4,999 / $3,999-linked**. See docs/MASTER_MIRROR_OPP_DESIGN.md.

**Target launch:** ~2026-07-14 (10 days). **Method:** a deep 8-track code sweep (the 6 product
areas + greenfield migrations + infra/prod-readiness), every claim traced to `file:line`, then
reconciled against the prior audits (`HITL_WIRING_AUDIT_2026-07-03.md`, `V1_DEPLOY_GAP_REPORT.md`,
`GREENFIELD_COMPONENT_AUDIT.md`). Latest migration: **103**.

> **One-line verdict.** The *spine is built and driven-green* (ingest → curate → release → provision →
> build → lock → export all exist in code, most with e2e coverage). The launch risk is **not** missing
> engines — it is **(1) un-assembled integration seams** between the pieces, **(2) a broken deploy
> runbook + config landmines** that silently disable payments/AI/email, and **(3) a handful of
> "last-mile" wiring bugs** where a real button hits the wrong endpoint. All are bounded. **10 days is
> achievable IF ~4 scope decisions are made now (see §6) and the config pass lands Day 1.**

---

## §0. Executive summary — the P0 map

| # | P0 launch blocker | Area | Nature | Effort |
|---|---|---|---|---|
| 1 | **Deploy runbook is broken + config landmines** — Stripe price-var *names* mismatch code (`STRIPE_PRICE_FINDER` vs `STRIPE_SPOTLIGHT_PRICE_ID`), frontend `ANTHROPIC_API_KEY` / `AWS_S3_BUCKET_NAME` / `NEXTAUTH_URL` missing from `RAILWAY.md`, email provider vars undocumented, wrong Docker build context | 8 | Config/docs | 1 day |
| 2 | **Customer can't get their password** — accept route doesn't return `tempPassword` to the admin UI (blank panel) **and** email no-ops if unconfigured | 1 | Wiring + config | 0.5 day |
| 3 | **New customer's `/cards` is empty** — `backfillTenant` exists but is never called on signup | 3 | Un-assembled seam | 0.5 day |
| 4 | **Purchase → workspace chain not assembled** — purchase creates no proposal, no UI reaches `proposals/create`, proposal checkout unreachable from any UI | 5 | Un-assembled seam | 2 days |
| 5 | **Provisioned proposal is un-editable ("release" deadlock)** — provision sets `is_locked=true, lock_count=0`; the only unlocker rejects `lock_count=0` ("Nothing to unlock"). Nothing clears the initial lock | 5 | Wiring bug | 0.5 day |
| 6 | **"Download my proposal" returns a `.json` manifest, not `.docx`** — the docx package backend is real; the button POSTs without `?format=docx` | 6 | Wiring bug | 0.25 day |

**Product-decision gaps (change scope — see §6):** web-search new-source discovery (Area 2a, *unbuilt*),
atoms→bucket context (Area 4b, *unbuilt*), pinned-opp nudge *delivery* (Area 4e, *detection-only*),
EconDev/manager review gate (Area 5d, *absent*), PDF export (Area 6, *absent*).

---

## §1. Exact current state — by area

Legend: 🟢 works (evidence in code, mostly e2e-covered) · 🟡 partial/isolated · 🔴 missing/not-assembled.

### Area 1 — Public content + waitlist + account approval
- 🟢 **~20 marketing pages** `app/(marketing)/` — CMS-block driven (`lib/cms.ts:212`) with hardcoded
  fallbacks + `try/catch → []`, so they render even with an empty CMS. Middleware allow-lists them.
- 🟢 **Application → accept → tenant provisioning** — `/apply` → `POST /api/applications` (zod, dedup by
  email+domain) → `applications` (mig 011). `admin/applications/[id]/accept/route.ts` runs one txn:
  `tenants` (race-free slug) + `users role=tenant_admin temp_password=true` (bcrypt) + welcome email +
  `capture:application.accepted`. Auth (`auth.ts` NextAuth v5) + temp-password force-redirect to
  `/change-password` all work.
- 🟢 **Waitlist capture** — `POST /api/waitlist` upsert `waitlist` (email UNIQUE) + event. **But** rendered
  on only one page (`/federal-rd-101`), has **no working admin surface** (`admin/waitlist/page.tsx` reads
  the `applications` table, not `waitlist`), and no waitlist→account path.
- 🔴 Provisioning seeds **no billing/tier** (`product_tier`, `subscription_status`) despite `/apply`
  promising "$299/mo … Stripe."

### Area 2 — Scout engine + source mgmt + daily admin notifications
- 🟢 **Admin source management (b)** — `source_profiles` (mig 020, seeded DSIP/SBIR.gov/SAM.gov) +
  `source_regions/snapshots/diffs` (mig 025); admin list/create/annotate UI (`admin/sources/**`, region
  point-and-mark); manual scout → `pipeline_jobs kind=scout_source`.
- 🟢 **Change-detection + alert workflow** — `source_scout.py` (fetch HTML → SHA-256 per region → Claude
  classify → `source_diffs` → `finder:source.change_detected`) → `on_source_change_detected.py`
  (draft + email + `source_review` ToDo). Ingest-detection path (`opportunities.detected` →
  `triage_new_opportunities` ToDo + email) is DONE. ToDo ledger + admin triage panel + 60s nudge sweep +
  hourly date-anchored sweep all live.
- 🔴 **(a) web-search NEW-source discovery — absent entirely** (grep: no `web_search|tavily|serpapi`).
- 🔴 **(c) daily cadence — not driven.** `scout_all_due()` exists but has **no scheduler** (dispatcher
  skips non-INGESTER schedules; no cron/ScheduleTrigger). Scout fires only on a manual click.

### Area 3 — Opp river + bridge + clone-on-signup + archival
- 🟢 **Bridge spine is production-quality** — global river (`/admin/cards`), forward-only `opportunity_bridge`
  (L0) → `tenant_opportunity_cards` (L1, RLS FORCE) via `publishToBridge`/`applyToTenant`/`fanOutBridgeEvent`;
  multi-topic fan-out (every topic → its own card, `e2e/fanout.admin`); lifecycle 6-state; **archive hides
  the card** (`cards/route.ts:65`); `autoScoreCard` on fan-out.
- 🔴 **(c) auto-clone on signup — NOT wired.** `backfillTenant` (`opportunity-bridge.ts:279`) exists but the
  accept route never calls it → new customer sees an **empty `/cards`**. No self-heal (cursor written, never
  read); no admin backfill button.

### Area 4 — Library + 5 buckets + per-bucket ranking + pin→S3
- 🟢 **Data model correct** — one `tenant_opportunity_cards` row per (tenant,opp); `tenant_bucket_scores`
  one score per card **per bucket** (no card duplication). `autoScoreCard` loops every active bucket.
- 🟢 **Upload→atomize→`library_atoms`** (`atoms/upload` + `POST /atoms`, AtomsWorkbench); **buckets CRUD**;
  **pin→S3 is real** (`opportunity-pin.ts` → `CopyObjectCommand` → `customers/{slug}/pinned/…` + manifest);
  **pin-update detection** flips `pin_update_available`.
- 🔴 **(b) atoms → bucket context — unbuilt** (`bucket-ranking.ts` has zero `library_atoms` refs).
- 🔴 **(c) per-card multi-bucket rank display — unbuilt** (`/cards` UI shows no score at all).
- 🔴 **(e) pinned-opp nudge *delivery* — unbuilt** (detection only; `applyToTenant` emits no tenant-scoped
  event, so nothing reaches `/notifications` or email).
- 🔴 **Cold-start: zero buckets seeded** at onboarding → unranked pipeline until the customer hand-builds lenses.

### Area 5 — Purchase → skeleton curation → release → EconDev review → portal
- 🟢 **In isolation:** real Stripe (`stripe.ts`, checkout, signed webhook → `purchases` + `capture:purchase.completed`);
  **real per-solicitation curation** (`admin/rfp-curation/**`: compliance, volumes, templates, push);
  **real provisioning** (`proposals/create/route.ts`: artifacts=volume tree, sections, matrix rows,
  templates, S3 doc copy, 72h admin email, `admin_review` HITL task); **partner_user stage-scoped access**.
- 🔴 **Chain not assembled:** purchase creates **no** proposal; **zero** `.tsx` callers of `proposals/create`;
  `billing-panel` sells only finder-subscription + consulting → **proposal checkout unreachable from UI**;
  real path gated by `FOUNDING_COHORT_BYPASS` (admin/dev-invoked).
- 🔴 **Initial "release" deadlock** — provision hardcodes `is_locked=true, lock_count=0`; the DELETE-unlock
  route rejects `lock_count===0`; no draft-stage unlock button. **Nothing clears the first lock** (masked
  because `e2e_fixtures.sql` seeds `is_locked=false`).
- 🔴 **(d) EconDev/manager review — entirely absent** (no manager role/gate; only post-creation partner_user).
- 🟡 Three unlinked "creation" layers (`proposals` / `proposal_portals` / pinned `cards`) — operator confusion.

### Area 6 — Proposal pipeline → download
- 🟢 **Substantially built end-to-end** — canvas save (OCC), **accept/lock** (CAS, idempotent, matrix→satisfied,
  harvest to both libraries, artifact roll-up), **stage advance** (TOCTOU-safe gate + **force** escape hatch),
  proposal-lock→download gate. **AI that runs:** section draft (Sonnet-4, budget-guarded), compliance (Haiku-4.5),
  3/10 pipeline archetypes with real producers (`section_drafter`/`color_team_reviewer`/`compliance_reviewer`).
  **Per-section export is real** (`.docx/.pptx/.xlsx`, `docx-exporter.ts` with TOC/tables/headers).
- 🔴 **Whole-proposal download orphaned** — `package/route.ts?format=docx` is real, but the "Export Package"
  button POSTs with no format → the customer gets a **`.json` manifest**, not a Word doc.
- 🟡 PDF export disabled ("coming soon", no renderer). Greenfield-provision path doesn't populate the matrix →
  card `percentComplete` stuck at 0% (display only; doesn't block advance/export). ~7 dormant archetypes.

### Platform — migrations (Area 7) + infra (Area 8)
- 🟢 **Schema coherent, no code↔DDL drift** — migs 088–103 additive, idempotent, no destructive drops; every
  table code writes has a creating migration; all `ON CONFLICT`/CHECK targets match. Auto-applied on frontend
  deploy (`entrypoint.sh → migrate.mjs`); CI has a real migrate-vs-pgvector smoke gate.
- 🟢 Secrets hygiene, fail-closed AI spend guard, real health probes, Playwright(14)+vitest+pytest, seed path.
- 🔴 **Deploy runbook broken** (§0 #1). 🟡 **pgvector** hard dep on any *fresh* DB (fine on current prod).
  🟡 **RLS is app-level only** in prod (FORCE-RLS bypassed by the superuser role; `WHERE tenant_id` is the guard).
  🟡 `/api/health` always 200 (won't fail Railway's probe on a dependency outage). Confirm Postgres PITR.

---

## §2. Launch-gap register (ranked, with fix sketch + file)

### P0 — must fix to launch
| ID | Gap | Fix sketch | Files |
|---|---|---|---|
| **P0-1** | Stripe price-var name mismatch | Set env under the **code's** names; delete the wrong names from `.env.example`/`RAILWAY.md` | `lib/stripe.ts:30-42`, `.env.example:124-139`, `RAILWAY.md` |
| **P0-2** | Frontend missing `ANTHROPIC_API_KEY`/`AWS_S3_BUCKET_NAME`/`NEXTAUTH_URL` | Add to frontend service env + runbook | `lib/tools/proposal-draft-section.ts:167`, `storage/s3-client.ts:31`, `lib/stripe.ts:116` |
| **P0-3** | `RAILWAY.md` build context + migration steps wrong | Rewrite runbook: root build context, `migrate.mjs` is auto, correct var table | `RAILWAY.md`, `frontend/Dockerfile`, `entrypoint.sh` |
| **P0-4** | Email no-ops silently (welcome/reset/nudge) | Configure Google-Workspace **or** `RESEND_API_KEY`; send a real test; document `GOOGLE_*` | `lib/email.ts:158`, `services/cms/.../event_listener.py:53` |
| **P0-5** | Accept route hides temp password (blank UI) | Return `tempPassword` + real `emailError` from the route | `admin/applications/[id]/accept/route.ts:183-194` |
| **P0-6** | `backfillTenant` not called on signup → empty `/cards` | Post-commit `backfillTenant(tenantId)` (out-of-band) + `capture` event | `admin/applications/[id]/accept/route.ts:~154`, `lib/opportunity-bridge.ts:279` |
| **P0-7** | Purchase → workspace chain unassembled | Add buy CTA on opp/pinned card → checkout; on `purchase.completed` (or task completion) call provisioning; link portal→proposal | `stripe/webhook/route.ts`, `components/cards/opportunity-card.tsx`, `proposals/create/route.ts`, `lib/portal-launch.ts` |
| **P0-8** | Initial "release"/unlock deadlock | Add an admin **"Release to customer"** action that clears the first lock (fix `lock_count=0` case or a dedicated release endpoint that flips `is_locked=false`) | `.../proposals/[proposalId]/lock/route.ts:307`, `proposal-admin-panel.tsx`, `stage-control.tsx:269` |
| **P0-9** | Whole-proposal download returns `.json` | Button → `POST /package?format=docx` + binary-blob download | `components/portal/proposal-admin-panel.tsx:188-215`, `package/route.ts:364` |

### P1 — important / silent breakage
| ID | Gap | Fix | Files |
|---|---|---|---|
| P1-1 | `/cards` shows no rank despite "ranked by your buckets" copy | Add `topScore` + up-to-5 per-bucket chips to the card | `components/portal/pipeline-cards.tsx:6-16`, `cards/route.ts` |
| P1-2 | Pinned-opp nudge delivery unbuilt | Emit tenant-scoped `capture:*` on `pin_update_available` flip → feeds `/notifications` + email | `lib/opportunity-bridge.ts:187`, `notifications/route.ts` |
| P1-3 | Scout has no daily scheduler | Add a daily loop driving `scout_all_due()` + a digest workflow; flip `auto_crawl_enabled=true` on baseline sources | `pipeline/src/main.py:170`, `ingest/dispatcher.py:60`, `source_scout.py:405`, mig 025:12 |
| P1-4 | Cold-start: zero buckets on signup | Seed a small default bucket set at accept/backfill | `admin/applications/[id]/accept/route.ts`, `bucket-ranking.ts` |
| P1-5 | Greenfield provision doesn't populate matrix (0%) | Mirror the create-route matrix insert in `provision-proposal.ts` | `lib/provision-proposal.ts`, `proposals/create/route.ts:408` |
| P1-6 | admin/waitlist reads wrong table | Repoint page to `waitlist` (wire existing `GET /api/admin/waitlist`) | `app/admin/waitlist/page.tsx` |
| P1-7 | ToDo materialization needs the pipeline running | Ensure the Python worker is a launched Railway service + health-alerted | `pipeline/src/main.py`, `pipeline/railway.json` |

### P2 — post-launch hardening (track, don't block)
RLS real-enforcement decision (app-level is solid today); `/api/health` degradation status; in-memory
rate-limiter (fine at 1 container); `opportunity_bridge` version race; DOCX embedded images; ~7 dormant
archetypes; `library_units` deprecation Phases 2–4 (hold Phase-4 drop until after HITL, see
`LIBRARY_CONVERGENCE_STATUS_2026-07-03.md`); jsonb `JSON.stringify::jsonb` residual writers (Mistake 36);
stale `MIGRATIONS_RUNBOOK.md` + cliffnotes migration count.

---

## §3. Full-scope HITL test plan

**Environment of record:** a seeded staging instance = frontend (`next start`) + **the Python pipeline
worker running** (tasks/AI depend on it) + Postgres (all migrations) + R2, with **real email + Stripe
test-mode + `ANTHROPIC_API_KEY`** configured. Seed via `scripts/seed_dev_accounts.mjs` + `scripts/e2e_fixtures.sql`.
Personas: `master_admin`, `rfp_admin`, `tenant_admin` (customer), `partner_user` (collaborator/EconDev proxy),
plus an **anonymous** prospect. Each area below lists the drive + the *expected-fail-today* markers (they turn
green as the §4 fixes land).

**T1 — Public → waitlist → apply → approve → login (Area 1).**
Anon: render `/`, `/pricing`, `/how-it-works`, `/apply`, `/federal-rd-101`. Submit waitlist (201 + row + event,
re-submit upserts). Submit `/apply` (all required fields, T&C email-match; dup email → 409, same domain → 409).
Admin: `/admin/applications` → Accept (notes ≥10). **Assert:** tenant + `tenant_admin` + `temp_password` +
`capture:application.accepted` + welcome email; **temp password is obtainable** (email + admin panel — *fails
today: P0-5*). Customer: login → forced `/change-password` → `/portal/{slug}/dashboard`; cross-tenant blocked.
Reject path (+email); re-accept → 409; rate-limit → 429.

**T2 — Signup mirror + buckets (Area 3 + 4 cold-start).**
Immediately after T1 accept: `GET /api/portal/{slug}/cards`. **Assert:** the full non-archived opp set as thin
cards (*fails today: empty → P0-6*) and ≥1 default spotlight bucket exists (*fails today → P1-4*). Archive an
opp as admin → card disappears; `?includeClosed=true` still shows it.

**T3 — Scout → source review → notification (Area 2).**
Enable a baseline source (`auto_crawl_enabled=true`, add a region). Manual scout → baseline snapshot. Mutate the
page → scout again → `source_diffs` meaningful + `finder:source.change_detected`. **Assert:** `OnSourceChangeDetected`
instance, `source_review` ToDo in the admin triage panel, and a delivered/stubbed email. Admin completes the ToDo
→ instance resumes. **Daily-cadence step (*fails today → P1-3*):** tick the scheduler → expect `scout_all_due()`
to run and re-alert. Parallel: run a stub ingester creating ≥1 solicitation → `triage_new_opportunities` ToDo + email.

**T4 — Library → bucket → per-bucket ranks → pin → S3 → nudge (Area 4).**
Customer: `/portal/{slug}/atoms` → upload a `.docx` → select blocks → tag `vol` → Create (assert `library_atoms`
+ `atom_tags` rows). Create a bucket (*expected gap: no atom-context control → Area-4b*). Admin pushes a multi-topic
AF SBIR solicitation → `GET /cards` each topic `topScore>0`; second bucket → a second `tenant_bucket_scores` row.
**Assert on the page:** per-card bucket ranks visible (*fails today → P1-1*). Pin → assert R2 objects under
`customers/{slug}/pinned/{oppId}/…` + `pinned_docs` manifest. Admin `close_date_change` → amber "Update available"
→ Resync re-copies. **Nudge:** check bell + email (*fails today → P1-2*).

**T5 — Pin → purchase → curate → release → (review) → portal (Area 5).**
Confirm a **buy CTA** exists on the pinned/opp card (*fails today → P0-7*). Drive checkout (`proposal_phase1`,
Stripe test) → webhook writes `purchases` + emits event → `proposal_setup` ToDo on `/admin/dashboard` (needs
pipeline). **Assert a proposal is provisioned** (*fails today: purchase provisions nothing → P0-7*). Admin curates
the skeleton (`/admin/rfp-curation/{solId}`: compliance + volumes + templates + push). Admin **Release to customer**
(*fails today: "Nothing to unlock" → P0-8*). Optional **EconDev review** (*not testable → Area-5d*; closest:
`partner_user` invite with stage-scoped access). Customer sees an **editable** workspace.

**T6 — Proposal build → lock → advance → DOWNLOAD (Area 6).**
Customer drafts a section (Sonnet-4 nodes + `section.saved` OCC) + runs compliance (Haiku inline score). Collaborator
read-only + comments. "Accept & Lock All" → per-section `section.locked` + matrix→satisfied + `library_atoms` harvest
+ `artifact.locked` + `document.locked`. Advance draft→final (auto-lock → `submitted`, `lock_count=1`); also test
**force-advance** with one open section. **DOWNLOAD (critical):** whole-proposal → **expect `.docx`** (*fails today:
`.json` → P0-9*); per-section `.docx` opens in Word (headings/tables/TOC). Regression: unlock → matrix resets → re-lock.

**T7 — Platform/deploy dress rehearsal (Area 7/8).**
From a **fresh** staging DB: run all migrations (confirm pgvector present), boot all 3 services, run the full
seed. Verify: welcome email delivers; a Stripe test checkout succeeds and its links resolve to the **real host**
(not localhost → P0-2/`NEXTAUTH_URL`); an uploaded file lands in R2; `/api/health` reports each dependency. Run
`vitest` + Playwright(14) + `pytest` green.

**Pass bar for launch:** T1–T6 fully green on staging with real email + Stripe test-mode + AI keys, plus T7
migrations-from-scratch + all three test suites green.

---

## §4. The 10-day plan (test → refactor → document → test → error-check → test → document)

Each day runs the same rhythm: **drive** the area on staging to reproduce the gap → **refactor** the fix →
**document** (update this file's gap register + the area's HITL step) → **regression** (`tsc --noEmit`, `lint`,
`vitest`) → **error-check** (build + targeted Playwright/`pytest`) → **HITL re-drive** the fixed path → **commit**
with the driven evidence. Branch: `claude/nice-hamilton-kBqtD`. Days are ordered so each unblocks the next HITL track.

> **Day 0 (today, 7/4) — DONE:** the 8-track sweep + this plan + `sweep_findings` evidence. Decisions in §6 owed.

### Day 1 (7/5) — Config truth pass + credential delivery → unblocks *everything downstream*
- **Refactor:** rewrite `RAILWAY.md` + `.env.example` to match code (P0-1/2/3): Stripe price-var names, frontend
  `ANTHROPIC_API_KEY`/`AWS_S3_BUCKET_NAME`/`NEXTAUTH_URL`, `GOOGLE_*` email vars, root Docker build context.
  Configure email provider and **send a real test** (P0-4). Fix `accept/route.ts` to return `tempPassword` +
  `emailError` (P0-5). Fix jsonb metadata writes to `sql.json()` in applications/waitlist routes.
- **Test/HITL:** boot the seeded stack; run **T1** end-to-end; confirm a welcome email arrives and the admin panel
  shows the temp password. `tsc`+`lint`+`vitest`+`build`.
- **Files:** `RAILWAY.md`, `.env.example`, `lib/stripe.ts`, `lib/email.ts`, `admin/applications/[id]/accept/route.ts`,
  `app/api/{applications,waitlist}/route.ts`. **Doc:** new `docs/LAUNCH_RUNBOOK.md` (authoritative env table from §5).

### Day 2 (7/6) — Onboarding mirror: backfill + default buckets + waitlist surface → unblocks T2
- **Refactor:** call `backfillTenant` post-commit in the accept route, out-of-band, `AND lifecycle_status<>'archived'`,
  emit `capture:tenant.cards_backfilled` (P0-6). Seed a small default spotlight-bucket set on accept (P1-4). Add an
  admin "Backfill cards" button on the tenant-detail page (self-heal). Repoint `admin/waitlist` to the `waitlist` table (P1-6).
- **Test/HITL:** add `e2e/onboarding.admin.spec.ts` (accept → `/cards` non-empty + ≥1 bucket). Run **T2**.
- **Files:** `admin/applications/[id]/accept/route.ts`, `lib/opportunity-bridge.ts:279`, `bucket-ranking.ts`,
  `admin/tenants/[tenantId]/page.tsx`, `app/admin/waitlist/page.tsx`.

### Day 3 (7/7) — Purchase → provision assembly, part 1 → unblocks T5 (front half)
- **Refactor:** add a **buy/create CTA** on the pinned/opp card → `POST /api/stripe/checkout` (`proposal_phase1`,
  `opportunityId`); surface proposal products in `billing-panel`. On `purchase.completed` (or `proposal_setup` task
  completion), **call the provisioning core** (extract a shared `provisionForPurchase()` from `proposals/create`).
  Decide founding-cohort vs Stripe-live for launch (§6).
- **Test/HITL:** drive checkout (Stripe test) → assert `purchases` row → assert a proposal is provisioned. `tsc`/`vitest`/`build`.
- **Files:** `components/cards/opportunity-card.tsx`, `components/portal/billing-panel.tsx`, `stripe/webhook/route.ts`,
  `proposals/create/route.ts` (extract core), `lib/tasks/tasks.ts`.

### Day 4 (7/8) — Release deadlock + greenfield matrix → unblocks T5 (back half) + T6 matrix
- **Refactor:** add an admin **"Release to customer"** action that flips the initial `is_locked=false` (fix the
  `lock_count=0` "Nothing to unlock" case or add a dedicated release endpoint + button) (P0-8). Populate
  `proposal_compliance_matrix` in `provision-proposal.ts` (mirror the create-route insert) (P1-5). Link
  `proposal_portals` → the provisioned `proposals` row (`linkPortalProposal`).
- **Test/HITL:** add `e2e/release.tenant.spec.ts` (provision locked → release → customer can save). Run **T5** end-to-end.
- **Files:** `.../proposals/[proposalId]/lock/route.ts:307`, `proposal-admin-panel.tsx`, `lib/provision-proposal.ts`,
  `lib/portal-launch.ts`, `scripts/e2e_fixtures.sql` (add a locked-then-released fixture).

### Day 5 (7/9) — Proposal download + PDF decision → unblocks T6 download
- **Refactor:** rewire the Export Package button → `POST /package?format=docx` + binary blob (P0-9). Execute the
  PDF decision (§6): document docx-only + manual Save-as-PDF, or scope a renderer. Optionally populate matrix % display.
- **Test/HITL:** run **T6** to a downloaded `.docx`; open in Word (headings/tables/TOC). Add a `package?format=docx`
  assertion to an e2e spec.
- **Files:** `components/portal/proposal-admin-panel.tsx:188-215`, `package/route.ts`, `lib/export/docx-exporter.ts`,
  `components/canvas/canvas-editor.tsx`.

### Day 6 (7/10) — Scout daily cadence + notification delivery → unblocks T3
- **Refactor:** add a **daily scheduler loop** in `main.py` (or a `pipeline_schedules` scout kind the dispatcher
  honors) driving `scout_all_due()` + a daily digest workflow (P1-3); flip `auto_crawl_enabled=true` on the sources
  meant for monitoring; verify the email nudge path (Google/Resend) end-to-end. Execute the web-search-discovery
  decision (§6 — recommend **descope to manual-add for launch**).
- **Test/HITL:** run **T3** including the daily-cadence tick. `pytest` for the pipeline.
- **Files:** `pipeline/src/main.py:170`, `ingest/dispatcher.py:60`, `source_scout.py:405`, `on_source_change_detected.py`,
  mig for `auto_crawl_enabled`, `services/cms/.../event_listener.py`.

### Day 7 (7/11) — Spotlight differentiators → unblocks T4 UI
- **Refactor:** surface per-card bucket ranks on `/cards` (add `topScore` + up-to-5 chips) (P1-1); wire pinned-opp
  nudge **delivery** (tenant-scoped event on `pin_update_available` → `/notifications` + email) (P1-2); execute the
  atoms→bucket-context decision (§6 — build a minimal "attach atoms as bucket keywords" or descope).
- **Test/HITL:** run **T4**; add `e2e/pin.tenant.spec.ts` (pin → S3 copy + nudge event).
- **Files:** `pipeline-cards.tsx`, `cards/route.ts`, `lib/opportunity-bridge.ts:187`, `notifications/route.ts`,
  `bucket-ranking.ts`, `spotlight-buckets.tsx`.

### Day 8 (7/12) — EconDev decision + full dress rehearsal #1
- **Refactor:** execute the EconDev/manager-review decision (§6 — recommend **model as a required `partner_user`
  reviewer gate** before customer edit, reusing `collaborator_stage_access`, rather than a new role). 
- **Test/HITL:** **full T1→T6 dress rehearsal on staging** with real email + Stripe test + AI keys; log every defect
  as a P0/P1 with file:line. Full `vitest` + Playwright + `pytest`.
- **Files:** `collaborators/route.ts`, `proposal-access.ts`, `stage-control.tsx`; defect log appended here.

### Day 9 (7/13) — Defect burndown + platform hardening
- **Refactor:** burn down Day-8 defects (P0 first). Confirm the prod DB role vs FORCE-RLS (Area 7 P1) and **document
  the app-level-isolation decision**; make `/api/health` report degradation; confirm Railway Postgres PITR.
- **Test/HITL:** re-drive every path touched; full three-suite regression; **fresh-DB migration run (T7)** to catch pgvector.
- **Files:** `lib/rls.ts`, `app/api/health/route.ts`, `MIGRATIONS_RUNBOOK.md` (correct), `CLAUDE_CLIFFNOTES.md` (mig count).

### Day 10 (7/14) — Final dress rehearsal #2 + go/no-go + launch
- **Test/HITL:** clean-staging **T1→T7** from fresh migrations, real emails, Stripe test-mode; the §5 go-live
  checklist; then execute `LAUNCH_RUNBOOK.md` against prod and run T1 (approve a real internal account) + T7 smoke.
- **Document:** final go/no-go record + a post-launch P2 backlog.

**Slip valve:** if a day's P0 isn't green by end of day, it bumps the *feature* days (6–8), not the *chain* days
(1–5). The revenue chain (T1→T6) is the non-negotiable critical path; Areas 2a/4b/5d/6-PDF are the descope buffer (§6).

---

## §5. Go-live config checklist (authoritative — supersedes `.env.example`/`RAILWAY.md` until they're fixed Day 1)

**Frontend service:** `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, **`NEXTAUTH_URL`** (= AUTH_URL — else Stripe/invite
links go to localhost), `NEXT_PUBLIC_APP_URL`, `API_KEY_ENCRYPTION_SECRET`, **`ANTHROPIC_API_KEY`**, `AWS_S3_BUCKET_NAME`
+ `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_DEFAULT_REGION` + `AWS_ENDPOINT_URL`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, **`STRIPE_SPOTLIGHT_PRICE_ID`**, **`STRIPE_PROPOSAL_P1_PRICE_ID`**, **`STRIPE_PROPOSAL_P2_PRICE_ID`**,
`STRIPE_CONSULTING_PRICE_ID`, email (`GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET`+`GOOGLE_REFRESH_TOKEN`+`GOOGLE_WORKSPACE_EMAIL`
**or** `RESEND_API_KEY`) + `EMAIL_FROM`, `NODE_ENV=production`. Leave `SEED_DEV_ACCOUNTS` + `ALLOW_SCHEMA_RESET` unset.

**Pipeline worker (must be a running service):** `DATABASE_URL`, `ANTHROPIC_API_KEY`, `API_KEY_ENCRYPTION_SECRET`
(= frontend's), `SAM_GOV_API_KEY`, `CLAUDE_MODEL`, `AWS_*`, `USE_STUB_DATA=false`, `HEALTH_PORT=8080`.

**CMS service (email delivery listener):** `CMS_DATABASE_URL`, **`SHARED_DATABASE_URL`** (else the listener self-disables),
`ANTHROPIC_API_KEY`, `CMS_JWT_SECRET`, `GOOGLE_*`, `ALLOWED_ORIGINS`, `FRONTEND_URL`.

**Pre-flight:** target Postgres has **pgvector** + the connecting role may `CREATE EXTENSION`; migrations applied
(`migrate.mjs` on deploy); PITR/backups on; a Stripe **webhook endpoint** registered to `/api/stripe/webhook`.

---

## §6. Decisions needed now (they set the 10-day scope) — with my recommendation

1. **Web-search NEW-source discovery (Area 2a).** *Recommend: descope for launch* → ship admin manual-add +
   scheduled change-monitoring of known sources (both real); make "auto-discovers new sources" a fast-follow. Building
   it in 10 days competes with the revenue chain and needs a new search-API key.
2. **Payments at launch (Area 5).** *Recommend: real Stripe self-serve* (the SDK + webhook are real; the gap is a CTA +
   provision wiring, on the Day-3/4 critical path). Fallback: founding-cohort `FOUNDING_COHORT_BYPASS` (admin-invoked)
   if you want a softer launch — but then "purchase" is manual.
3. **EconDev/manager review gate (Area 5d).** *Recommend: model as a required `partner_user` reviewer* (reuse
   `collaborator_stage_access`) gating customer edit, not a new `manager` role. Full role modeling is post-launch.
4. **PDF export (Area 6).** *Recommend: docx-only for launch* + documented "Save as PDF from Word," unless a founding
   customer's agency mandates PDF upload — then it's a Day-5 build (needs a renderer, ~1–2 extra days).
5. **atoms→bucket context (Area 4b) & the multi-bucket card view (4c).** *Recommend: ship the card rank display +
   nudge delivery (P1-1/P1-2, high perceived value, low effort); descope atoms-as-bucket-context* to fast-follow.
6. **RLS (Area 7/8).** *Recommend: keep app-level `WHERE tenant_id` isolation for launch* (it is consistently applied
   and e2e-verified) and document the decision; real DB-enforced RLS is a post-launch hardening item.

---

*Evidence for every claim: the 8-track sweep in `scratchpad/sweep_findings.md` (this session) + the cited `file:line`.*

---

## §7. Execution log

**2026-07-04 — Day-1/Day-2 slice landed + driven-green (decision-independent P0s):**
- **P0-5 (credential delivery)** — `accept/route.ts` now returns `tempPassword` + `emailError`; the admin
  UI already renders them. Drive-verified: accept response carried `tempPassword` + the exact
  "no email provider configured" reason (email `skipped` in the test env).
- **P0-6 (backfill-on-signup)** — accept now calls `backfillTenant` post-commit (best-effort) + emits a
  tenant-scoped `capture:tenant.cards_backfilled`. Drive-verified: a fresh accepted tenant landed **6
  mirrored `tenant_opportunity_cards`** (matched `cardsBackfilled:6`); event emitted with the right tenant.
- **P0-1 (Stripe var names, doc side)** — `.env.example` corrected to the code's names + real amounts.
- **P1-6** — `admin/waitlist` repointed to the real `waitlist` table (was reading `applications`).
- **Copy/hygiene** — welcome-email "Spotlight" → "opportunity cards"; `applications`/`waitlist` jsonb
  metadata now via `sql.json()` (Mistake-36).
- **Regression** — `e2e/onboarding.admin.spec.ts` added (apply → accept → temp-password + cards mirror).
  Gates: `tsc` 0, `vitest` 603/603, Playwright **20/20** (incl. the new onboarding spec).
- **Still owed on Day 1 (needs the operator / real infra):** set the Railway env (frontend
  `ANTHROPIC_API_KEY`/`AWS_S3_BUCKET_NAME`/`NEXTAUTH_URL` + Stripe price IDs), configure + verify a real
  email provider, and rewrite `RAILWAY.md` build-context/migration steps.

**2026-07-04 — Day-4/5 slice landed + driven-green (decision-independent wiring P0s):**
- **P0-9 (docx download)** — the Export button now POSTs `/package?format=docx` and downloads the
  binary (label → "Download Proposal (.docx)"). Drive-verified: 200, a real 8.8 KB `.docx` (valid PK/zip),
  `Content-Disposition` attachment. Fixed two crashers found while driving it: `docx-exporter` now defaults
  a missing/partial canvas config **and** per-node `style` (US-Letter / 1" / 12 pt Times) instead of
  throwing `reading 'family'` on any hand-authored/template section.
- **P0-8 (release deadlock)** — an RFP/master admin can now release a `lock_count===0` provisioned proposal
  (the intended "unlock → release to the customer"); a tenant user still gets "Nothing to unlock". Also fixed
  the release notification querying a **phantom `tenant_memberships`** table → `users.tenant_id`, so the
  "your proposal is ready" email actually fires. Drive-verified: tenant_admin→409, admin→200 `is_locked=false`,
  server log clean. NOTE: the live portal-launch path already provisions `is_locked=false` (editable); this
  fixes the legacy/admin-provision path's trap.
- **P1-5 (greenfield matrix)** — `provision-proposal.ts` now populates `proposal_compliance_matrix`
  (one `not_addressed` row per required item). Drive-verified via a real portal accept: the provisioned
  proposal came up editable with **2 matrix rows** (Technical Approach | Key Personnel) — was 0 (card stuck 0%).
- Gates: `tsc` 0, `vitest` 603/603, Playwright **20/20**.
