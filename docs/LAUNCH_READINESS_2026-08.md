# LAUNCH_READINESS_2026-08.md — retrospective, cracks, and the launch punch list

**Date:** 2026-08-16 · **Migration head:** 184 · **Branch:** `claude/nice-hamilton-kBqtD`
**Backbone:** frontend `tsc` 0 · `vitest` 1129 · `next build` clean; pipeline workflow-invariant suite green
(the no-deadend CI failure fixed this session). **Method:** four parallel code sweeps (doc-currency,
visible-cracks, launch-functionality, retrospective+seams) + targeted live re-verification of every sharp claim.

---

## 0. Verdict (BLUF)

**The customer spine is code-complete and internally proven; there are no hard BUILD blockers to a customer
going end-to-end.** RLS is live (two-layer), cross-tenant isolation is adversarially verified (docs/COPY_INWARD_VERIFICATION.md),
the PDF/Chromium + export dependencies are correctly provisioned, and the freshest arc (Command Center,
scoring/ranking, provisioning cockpit, Workflow Setup, section spine) is genuinely well-built — clean of the
recurring bug classes (0 `console.log`, 0 bare `alert()`, 0 `JSON.stringify::jsonb`, 0 snake-cased `sql<>` traps).

**What stands between "it deploys" and "a paying customer succeeds" is deployment CONFIG + one honest live
proof + one product decision — not building.** Four things must clear, in order (§4).

---

## 1. What shipped — the last few weeks (migs 179–184)

| # | Thread | What shipped | Mig | Canonical doc |
|---|--------|--------------|-----|---------------|
| 1 | **Command Center** | One tabbed, count-badged "what needs me" cockpit for admin · tenant · partner, with a per-(user,scope,tab) "new since you looked" watermark → blue dot + read-receipt audit. | 179 `command_seen_state` | COMMAND_CENTER_DESIGN.md |
| 2 | **Bucket-scoring integrity** | Restored the `CHECK(score 0–100)` + orphan/inactive prune the retired legacy table dropped; fixed the backfill; gave the TS scorer its first test suite; daily rescore so timeline-decay never goes stale. | 180 | BUCKET_LOCKDOWN.md |
| 3 | **Ranking spine** | Bucket cap (12→6), revocable designee `can_manage_buckets`, the missing bucket edit UI, one mirror-OPP list re-rankable by any bucket lens, admin pin-for-updates (holder fan-out pre-purchase), pre-purchase hot/closing-soon start-nudge. | 181 | RANKING_SPINE.md |
| 4 | **Provisioning cockpit** | Master `build_complete` flag + readiness bar; `/admin/provisioning/[portalId]` whose **"Complete & Release"** does two auditable outcomes at once — broadcast the master's completion to every mirror card + provision the purchaser's private UNLOCKED build and flip `curation_pending→launched`. | 182 | PROVISIONING_WORKSPACE_DESIGN.md |
| 5 | **Tenant Workflow Setup** | Made the per-portal workflow **editable after launch** via a bounded, CAS-guarded re-projection — absolute stage/todo dates, named assignees, per-todo nudges, a per-stage gate closer (human \| agent_manager), a "recommend-but-require" Accept, history recommender, per-task reassign/reschedule, the AI-manager stage gate wired end-to-end. | none (JSONB) | TENANT_WORKFLOW_SETUP_DESIGN.md |
| 6 | **Section-editing spine** | The missing per-section layer: section-scoped ToDos → editor routing (auto-completed on lock), AI researchers/assist from the section bar, the AI-manager's findings surfaced at the gate, span/node-anchored comments, AI-manager auto-advance, a partner_user collaborator-scoped bell, canvas robustness (a partial/legacy doc never white-screens). | 183 `comment_anchor` | SECTION_SPINE_DESIGN.md (as-built banner added) |
| 7 | **Cross-tenant isolation hardening** | 4 static sweeps + live DB probes as the NOBYPASSRLS role. Fixed one real intra-tenant bug (artifact export/layout let a one-section partner_user pull a whole volume) + closed an RLS backstop (a tenant session could mutate/delete the shared `document_templates` catalog). | 184 | COPY_INWARD_VERIFICATION.md |

---

## 2. Does it hang together? — the seams

**Yes — it reads as one coherent product, with one honest architectural seam to name at launch.** The spine is
genuinely wired: ranking drives the cards + Command Center; "Complete & Release" is one auditable two-outcome
action that hands a provisioned build straight into a required Workflow Setup; the AI-manager gate is a *single*
mechanism shared by Workflow-Setup and the section spine; and the ToDo (`tasks`) and activity (`system_events`)
ledgers are deliberately-separate-but-synchronized, not desynced duplicates.

**The one seam to say plainly: "the workflow" is two machines.** A **portal-level HITL stage/nudge overlay**
(what Workflow Setup configures — `proposal_portals.guardrail_config.stages[]`, advanced by `advancePortalStage`)
runs *parallel* to the **proposal/section build machine** (what section-editing advances — `proposals.stage` +
all-sections-locked). They meet only at a terminal `submitted → closeout` sync and at manual "complete_sections"
checkboxes — the portal stages do **not** literally gate on section locks, and the "who owns each stage" a tenant
sets in Setup does **not** auto-assign each section. This is intentional and documented, but it's the seam a first
customer will feel; put it in the launch notes. (Minor housekeeping the sweep found: `portal-workflow.ts:547` names
`/api/internal/agent-gates/sweep` but the route is `/api/admin/agent-gates/sweep`; a stale "10 collaborators, 1
manager" comment in `release-portal.ts:59` where limits are now 25/25; migration numbering skips 165 — all harmless.)

---

## 3. The customer journey — stage by stage

| Stage | State | Note |
|-------|-------|------|
| 1. Admin discovers / curates opportunity | ✓ | `admin/rfp-curation/**`; automated ingest built but SAM.gov off by design |
| 2. Scored + ranked onto tenant cards | ✓ | `solicitation.push` → bridge → `tenant_opportunity_cards`, auto-scored; ranking hardened migs 180/181 |
| 3. Customer buys via comp-code | ✓ | `purchase/route.ts` — validates comp code, opens portal `curation_pending`, $0 `purchases` row, emits `capture:purchase.completed`; the Stripe button degrades cleanly to "use an access code" |
| 4. RFP admin releases / provisions | ✓ | `provisioning/[portalId]/release` → build UNLOCKED with `proposal_sections` + `proposal_compliance_matrix` + molds |
| 5. Customer builds (sections/AI/collab/compliance) | ⚠ | Sections ✓, collaborators ✓, inline compliance ✓ — **but the flagship AI cohort (full-draft/Studio/ai-review/research + provision-time drafter) runs in the Python pipeline and needs its `ANTHROPIC_API_KEY`, proven only vs the emulator** (§4.2) |
| 6. Locks / submits | ✓ | submission-readiness gate hard-blocks on blockers unless acknowledged |
| 7. Downloads package (docx/pdf/zip) | ✓ | docx/pptx/xlsx pure-JS; PDF via system Chromium, correctly provisioned in the Dockerfile |

Surrounding surfaces (Command Center, Workflow Setup, notifications/ToDos, partner console) are all present and real.

---

## 4. Launch punch list

### 4.A — MUST CLEAR before paying customer #1 (all CONFIG/PROVE — zero new code), in order

1. **Set `DATABASE_URL_OWNER` on the frontend service.** `[CONFIG · verified]` `lib/db.ts:63` —
   `sqlBypass = postgres((DATABASE_URL_OWNER || DATABASE_URL)!)`. In prod `DATABASE_URL` is the NOBYPASSRLS
   `govtech_app` role, so if `DATABASE_URL_OWNER` is unset the owner pool falls back to `govtech_app` and **every
   admin cross-tenant read (curation queue, agent-workforce rollup, `matched_opportunities`, tenant list)
   RLS-filters to zero rows** — the admin curate→release step goes blind. One Railway variable.
2. **Confirm `ANTHROPIC_API_KEY` on the pipeline (+ CMS) service.** `[CONFIG/PROVE]` The event-triggered AI cohort
   executes in the Python worker, gated on a non-`sk-noop` key. The wiring is proven against the `:8787` emulator;
   the real model is unconfirmed. Without it a customer gets mold-scaffolded sections but no LLM drafting/review —
   the product's headline feature. (The manual authoring path still completes the journey.)
3. **Run `docs/PROD_SMOKE_TEST.md` on live prod** after 1–2. `[PROVE]` Converts emulator-proof into real-model
   proof and exercises the full comp-code → curation → release → build → package chain on live infra; fix what it
   surfaces (esp. real drafting/compliance output quality).
4. **Decide comp-code vs. waking Stripe for cohort #1.** `[DECISION]` Checkout code exists but is off; the modal
   degrades to "use an access code." Comp-code is the intended launch path — confirm it, or wake Stripe.

### 4.B — FAST-FOLLOW (launch without; works or degrades cleanly)

- **Fix the lying "Suggest regions" button** (§5.1) — the one customer-facing credibility crack; small fix.
- **`AGENT_GATE_SWEEP_URL` (+`CRON_SECRET`)** — until set, AI-manager auto-advance ships **inert** (the pipeline
  poker logs once and returns); assisted one-click gate-close works regardless. Set it to make auto-advance autonomous.
- **`AGENT_DATABASE_URL` (the `rfp_agent` NOBYPASSRLS role)** — agents run on the owner connection today; the
  RLS-enforced agent role is built but deploy-gated (defense-in-depth, not a blocker).
- **Wake more agents** — the workforce is registered (36 archetypes) and the core journey's agents are live; the
  exact "fires live in prod" count is disputed across docs (a known agent-report discrepancy) and depends on the
  pipeline key + per-producer wiring. Reconcile + wake the next highest-value (`amendment_monitor`) as fast-follow.
- **RLS backstop for `tasks` + `process_instances`** — the with-shared policy still lets a tenant session write a
  NULL/global row (not app-reachable; documented in COPY_INWARD_VERIFICATION.md §3, needs a no-context carve-out).
- Dead **Paste Topics** modal + **CRM "coming soon"** placeholder (§5.2–5.3).

### 4.C — BY-DESIGN (deliberate descope — call out, don't "fix")

Self-serve Stripe checkout (comp-code stands in) · SAM.gov ingest off (SBIR/DSIP + admin curation are the live
discovery paths) · the `rfp-crm` CRM service (later) · the one-canvas/polymorphic-artifact refactor (design-first) ·
the shared *atom* library (each tenant holds isolated copies by segregation design).

---

## 5. Visible cracks (proven, file:line)

1. **SHARP-EDGE — the "✨ Suggest regions" button is a lying AI button.** `[verified]`
   `lib/propose-regions.ts:26-39` returns two **hardcoded** boxes at fixed fractional positions (figure at
   10/12/52×30 %, table at 10/55/80×32 %) scaled only to frame size — it **never reads the document pixels**. The
   route (`atoms/propose-regions/route.ts`) reports `engine:'demo'`. On the live `/atoms` Capture tab, a user clicks
   the sparkle "Suggest regions" and always gets the same two boxes regardless of content. Advisory (they edit before
   Atomize, no corruption) — but it's exactly the "lying button" class this codebase has purged (cf. the retired
   "Draft with AI" button). **Fix:** degrade honestly like `lib/vision.ts` (return empty + a toast "AI region
   detection isn't available on this deployment"), or hide the button when the engine is `demo`.
2. **POLISH — orphaned "Paste Topics" modal** (`components/admin/source-card-actions.tsx`): ~180 lines,
   `setShowPasteModal(true)` is never called (unreachable), and its handler targets an endpoint that always 400s.
   Its own TODO says "wire to a real endpoint or retire." Not user-facing; a maintenance trap. Retire it.
3. **POLISH — CRM admin nav → "Coming soon"** (`app/admin/crm/page.tsx`): honest + documented, lowest priority.

**Marker census (clean):** frontend — 2 `TODO` comments (the two above), 1 legit `@ts-ignore`, **0** real
`console.log`, **0** bare `alert()`, 27 `confirm()` (all legit destructive gates), **0** `JSON.stringify::jsonb`,
**0** snake-cased `sql<typeof rows>` traps. Pipeline — **0** real code TODOs, 3 intentional `NotImplementedError`
contract guards. The codebase is disciplined.

---

## 6. Documentation pass (done this session)

Brought the binding/canonical docs current to head 184: **CLAUDE.md** (head 182→184 + Command Center/section
spine/mig-184 in the overview + vitest 1129 + RLS-totals wording), **CLAUDE_CLIFFNOTES.md** (killed a **phantom
`rank_score` column** in the SQL-guidance section — it exists nowhere; added a migs 179–184 schema delta),
**ARCHITECTURE_V10.md** (head + §7 + a 179–184 reconciliation), **CONTINUATION.md** (date + head + the recent arc;
the stale "branch already merged" note), **AGENT_WORKFORCE.md** (35→36), **START_END_FRAMEWORK / DATA_FLOW /
LAUNCH_STATUS** (head 178→184, counts), and an AS-BUILT banner on **SECTION_SPINE_DESIGN.md**. Still owed (fast-
follow): re-run `PROJECT_AUDIT.md` (frozen at mig 141) and stamp superseded banners on `EVENT_CONTRACT` v1/v2 and
the historical `CANVAS_*` cluster.

---

## 7. The launch cut

**Can a real customer launch on this? Yes — and the gate is config + proof, not code.** In order:
**(1)** `DATABASE_URL_OWNER` on frontend → **(2)** `ANTHROPIC_API_KEY` on the pipeline → **(3)** `PROD_SMOKE_TEST`
on live prod → **(4)** confirm comp-code for cohort #1. Then fast-follow the lying-button fix and
`AGENT_GATE_SWEEP_URL`. Everything else is deliberate scope or non-blocking polish.
