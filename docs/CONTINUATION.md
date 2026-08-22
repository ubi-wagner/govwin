# CONTINUATION — spin up exactly here

**Last updated:** 2026-08-16 (migration head **185** — Command Center · bucket/ranking scoring · provisioning cockpit · tenant Workflow Setup · section-editing spine · cross-tenant isolation hardening (migs 184–185 per-command RLS on `document_templates` then `tasks`/`process_instances`) · four launch fast-follows (honest region proposer · retired Paste Topics modal · mig 185 · `amendment_monitor` WOKEN); a retrospective + doc-currency pass, docs/LAUNCH_READINESS_2026-08.md. The PR #205 workflow-viz/compliance work was MERGED to `main` + DEPLOYED at head 162; everything since is the current unmerged arc.)
**Branch:** `claude/nice-hamilton-kBqtD` — carries the **current unmerged arc** (heads 163–185: Command Center + migs 179–185 + the launch fast-follows). PR #205 was merged to `main` at head 162; everything since is unmerged and lives on this branch. **Do NOT restart it from `origin/main`** — that would discard the unmerged arc. Continue on it and push (fetch first — a laptop may also push here).

---

## 📍 Most recent work — the midterm end-to-end drive (2026-08-22, migration head **204**)

> **B51 is closed (mig 204).** An application used to raise two ToDos — the route's typed,
> entity-linked `application_triage` row and an untyped, unlinked copy from a mig-040 automation
> rule — and neither closed when the application was decided. Mig 204 retires the rule and cancels
> its orphans; a shared `closeTasksForEntity` (`lib/tasks/tasks.ts`) drains the real ToDo from
> **both** the accept and the reject route. The non-obvious half: those rows are platform-scope
> (`tenant_id IS NULL`) and mig 185 made `tasks` UPDATE own-only, so the completion had to run
> under `runInBypass` — without it `completeTask` reports `TASK_CLOSED` while changing nothing
> (proven: `select_no_ctx=1 · update_no_ctx=0`). Verified live by
> `frontend/e2e/b51-application-todos-drive.spec.ts` (accept + reject, both green).
>
> **B50 and B53 are closed too** (`frontend/e2e/b50-b53-reachability-drive.spec.ts`). B50: contracts
> now have an index page and a rail link, so an award is not lost when its kickoff ToDo is dismissed.
> B53: `/admin/scouts` no longer reads `source_health` — a table written exactly once, by the mig-002
> seed, so its HEALTHY tile was 0 *by construction*. Status is derived from what a scout pass really
> writes, and `manual` (a source a person reads) is now its own status rather than being reported as
> a fault. **The bug log's open list is empty.**
>
> **B64 — the page ruler now agrees with the printed page.** `estimatePageCount` is what tells a
> customer whether their volume is inside its page limit, and it under-counted: a 40-row table by a
> page, the same table with *wrapping* cells by two, and **two of the four real proposals in the
> sandbox by a page each**. Four defects — a table row modelled as body text, no term for a wrapped
> cell, equal-width columns in an auto-layout table, and `fitKeep` refusing to relocate an oversized
> `break-inside: avoid` block. All under-counting, i.e. the direction that clears a bid the printer
> rejects. Constants are now MEASURED (`scripts/measure-table-row-height.mts`) rather than read off
> the stylesheet — the stylesheet-derived value falls outside the measured bracket. The missing
> instrument is the real deliverable: **`scripts/calibrate-page-ruler.mts`** renders every case
> through Chromium and exits non-zero on drift; run it after anything that touches layout.
>
> **B65 — the same defect in lists, found by extending the method to decks.** `nodeStackHeightPt`
> had no `bulleted_list` / `numbered_list` case, so a list fell through to the prose default: every
> bullet concatenated and reflowed at full width. A 120-bullet document read 3 pages and printed 4,
> and a slide holding 30 bullets — needing 648pt of a 452pt frame — reported **no overflow**, the
> one check standing between a customer and a deck with content cut off. Second harness:
> **`scripts/calibrate-slide-ruler.mts`** (7/7); the page harness is now 20/20.
>
> **The class to keep sweeping for:** *a model that flattens structure the renderer preserves.*
> B64 found it in table cells, B65 in list items. Any node whose content is a LIST of things —
> rows, items, series, steps — is a candidate; measuring its text length is not measuring its height.
>
> **B66 — swept the remaining twelve node types through the same harness.** Two more: `code_block`
> (newlines inside `white-space:pre-wrap` were reflowed away — 60 lines read 1 page, printed 2) and
> `toc` (modelled as **zero height**, so a 40-entry contents list cost nothing and printed two
> pages). Both fixed and measured. One **named residual** left deliberately un-modelled: the ruler
> does not implement `h1,h2,h3 { break-after: avoid }`, which binds a heading to its first
> paragraph; it only bites when a toc pushes headings onto a page boundary, and both affected
> documents are exact without the toc. Two cases carry an explicit `tolerance: 1` with that reason.
>
> **And the harness defeated itself once** — a `tolerance` defaulted at the comparison instead of
> at the push left it `undefined`, and every comparison against `undefined` is false, so the script
> printed "off by −1" beside two rows and then declared all 28 passing. It would have reported
> success for any delta. *A calibration harness that cannot fail is worth less than none, because
> it is believed.* Second class to sweep for: **a check whose failure path is never exercised.**
>
> **B46 + B67 — the last open defect, and the claim that hid it.** B46: `opportunities.solicitation_id`
> was written by 7 of 10 writers (every topic path stamped it; three umbrella paths did not), so the
> column was reliable-looking and inconsistent. `compliance-resolver.ts` already carried a fallback
> with a comment recording the cost of not having one — an umbrella purchase provisioning a default
> skeleton "while the fully-authored master sits unread". The three writers now stamp it and **mig 205**
> backfills; verified safe first, because every topic-only query also filters on `topic_number`.
> B67: I had reported the log clear using a grep that understood one of its **three** heading
> conventions. **`node frontend/scripts/bug-log-status.mjs`** now reads the status from either end,
> refuses to guess, and says *"5 deferred entries remain by choice — name them rather than calling the
> log clear."* **Run it before claiming the log is clean.** The five deferred are B30, B33, B34, B35
> and **B40 (high — a large solicitation is silently truncated at 500,000 characters)**.

The last session ran the product start to finish **from a database holding nothing a user could
have created** (`scripts/reset-minimal.sh` — schema, platform config, the house tenant's starter
shelf, one operator). Every tenant, opportunity, library, bucket, purchase, portal, section,
review and export was composed by driving the real surfaces.

- **Read first: `docs/MIDTERM_RESULTS.md`** — the nine acts, the ledger, the artifacts as opened
  (not as counted), and what the run deliberately does not cover.
- **The primaries are part of it.** Sections carry images, tables, charts and captions, not just
  prose: two photographs uploaded through the customer's own image surface, a milestone table, a
  throughput bar chart and a Phase I Gantt. Each leaves the canvas a different way (native OOXML
  table · SVG rasterized for Word but kept vector in the PDF · storage key fetched and inlined) and
  **all three degrade to a grey `[Image: …]` stub instead of failing**, so the drive counts the real
  ones and fails on the stubs. Fixtures: `scripts/make-figure-fixtures.py`.
- **The drive: `frontend/e2e/mt-arc-drive.spec.ts`** — run it with
  `scripts/reset-minimal.sh && scripts/mt-run.sh mt-arc-drive`. It never throws on a block: every
  step is recorded `ok` / `decision` / `override` / `note` / `blocked` and the arc continues, so a
  run always reaches the end and reports honestly. Final tally **`ok=89 · blocked=0`**.
- **New findings: bug log B62 and B63.** B62 is the real one — a new tenant was born at 100% of
  the spotlight-bucket cap, so the first thing a customer does answered 409. Fixed by mig **203**
  plus `lib/automation/policy.ts` deriving the cap from the seeded set instead of duplicating a
  number. B63 is the harness: `playwright.config.ts` had no `actionTimeout`, and Playwright's
  default of 0 means *wait forever* — one missing selector ate whole runs silently.
- **Two behaviours that read as bugs and are not** (now documented in `readiness.ts`,
  `PROVISIONING_WORKSPACE_DESIGN.md` and the RFP-admin guide): a deferred compliance field
  correctly blocks the push until a human enters it, and the build-out readiness bar has **five**
  conditions, not the three its own summary used to claim.

---

## ⭐ SOP — LAUNCH FIRST every session (keep-alive + verify-agents)

> **⛑️ RLS IS LIVE — emulate production EXACTLY.** RLS is real and enforced (two-layer): the app runs as
> the `NOBYPASSRLS` `govtech_app` role with the per-request `SET app.tenant_id` context (migs 116/136/137).
> Do NOT treat RLS as "inert" or the sandbox as owner-bypass — **serve the sandbox as `govtech_app` with RLS
> on** so it behaves exactly like prod. The owner (`govtech`/`sqlBypass`) connection is ONLY for
> bootstrap/migrations and the few legitimate cross-tenant reads (agent-workforce rollup,
> `matched_opportunities`, rfp-curation Customer Interest — these MUST use `sqlBypass`). "No live DB /
> RLS-inert / can't test" is never a valid excuse — bring the stack up (`rehydrate-sandbox.sh` bootstraps as
> owner, then point the runtime `DATABASE_URL` at `govtech_app`) and prove tenant isolation for real.

**1. Heartbeat keep-alive.** Before any long drive, launch the heartbeat manager as a BACKGROUND task and
leave it running the whole session. It pings the DB + services every ~20s and auto-repairs PG / the server /
the emulator, so the sandbox stays active + the DB stays hydrated and a mid-drive idle-reap can't interrupt work:

    Bash(run_in_background):  INTERVAL=20 SCR=<scratchpad> bash frontend/scripts/sandbox-heartbeat.sh
    # add EMULATE=1 to also own the emulated-Claude endpoint (:8787) for AI-gated end-to-end tests

Status: `<scratchpad>/health-status.txt` (one line) + `health.log`. It can't prevent a full VM reclaim
(platform inactivity, no pin) — on one it writes `needs-rehydrate`; recovery is
`bash frontend/scripts/rehydrate-sandbox.sh`.

**2. Verify dispatched agents.** ALWAYS re-derive a sub-agent's finding against the actual code/schema before
acting on it — agents have returned stale/incomplete generation (this session: a "readiness uses the cheap
page estimate" gap that was already closed; inconsistent agent live/dormant counts). Trust nothing an agent
returns until it's proven against the source.

**AI-gated end-to-end testing (no live key):** `frontend/scripts/test-harness/emulated-claude.mjs` is an
Anthropic-Messages-compatible endpoint that lets this session BE the model (both services honor
`ANTHROPIC_BASE_URL` + gate on a non-`sk-noop` key). Prod uses the real Railway key + the identical wiring;
this closes the sandbox's AI gap. Per-agent RESPONDER registry returns each agent's exact expected shape.

---

## 0. LATEST — 2026-08-09 (workflow viz + compliance + full-draft landing; MERGED + DEPLOYED; READ THIS FIRST)

Everything below is **merged to `main` (PR #205) and deployed**. Migration head **162** at that time. `tsc 0 · vitest 899`.
**Since then (through 2026-08-16): migration head 185** — the **Command Center** cockpits (179) · **bucket-score
integrity** (180, docs/BUCKET_LOCKDOWN.md) · the **ranking spine** (181, docs/RANKING_SPINE.md) · the
**provisioning cockpit** + master `build_complete` (182, docs/PROVISIONING_WORKSPACE_DESIGN.md) · **tenant Workflow
Setup** (the `tw` series, no migration, docs/TENANT_WORKFLOW_SETUP_DESIGN.md) · the rebuilt **section-editing spine**
(section ToDos · editor AI · span-anchored comments 183 · AI-manager auto-advance · partner-scoped bell) · and
**cross-tenant isolation hardening** (per-command RLS on `document_templates` then `tasks`/`process_instances`, migs 184–185, docs/COPY_INWARD_VERIFICATION.md) · and four **launch fast-follows** (honest region proposer · retired Paste Topics modal · mig 185 · `amendment_monitor` reconciled WOKEN, `test_amendment_monitor_wiring.py` 9/9); plus the template-stable/bridge spine (migs 177/178;
`lib/template-bridge.ts`, docs/TEMPLATE_BRIDGE_DESIGN.md), the NILOC gold-example proposal set
(`frontend/scripts/niloc/`, docs/NILOC_GOLD_EXAMPLES.md), and the cost-volume common-form pass (migs 168/169).
RLS is **live app-side** (the app runs as `govtech_app`; see the ⛑️ callout above).

**Shipped this stretch:**
- **Workflow visualization** at `/admin/workflows` — a dependency-free, by-spine **Workflow Map** (all 29
  templates, discovery + build spines + platform) + **live instance DAGs** (step status overlay) +
  sortable/filterable/Live monitor. Files: `app/admin/workflows/workflow-graph.tsx` (renderer),
  `workflow-shapes.ts` (the code-defined shape catalog, 1:1 with `pipeline/src/workflows/*`),
  `workflow-map.tsx`. Both-spine admin guide: `docs/WORKFLOW_ADMIN_GUIDE.md`.
- **Compliance enforcement** — `validateCanvasAgainstSpec(doc, spec)` in `lib/types/canvas-document.ts`
  (font floor · page cap · images · header/footer), wired at the **export gate** (artifact export →
  `X-Compliance-Violations` header + `proposal:artifact.exported {compliant}` audit) and **section save**
  (`data.complianceWarnings`, non-blocking).
- **Full-draft LANDING (read-on-review)** — the fabric never lands agent output, and the workflow engine's
  invariants FORBID a pipeline ACTION from consuming an agent step's result (see
  `docs/FULL_DRAFT_LANDING_DESIGN.md`). So the landing is a **frontend, human-triggered** route:
  `POST /api/portal/[slug]/proposals/[p]/land-revisions` reads the proposal's latest `OnFullDraftRequested%`
  `process_instances.step_results`, extracts the staged canvases, and lands each as a **proposed
  `ai_revision` canvas_versions row** for the version-history UI to review + restore. Button: "Apply
  AI-proposed revisions" in `proposal-ai-actions.tsx`. Emits `proposal:full_draft.landed`.
- **Canvas export fidelity** — the TOC now renders in the PDF/preview (`lib/export/canvas-html.ts`), and the
  editor page-count uses the real `estimatePageCount` (not `nodes.length/8`).

**⚠️ INVARIANT any new `canvas_versions` writer MUST hold** (a bug the live staging scenario caught + I
fixed in the landing route): **`proposal_sections.version` must stay `> MAX(canvas_versions.version_number)`
per section.** Number a new row at the section's CURRENT `version` and ADVANCE the counter (compare-and-swap
`version = version + 1`) — mirror `lib/proposal/lock-section.ts` / `lib/proposal-advance.ts`. Numbering at
`MAX+1` without advancing makes the next human-save's archive collide → `ON CONFLICT DO NOTHING` silently
drops it → undo/history content-loss.

**One honest asterisk:** the landing's read/extract/land/restore path is fully live-verified, but the
UPSTREAM staging (agents generating the real canvases into `step_results`) needs `ANTHROPIC_API_KEY` — prod
has it, the sandbox doesn't. So the landing mechanism is proven; the LLM that fills the tray runs in prod.

**Recurring gotcha — the self-reverting sandbox (hit ~8×):** on idle the container reverts the working tree
+ local git + the `/tmp` Postgres to an OLD commit, and kills PG/server/heartbeat. **Nothing is lost** — every
commit is pushed. Recover: `git fetch origin && git reset --hard origin/<branch>` (or `checkout -B` from
`origin/main` if the PR merged); restart PG as the **`claude`** user (NOT root) on port **5433**
(`su claude -c '/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgs_gov/data -o "-p 5433 -k /tmp/pgs_gov" -l /tmp/pgs_gov/pg.log start'`);
`psql -h /tmp/pgs_gov -p 5433 -U claude -d govtech_intel`. Serve = the standalone recipe in §2 (stage
`.next/static`+`public`, then `node server.js`; auth on `localhost:3000`, env `AUTH_TRUST_HOST=true` +
`AUTH_SECRET`). Re-arm the scratchpad heartbeat to keep the box alive during live drives.

**Update 2026-08-11 — one-command recovery + a keep-alive manager (supersedes the PG recipe above
for the current env):** the sandbox Postgres is now the **system PG16 cluster on :5432** (role
`govtech`/`changeme`, db `govtech_intel`), NOT `/tmp/pgs_gov:5433`. After a reclaim, run
**`bash frontend/scripts/rehydrate-sandbox.sh`** — it starts PG, ensures the role+db, runs migrations
(169/170 self-seed the Foundation demo), builds if the standalone is gone, and stages `static`+`public`.
Then launch **`frontend/scripts/health-manager.sh`** as a **background task**
(`SCR=<scratchpad> INTERVAL=60 bash frontend/scripts/health-manager.sh` via run_in_background) — it pings
server+DB+pad every 60s and auto-restarts the server/PG *within a live VM*. Neither can prevent or survive
a VM reclaim (that's a platform inactivity behavior, no reserve/pin option — docs/en/claude-code-on-the-web
"Environment expired"); the manager just flags `needs-rebuild` when one happened so recovery is the two
commands above, not a re-diagnosis. NB: a server launched from a *foreground* call gets reaped — the manager
(a persistent background task) is what owns the running server.

**Object storage in the sandbox (image atoms / capture / export):** Railway's R2 isn't linked
here, so the frontend runs the **local storage driver** — `STORAGE_DRIVER=local` +
`LOCAL_STORAGE_DIR=/tmp/govwin-storage` + `AWS_S3_BUCKET=rfp-pipeline-local` (the health-manager's
`start_server` already sets these). `lib/storage/s3-client.ts` then backs the SAME
`putObject`/`getSignedGetUrl`/… calls with the filesystem (`<dir>/<bucket>/<key>`), and signed URLs
resolve to the gated `GET/PUT /api/storage/local/<key>` route — so uploads, box-capture image atoms,
and export image-inlining all work end-to-end. Prod (no flag) is unchanged (real R2). Verify with
`frontend/scripts/verify-local-storage.mts` (driver) + `verify-storage-server.mts` (upload→serve).

**⚠️ The sandbox now serves as `govtech_app` — RLS is ENFORCED here (2026-08-17).** `sandbox-heartbeat.sh`
used to hand the server the **superuser** `govtech` connection, which bypasses every RLS policy — so the
whole missing-`enterTenant` bug class was INVISIBLE to `tsc`, `vitest`, and live drives, and only appeared
in production as 0 rows / 404 / RLS-violation. It now passes `DATABASE_URL=govtech_app` (NOBYPASSRLS) +
`DATABASE_URL_OWNER=govtech` (for `sqlBypass`), matching prod exactly per CLAUDE.md. Set `RLS_FAITHFUL=0`
to fall back to the old superuser behaviour. **Consequence: a route that forgets `enterTenant(tenantId)`
in its OWN handler frame now fails HERE, which is the point.** To check a table by hand:
`PGPASSWORD=changeme psql -U govtech_app -d govtech_intel -c "SET app.tenant_id='<uuid>'; SELECT …"` —
with no `SET`, every RLS-gated table correctly returns 0 rows.

**Login rate limit while drive-testing:** `middleware.ts` caps `/api/auth/*` at **20 requests / 15 min
per IP** (in-process Map). A multi-actor script burns that fast and then every later login returns
`RATE_LIMITED` — which reads exactly like a broken password. Pace the logins, reuse cookie jars, or
restart the server process to clear it (kill by PID: the heartbeat launches a bare `node server.js`,
so `pkill -f standalone/server.js` does NOT match it).

**Verified demo accounts:** `kate.ulepic@foundation3dp.com` / `DemoPass123!` (Foundation tenant_admin) ·
`eric@rfppipeline.com` / `RFPAdmin2026!` (rfp_admin). Foundation TVSF proposal `c3db60b1-…` (submitted/locked;
`scripts/rebuild-tvsf.mjs` restores it to canonical — run with `NODE_PATH=frontend/node_modules`).

**Next up (2026-08-09):** a fresh punchlist sweep + a docs-accuracy pass (CLAUDE.md · ARCHITECTURE_V10 ·
workflow docs · EVENT_CONTRACT namespaces) — in progress.

---

## 0·aug04 — 2026-08-04 (V1 hardening: bug-hunt + polish + docs)

Post-wiring hardening pass on the V1 + archive work:

- **Bug hunt** (3 adversarial agents — API / React / data-layer; every finding proven against code
  before fixing): **12 fixes** — amendment confirm no longer 200s on a no-op (`confirmAmendment` returns
  `{confirmed}` → route 409s); fan-out skips archived proposals; portal + tenant + outcome archive
  cascades scoped to **BUILD** `process_instances` (never a co-active `spotlight`/`contract` run on the
  same opportunity); tenant archive is compare-and-swap (404/409, not a silent 200); `finder:tenant.*`
  events dropped the top-level `tenantId` (finder=admin SOP); archived **Export** POSTs (was a GET → 405);
  amendment banner / curation panel error paths surfaced; canvas Review composer honors `canComment`.
  (commit `0e4a6fb`)
- **Polish** — new dependency-free `frontend/lib/toast.tsx` (module-level pub/sub, `<Toaster/>` mounted
  once in the root layout); every transient `alert()` across portal / admin / curation → `toast.*`.
  Native `confirm()` kept for destructive blocking gates; form validation keeps inline `setMsg`/`setErr`.
  (commit `e8b74bb`)
- **Manuals regenerated** — all 3 role guides (`_src/build_*.py` → JSON → HTML/PDF): Studio, AI Actions /
  full-draft modes, amendments (log→confirm→acknowledge), portal + atom + tenant archive, packaging
  review, outcome→contract, mark-all-read, comped-portal grant, assess-ingest, auto-drive doorbell.
  (commit `bea5881`)
- **Docs synced** — CLAUDE.md (mig 148 + corrected archive contract + toast convention + vitest 855),
  ARCHITECTURE_V10 §7 (migs 144–148), docs/ARCHIVABLE_CONTRACT.md (tenant/atom cascade text reconciled to
  as-built), CLAUDE_CLIFFNOTES §1c.

State: migrations **148** · **vitest 855** · tsc 0 · next build ✓. Front-to-back / side-to-side live test
done — **zero product bugs** (docs/V1_READY_REPORT.md §7). **Launch punch list: docs/V1_LAUNCH_PUNCHLIST.md**
(Wave A = prod ops/config blockers; B = RLS cutover + demo refresh; C = next-cycle full-e2e QA fixtures).
**Next-cycle test-env spin-up (fast + full refresh, e2e fixture gaps, the fire-a-portal recipe): CLAUDE_CLIFFNOTES §0.**

## 0b. 2026-08-03 (V1 UI-wiring program + universal archive)

The V1 gap-register was wired end-to-end (H1–H5, M1–M6, H2) + three full builds: **amendment
fan-out engine** (mig 146; detect→confirm→fan-out→acknowledge), **contract+kickoff** (was already
built — audit added), and the **archive lifecycle**. Then a **universal archive** pass, corrected to
the as-built model (docs/ARCHIVABLE_CONTRACT.md + docs/V1_LAUNCH_GUIDE.md):

- **Archive = soft, reversible, sort/visibility only. NOTHING is ever hard-deleted** (future: S3 bulk
  cold-storage by `archived_at` watermark). The earlier proposal hard-delete was removed.
- **Archive actions on three entities ONLY:** portal/pipeline (proposal → cascades its
  `process_instances` by tenant+opportunity), library atom / foundational doc (per-item `archived_at`
  → excluded from library + **draft selection**; atoms are copied-forward so no cascade), tenant
  (rfp_admin → cascades workflows). **Workflows are instantiated templates — no archive of their own**;
  they cascade + keep `archived_at IS NULL` filters so they drop out of the monitor. **Cards are NOT
  archivable** (reverted). mig 148 added `archived_at` to process_instances/library_atoms/contracts
  (+ tenant_opportunity_cards, now unused).
- **content_generator was never dormant** — the OnCmsContentRequested vertical runs it from the admin
  "Generate Content" launcher; roster relabeled `live`. (Third stale gap-register claim caught by
  verifying agent work — after M4 contract + Archive.)

State: migrations **148** · **vitest 855** · tsc 0 · next build ✓ (`EIHMKFP62qwSslLPKG8B3`). Verified
E2E on the live server as all four working actors (master_admin `eric@rfppipeline.com`, tenant_admin
`kate.ulepic@foundation3dp.com`, tenant_user `connor.casey@foundation3dp.com`, partner
`pjackson@ecinnovates.com` — all `DemoPass123!`): archive→cascade→restore proven via `proposal.archived`
payload `workflowsArchived=1`; tenant_user boundary (no Studio/Archive) confirmed. **Remaining for
launch:** regenerate the in-browser help HTML from docs/V1_LAUNCH_GUIDE.md (L5).

## 0a. 2026-08-02 (TVSF Foundation proposal build)

First-customer (Foundation 3DCP) TVSF proposal, built end-to-end as **Paul Jackson** (external
EC shadow-admin, `pjackson@ecinnovates.com`). Canonical TVSF shape (docs/TVSF_SPEC.md): **3
volumes** — Narrative (Abstract + Q1–14, 7pp) · Willingness-to-License Letter · ESP Support Letter;
four mandatory tables (competitor Q2, pro-forma P&L Q6, milestone Q11, budget Q12). Proposal
`c3db60b1-2f0e-4bc8-903c-1ec098906c58`, tenant `17780cad-…`. **`scripts/rebuild-tvsf.mjs` is the
canonical demo builder** (idempotent, DETERMINISTIC section ids `c3db6000-0000-4000-8000-<sort>` so
tests/screenshots don't churn — re-run any time).

Shipped this sprint:
- **Whole-proposal PDF download.** `POST /api/portal/<slug>/proposals/<id>/package` now takes
  `format=json|docx|pdf|zip`. `pdf` reuses the SAME combined-CanvasDocument assembly as docx and
  renders via `exportToPdf` (Chromium: header/footer, page numbers, tables + inline SVG figures).
  UI: a red **Download Proposal (.pdf)** button in `proposal-admin-panel.tsx` beside .docx/.zip.
- **Real figures in the narrative.** Native `chart` nodes (SVG in PDF, sharp-rasterized PNG in docx):
  a milestone bar chart (Q3) + a pro-forma revenue/gross-profit line chart (Q6). `renderChartSvg`
  in `lib/export/canvas-html.ts` was already there — rebuild-tvsf just authors the nodes.
- **NUMBERING ROOT FIX (durable).** Sections were string-sorted by `section_number` ("10".."14"
  before "2"; volumes out of order). Added a real integer **`sort_index`** column (**migration 143**
  — adds + backfills + indexes it; it was previously created only ad-hoc by rebuild-tvsf, so the
  new `ORDER BY sort_index` would have errored in prod). Every section-ordering query now sorts
  `ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number`: workspace page, detail
  API, review page, per-volume export + layout, and `proposal-advance`. **Migrations now at 143.**
- **Deliverables committed to git:** `docs/TVSF_PROPOSAL_BUILD_GUIDE.md` (+ `.pdf`, 12 screenshots
  under `docs/tvsf-build-guide/`, driven by `frontend/e2e/hitl-tvsf-build-guide.spec.ts`) and
  `docs/Foundation_TVSF_Proposal.pdf`.

**Operational reality that ate the most tokens** (now fixed in §2): `next start` does NOT serve
`output:'standalone'` — you must run `node .next/standalone/server.js` after staging static/public;
and auth flows must hit `localhost:3000` (not `127.0.0.1`) or NextAuth bounces. Full recipe + the
PDF-tooling map are in §2. Agents were NOT freshly run (sandbox `ANTHROPIC_API_KEY=sk-noop` is a
no-op); sections are already `section_drafter`-drafted (`ai_drafted`).

**Also shipped this session — the admin-agent program + observability sweep:**
- **`rfp_ingest_manager` (36th archetype)** — the platform-scope ingest-orchestration *manager* (the
  analog of the tenant `proposal_manager`). Admin-invoked (`.../assess-ingest` →
  `OnIngestAssessmentRequested` → `tool.ingest.assess`), reads a curated solicitation's ingest state,
  infers the stage deterministically, plans which specialist agents to run next. Advisory,
  injection-fenced, guardrail-gated, **no tenant descent**. Locked by
  `pipeline/tests/test_rfp_ingest_manager_wiring.py` (7/7, incl. a live drive over our own solicitations).
  Full spec: **docs/ADMIN_AGENT_DESIGN.md**.
- **Proposal Auto-Drive "doorbell"** — the tenant Proposal Draft Manager (`proposal_manager` +
  `OnFullDraftRequested{ModeA,B,C}`, Mode C = full auto) is now admin-drivable from `/admin/agents`
  without portal descent: a card → `POST /api/admin/proposals/[p]/full-draft` → the same
  `proposal:full_draft_requested` trigger. Portal + doorbell funnel through ONE helper
  (`lib/proposal-full-draft.ts::requestFullDraft`) — one auditable record, `source` = `portal` vs
  `admin_doorbell`. **Verified live** as master_admin: the ring lands in `system_events` +
  `proposal_activity_log` (attributed, `source=admin_doorbell`), visible atop `/admin/events`.
- **Event-audit sweep** (**docs/EVENT_AUDIT_2026-08-02.md**) — every actor/automation/agent/manager
  action posts to the `system_events` spine (+ domain logs). One gap found + fixed: `package?format=zip`
  returned the whole native package with zero audit; now emits `package.export_started`/`.exported` +
  `download_count` + `proposal_activity_log`, parity with docx/json/pdf.
- Migrations still at **143**; frontend `vitest` now **829**; pipeline agent suite **257**.

## 0b. — 2026-07-25 (library + collaboration vaults)

Shipped the **library/vaults build plan** (docs/LIBRARY_VAULTS_BUILD_PLAN.md, tasks #231–275).
Grain model `foundation ⊃ section ⊃ group ⊃ atom`; the **starter set** seeds + agent hookup;
and **collaboration vaults ("nooks")** — a per-partner, RLS-segregated branch library with a
full **two-sided UI** now live (design: docs/LIBRARY_AND_VAULTS_DESIGN.md §9).

- **Tenant side:** `/portal/<slug>/vaults` (index + create-a-nook) and `/vaults/<id>` (NookDetail,
  full rights: invite/revoke · copy-in · any-grain download · Harvest → library). "Vaults" nav
  link beside Library (tenant_admin-gated).
- **Collaborator side (NEW top-level surface):** `app/vaults/` — a vault-only partner holds NO
  tenant membership, so it lives OUTSIDE the portal (`resolveVaultAccess`, not
  `verifyTenantAccess`). `/vaults` lists their own nook(s) only; `/vaults/<id>` reuses NookDetail
  with COLLAB_RIGHTS (upload · atomize · download-WHOLE-only — no members panel, no Harvest). The
  portal dispatcher routes a vault-only collaborator to `/vaults` at sign-in.
- **P8.7 HITL:** a collaborator upload emits `library:vault.artifact_uploaded` + raises ONE
  standing `tenant_admin` `vault_artifact_review` ToDo per nook (idempotent). **P8.8:**
  instruction-based sharing copy per side (partial-share/signatures deferred).
- **Isolation contract (proven 0-leak):** every nook grain carries `vault_id`; ~20 main-library
  readers + all pipeline agents are fenced `vault_id IS NULL`, so nook content is invisible to
  the main library AND the agents until a tenant harvests it.

**Migrations:** 134 (collaboration_vaults + vault_members + library_atoms.vault_id + visibility
CHECK += 'vault' + FORCE RLS), 135 (starter-offer partial-unique idempotency).

**Verification (all green):** `tsc` 0 · `vitest` **828** · `next build` (all four vault routes) ·
drives: `drive-vault-collab-surface` 5/5, `drive-vault-{isolation 7/7, content 5/5, leak 0-leak}` ·
both sides captured in-browser → Customer-Admin (§13) + Collaborator (§8) manuals re-rendered.

**Sandbox demo nook (screenshots):** `scripts/seed-vault-demo.mts` seeds a nook "Acme Robotics"
owned by Immobileyes + a login-capable partner **partner@acme.test / Sandbox2026!** (partner_user,
no tenant membership → lands on `/vaults`). `scripts/capture-vaults.mjs` captures both sides.
**Screenshots need the DEV server** (`next dev -p 3001`) — the prod `next start` build hit a client
hydration error ("Something went wrong") in this sandbox; dev hydrates cleanly. Login via Playwright:
`goto(domcontentloaded)` → `waitForTimeout(2500)` (let hydration finish) → `waitForSelector('#email')`
→ fill; `networkidle` on the login goto starves and the pre-hydration node detaches.

---

## 0. EARLIER — 2026-07-22 (launch-readiness → automation-prep)

The last several days were a **both-sides launch-readiness pass** on top of the identity/agent work
below. State entering the automation phase (task **#190**):

**Verification (all green this session):** `tsc --noEmit` 0 · `vitest run` **729/729** · `next build`
EXIT 0 · migrations apply clean through `migrate.mjs` (head = **125**) · adversarial 3-agent bug sweep
(API/React/SQL) PROVED + fixed 2 HIGH bugs. This 6-step order IS the verification backbone (now codified
in DEVELOPMENT_STANDARDS §3 / TESTING_STRATEGY / DEFINITION_OF_DONE).

**Migrations 124–125 (new):**
- **124 — SECURITY:** rotated `eric.c.wagner@gmail.com` (master_admin) off the committed `GovWin2026!`
  to a random password (⚠️ **bcrypt hash only in git; the plaintext lives ONLY in chat** — `temp_password=true`
  forces a reset on first login). Deactivated/hash-invalidated the `.test` seed accounts; archived the
  `apex-defense` test tenant. Sorts after 041/051 to win any ON-CONFLICT re-apply.
- **125 — dead-table drop:** dropped **12 superseded, zero-referenced** tables (`tenant_pipeline_items`,
  `opportunity_events`, `customer_events`, `content_events`, `pipeline_runs`, `proposal_reviews`,
  `solicitation_templates`, `tenant_uploads`, `tenant_actions`, `legal_document_versions`, `system_config`,
  `collaborator_library_prefs`) + rebuilt the `v_opportunity_rollup` view onto `tenant_opportunity_cards`.
  **Drop rule (codified):** superseded-with-a-successor AND zero live refs — "empty in the sandbox" is NOT a
  drop signal. KEPT (empty but forward-live): `verification_tokens`, `invitations`, `agent_archetypes`,
  `rate_limit_state`, `system_health_snapshots`.

**UI-UX + auditability sweep (both sides, 17 fixes + 1 SSR crash) — verified live (Playwright):**
- **Free "Open portal" bypass CLOSED:** `POST /api/portal/[slug]/portals` is gated to rfp_admin+, records a
  $0 `purchases` row (`metadata.grant='admin'`) + emits `capture:purchase.completed` → an **RFP-Admin-approved
  free portal audits EXACTLY like a purchase**. Validates the opportunity exists first (FK-before-audit).
- Silent-failure handlers now surface errors (proposal-admin-panel, pipeline-cards, source-detail, guardrail-defaults,
  spotlight-summary-editor); post-submit unlock renders; honest cold-start card for base tenant_users; Stripe CTA
  returns a friendly `STRIPE_NOT_CONFIGURED`; admin document PDF export wired.
- **Auditability:** every state-changing action now emits a namespaced `system_event` (**97/97** on checked paths).
  New/fixed types: `library:atom.created` (all 3 atom producers), `library:section.atoms_selected`,
  `finder:tenant.created` fixed to `tenantId:null`, comp `capture:purchase.completed`.

**Two HIGH bugs found+fixed by the adversarial sweep (both bug-classes now in CLIFFNOTES §4 Mistakes 39–42):**
1. `next/dynamic({ssr:false})` does NOT forward `ref` (Next 15.5 writes `{retry}` to `ref.current`) → pass the
   imperative handle via a normal `innerRef` prop. (pdf-viewer.)
2. react-pdf/pdfjs crash SSR at module-eval → load via `next/dynamic({ssr:false})`, never a static import into a
   client component. (This was white-screening the whole curation workspace.)
Plus Mistake 41 (FK-before-audit ordering) + Mistake 42 (empty ≠ dead).

**Deprecation/bloat cleanup:** removed 16 unused frontend npm deps (tiptap ×6, dnd-kit ×3, react-query,
lucide-react, recharts, clsx, date-fns, dom-serializer, domutils); deleted dead code (`pipeline/src/scoring/`,
`DEFAULT_CATEGORIES`, dead `STORAGE_ROOT` env) + 6 orphaned frontend modules. **Cataloged (NOT blind-deleted):**
~28 no-caller API routes, 8 dead exports, 4 needs-review libs — a per-item decision in docs/DEPRECATION_CLEANUP_2026-07-22.md.

**⚠️ Cross-tenant admin/CMS reads on RLS-FORCED tables — must run on the BYPASS/owner path (RLS is LIVE):**
the retired-table repoints made two **direct cross-tenant admin/CMS reads** on `tenant_opportunity_cards` (RLS
FORCED) — `app/admin/rfp-curation/[solId]` Customer Interest + CMS `matched_opportunities`. Because RLS is
**enforced now** (the app connects as the `NOBYPASSRLS` `govtech_app` role, and the sandbox emulates that
exactly), a tenant-scoped connection returns ZERO rows for these — they MUST use `sqlBypass` / an owner-view
read (legitimate cross-tenant admin surface). Verify both are on the bypass path; treat any tenant-scoped
cross-tenant read as a live bug, not a future-cutover item.

**Automation spine — MAPPED, ready to build (the phase we're starting).** The engine is ALREADY the
start→end gate pattern the user wants: declarative `Workflow` = `trigger` + `steps[]` (DAG via `depends_on`),
`validate()` hard-rejects bad templates at boot, every step emits start+end into `system_events`, state is
DERIVED (stateless) from `process_instances`/`_transitions`/`tasks`, two reconcilers (event processor with
5-min lookback + idempotent spawn; time sweeper for nudges/timeouts) give cold-restart. `ProjectCollaboration`
= the generic multi-actor gate. 11/12 lifecycle stages wired. **The one genuinely-open piece = the global
per-tenant automation policy layer (recipients × trigger × timing × escalation)** feeding
`nudge_days`/`assignee_role`/`due_in_minutes` into instances — that IS task **#190**. Map:
`docs/AUTOMATION_SPINE_MAP.md` (+ AUTOMATION_DESIGN.md, AGENT_WORKFORCE.md).

**Docs refreshed this session (the "next push"):** CLAUDE.md, CLAUDE_CLIFFNOTES.md, ARCHITECTURE_V10 +
FOLDER_STRUCTURE, DEVELOPMENT_STANDARDS + TESTING_STRATEGY + DEFINITION_OF_DONE, AGENT_FABRIC_DESIGN +
AGENT_WORKFORCE + AUTOMATION_DESIGN, EVENT_CONTRACT_V3 + RATE_MONITORING + **new** SECURITY_AND_SAFETY.md,
the MANAGE_CONSOLE_GUIDE + user-guides. Session audit docs: UI_UX_AUDIT_2026-07-22, DEPRECATION_CLEANUP_2026-07-22,
AUTOMATION_SPINE_MAP, LAUNCH_READINESS_2026-07-22.

**NEXT:** task **#190** — build the global per-tenant automation policy layer (the grammar) on top of the mapped spine.

---

**AGENT WORKFORCE — COMPLETE + EXPANDED (36 archetypes). Source of truth: `docs/AGENT_WORKFORCE.md`;
forward plan: `docs/archive/AGENT_ROADMAP.md`; fabric §0 summary: `docs/AGENT_FABRIC_DESIGN.md`.**

- **#117 DONE — all 10 original archetypes awake as workflow actors.** section_drafter / compliance_reviewer /
  color_team_reviewer were live; this run woke librarian (producer in atomize-package), scoring_strategist +
  opportunity_analyst (per-tenant producers on the PIN route), proposal_architect + capture_strategist
  (AI_INVOKE in OnProposalCreated), packaging_specialist (AI_INVOKE in OnProposalAdvancedToFinal),
  partner_coordinator (AI_INVOKE in the new OnCollaboratorInvited). Each greenfielded to `library_atoms`,
  tenant-discretion (no `tenant_id` in schemas), injection-fenced, locked by `test_<agent>_wiring.py`.
- **#120 DONE — the two 🚩 flags are built.** Mig 117 adds the `rfp_agent` NOBYPASSRLS role + FORCE-RLS +
  tenant_isolation on proposals/proposal_sections/tenant_profiles/atom_tags (PROVEN in sandbox: cross-tenant/
  unset reads return 0 rows). `fabric.invoke_agent` sets/resets `app.tenant_id` per call (optional agent pool
  via `AGENT_DATABASE_URL`). `agents/guardrails.py::enforce_guardrails` gates every result (advisory →
  guardrail → land-or-review): disallowed content → review, scoring adjustment clamped to ±15, fail-safe.
  **Deploy step (gated):** provision a login member of `rfp_agent` + set `AGENT_DATABASE_URL`.
- **Batches A/B/C DONE — fabric then 19; POD4/CMS + the library-seed pair have since taken it to 27.** Batch B onboarding_agent (OnApplicationAccepted). Batch A
  platform-scope opportunity_scout/ingest_analyst/matrix_stager/skeleton_architect (OnOpportunitiesDetected +
  OnRfpUploaded). Batch C outcome_analyst/amendment_monitor/cost_estimator/pp_matcher (OnProposalOutcomeRecorded
  / OnSourceChangeDetected / OnProposalCreated). Platform agents skip tenant-discretion (no tenant) but KEEP
  the injection fence + land into the admin curation review.
- **Verify:** `cd pipeline/src && PYTHONPATH=. python3 -m pytest ../tests/test_*_wiring.py ../tests/test_agents.py
  ../tests/test_agents_security.py ../tests/test_guardrails.py -q` → 332 green (crypto failures are a
  pre-existing PyO3 env artifact). Deploy has the real ANTHROPIC_API_KEY (Railway); LLM reasoning runs live
  there — in-sandbox we verify routing + producer/step + tool SQL against the live schema.
- **NEXT:** the **RFP-Pipeline (our-org) agents** — a separate future run (as agreed). Oversight surface is
  `/admin/agents` → Agent Workforce (roster + per-tenant usage rollup, forward-only bridge).

**LAUNCH-READINESS — all green this session (2026-07-19):** identity×deeplink 22/22, shadow-tenant-admin
10/10, pin 15/15, p3-lifecycle 13/13, immobileyes-shadow 4/4, item-template-picker 8/8, **full Monday
journey E2E green** (ingest→matrix→atomize→spotlight→provision→draft-from-atoms→lock→harvest(lineage)→
export, tenant-isolated), vitest 701/701, tsc clean, build clean. Identity model is DONE. Remaining
backlog is NON-critical: #117 (7 dormant agents — large, defer past launch), #69 (Ohio TVSF gen),
#18 (past-proposal templify), #111 (deploy-verify, automatic).
**This file is the durable "start here tomorrow" memory.** It's committed to git on
purpose — the sandbox container is ephemeral and gets reclaimed; git is the layer that
survives. Read this first, then `docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md`.

---

## 1. What just shipped (this sprint = multi-membership identity, DONE + verified)

One email → many `(company, role)` memberships; pick one at login; the session is
**singular** and enforced. Commits on the branch, newest last:

| Commit | What |
|---|---|
| `cf3989a` | P1 — `user_memberships` table (mig 111) + backfill; `verifyTenantAccess` reads it |
| `42c8b3b` | P2 — `/select-company` selector when >1 membership |
| `d8a3937` | Collaborator visibility — withhold unassigned sections server-side |
| `7935ab7` | Universal upload+atomizer (dashboard + collaborator view) |
| `7662779` | RFP-admin shadow descend/ascend — banner + ack modal + audited |
| `bab99b7` | **Singular ENFORCEMENT** — active membership pinned in the JWT (`unstable_update`) |
| `ecaaad9` | **P3** — collaborator invite → membership (multi-company works) + uuid[] fix + login copy |
| `be5eb82` | launch-hardening — run.sh glob footgun fix; Immobileyes shadow flow verified; #116 sweep clean |
| `465a47a` | **Never hard-delete a user** — collaborator soft-delete + reactivate (mig 112); fixes removal 500 |
| `d09c348` | membership-ify all user-creation paths (team invite + onboarding accept) |
| `836353f` | **Company ARCHIVE** (license slumber) — third state (mig 113); reversible + lossless |
| `74f1f10` | **#115** retire legacy users.tenant_id access read-through — access is now membership-pure |
| `f1d1fb3` | **#118** team-member deactivate/reactivate (never delete) + dispatcher redirect-loop fix |
| `5d54174` | RFP-admin **create company + admin POC** (was a stub) + "New Company" admin UI |
| `994aa41` | **Notification deep-link** — /go + /api/enter land recipients directly in their company queue |

**Admin/RFP capability set (all done + verified):** tenant_admin adds/(de)activates users
(`team/[userId]`) + collaborators (invite/soft-delete/reactivate); a shadow rfp_admin passes the same
tenant_admin gate, audited. RFP-admin creates companies+POC (`POST /api/admin/tenants`), archives/
restores companies, and shadows in to help upload+atomize.

**Notification deep-link foundation (`c2ee5b8`) — for ALL external nudging.** Emails from
platform@rfppipeline.com (`GOOGLE_WORKSPACE_EMAIL`+Gmail API) link to `/go?task=<id>` or
`/go?tenant=<slug>`. `/go` is the orchestrator: checks link freshness (task completed/cancelled/expired,
proposal archived/submitted → "already done" note), then routes by session state — in the target company
→ "you're in X" confirm → the task; in a DIFFERENT company → `DeepLinkGate` "Switching companies" (sign
out + re-login, singular session, NO silent switch); unpinned multi-membership → `/api/enter` pins the
target (first pick); admins straight in. `/api/enter` never silently cross-switches (hands to `/go`).
So email = the nudge; completion happens in-platform, auditable.

**Identity is 100% across deep-linked emails — hardened + proven (this session).** Two fixes closed the
last gaps: (1) `middleware.ts` now preserves the FULL path INCLUDING the query on the unauthed→/login
redirect (`from = pathname + req.nextUrl.search`) — before, a multi-membership recipient who wasn't
signed in lost the `?tenant=`/`?task=` target and stranded at the dispatcher; (2) `/go`'s switch-relogin
routes back through `/go?tenant=<target>` (not `/api/enter`) and the here-ack is restricted to
`(pinned && sessionSlug === targetSlug) || memberships.length === 1`, so a fresh not-yet-pinned
multi-membership session re-pins via `/api/enter` and lands PINNED to the target (not merely at its URL).
Proven end-to-end by `scripts/drive-identity-deeplink.mts` (22/22): switch round-trip lands PINNED as the
target's role; unauthed deep-link to a NON-home company survives login; non-member denial; completed-task
dead-link ack; `/api/enter` no-silent-switch guard. Manual: `getting-started.md` "Following a
notification link" (screenshots `deeplink-switch/-login-notice/-here/-donetask.png`).
Regression scripts: `scripts/drive-pin.mts` (15), `drive-p3-lifecycle.mts` (13), `drive-identity-deeplink.mts` (22),
`drive-shadow-tenant-admin.mts` (10, #114), `drive-item-template-picker.mts` (8, #77),
`drive-past-proposal-templify.mts` (27, #18).

**#18 DONE (this session) — past-proposal templify + regen + branch-and-promote lineage loop.** In the
Library, "Reuse a past proposal" lists uploaded proposal packages (document_cocoons). **Templify** →
`templates/extract` new `cocoonId` source reconstructs the ordered section skeleton via
`lib/templates/past-proposal-canvas.ts` (lay atoms out DIRECTLY — assembleArtifactCanvas→moldNodes drops
bare prose and collapses structure), persisted as a tenant template (metadata.templifiedFromCocoon), emits
`library:template.extracted` (source=past_proposal). **Regen** (`New draft` → documents POST) creates a new
tenant_document AND copies the seminal atoms into WORKING drafts (source=manual, status=draft) bound to the
doc via a working `document_cocoons.origin_document_id` (mig 115), each with `atom_lineage` derived_from →
the seminal atom; emits `library:document.regenerated`. **Full lock for download** (`DocumentLockBar` →
`documents/[id]/lock`) sets the doc `status=final` and PROMOTES the working copies to FOUNDATION atoms
(status=approved, source=download_derivative) via `lib/documents/lock-document.ts`, lineage preserved; emits
`library:document.locked`. Seminal atoms are NEVER touched (non-destructive). Constraints: atom source CHECK
= upload|harvest|download_derivative|manual (no 'regen'); cocoon source CHECK = upload|download|system|harvest;
tenant_documents.status CHECK = draft|final (lock = 'final'). Proven `drive-past-proposal-templify.mts` (27/27,
incl. 4/4 sections+titles preserved, lineage to seminal, promotion, non-destructive) + unit
`__tests__/past-proposal-canvas.test.ts`. Manual: `library-atoms.md` §6 (screenshots library-templify-panel/
-form, document-lock-bar). **Mig 115 must apply on deploy** (auto via entrypoint→migrate.mjs).

**Migrations added this stretch:** 111 (user_memberships), 112 (proposal_collaborators.revoked_at),
113 (tenants.archived_at), 114 (rfp-pipeline tenant + staff memberships). All idempotent +
auto-applied on deploy via `entrypoint.sh → migrate.mjs`. Verify post-deploy.

**#112 "including us" DONE (`c7c00f7`):** RFP Pipeline is a real tenant; staff hold tenant_admin home
memberships; **Our Workspace** admin-nav link → `/portal/rfp-pipeline` gives us the upload/atomizer +
whole portal like any customer (atomize into our own library_atoms). Portal layout: `isShadowAdmin =
admin AND not-a-member`, so no shadow banner on our own tenant; customer tenants still show it.
**Identity/lifecycle/admin model is now COMPLETE.** Remaining: #111 (deploy-verify, auto), and the
NON-identity gaps #117 (dormant agents), #69/#18 (curation/template features).

**#114 DONE (this session) — shadow-admin-as-company-admin, proven + reconciled.** The design once
imagined rewriting the shadow session role to `tenant_admin`; the as-built delivers the SAME authority by
HIERARCHY and deliberately keeps the platform role. Every customer-portal gate is
`hasRoleAtLeast(role,'tenant_admin')` (or lists the admin roles) and rfp_admin/master_admin outrank
tenant_admin, so a shadow admin passes every tenant_admin gate; there is NO in-tenant action gated on
*exactly* tenant_admin and NO rfp_admin-only bypass inside a single customer portal. Keeping the platform
role (a) preserves honest audit provenance ("an RFP admin did this in shadow", not an anonymized
tenant_admin — the user's "still all audited" requirement), and (b) keeps the shadow banner + singular-session
exemption working (`isShadowAdmin = isAdmin && !hasActiveMembership`). Proven by
`scripts/drive-shadow-tenant-admin.mts` (10/10): no membership at target, role stays platform-admin
in-tenant, tenant_admin-gated WRITE succeeds, audited under the admin's real user id scoped to the customer.
Design reconciled in MULTI_MEMBERSHIP_IDENTITY_DESIGN.md ("AS-BUILT (#114)").

**#77 DONE (this session) — required-item → template picker in curation.** The AddEditItemModal now
carries a **Section grounding** block: a **Starter template (mold)** picker (fetches `/api/admin/templates`,
grouped by type) that sets `volume_required_items.template_id`, plus an **Expert notes** textarea →
`expert_notes`. Both were already accepted by the `volume.add/update_required_item` tools and consumed by
provisioning (`create/route.ts` SELECTs `canvas_document` by `template_id` → interpolates the section mold;
`expert_notes` → section.meta; via `compliance-resolver.ts`), so this closed the UI gap end-to-end. Linked
items show 📄 template + ✎ notes badges in the volume list. Proven by `scripts/drive-item-template-picker.mts`
(8/8, real modal). Manual: `admin-rfp.md` §3 (screenshots `curation-item-template-picker/-badge.png`).

**Identity state ladder (user directive) — active · inactive · archived, all reversible + auditable, nothing destroyed:**
- **active / inactive** = per-USER (never hard-delete; mark inactive, keep history, re-invite reconstitutes
  the same row auditably). Collaborators DONE (revoked_at + reactivate). Tenant_users/admins = gap #118.
- **archived** = whole COMPANY (license lapsed): `tenants.archived_at`, orthogonal to per-user state so
  renewal restores everyone to their exact prior state for free. Archived companies vanish from the login
  list (`getActiveMemberships` filters them); admins can still enter to renew. Admin control on the tenant
  page. DONE + verified (`scripts/drive-archive.mts`). Every user-creation path now writes a membership.
See the identity design's "Never hard-delete" + "third state: ARCHIVED" sections.

**As-built mechanism (don't re-derive):**
- The active `(role, tenantId, tenantSlug)` + a `membershipPinned` flag live in the
  **session JWT**. `auth.config.ts` `jwt` callback: sets them false on login, and on
  `trigger === 'update'` copies them from `unstable_update` data and sets pinned=true.
- `/select-company` posts to `selectCompanyAction` (`app/actions/auth-actions.ts`) →
  validates the tenant is one of the caller's memberships → `unstable_update` rewrites
  the JWT → redirects. So the active **role follows the selected company** (a
  tenant_admin-at-home becomes partner_user when they enter a company where they're a
  collaborator). This is what reaches all ~40 portal routes without editing each one.
- Re-pick-proof: once pinned, `/select-company` + dispatcher forward to the active
  company; the portal layout redirects any other tenant back. Logout clears the JWT
  (= clears the pin) → "log out to switch" is a hard guarantee.
- **Fail-closed safety net:** `verifyTenantAccess` (lib/db.ts) also caps a non-admin's
  active role to the role actually granted at that tenant
  (`hasRoleAtLeast(membershipRole, sessionRole)`), so even if the rewrite didn't take,
  routes deny — never escalate.
- RFP/master admins are **exempt** (they re-scope in-session via shadow descend/ascend).
- P3 invite: `proposal_collaborators` route also INSERTs an active
  `(tenant, partner_user|tenant_user, source='collaborator')` membership,
  `ON CONFLICT (user_id,tenant_id) DO NOTHING`, **without touching users.tenant_id**
  (home preserved, no clobber).

**Verified:** `frontend/scripts/drive-pin.mts` (12/12: pin, role-rewrite, hop-denied,
re-pick-proof, single-membership + admin controls) and `frontend/scripts/drive-p3-invite.mts`
(cross-company invite → two memberships, home preserved). tsc clean; vitest 701/701.

---

## 2. Spin up the sandbox (exact commands + gotchas)

```bash
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'

# The disk PERSISTS across idle (git repo, node_modules, .next build, AND the
# postgres data dir at /tmp/pgs_gov/data all survive) — but the postgres + next
# PROCESSES are stopped when the container goes idle. So on resume you usually
# only need to RESTART both, not rebuild/reseed.

# 1. Start postgres on the surviving data dir (PG16; runs as 'claude', NOT root):
rm -f /tmp/pgs_gov/data/postmaster.pid            # clear the stale pid from last run
mkdir -p /tmp/pgs_sock && chown -R claude:claude /tmp/pgs_gov /tmp/pgs_sock
su claude -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgs_gov/data \
  -o '-p 5433 -k /tmp/pgs_sock' -l /tmp/pgs_gov/log start"
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM tenants"   # sanity: expect 4 (incl. rfp-pipeline)
# ^ If pg_ctl fails with 'could not create lock file /var/run/postgresql/...: Permission
#   denied', the -k socket dir isn't being honoured — it MUST point at a claude-writable
#   path (e.g. /tmp/pgs_sock). psql over TCP (127.0.0.1:5433) still works regardless.

# If /tmp was ALSO wiped (full reclaim, data dir gone): initdb a fresh cluster
# (--auth=trust -U claude), createdb govtech_intel, then run every migration
# `for f in db/migrations/0*.sql 1*.sql; do psql "$DATABASE_URL" -f "$f"; done`
# (skip 000_drop_all.sql) and re-run the seed scripts (scripts/seed_dev_accounts.mjs,
# frontend/scripts/seed-cuas-immobileyes.mts, seed-demo-*.mts).

cd /home/user/govwin/frontend
# Build (~2 min; the 2-min default Bash timeout WILL cut a FOREGROUND build off — run it with
# run_in_background and poll the log, or pass a 600000ms timeout).
NODE_ENV=production DATABASE_URL="$DATABASE_URL" npx next build

# ⚠️⚠️ THE SERVER — the single biggest recurring time-sink. next.config has
# `output: 'standalone'`, so **`next start` DOES NOT serve this app** (chunk 404s, broken
# hydration, notFound on every route). You MUST run the standalone server, AND stage static +
# public INTO it first (Next does not copy them; do this on EVERY rebuild — a new BUILD_ID makes
# the old chunks 404):
rm -rf .next/standalone/.next/static && cp -r .next/static .next/standalone/.next/static
cp -r public/* .next/standalone/public/ 2>/dev/null
# Serve from the standalone dir. Start it with the harness run_in_background:true — NOT `setsid … &`
# (detached launches keep getting reclaimed on idle, and $! is setsid's pid, not node's child, so
# you can't stop it cleanly). Env below is the full set the app needs to boot + auth + export:
( cd .next/standalone && PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
  DATABASE_URL="$DATABASE_URL" AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST=true \
  NEXTAUTH_URL='http://localhost:3000' AUTH_URL='http://localhost:3000' \
  ANTHROPIC_API_KEY='sk-noop' AWS_S3_BUCKET_NAME='rfp-pipeline-local' AWS_REGION='us-east-1' \
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node server.js )
until curl -s -o /dev/null http://127.0.0.1:3000/login; do sleep 1; done
```

**⚠️ AUTH HOST MISMATCH (silent login bounce — cost real time this sprint):** the server can
LISTEN on `127.0.0.1` (via `HOSTNAME`), but you MUST hit it at **`http://localhost:3000`** in any
login flow (curl, Playwright, the produce/export scripts) because `AUTH_URL`/`NEXTAUTH_URL` are
`localhost`. NextAuth's session cookie is host-bound — sign in against `127.0.0.1:3000` and every
authed request bounces back to `/login?from=…`. `localhost` resolves to `127.0.0.1`, so listening
on `127.0.0.1` + browsing `localhost` is correct and consistent.

**GOTCHAS learned the hard way (save yourself the time):**
- **The sandbox needs `STORAGE_DRIVER=local`.** Without it the compliance and package routes
  return 500 on `[storage/s3-client] AWS_S3_BUCKET (or AWS_S3_BUCKET_NAME) is required in
  production` — the storage client's own documented local driver, not a product defect. Add
  `STORAGE_DRIVER=local LOCAL_STORAGE_DIR=<scratch>/storage` to the standalone server's env.
- **`AUTH_TRUST_HOST=true` or every login 500s** with `UntrustedHost: Host must be trusted`
  behind the standalone server. The symptom is a drive script getting 401 on every request while
  `/login` itself answers 200.
- **The Python worker runs as the OWNER, not `govtech_app`.** docs/RLS_CUTOVER.md is explicit
  ("pipeline = owner"); it is the cross-tenant engine, so one connection cannot carry one tenant's
  context. `rfp_agent` is the deploy-gated NOBYPASSRLS pool the AGENT FABRIC uses per invocation,
  and `fabric.py` sets `app.tenant_id` on it. Start the worker with `govtech_app` and every
  workflow dies on "new row violates row-level security policy for process_instances".
- **Kill the worker by port too.** It binds :8080 for its health server; `pkill -f src/main.py`
  can leave one alive holding the port, and the replacement exits on `Errno 98` — the same
  stale-process trap as the frontend, with the same symptom of code changes appearing not to work.
- **⚠️ KILL THE SERVER BY PORT, NOT BY NAME.** Next renames its process to `next-server (v…)`,
  so `pkill -f "standalone/server.js"` and `pkill -f "node server.js"` match NOTHING — including
  from inside `sandbox-heartbeat.sh`. The old process keeps serving its now-DELETED build from
  open inodes, `/login` answers 200, the heartbeat reports `srv=ok`, and `.next/BUILD_ID` matches
  `.next/standalone/.next/BUILD_ID` — every signal says "fresh" while every request runs the
  previous build. It cost an hour this session chasing a route fix that was correct in the
  source AND in the compiled bundle. Kill by port and VERIFY the generation changed:
      fuser -k -9 -n tcp 3000
      PID=$(fuser -n tcp 3000 | tr -d ' ')
      readlink /proc/$PID/cwd     # must NOT end in "(deleted)"
      ps -o lstart= -p $PID       # must be AFTER the build finished
- **`next build` finishing is not `.next/standalone` existing.** The build writes `.next/BUILD_ID`
  well before it emits `standalone/`, so `until [ -f .next/BUILD_ID ]` races and you restage into
  a directory that is about to be replaced. Wait on `.next/standalone/server.js` instead.
- **Restarting the standalone server:** stop the OLD one first or the new one hits
  `EADDRINUSE :3000`. If you started it with `run_in_background`, `TaskStop <task_id>`;
  otherwise `fuser -k -9 -n tcp 3000; sleep 2`. Then restage static (above) + start fresh +
  poll `/login` for 200. The node child dying silently after a `setsid … &` launch is the
  usual reason a "restart" appears to hang — use `run_in_background:true`.
- **Rebuild ≠ live:** the standalone server serves the files present at start. After ANY
  `next build` you must re-stage `.next/static` + `public` into `.next/standalone` AND
  restart — the BUILD_ID changes, so a stale server 404s every new chunk. Verify the two
  BUILD_IDs match: `cat .next/BUILD_ID` == `cat .next/standalone/.next/BUILD_ID`.
- **Background wait-loops:** `until ! pgrep -f "next build"` matches its **own** command
  line → never fires. Match the node process, not the bash wrapper. And the foreground
  Bash tool caps at 2 min — long builds must be `run_in_background` or `timeout 600000`.
- **PDF / office tooling that IS vs ISN'T installed** (don't re-probe every session):
  - **Absent:** `pdftoppm`/`pdfinfo`/`pdftotext` (poppler), `pandoc`, `pdftk`, `gs`,
    `qpdf`, python `markdown`, npm `marked`/`markdown-it`.
  - **Present:** `soffice`/`libreoffice`; `sharp` (SVG→PNG works — the docx figure path);
    `@napi-rs/canvas`; `pdfjs-dist` **v5** (ESM at `node_modules/pdfjs-dist/legacy/build/pdf.mjs`);
    Chromium at `/opt/pw-browsers`.
  - **Look at a PDF** (no poppler): rasterize with pdfjs + `@napi-rs/canvas` (custom
    `canvasFactory` with create/reset/destroy → `page.render` → `canvas.toBuffer('image/png')`),
    then Read the PNGs. **Verify PDF text/pages/order** with pdfjs `getTextContent`.
  - **Markdown → PDF** (no pandoc): convert MD→HTML yourself, inline images as `data:` URIs,
    `page.setContent` + `page.pdf()` via Chromium. Reusable scripts were written to the
    scratchpad this sprint (md2pdf / raster / verify) — rewrite from these notes if gone.
  - **From `/tmp` scripts, bare specifiers don't resolve** — import node modules by ABSOLUTE
    path (`/home/user/govwin/frontend/node_modules/…`), and for the CJS `playwright` entry use
    `const pw = await import(abs); const chromium = pw.chromium ?? pw.default?.chromium`.
- **Produce the real docx/pdf by dogfooding the live endpoint**, authed as the actual user:
  Playwright login (at `localhost:3000`) → `ctx.request.post('/api/portal/<slug>/proposals/<id>/package?format=docx|pdf|zip')`
  → write `res.body()`. Proposal must be **locked or submitted/archived** to pass the export gate.
- **Playwright e2e:** specs must live under `frontend/` and match a project's `testMatch`.
  Self-authenticating specs use the **`hitl-*.spec.ts`** name and run with `--project=hitl`
  (config `baseURL` is `localhost:3000`; Chromium via `executablePath` `/opt/pw-browsers/chromium`).
- `GET /api/auth/session` (public path) returns the JWT-derived session incl. our custom
  `role/tenantId/tenantSlug/membershipPinned` — fastest way to assert the active membership.

**Demo accounts** (password `DemoPass123!` unless noted):

| Email | Home | Memberships | Use for |
|---|---|---|---|
| `expert@beacon-labs.test` | tenant_admin @ beacon-labs | +partner_user @ acme | THE multi-membership case |
| `admin@acme-navy.test` | tenant_admin @ acme-navy-systems | 1 | acme admin / invites |
| `teammate@acme-navy.test` | tenant_user @ acme-navy-systems | 1 | single-membership control |
| `eric@rfppipeline.com` | master_admin (no tenant) | 0 | admin / shadow control |

> ⚠️ **Mig 124 (this session) DEACTIVATED + hash-invalidated every `.test` seed account** (the three
> `.test` rows above) and archived the `apex-defense` test tenant — so they can't log in on any environment
> that applies migrations. For a **local sandbox** drive-test, re-enable them with a known hash
> (`UPDATE users SET is_active=true, password_hash='<bcrypt>' WHERE email LIKE '%.test'`) — never commit that.
> The real master_admin `eric.c.wagner@gmail.com` was rotated to a random password (mig 124, `temp_password=true`);
> the plaintext is **chat-only** (git has only the bcrypt hash) — first login forces a reset.

Acme proposal `3b0e7f8b-7ca2-4570-91d9-48326add00ff`; sections
`dc8a44af-…` (Assigned) / `26a41b25-…` (Unassigned). Comp code `rfppipelinetest`.

---

## 3. Rebuilt gap list (tasks carry the detail; here's the map)

**Deploy-gating (do before/at deploy):**
- **#111 — migration 111 to staging/prod.** DE-RISKED 2026-07-19: production applies
  migrations automatically via `entrypoint.sh` → `db/migrations/migrate.mjs` (glob
  `^\d{3}.*\.sql$`, so it DOES pick up 100–111), and mig 111 is idempotent
  (`CREATE TABLE IF NOT EXISTS` + backfill `ON CONFLICT DO NOTHING`) — verified by
  running it through the tracked runner (no-op on re-run, data intact). Action is now
  just **verify post-deploy**: `user_memberships` exists + backfilled, and one multi-
  + one single-membership login work. NOTE: `db/migrations/run.sh` (manual dev tool)
  had a `0*.sql` glob that silently skipped 100–111 — FIXED to `[0-9][0-9][0-9]*.sql`.

**Identity model follow-ons (natural next phases):**
- **#112 — our-org-as-a-tenant + platform upload/atomizer** ("including us"): make our
  org a real `tenants` row so staff hold customer memberships; add UploadAtomizeCard to
  `/admin`.
- **#113 — collaborator removal → revoke the 'collaborator' membership** (only when no
  proposal collaborations remain at that tenant; never touch home/manual memberships).
- **#114 — shadow descend rewrites session role to tenant_admin** (currently stays
  rfp_admin in-session; use the same `unstable_update` mechanism for true company-admin
  parity + data-integrity).
- **#115 — Identity P4:** retire the fused `users.tenant_id/role` read-throughs once
  every caller reads the active membership and a backfill sweep is clean.

**Bug-class + platform hardening:**
- **#116 — array-column insert sweep:** audit every `sql.array(...)` binding against its
  column type (uuid[]/int[]/enum[]); non-empty text[] into a typed[] column 500s.
  Same family as the CHECK controlled-vocabulary class and the camelCase-read class.
- **#117 — wire dormant AgentFabric archetypes** (~7 registered, no producer).

**Carried over (pre-existing pending):** #18 past-proposal templify+regen, #69 Ohio
TVSF end-to-end, #77 P4b required-item→template picker in curation.

---

## 4. Durable lessons this sprint reinforced (the "checks we keep doing")

These are recurring bug-classes — treat them as a checklist, not one-offs:
1. **Controlled vocabularies (CHECK columns):** confirm a literal is in the column's
   CHECK before writing (process_instances.scope, source_health.status,
   source_visits.action, source_diffs.severity, user_memberships.source/status…).
2. **postgres.js global camelCase transform:** result rows are camelCase; JSONB column
   *contents* are not. Read camelCase in components (this bit us in atom-library).
3. **Array-column type match:** `sql.array(text[])` into a `uuid[]` column throws — cast
   `::uuid[]` and validate elements. Only shows up with a NON-empty array.
4. **Standalone serving (supersedes the old "next start" note):** `output:'standalone'` means
   `next start` is broken — serve `node .next/standalone/server.js`, re-stage `.next/static` +
   `public` on every rebuild, restart, verify matching BUILD_IDs. Rebuild ≠ live. (§2 has the recipe.)
   ⚠️ **The stale-server trap:** the heartbeat only starts a server when :3000 is FREE, so a process
   left over from before your rebuild keeps serving the OLD code — and the symptom is a live test
   failing on the exact behaviour you just added, which reads like your code is wrong. After every
   rebuild, kill by PID and confirm the new one is younger than the build:
   `fuser -k 3000/tcp` then `ps -o pid,lstart -p $(fuser 3000/tcp)`. (`ss` is not installed here; use
   `fuser`. And `pkill -f standalone/server.js` never matches — the heartbeat launches a bare
   `node server.js` with cwd=standalone.)
5. **JWT is the singular-session source of truth:** everything authz reads the active
   membership off the token; never infer tenant from `users.tenant_id`.
6. **Section ordering = `sort_index`, never `section_number` string:** any new query that lists
   proposal sections MUST `ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number`
   (string sort puts "10" before "2" and scrambles volumes). The column exists from mig 143.
7. **Auth host-binding:** drive/produce scripts sign in at `localhost:3000` (matches AUTH_URL),
   not `127.0.0.1` — cookie is host-bound, mismatch → silent `/login?from=…` bounce.
8. **Verify exports by looking at them:** no poppler, but pdfjs (`legacy/build/pdf.mjs`) +
   `@napi-rs/canvas` rasterize any PDF to PNG to Read; pdfjs `getTextContent` proves page count +
   order + content. Dogfood the live `/package` endpoint (proposal locked/submitted) for the real files.

---

## 5. Open question for the user (non-blocking)

The "two login options (Spotlight vs Portal)" to consolidate: the codebase has a
**single** `/login` CTA (site-chrome `chrome.nav.loginHref`) and one unified sign-in
form — already the consolidated single-login → select-company flow the request
describes. If a second login CTA is seen somewhere (a specific marketing page or a CMS
override), point at it; otherwise this is considered resolved.
