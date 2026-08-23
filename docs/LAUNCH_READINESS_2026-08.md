# LAUNCH_READINESS_2026-08.md — retrospective, cracks, and the launch punch list

**Date:** 2026-08-16 · **Migration head:** 185 · **Branch:** `claude/nice-hamilton-kBqtD`
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

- **Fixed the lying "Suggest regions" button** (§5.1) — **DONE 2026-08-16**: route honest-inert by default, client degrades honestly. The one customer-facing credibility crack, closed.
- **`AGENT_GATE_SWEEP_URL` (+`CRON_SECRET`)** — until set, AI-manager auto-advance ships **inert** (the pipeline
  poker logs once and returns); assisted one-click gate-close works regardless. Set it to make auto-advance autonomous.
  ⚠️ **Setting it was not sufficient until 2026-08-21.** The route's headless-cron bearer path
  (`Authorization: Bearer $CRON_SECRET`) was unreachable: `middleware.ts` required a session for every
  non-public path and ran first, so a correctly-authenticated poke got `{"error":"unauthenticated"}` before the
  handler was entered. The middleware now lets a valid bearer through for exactly the two cron endpoints
  (the route still re-checks the secret AND the role). Any deploy that set this variable before that date was
  getting 401s, not auto-advance.
- **`CARD_RECONCILE_URL` (+`CRON_SECRET`)** — hourly sweep that catches every active tenant's opportunity mirror
  up to the bridge head. The customer feed read-repairs on `GET /cards`, but only for a tenant that VISITS; this
  is the one thing that heals a tenant who never opens their feed, whose weekly digest and admin rollups are
  otherwise computed off a stale mirror. `reconcileActiveTenants` and its cron endpoint both already existed —
  nothing called them on a schedule. Inert (logs once) when unset, like its sibling.

  **Verified live 2026-08-21**, whole chain, on the sandbox's real drift — 5 of 8 active tenants were
  behind the bridge head:

      immobileyes  3 → 12    lighthouse   3 → 14    rfp-pipeline  3 → 12
      ubihere      1 → 12    youngstown   3 → 12    (49 cards applied)

  A second sweep applied 0 — idempotent. The auth boundary was checked against the running server and
  holds: no header, wrong secret, `Basic` scheme, a sibling admin route with the right secret, and a
  path BELOW a cron path all still 401. And the pipeline poker closes the loop on its own —
  seven cards deleted from one tenant, worker restarted, first pass logged
  `card reconcile sweep: caught up 7 card(s) across 1 tenant(s)` and the tenant was back at 12.
- **`AGENT_DATABASE_URL` (the `rfp_agent` NOBYPASSRLS role)** — agents run on the owner connection today; the
  RLS-enforced agent role is built but deploy-gated (defense-in-depth, not a blocker).
- **Wake more agents** — the workforce is registered (36 archetypes) and the core journey's agents are live. The
  next highest-value, `amendment_monitor`, is now **reconciled + proven WOKEN (2026-08-16)**: it was already fully
  wired (archetype + `tool.solicitation.amendment_delta` map + the independent `ai_amendment_monitor` step in
  `OnSourceChangeDetected` + its `finder:source.change_detected` trigger emitted from both the frontend
  source-scout tool and the pipeline `source_scout` worker); now locked by `test_amendment_monitor_wiring.py`
  (9/9). The remaining dormant agents still depend on the pipeline key + per-producer wiring.
- **RLS backstop for `tasks` + `process_instances`** — **DONE 2026-08-16 (mig 185)**: per-command policy split so a
  tenant session can no longer mutate/delete a shared (`NULL`) row or promote its own row to global; read-shared and
  the automation `NULL`-writer are preserved. Live-proven on a throwaway PG16. The residual `INSERT`-mint (needs the
  automation writer moved to `sqlBypass`) is documented in COPY_INWARD_VERIFICATION.md §3.
- **Retired the dead Paste Topics modal** (§5.2, **DONE 2026-08-16**); the honest **CRM "coming soon"** placeholder remains (§5.3, lowest priority).

### 4.C — BY-DESIGN (deliberate descope — call out, don't "fix")

Self-serve Stripe checkout (comp-code stands in) · SAM.gov ingest off (SBIR/DSIP + admin curation are the live
discovery paths) · the `rfp-crm` CRM service (later) · the one-canvas/polymorphic-artifact refactor (design-first) ·
the shared *atom* library (each tenant holds isolated copies by segregation design).

---

## 5. Visible cracks (proven, file:line)

1. **FIXED (2026-08-16) — the "✨ Suggest regions" button no longer fabricates AI output.** `[verified]`
   Previously `lib/propose-regions.ts` returned two hardcoded boxes at fixed fractional positions (never reading the
   document pixels) that the client presented as AI suggestions — exactly the "lying button" class this codebase has
   purged (cf. the retired "Draft with AI" button). **Fix shipped:** the route (`atoms/propose-regions/route.ts`) is
   now **honest-inert by default** — with no vision detector wired it returns no regions and `available:false`, and
   the client shows *"AI region detection isn't available on this deployment — draw the boxes manually"* instead of
   fabricating boxes (mirrors `lib/vision.ts`). The deterministic demo stand-in is opt-in for dev/demo via
   `REGION_PROPOSER=demo`; a real vision detector still swaps in server-side as `engine:'vision'`. `tsc` 0 · `vitest` 1129.
2. **FIXED (2026-08-16) — retired the orphaned "Paste Topics" modal** (`components/admin/source-card-actions.tsx`).
   The ~200-line `PasteTopicsModal` component, its `showPasteModal` state, and its (already-unreachable) render block
   were removed and the single-child fragment collapsed. The button had already been retired; the handler targeted
   `/api/admin/extract-topics`, which only extracts from a stored solicitation's `solicitationId` (never pasted rows)
   and so always 400'd. `tsc` 0 · `vitest` 1129 · `next build` clean.
3. **POLISH — CRM admin nav → "Coming soon"** (`app/admin/crm/page.tsx`): honest + documented, lowest priority.

**Marker census (clean):** frontend — 1 `TODO` comment (the paste-topics one was removed with the retired modal), 1 legit `@ts-ignore`, **0** real
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
LAUNCH_STATUS** (head 178→184, counts), and an AS-BUILT banner on **SECTION_SPINE_DESIGN.md**.

**Follow-up currency sweep (2026-08-16, → head 185).** Brought the binding + standards docs from 184→185 (the
four launch fast-follows + mig 185 RLS + `amendment_monitor` reconciled WOKEN): CLAUDE.md · ARCHITECTURE_V10 ·
CONTINUATION · LAUNCH_STATUS · DATA_FLOW · COPY_INWARD_VERIFICATION · DEFINITION_OF_DONE · DEVELOPMENT_STANDARDS ·
TESTING_STRATEGY · AGENT_WORKFORCE. Stamped **PROJECT_AUDIT.md** FROZEN-at-141 (a fresh re-run at 185 deferred).
The superseded banners were already in place — `EVENT_CONTRACT` v2/v3 and the historical `CANVAS_*` cluster each
already carry a "no-longer-authoritative / historical snapshot" header.

---

## 7. The launch cut

**Can a real customer launch on this? Yes — and the gate is config + proof, not code.** In order:
**(1)** `DATABASE_URL_OWNER` on frontend → **(2)** `ANTHROPIC_API_KEY` on the pipeline → **(3)** `PROD_SMOKE_TEST`
on live prod → **(4)** confirm comp-code for cohort #1. Then fast-follow the lying-button fix and
`AGENT_GATE_SWEEP_URL`. Everything else is deliberate scope or non-blocking polish.

---

## 8. Addendum 2026-08-23 — the verification arc (migs 186–205, B68–B76)

**The punch list in §4.A is unchanged: still CONFIG · PROVE · DECIDE, still zero new code.** What changed
is how much of the claim "internally proven" is now backed by measurement rather than by passing tests.

**Backbone now:** migration head **205** (was 185) · `tsc` 0 · `vitest` **1670** (was 1129) · `next build`
exit 0 · bug log 76 entries, **0 open**, 2 deferred (B30, B33).

### What the arc actually established

Seven defects closed (B68–B76). The one that matters most for launch judgement is **B73**, because it was
not a test failing — it was **HTTP 500 to a tenant_admin opening her own volume**, on rows that exist in the
database today, while that same volume downloaded as a correct PDF. Three stored TVSF artifacts carry a
partial canvas spec (`{width,height,margins}`, no `font_default`); the exporters default every field they
read and the ruler did not. Reproduced live before the fix and 200 after.

**That is the launch lesson, and it generalises past the ruler:** every fixture in this repo is built by
`CANVAS_PRESETS`, which is complete by construction. Customer rows are not. Nothing in the suite had ever
handed the product a partial one.

### Six instruments now exist that did not

| harness | standing today |
|---|---|
| `verify-ruler-on-proposals.mts` | 8 authored volumes — **8/8 exact, 0 under-counts** |
| `verify-ruler-on-stored-artifacts.mts` | every artifact row in the DB — **37: 36 exact, 1 over, 0 under** |
| `verify-exports-on-stored-artifacts.mts` | **41 volumes · 78 exports · 0 failures** — every stored volume downloads in every format offered |
| `calibrate-page-ruler.mts` | 36 synthetic cases vs Chromium (4 within a stated ±1) |
| `calibrate-slide-ruler.mts` | 7 deck cases vs a rendered `.pptx` |
| `sweep-mold-quality.mts` | 39 shipped molds — 39 clean, 0 needing a look |

Plus `__tests__/node-vocabulary-coverage.test.ts` (all 22 `NodeType`s through all four writers, compile-enforced)
and a corrected `scripts/schema-check.mjs` — which had been reading **767 of 2,174** SQL blocks and clearing
files it never opened; it now verifies **2,560 references across 683 files with 0 findings** (B74).

### What this does and does not license

- **Does:** the claim "a customer can build a proposal and download it" is now measured on real rows in every
  offered format, not inferred. The compliance gate never under-counts on any corpus tested.
- **Does not:** none of it exercises the real model. §4.A item 2 (`ANTHROPIC_API_KEY`) and item 3 (the live
  smoke test) are exactly as load-bearing as they were, and the visual reviewer's vision half remains
  unproven by design — the emulator cannot see images and returns `[]` rather than inventing findings.
- **One amendment to §4.A item 3:** run `PROD_SMOKE_TEST.md` against data shaped like a real customer's,
  not only a freshly-seeded build. B73 was invisible to every fixture and obvious on the first stored row.

### Known residual, stated so it is not rediscovered as a bug

Five molds' page estimates read 1–2 pages long. B76 established this is **structural, not a defect**:
the ~8% headroom the ruler needs so real prose never under-counts is exactly what makes a bracket-heavy
template read long. Measured, written up, and deliberately not tuned away.
