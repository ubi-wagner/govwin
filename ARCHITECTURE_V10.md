# ARCHITECTURE_V10.md — RFP Pipeline Portal: Greenfield-Canonical As-Built

**Date:** 2026-07-03

> **FULL-PROJECT AUDIT (2026-08-01) — see `docs/PROJECT_AUDIT.md` for the canonical current-state map**
> (schema · 191 routes · 104 pages · agent wiring · bugs). Reconciliations: migration head is now **148**
> (140 = Foundation TVSF demo seed, 141 = Paul shadow-admin role fix; the **V1 UI-wiring pass** then added 143
> `proposal_sections.sort_index`, 144 `proposals.studio_phase`, 145 `notification_read_state`, 146 the amendment
> engine, 147–148 the soft-archive `archived_at` cascade — canonical **docs/ARCHIVABLE_CONTRACT.md**); the archetype roster is **36 files =
> 36 archetypes + the shared `base` parent** (the "27"/"35" counts in older notes are superseded; the 36th is the admin-agent `rfp_ingest_manager`), of which
> — traced by actual call-site + whether the trigger event is emitted live — **34 are wired and exactly 1 is
> dormant** (`content_generator`; its `library:content.requested` trigger has no emitter). Earlier "~11 dormant"
> was a reference-count artifact (queue-producer / `AI_INVOKE`-step agents show few name-refs yet are wired).
> Schema = **105 live tables (20
> dropped)**; the `accounts` / `sessions` / `verification_tokens` NextAuth adapter tables are **dead**
> (the app uses JWT sessions, no adapter), as are `agent_archetypes`, `system_health_snapshots`,
> `audit_log`, `rate_limit_state`, `scout_runs`, and `tenant_automation_preferences` (superseded by
> `tenant_automation_policies`). **Verified bug cluster** (mig-071 TEXT vs object): the portal + admin
> section editors render blank on reload, and `seed-job/apply` silently destroys section content — export
> is unaffected. See `docs/PROJECT_AUDIT.md §4b`.

> **AS-BUILT UPDATE (#117 agent workforce, 2026-07-19; roster count refreshed 2026-07-22).** The pipeline
> `AgentFabric` (**27 registered archetypes, all auto-registered — dormant ≠ dead**; #117 woke the original 10
> as workflow actors, since expanded to 27) is a
> **tenant-bound advisory workforce** being woken one at a time. Each tenant-space agent runs with
> **tenant_user authority** scoped to its assigned tenant (the trusted task context; tool schemas expose no
> `tenant_id`), produces **advisory** output that goes **through guardrails to land-or-review** (never
> auto-writes business tables), fences untrusted content against injection, and is bounded so it can't run
> away or dead-end a workflow. Two producer shapes: **per-tenant producers** (fan-out: scoring, opportunity
> analysis) and declarative **`AI_INVOKE` workflow steps** (single-entity: architect/package/capture/partner).
> Oversight rolls **usage** up to the RFP admin (`/admin/agents` → Agent Workforce, per-tenant) — **forward
> only; tenant data stays in the tenant** (the same bridge invariant as the OPP spine). Canonical detail:
> **`docs/AGENT_WORKFORCE.md`** + `docs/AGENT_FABRIC_DESIGN.md`.
**Status:** As-built successor to ARCHITECTURE_V9.md. V9 remains the baseline for the retained
core (proposal workspace, canvas, stages/gates, auth, provisioning, admin curation, CMS, pipeline
ingest/shred/score, memory). **This document records the greenfield refactor that converged the
customer-facing surface onto the opportunity-card spine** and the drive-verification that proved it.
**Branch:** `claude/nice-hamilton-kBqtD` (schema through migration **103**).
**Verification method:** Driven end-to-end against a live stack — Next.js `next start` on a migrated +
seeded scratch DB, the Python workflow engine on `:8080`, Postgres — with the full Playwright suite
(**17/17 green**) and a live workflow-engine run (12 templates registered, `process_instances` created
carrying `opportunity_id`). Not a code-read.
**Evidence location:** `docs/archive/HITL_WIRING_AUDIT_2026-07-03.md` (finish-out + live-verification block),
`docs/archive/HITL_WIRING_AUDIT_RUNBOOK.md` (method), `frontend/e2e/` (the suite).

> **Update (2026-07-15) — schema now at migration 108; the purchase→curation→release flow landed.**
> Since this doc's 2026-07-03 drive-verify (mig 103), the customer **comp-code purchase → curation →
> release → provision** path shipped (migs **104–108**): a comp-code purchase (`rfppipelinetest`) opens a
> `proposal_portals` row at `curation_pending` (72h SLA), a shadow admin **releases** it, and provisioning
> instantiates the proposal at **V0**. The bridge/cards model below is unchanged and is now framed as the
> **master + mirror, one-way bridge** with **two releases per OPP** — (1) *Spotlight* (basic ingest +
> `spotlight_summary` → push → rank → mirror; pin copies the OPP's files to the tenant) and (2)
> *Proposal-portal* (the full compliance matrix + blank templated molds built ONCE on the master, reused
> per tenant at provision). The only signal that ever flows admin-ward is a navigational **ToDo event
> (no customer data)**. **Canonical design of record for the opportunity→purchase→proposal flow:
> `docs/MASTER_MIRROR_OPP_DESIGN.md`.** §4 and §7 are updated inline; the rest of the drive-verify stands
> as verified at mig 103.

> **Update (2026-07-22) — schema now at migration 125; launch-hardening + as-built cleanup pass.**
> Since the mig-108 flow above, migrations **109–125** landed the multi-membership identity model and
> tenant documents (110/111), agent-memory RLS + the `NOBYPASSRLS`-track agent role (116/117), the
> observability lifecycle (120), portal delegated managers (123), and two hardening drops: **mig 124**
> rotated the committed `master_admin` credential off `GovWin2026!` to a random bcrypt-only hash
> (`temp_password=true`), deactivated the `.test` seed accounts, and archived the `apex-defense` test
> tenant; **mig 125** dropped **12 superseded, zero-referenced tables** (§7) and **rebuilt
> `v_opportunity_rollup`** on `tenant_opportunity_cards`. The last live reads of retired tables were
> repointed (§7), RLS is documented as a **single enforced layer today** with a `govtech_app`-cutover
> caveat (§7 "RLS reality"), and a dead-code/dependency trim removed **16 unused frontend deps + 6
> orphaned modules**. The full ingest→outcome spine and the `system_events` start/end river are traced
> end to end in **§3.1**; the workflow engine that rides that river has its own canonical map in
> **`docs/AUTOMATION_SPINE_MAP.md`**. Cleanup ledger: `docs/DEPRECATION_CLEANUP_2026-07-22.md`.

> **Update (2026-07-26) — schema now at migration 137; automation framework → library/vaults → RLS cutover.**
> Since the mig-125 pass, migrations **126–137** landed: the **declarative automation framework + policies**
> (126–129), the **curation-SLA ToDo** (130), the **expert-time calendar** (131), the **foundation artifact
> grains** (`foundation ⊃ section ⊃ group ⊃ atom`, 132), **library seed jobs** (133), **collaboration vaults
> ("nooks")** with per-partner RLS segregation (134), the **starter-offer** partial-unique idempotency (135),
> and the **RLS cutover** (136) + **namespace-CHECK validation** (137). The `AgentFabric` registry has since
> expanded to **27 archetypes** (added `library_seed_mapper` + `library_seed_suggester`). **RLS status
> refreshed:** the non-owner cutover is now **built + applied in schema** — mig 136_rls_cutover created the
> `govtech_app` (app) + `rfp_agent` (agents) `NOBYPASSRLS` roles, **19 force-RLS tables**, **35
> `tenant_isolation` policies**, and the per-request `SET app.tenant_id` context layer
> (`frontend/lib/tenant-context.ts` + `lib/db.ts` enterTenant/enterBypass); it is **single-layer in effect
> today only until the one-op prod `DATABASE_URL` flip** to `govtech_app` (still pending). As-built RLS record:
> **`docs/RLS_CUTOVER.md`**; library/vaults design: **`docs/LIBRARY_AND_VAULTS_DESIGN.md`**. Verify snapshot:
> `tsc` 0 · `vitest` 828 · `next build`.

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Live and wired — actively called at runtime, and driven-verified this pass |
| 🟡 | Shipped with gaps — code works but specific paths incomplete |
| 🟦 | Built-but-dormant — code is correct but never called at runtime |
| 🔴 | Broken — code exists but has a confirmed runtime defect |

---

## 0. What Supersedes What

```
ARCHITECTURE_V7 (2026-05-21) — Master system index; SUPERSEDED by V9
ARCHITECTURE_V8 (2026-06-02) — Content-subsystem delta; FOLDED INTO V9
ARCHITECTURE_V9 (2026-06-23) — As-built baseline (file-by-file); STILL CANONICAL for the retained core
ARCHITECTURE_V10 (2026-07-03) — THIS DOCUMENT — the greenfield-canonical customer surface + drive-verify
```

V10 does **not** re-verify the whole 900-file tree. It documents the **new canonical layer** and the
**convergence** that shipped on `claude/nice-hamilton-kBqtD`, and points at V9 for everything the
refactor left intact. Where V9 and V10 conflict on the customer opportunity surface, **V10 wins**;
everywhere else, **V9 stands**.

---

## 1. Executive Summary

The V1 build reached a fork: two parallel customer opportunity surfaces existed — the legacy
**Spotlight/Pipeline** stack (`tenant_pipeline_items`, per-tenant scoring rows) and a greenfield
**opportunity-card** stack (a forward-only bridge → denormalized per-tenant cards). This refactor
**resolved the split-brain by making the greenfield card spine canonical (design A)** and driving the
whole ingest→lock spine green against a live instance.

What is now true that was not in V9:

1. **The opportunity-card spine is the canonical L0→L1 orchestration surface.** Admin approval
   (`solicitation.push`) publishes **every activated opportunity — the umbrella solicitation PLUS every
   topic** — to the append-only `opportunity_bridge`, which fans out a denormalized
   `tenant_opportunity_cards` row per subscribed tenant. A multi-topic BAA now lands **one customer card
   per topic** (was: one umbrella card).
2. **The legacy Spotlight/Pipeline surface is RETIRED.** `tenant_pipeline_items` is off the customer
   path; `/portal/[t]/spotlights` and `/portal/[t]/pipeline` are server redirects to `/cards`; the nav
   promotes **Opportunities / Buckets / Atoms**; dashboard and origin-bucket reads are repointed to the
   greenfield tables.
3. **The library is unified around atoms.** `library_atoms` (primitive | group | reference) with a
   single taxonomy (`taxonomy_terms`), ownership/visibility, provenance, and a size currency that
   compares directly to a section mold. Upload → deconstruct → register → atomize → tag → **scored
   select** feeds the AI drafter. Reads are visibility-enforced; collaborators get scoped access.
4. **The compliance matrix is real.** Populated at provision (one row per required item / required
   section), advanced to `satisfied` on section lock, reset on unlock — was an always-0% empty shell.
5. **Rankings are automated.** `tenant_bucket_scores` is auto-populated on bridge fan-out
   (`autoScoreCard`) and the `/cards` feed is ordered by best bucket score (pinned → score → recency).
6. **The build→lock loop is hardened.** Section-lock compare-and-swap, locked-save rejection (423),
   assigned-section enforcement, a real client-baseVersion optimistic lock (409), and section-scoped
   editor comments — all driven-verified.
7. **Event payloads are jsonb OBJECTS.** A systemic bug (payloads written as jsonb string scalars, so
   `payload->>'field'` returned null for every audit/automation consumer) is fixed at the emitter and
   back-filled by migration 103. This is load-bearing for the workflow spine below.
8. **The workflow engine is live.** It registered **12 templates** and created `process_instances`
   **carrying `opportunity_id`** frozen from the trigger overlay — the spine keys reaction runs by the
   immutable opportunity.

---

## 2. The Greenfield-Canonical Model

### 2.1 One immutable opportunity, three forked layers (unchanged spine, new surface)

V9's opportunity spine (the `opportunity_id` keying L0 master → L1 per-tenant → L2 proposal, see
`docs/V1_REFACTOR_DESIGN.md`) is retained. What changed is **how L0 reaches L1**: not a scoring job
writing `tenant_pipeline_items`, but a **forward-only bridge** that replicates a thin, self-contained
**card** to each tenant.

```
L0  opportunities (master, immutable key)              ─ admin-owned pool
         │  admin approval → solicitation.push
         ▼
    opportunity_bridge      (global, append-only, versioned card snapshots)   [mig 094]
         │  fanOutBridgeEvent → applyToTenant (per subscribed tenant)
         ▼
L1  tenant_opportunity_cards (denormalized, RLS-scoped, one row per tenant×opp) [mig 094]
         │  pin → pull docs local · autoScoreCard → tenant_bucket_scores        [mig 095/096]
         ▼
L2  proposals (per build; origin_card frozen, opportunity_id key)             ─ V9 retained
         │  provision → artifacts → sections → compliance matrix
         ▼
L3  proposal_portals (execute/guardrail layer, "Builds")                      [mig 097/098]
```

**Why a card, not a JOIN.** `tenant_opportunity_cards.opportunity_id` is a **soft reference** — there is
no FK back to the global `opportunities` table. Each tenant's pipeline is self-sufficient (shard-ready),
and the customer feed reads its own rows with **zero joins to admin data**. The card is the *only* part
of an opportunity that crosses the admin→customer boundary. File: `frontend/lib/opportunity-bridge.ts`.

### 2.2 The bridge is the sole admin→customer coupling

`opportunity_bridge` is a **forward-only, append-only** log: each publish inserts a new
`(opportunity_id, version, event_type, card, posted_by)` row (monotonic version per opportunity). The
consumer (`fanOutBridgeEvent` → `applyToTenant`) upserts each subscribed tenant's card and advances a
per-tenant cursor (`tenant_bridge_cursor`). Everything is **idempotent and re-drivable** — a fan-out
failure to one tenant never fails the publish, and `backfillTenant()` replays the latest version of
every opportunity onto a new tenant.

| Concern | Mechanism |
|---------|-----------|
| Publish | `publishToBridge()` — `INSERT … version = max(version)+1` (append-only) |
| Replicate | `fanOutBridgeEvent()` → `applyToTenant()` per `status IN ('active','trial')` tenant |
| Tenant isolation | `applyToTenant` runs inside `withTenant(tenantId)` (SET LOCAL `app.tenant_id`) |
| Pin-update signal | on re-publish, `pin_update_available` flips true only if the tenant pinned an older version |
| Lifecycle propagation | `republishIfReleased()` re-publishes + re-fans a released opp on stage/content edits |
| New-customer backfill | `backfillTenant()` applies the head version of every opportunity (currently a manual admin route) |

**The one backflow is a ToDo, not data.** The bridge moves card data admin→customer only. The *sole*
"upward" signal is a navigational **ToDo event** (carries **no** customer content) that routes a
privileged actor down into a tenant's RLS-scoped **shadow account** to build/release there —
`tasks` row `task_type='proposal_setup'` via `launchProjectCollaboration`, surfaced by
`listOpenAdminTriageTasks`. Shadow grants are recorded in `shadow_admin_grants` (mig 097, portal-scoped,
`source ∈ {t_and_c, invite}`, revocable). This keeps tenant content sharded/private while still letting
the RFP side act. Full contract: `docs/MASTER_MIRROR_OPP_DESIGN.md` §3–4. (⚠ Security gap: mig 097 meant
the grant to *replace* the admin god-view, but `verifyTenantAccess` — `frontend/lib/db.ts:52` — still
grants any admin global access; enforcing the grant + retiring the god-view is a tracked ToDo.)

### 2.3 Convergence — what was retired

| Legacy | Fate | Replacement |
|--------|------|-------------|
| `tenant_pipeline_items` (per-tenant scoring rows) | Off the customer path → **DROPPED (mig 125)** | `tenant_opportunity_cards` |
| `/portal/[t]/spotlights` page | Server `redirect()` → `/cards` | Greenfield Opportunities |
| `/portal/[t]/pipeline` page | Server `redirect()` → `/cards` | pin state on the card |
| Spotlight scoring job | Retired for the feed | `autoScoreCard` on fan-out → `tenant_bucket_scores` |
| Nav: Spotlight / Pipeline | Removed | **Opportunities / Buckets / Atoms / Builds** |
| Dashboard / origin-bucket reads | Repointed | `tenant_opportunity_cards`, `origin_card` |

Legacy page bodies survive only as one-line redirects (prior implementations in git history). The
`tenant_pipeline_items` table itself was **physically dropped in mig 125** (its last three live reads —
CMS `matched_opportunities`, the rfp-curation Customer Interest panel, and `v_opportunity_rollup` — were
first repointed to `tenant_opportunity_cards`; see §7). The orphaned `/spotlight/pin` API and legacy
spotlight components are cataloged for a per-item cleanup decision in `docs/DEPRECATION_CLEANUP_2026-07-22.md`.

---

## 3. Data Flow — The Spine, End to End

### 3.1 The whole river — admin upload → outcome (one `system_events` spine)

Every state-changing beat on the spine emits a namespaced `system_events` row (start/end pair, or a
single; §6). That river is simultaneously the **audit log** and the **substrate the workflow engine
derives state from** — the engine keeps no memory of its own, so the whole lifecycle is replayable from
the river on a cold restart. Canonical map of the engine + its reconcilers + the per-tenant automation
grammar: **`docs/AUTOMATION_SPINE_MAP.md`**. The end-to-end trace, admin ingest through outcome/harvest:

```
ADMIN  (finder namespace)
  rfp_admin uploads a solicitation ─► rfp_shredder: PDF → Claude → compliance/documents/volumes/matrix
        │                              finder:rfp.uploaded  ·  finder:opportunities.detected
        ▼
  curate + approve ─► solicitation.push (lib/tools/solicitation-push.ts)
        │   opportunities.is_active=true for the umbrella + EVERY topic
        ▼   finder:solicitation.pushed ──────────────────────────► [OnSolicitationPushed] carries opportunity_id
  publishToBridge → opportunity_bridge (append-only) ─► fanOutBridgeEvent
        │
        ▼   per active/trial tenant, inside withTenant()
  tenant_opportunity_cards (denormalized) + autoScoreCard → tenant_bucket_scores   ── the ADMIN→CUSTOMER
        │                                                                             boundary (the sole crossing)
════ CUSTOMER  (capture namespace) ═══════════════════════════════════════════════════════════════════
        ▼
  card ranked on /cards ─► pin (pulls docs local, re-scores) ─► comp-code purchase  (or a $0 admin grant)
        │   POST /purchase → proposal_portals @ curation_pending (72h SLA)
        ▼   capture:purchase.completed ──► automation_rule notify_admin  +  [ProjectCollaboration] (scope=opp)
  CURATION GATE — a navigational ToDo (no customer data) routes a shadow-admin into the tenant RLS account
        │   action=release → releaseFromCuration (CAS curation_pending → launched)
        ▼
  provision (lib/provision-proposal.ts, UNLOCKED) → proposal_artifacts + proposal_sections
        │   + proposal_compliance_matrix (one row/required item, not_addressed) + origin_card frozen
        ▼   proposal:proposal.created ──► [OnProposalCreated] (draft_v0 strawman when ANTHROPIC_API_KEY set)
════ PROPOSAL  (proposal + library namespaces) ═══════════════════════════════════════════════════════
        ▼
  BUILD (canvas) ⇄ atoms library      library:atom.created · library:section.atoms_selected
        │   proposal:section.saved ──► [OnProposalSectionEdited]
        ▼
  section LOCK (CAS) → matrix row → 'satisfied' · harvestSectionToAtomLibrary · artifact roll-up
        ▼
  ADVANCE (gated, all sections locked) → review ──► color_team_reviewer (agent_task_queue)
        │   proposal:proposal.advanced  (targetStage review → final)
        ▼
  SUBMIT → stage 'submitted'  (terminal, but "Unlock for Edit" still renders — no dead-end)
        ▼
  outcome recorded ──► proposal:outcome.recorded ──► [OnProposalOutcomeRecorded]   ── harvest → library_atoms
```

Each hop's start/end pair is exactly what the two stateless reconcilers (the event poller and the time
sweeper) read to answer "what started, and did it finish before its nudge?" — so parking, nudging, and
escalation are all derived from timestamps in the river, never from engine memory. The bracketed
`[Template]` labels are the workflow templates that trigger off each event (§6.2); the full template ↔
trigger ↔ `process_instance` contract, the reconcilers, and the customer automation grammar are in
**`docs/AUTOMATION_SPINE_MAP.md`**.

### 3.2 Ingest → Bridge → Cards → Buckets / Rankings (detail)

```
rfp_admin curates + approves a solicitation (V9 Stage 2–3, retained)
    │
    ▼  solicitation.push tool  (frontend/lib/tools/solicitation-push.ts)
    ├─ 1. Gate: submission_format present ANYWHERE for the solicitation —
    │      custom_variables->'submission_format'->>'value' (interactive layer) OR a named column.
    │      (Fixes A1: the solo/interactive curation flow only writes custom_variables, so the old
    │       named-column-only check blocked a solo release.)
    ├─ 2. Atomic txn: curated_solicitations approved → pushed_to_pipeline;
    │      opportunities.is_active=true + submission_stage='open' for the FULL activation set —
    │      the landing opportunity (id = cs.opportunity_id) PLUS every topic (solicitation_id = sol.id).
    ├─ 3. emit finder:solicitation.pushed:single  (topicCount = size of the activation set)
    └─ 4. For EACH activated opportunity: publishAndFanOut('published')
              │
              ▼  publishToBridge → buildCardSnapshot(opportunityId)
              │      resolves solicitation for BOTH umbrella (cs.opportunity_id=o.id) AND
              │      topics (o.solicitation_id=cs.id) — without the topic arm a topic card
              │      came out with null namespace/compliance/volume_count.
              ▼  fanOutBridgeEvent → applyToTenant(tenant) for every active/trial tenant
                     ├─ upsert tenant_opportunity_cards (card jsonb, bridge_version, lifecycle_status, submission_stage)
                     └─ autoScoreCard(tx, tenant, opp, card)  → tenant_bucket_scores (per active bucket)
```

**Multi-topic fan-out (the headline behavior change).** Because the activation set and the publish loop
both include the umbrella *and* every topic, a 10-topic BAA now produces **10 customer cards** (plus the
umbrella if it is itself an opportunity row), each a self-contained snapshot. Contract C1.a in
`solicitation-push.ts` keeps the activation `WHERE`, the `topicCount`, and the publish loop identical so
the event, the DB flip, and the customer cards always agree.

**Reading the pipeline.** `GET /api/portal/[t]/cards` (`app/api/portal/[tenantSlug]/cards/route.ts`)
reads the tenant's cards under `withTenant()` and LATERAL-joins the card's **best** bucket score:

```sql
ORDER BY c.is_pinned DESC, bs.top_score DESC NULLS LAST, c.updated_at DESC
```

So the feed is genuinely **ranked** (pinned → best bucket score → recency), not recency with a "ranked
by your buckets" label.

**Buckets / rankings.** `tenant_spotlight_buckets` (mig 096) are customer-defined ranking lenses; each
holds weighted `criteria` (keywords, naics, agencies, programTypes, setAsides, timeline). `scoreCard()`
(`lib/bucket-ranking.ts`) scores a card 0–100 against a bucket; `autoScoreCard()` runs on fan-out (so a
card is ranked the instant it lands), and `rankBucket()` re-ranks the whole local pipeline on demand
(so a bucket registered at any time immediately ranks the available universe). Scores upsert to
`tenant_bucket_scores` (unique `(tenant_id, bucket_id, opportunity_id)`).

**Lifecycle.** `lib/lifecycle.ts` defines the canonical six submission stages
`nofo → pre_release → open ⇄ updated → closed → archived` (mig 100). `submission_stage` on the master
opportunity and the card is the source of truth; `lifecycle_status` (open/closed/archived) is the coarse
projection the feed/ranking filters use. A stage change on a *released* opp re-fans via the bridge event
from `eventTypeForStage()`.

---

## 4. Data Flow — Provision → Matrix → Build → Lock → Download

The build loop is V9-retained; V10 makes the **compliance matrix real** and **hardens lock**.

```
Comp-code purchase → curation → release → provision  (canonical: docs/MASTER_MIRROR_OPP_DESIGN.md §5–6):
  POST /api/portal/[t]/purchase (code 'rfppipelinetest') → proposal_portals curation_pending (72h SLA)
    → action=release → releaseFromCuration (CAS, curation_pending→launched) → provision (two entry points):
    • create route:  app/api/portal/[t]/proposals/create/route.ts   (legacy + matrix)
    • portal launch: lib/provision-proposal.ts                       (greenfield, UNLOCKED, + matrix)
        resolveTopicCompliance → proposal_artifacts (per volume) → proposal_sections (per required item)
        + proposal_compliance_matrix rows (one per required item / required-section), status='not_addressed'
        + origin_card frozen onto proposals.origin_card
        + emit proposal:proposal.created:end  → OnProposalCreated (draft_v0 strawman on deploy)
    │
    ▼  BUILD  (canvas editor — V9 §2 Stage 7, retained)
    │   versioned saves iterate unbounded within a stage; optimistic-lock CAS on section.version
    │
    ▼  LOCK   app/api/portal/[t]/proposals/[p]/sections/[s]/lock  (POST)
    │   CAS: UPDATE … WHERE id=$s AND is_locked=false  (0 rows ⇒ already locked ⇒ skip side effects)
    │   ├─ proposal_compliance_matrix: status → 'satisfied' for this section's requirements
    │   ├─ canvas snapshot + harvest section → library
    │   ├─ artifact roll-up: when every section of an artifact is locked → artifact.locked (atomic)
    │   └─ document/proposal-ready signals + opt-in auto-advance (shared gated core)
    │      DELETE (unlock): matrix status → 'not_addressed'; artifact reopened (mirror)
    │
    ▼  ADVANCE (gated) → SUBMIT/LOCK → DOWNLOAD (json/docx/pdf/zip, in-memory, S3-independent)
```

**Download (`POST /api/portal/[t]/proposals/[p]/package?format=…`, gate: locked or submitted/archived).**
Four formats off ONE section fetch: `json` (structured), `docx` (all sections combined → `exportToDocx`),
`pdf` (the SAME combined CanvasDocument → `exportToPdf`, Chromium print: repeating header/footer, real
page numbers, tables + inline SVG figures — added 2026-08-02), and `zip` (each volume in its NATIVE format
via `assembleArtifactCanvas`+`renderCanvas`). Figures are native `chart` nodes: SVG in the pdf, sharp-
rasterized PNG in the docx. UI buttons live in `proposal-admin-panel.tsx`. **Every** section list here —
and on the workspace/review pages — orders `volume_number NULLS LAST, sort_index NULLS LAST, section_number`
(mig 143's integer `sort_index`), so volumes and Q1–14 render in true document order, never string-sorted.

**Admin-plane triggers (admin-agent program, 2026-08-02).** Two admin-plane surfaces now drive the
(already-built) engine from up top, both advisory + audited: (1) the **`rfp_ingest_manager`** archetype —
the platform-scope ingest-orchestration *manager* (`.../assess-ingest` → `OnIngestAssessmentRequested` →
`tool.ingest.assess`) that reads a curated solicitation's ingest state and plans which specialist agents to
run next; and (2) the **Proposal Auto-Drive "doorbell"** — an `/admin/agents` card + `POST
/api/admin/proposals/[p]/full-draft` that rings the tenant Proposal Draft Manager
(`OnFullDraftRequested{ModeA,B,C}`) on a chosen proposal without portal descent. Portal + doorbell share
one emission helper (`lib/proposal-full-draft.ts`), so every full draft is one auditable
`proposal:full_draft_requested` record (`source` = `portal`|`admin_doorbell`). Neither descends into a
tenant (Phase 2). Canonical: **docs/ADMIN_AGENT_DESIGN.md**. Observability of ALL actor/agent/automation
actions was swept + gap-fixed (**docs/EVENT_AUDIT_2026-08-02.md** — the `package?format=zip` audit blind
spot is closed; everything posts to `system_events` + domain logs).

**Compliance matrix (`proposal_compliance_matrix`, pre-exists mig 001; now populated).** The create route
inserts one row per required item (or per named required-section within it), sourced from the volume,
linked to the section that addresses it, starting `not_addressed`. The lock route flips matched rows to
`satisfied`; unlock resets to `not_addressed`. Status CHECK: `not_addressed | partial | satisfied |
not_applicable`. This is what the proposal card's `percentComplete` and the workspace compliance tab
read — previously always 0%.

> **Resolved (2026-07-15):** the mig-103 gap is closed. `provisionProposalForPortal` now **populates the
> matrix at provision** (`frontend/lib/provision-proposal.ts:134,170` — one `proposal_compliance_matrix`
> row per required item, `status='not_addressed'`), matching the legacy create route. A portal-launched
> proposal ships with a real matrix.

---

## 5. Data Flow — Upload → Atoms → Selector → Drafter (Unified Library)

The content library is re-founded on **atoms** (mig 101/102). Files: `frontend/lib/atoms.ts`,
`lib/atom-size.ts`, `components/portal/{atoms-workbench,atomizer,atom-library}.tsx`,
`app/api/portal/[tenantSlug]/atoms/*`.

### 5.1 The atom model

An atom is one `library_atoms` row of a given **grain**:

| Grain | Meaning |
|-------|---------|
| `primitive` | one object (a bio, a past-performance blurb, one paragraph) |
| `group` | an ordered aggregate of member atoms (`atom_members`) — a whole team section |
| `reference` | the registered source document (full content kept for later atomization) |

Every atom records its **`creator_kind`** (`admin | ai | collaborator | system | import`), its
**`owner_user_id`**, a **`source_anchor`** back to the objects it was cut from, and its **size**
(`word_count`/`char_count` + a physical estimate via `atomSize()`) in the same currency a section mold
uses — so fit against a compliance-bound skeleton is a direct comparison. Lineage is a DAG
(`atom_lineage`, parent→child `derived_from`); tags are the **unified taxonomy** (`atom_tags` keyed to
`taxonomy_terms`, each tag `auto`/`admin`-sourced and confirmable). Reusable skeletons live in
`document_cocoons`.

**Visibility** (`tenant | owner_only | shared_for_proposal | admin_only`) is enforced on every read via a
`Viewer` (`viewerFromRole`): admin tiers (tenant_admin / rfp_admin / master_admin) see the whole tenant
library; tenant_user / partner_user see tenant-shared atoms plus the ones they own. `partner_user`
collaborators get scoped read access (they can select atoms for a section but only see what they're
entitled to). This closed a data-exposure bug where library reads ignored ownership.

### 5.2 The loop

```
Upload (POST /atoms/upload, multipart) → readDocument (existing import readers)
    → register the whole doc as a `reference` atom (fmt tag auto-confirmed; provenance = uploader)
    → return deconstructed objects (heading + narrative chunks, suggested vol tags)
Atomize (components/portal/atomizer.tsx): paste OR upload → deconstruct into selectable objects →
    box/multi-select → "Make atom" (primitive, or a group of N member primitives) → tag against the
    unified taxonomy (curated dims via <select>, open dims free-text) → POST /atoms → createAtom()
Select  (GET /atoms/select?vol=&kinds=&context=): selectForSection() — the scored, pre-vector selector:
    scope by vol/kind → context boost (shared opp values: agency/program/phase/tech/dept) → tie-break by
    outcome_score, usage, recency. A group's content is assembled from its ordered members.
Draft   the ranked atoms feed the AI drafter's <library_atoms> context (and the admin picker).
```

`selectForSection` blends the signals as `ctxMatches*2 + outcome_score + log1p(usage)*0.1`, with the
same visibility predicate applied — so the drafter never receives an atom the requesting user can't see.
`embedding vector(1536)` exists on `library_atoms` for a later vector-select increment (default-off).

---

## 6. Event / Workflow Spine

### 6.1 The jsonb-object payload fix (load-bearing)

**Bug class (systemic):** event payloads were written as `${JSON.stringify(x)}::jsonb`, which stores a
jsonb **string scalar** — so `payload->>'field'` returned **null** for every audit/automation/workflow
consumer, and `create_instance` could not read `opportunityId` off a trigger overlay. **Fix:**
`frontend/lib/events.ts` now writes via `sql.json(x)` (jsonb **object**) in all three emitters
(`emitEventStart`/`emitEventEnd`/`emitEventSingle`); `lib/opportunity-bridge.ts` and
`lib/process/launch-template.ts` use the same `jsonParam` idiom. **Migration 103**
(`db/migrations/103_event_payload_jsonb_fix.sql`) back-fills historical rows: it converts `payload`/`error`
from string scalars to objects only where `jsonb_typeof = 'string'` and the unwrapped text starts with
`{`/`[` (guard so genuine string values are left alone). This restored `payload->>` for the CMS
automation listener, the audit surface, and the spine correlation below.

### 6.2 Namespaces → templates → instances (carrying the opportunity)

The 7 canonical namespaces are unchanged (V9 §8.2: `finder | capture | identity | proposal | library |
system | tool`). The workflow engine (V9 §8.4, `run_workflow_processor`, ~10s poll) now registers **12
templates** on boot (each writes a `process_templates` row with `active` + `trigger_key`), up from 9 in
V9 — the additions are `ProjectCollaboration`, `OnProposalSectionEdited`, and `OnProposalOutcomeRecorded`.

| Template | Trigger (`namespace:type:phase`) | Carries `opportunity_id` |
|----------|----------------------------------|--------------------------|
| `ProjectCollaboration` | `proposal:project.collaboration_requested:single` | ✅ opp + scope (generic overlay gate) |
| `OnSolicitationPushed` | `finder:solicitation.pushed:single` | ✅ opp (scope NULL) |
| `OnProposalCreated` | `proposal:proposal.created:end` | — (opp link via sibling `ProjectCollaboration`) |
| `OnProposalSectionEdited` | `proposal:section.saved:single` | — |
| `OnProposalOutcomeRecorded` | `proposal:outcome.recorded:end` | — |
| `OnProposalAdvancedToReview` | `proposal:proposal.advanced:end` (targetStage==review) | — |
| `OnProposalAdvancedToFinal` | `proposal:proposal.advanced:end` (targetStage==final) | — |
| `OnRfpUploaded` | `finder:rfp.uploaded:end` | — |
| `OnOpportunitiesDetected` | `finder:opportunities.detected:single` | — |
| `OnSourceChangeDetected` | `finder:source.change_detected:single` | — |
| `OnCmsContentRequested` | `library:content.requested:single` | — |
| `OnApplicationAccepted` | `capture:application.accepted:end` | — |

(The two `OnProposalAdvanced*` modules carry a stale `:single` header comment; the registered trigger is
`proposal:proposal.advanced:end` — `phase="end"` in code.)

**How the opportunity is frozen onto the instance.** Carrying the opportunity is **generic, not
template-coded**. `WorkflowManager.create_instance()` (`pipeline/src/workflows/manager.py` L180–213) reads
`opportunityId` and `scope` off the (now-object) trigger payload, validates `scope ∈ {opp, spotlight,
project, contract}` (the mig-088 CHECK; a bad value degrades to NULL), and writes both onto the
`process_instances` row alongside the **frozen payload** (the overlay JSON, `json.dumps(payload)`). So a
template carries the opportunity **iff its emitter puts `opportunityId` in the event payload** — today
only `ProjectCollaboration` (opp + scope) and `OnSolicitationPushed` (opp) do. `OnProposalCreated`'s
event carries `topicId`/`solicitationId` (not `opportunityId`), so its spine link instead arrives via the
**sibling `ProjectCollaboration` launch** in the same create route (`opportunityId: topicId, scope:
'project'`). A reaction run keyed this way can be chained / rolled up by `opportunity_id`
(`v_opportunity_rollup`, mig 088) — the "spine as a KEY + reaction runtime, not a new state machine."
`process_instances` gained `opportunity_id` + `scope` in mig 088; the frozen overlay lives in its
`payload` jsonb (mig 043).

`launchTemplate()` (`frontend/lib/process/launch-template.ts`) is the GUI/bridge on-demand entry point:
it re-checks the catalog gate, then emits the template's `single`-phase trigger with the overlay as
payload; the pipeline picks it up on its next poll and `create_instance` freezes that overlay.

### 6.3 The two consumers (unchanged shape)

Consumer 1 = the pipeline workflow processor (matches `system_events` → templates → `process_instances`
via `WorkflowManager`). Consumer 2 = the CMS `event_listener` (matches `automation_rules`). Both depend
on `payload->>` working — hence §6.1 is load-bearing for both.

---

## 7. New / Changed Schema (migrations 093 → 148)

Highest migration: **148** (was 103 at this doc's 2026-07-03 drive-verify; 104–108 added the
purchase→curation→release flow). **109–125** then landed identity/multi-membership + tenant documents
(110/111), agent-memory RLS + the `NOBYPASSRLS`-track agent role (116/117), scout crawl/schedules (118),
the observability lifecycle (120), the `library_units` drop (121), portal delegated managers (123), the
launch credential rotation (124), and the dead-table drop (125). **126–143** then landed the RLS cutover
scaffold (136/137), library + collaboration vaults (132–134), the Foundation TVSF demo seed (140,
generated by `gen-foundation-seed-migration.mjs`; 141 fixed Paul's shadow-admin role), the superseded-
table drop (142), and **`proposal_sections.sort_index`** (143 — the integer section-ordering key,
backfilled + indexed; see §4 Download). The **V1 UI-wiring pass** then added **144** `proposals.studio_phase`
(the Proposal Studio 3-loop state), **145** `notification_read_state` (per-user read watermark), **146**
`solicitation_amendments` + `proposal_amendment_flags` (the amendment detect→confirm→fan-out→acknowledge
engine), **147** `proposals.archived_at`, and **148** `archived_at` on `process_instances` /
`tenant_opportunity_cards` / `library_atoms` / `contracts` — the **soft-archive** watermark (reversible,
never hard-deleted; cascade + selection rules in **docs/ARCHIVABLE_CONTRACT.md**). Domains added to V9's 72-table /
14-domain map (the 093–108 core; the drops that shrank it back are in "Table drops" below):

| Migration | Adds |
|-----------|------|
| `093_collaborator_library_scope` | `library_unit_shares`, `collaborator_library_prefs` (per-collaborator scope on legacy `library_units` — **all three since dropped**, migs 121/125) |
| `094_oppcard_bridge_spine` | **`opportunity_bridge`**, **`tenant_opportunity_cards`** (RLS forced), **`tenant_bridge_cursor`**; `govtech_app` role |
| `095_oppcard_pin_docs` | `tenant_opportunity_cards.pinned_docs` jsonb (pin-pulls-docs-local manifest) |
| `096_tenant_spotlight_buckets` | **`tenant_spotlight_buckets`**, **`tenant_bucket_scores`** (both RLS forced) |
| `097_portals_shadow_guardrails` | `proposal_portals`, `shadow_admin_grants`, `guardrail_templates` (L3 execute layer, RLS) |
| `098_portal_workflow_guardrails` | `proposal_portals.current_stage_index`; seeds a global guardrail template |
| `099_intake_meta` | `curated_solicitations.intake_meta` jsonb |
| `100_submission_stage_lifecycle` | `submission_stage` (+ release metadata) on `opportunities` and `tenant_opportunity_cards`; extends `opportunity_bridge.event_type` (+`archived`) |
| `101_unified_library_taxonomy` | **`taxonomy_terms`, `document_cocoons`, `library_atoms`** (RLS), **`atom_tags`, `atom_lineage`, `atom_members`**; enables `vector` |
| `102_atomizer_support` | `library_atoms.{creator_kind, created_by, source_anchor}` |
| `103_event_payload_jsonb_fix` | back-fills `system_events.payload`/`.error` from string scalars → objects |
| `104_jsonb_string_scalar_backfill` | second-pass back-fill of remaining jsonb string-scalar rows (companion to 103) |
| `105_customer_purchase_curation_flow` | **`proposal_portals.curation_pending`** + `paid_at`/`curation_due_at`; **`promo_codes`** (kind `comp`/`percent`/`amount`; seeds `'rfppipelinetest'`); `purchases.promo_code` |
| `106_purchase_curation_notification` | seeds the `automation_rule` `capture:purchase.completed → notify_admin` |
| `107_spotlight_summary` | **`curated_solicitations.spotlight_summary`** (the Release-1 push gate; skeleton build stays off the bridge) |
| `108_patch_live_marketing_content` | marketing-content patch |

Key new tables (constraints; CHECK enums are in §2.1 and §5.1; full columns in `CLAUDE_CLIFFNOTES.md`):

- **`opportunity_bridge`** — `(opportunity_id → opportunities, version, event_type, card jsonb, posted_by)`,
  UNIQUE `(opportunity_id, version)`, append-only, **not** RLS (global feed).
- **`tenant_opportunity_cards`** — `(tenant_id → tenants, opportunity_id [soft ref, no FK], card jsonb,
  bridge_version, lifecycle_status, submission_stage, pursuit_status, is_pinned, pin_update_available,
  pinned_docs jsonb)`, UNIQUE `(tenant_id, opportunity_id)`, RLS ENABLE+FORCE on `app.tenant_id`.
- **`tenant_spotlight_buckets`** `(tenant_id, name, criteria jsonb, is_active)` + **`tenant_bucket_scores`**
  `(tenant_id, bucket_id CASCADE, opportunity_id, score, factors jsonb)` UNIQUE `(tenant_id, bucket_id,
  opportunity_id)` — both RLS forced.
- **`library_atoms`** (RLS forced) + **`atom_tags`** PK `(atom_id, dimension, value)`, **`atom_members`**
  PK `(group_atom_id, member_atom_id)`, **`atom_lineage`** PK `(parent_atom_id, child_atom_id)` CHECK
  parent≠child, **`document_cocoons`**, **`taxonomy_terms`** UNIQUE `(dimension, value)`.
- **`proposal_compliance_matrix`** (pre-exists mig 001) — now *populated*.

### Table drops & the drop rule (migs 121, 125)

The schema is **shrinking as it converges.** Two cleanup migrations removed tables a live successor had
fully replaced:

- **mig 121** dropped the entire **`library_units` family** — `library_units`, `library_harvest_log`,
  `library_atom_outcomes`, `library_unit_shares` — plus the `proposal_supporting_docs.library_unit_id`
  FK column, once every read/write was repointed to `library_atoms` (§5). (`solicitation_topics` was
  similarly retired earlier, migs 030a/035.)
- **mig 125** dropped **12 superseded, zero-referenced tables** (+ their orphaned indexes, via CASCADE):
  `tenant_pipeline_items` (→ `tenant_opportunity_cards`); `opportunity_events` / `customer_events` /
  `content_events` / `system_config` (→ `system_events` / config); `pipeline_runs` (→ `pipeline_jobs`);
  `proposal_reviews` (→ `agent_task_queue` + `proposal_activity_log`); `solicitation_templates`
  (→ `solicitation_outlines` / `document_templates`); `tenant_uploads` (→ `tenant_documents` /
  `library_atoms`); `tenant_actions` (→ `triage_actions` / `tenant_bucket_scores`);
  `legal_document_versions` (→ `consent_records`); `collaborator_library_prefs` (sibling of the mig-121
  shares table). It also **DROPs + REBUILDs `v_opportunity_rollup`** onto `tenant_opportunity_cards` —
  ranked/pinned tenant counts now come from live cards (`lifecycle_status <> 'archived'`), fixing a view
  that had been silently reporting **zero** because it still counted off the retired pins table.

**The drop rule (codified).** A table is dropped **only** when it is *superseded-with-a-named-successor
AND has zero live code references* (frontend + pipeline + CMS, repo-wide audit). **"Empty in the sandbox"
is NOT a drop signal** — most empty tables are live-but-unused. Five inert-but-intentional tables were
therefore deliberately **KEPT**: `verification_tokens` + `invitations` (the auth/invite surface),
`agent_archetypes` (the agent-workforce roster), `rate_limit_state` (code names it a future target), and
`system_health_snapshots` (monitoring).

**Retired-table repoints (the last live reads, now fixed before the drop).** Three surfaces still read a
retired table: the CMS `matched_opportunities` email variable (`services/cms/src/templates.py`) read
`tenant_pipeline_items` (always 0); the rfp-curation **Customer Interest** panel
(`app/admin/rfp-curation/[solId]`) joined the retired pins table; and `v_opportunity_rollup` counted off
it. All three now read `tenant_opportunity_cards` (`lifecycle_status <> 'archived'`,
`COALESCE(pinned_at, created_at)`, archived tenants excluded). Full ledger:
`docs/DEPRECATION_CLEANUP_2026-07-22.md`.

### RLS reality (updated from V9 §7.4 and migs 116/117)

The greenfield tenant tables (cards, buckets, scores, atoms, portals) ship **RLS ENABLE + FORCE with real
policies** keyed on the `app.tenant_id` GUC, and mig **116** extended forced RLS to the agent-memory
tables (`episodic_memories` et al., previously enabled-but-policyless). `withTenant()` (`lib/rls.ts`)
wraps each tenant operation in a txn that `SELECT set_config('app.tenant_id', $1, true)` (SET LOCAL).

**Today this is effectively a single enforced layer: the explicit `WHERE tenant_id = $1` predicate.** The
app still connects as the schema **owner**, which **bypasses RLS**, so the FORCE policies are wired but do
not yet bite — the WHERE predicates are the belt that actually isolates tenants. The policies become the
second, defense-in-depth layer only on the planned cutover to the non-owner **`govtech_app`** role
(created mig 094; the `NOBYPASSRLS` agent role is specified in `docs/AGENT_WORKFORCE.md`, wired by
migs 116/117).

**`govtech_app`-cutover caveat (RLS-cutover checklist, launch-readiness item #9).** The retired-table
repoints above — the CMS `matched_opportunities` read, the rfp-curation Customer Interest panel, and
`v_opportunity_rollup` — are **direct cross-tenant reads of `tenant_opportunity_cards` (RLS FORCED)** from
the admin/CMS side. They work today only because the owner bypasses RLS; after the `govtech_app`
(`NOBYPASSRLS`) cutover they would return **0** unless run on a BYPASSRLS connection or reframed as
owner-views. Belongs on the RLS-cutover checklist — see `docs/DEPRECATION_CLEANUP_2026-07-22.md`.

---

## 8. Canvas Build→Lock Hardening (correctness)

Driven and fixed against the live app (regression-tested in `frontend/e2e/`):

| ID | Bug | Fix | Spec |
|----|-----|-----|------|
| D1 | A **locked** section was still editable via the SAVE API → overwrote accepted content | `save` selects `is_locked`, rejects with **423** | `e2e/lock.tenant.spec.ts` |
| D2 | Section lock/unlock had **no CAS** → double-submit re-ran one-time side effects (harvest, artifact roll-up, auto-advance) | `UPDATE … WHERE is_locked=false/true` compare-and-swap + idempotent no-op | `e2e/lock.tenant.spec.ts` |
| D3 | Orphaned `PATCH /stage` bypassed the "all sections locked" gate | delegate to `advanceProposalStage` (gated core) | build path removed |
| #2 | Optimistic lock was not real — no base-version check | client sends `baseVersion`; a stale save is rejected **409** | `e2e/collab.tenant.spec.ts` |
| #3 | Save-auth hole — an **unassigned** collaborator could save | `resolveUserAccess` enforces `assigned_sections`; unassigned → **403** | `e2e/collab.tenant.spec.ts` |
| #1 | Editor comments were dead | section-scoped editor comments post + read back | `e2e/collab.tenant.spec.ts` |

Artifact roll-up (E1) is atomic: locking the final section of an artifact flips the artifact to `locked`
and emits `proposal:artifact.locked` in one statement, so two concurrent final-section locks can't both
observe "not all locked."

---

## 9. What V9 Retained (pointer, not repeated)

Everything below is **unchanged** by this refactor — V9 is the source of truth:

| Subsystem | See |
|-----------|-----|
| Proposal workspace + canvas editor (Tiptap, versions, drafting) | V9 §2 Stage 7, §4.7 |
| Stages / gates / force-advance / stage snapshots | V9 §2, §4.4 (`lib/proposal-advance.ts`, `force-advance.ts`) |
| Auth (NextAuth v5), 5 roles, RBAC, middleware, tenant isolation | V9 §4.3, §10 |
| Provisioning substrate (artifacts, sections, template seed, artifact-spec) | V9 lifecycle addendum, §2 Stage 6 |
| Admin curation + shredder (PDF → Claude → compliance/documents) | V9 §2 Stage 3, §5.4 |
| Pipeline ingest / scoring / source scout / memory lifecycle | V9 §5 |
| AI: Product-AI (frontend-direct) + pipeline agent workforce (advisory, on-deploy) | V9 §9 |
| CMS/CRM (87 endpoints, 7 workers, Vite SPA, event listener) | V9 §6 |
| Storage (S3/R2, three prefixes) | V9 §11 |
| Deployment (Railway, migrations at deploy, CI) | V9 §12 |
| Event system shape (system_events, 7 namespaces, start/end/single) | V9 §8 |

The 3-source strawman generation remains the open AI-integration gap (the `publish_section_draft`
landing primitive is shipped; `OnProposalCreated → draft_v0` fires only when the pipeline
`ANTHROPIC_API_KEY` is set on deploy) — unchanged from V9's §9 correction.

---

## 10. As-Built Verification

This refactor was **driven**, not code-read. Method + verdict scale: `docs/archive/HITL_WIRING_AUDIT_RUNBOOK.md`.

### 10.1 Playwright suite — 17/17 green

`frontend/e2e/` runs serially (`workers:1`, chromium, `screenshot:only-on-failure`,
`trace:retain-on-failure`) against an **externally booted + seeded** `next start` on `:3000` — no
`webServer` block; boot + seed (`scripts/seed_dev_accounts.mjs`, `scripts/e2e_fixtures.sql`) are Step 0
of the runbook. Three projects: `setup` (persona login → storageState), `admin`, `tenant`.

**17 total test cases = 3 auth-setup personas + 14 spec cases across 11 spec files** (`npm run test:e2e`):

| Spec | Cases | Drives |
|------|-------|--------|
| `auth.setup.ts` | 3 | real Credentials-form login → storageState (admin, lighthouse tenant, partner collaborator) |
| `smoke.admin` / `smoke.tenant` | 1 + 1 | each persona reaches a gated surface without bouncing to `/login` |
| `reach.admin` / `reach.tenant` | 1 + 1 | reachability sweep (30 `/admin/*` + 17 `/portal/*` routes, fail only on 5xx/crash) |
| `fanout.admin` | 1 | multi-topic push fans out one card per topic to the tenant |
| `redirect.tenant` | 2 | legacy `/spotlights` and `/pipeline` land on `/cards` |
| `matrix.tenant` | 1 | provision builds a real matrix; a requirement advances to `satisfied` on lock, resets on unlock |
| `lock.tenant` | 1 | locked section rejects save (423, D1); lock/unlock idempotent (D2) |
| `collab.tenant` | 3 | save-authz (admin ok / unassigned 403); stale-baseVersion 409; editor comments round-trip |
| `library.tenant` | 1 | atom visibility: admin sees all; collaborator sees tenant + own only |
| `ranking.tenant` | 1 | cards auto-scored on push, surfaced + ordered on `/cards` (`topScore > 0`) |

### 10.2 Live workflow-engine run

Against the **full live stack** (frontend `:3000` + the **Python workflow engine** `:8080` + Postgres),
the engine **registered 12 templates** and **created `process_instances` carrying `opportunity_id`** from
the frozen event overlay — witnessed for `ProjectCollaboration` (carries opp), `OnSolicitationPushed`
(carries opp), `OnProposalCreated`, and `OnProposalSectionEdited`. The §6.1 payload fix is what made the
`opportunity_id` correlation possible (a string-scalar payload returned null on `payload->>'opportunityId'`).
Evidence: `docs/archive/HITL_WIRING_AUDIT_2026-07-03.md` finish-out block.

### 10.3 Verdict

The **ingest → curate → release → fan-out (per topic) → pin → provision → build ×N → lock → download**
spine is end-to-end wired and driven-green; the customer surface is converged on the canonical cards;
the library is unified on atoms with enforced visibility; the compliance matrix and rankings are real;
and the workflow engine runs live keyed to the opportunity spine.

---

## 11. Known Gaps & Remaining Work

From the driven audit (`docs/archive/HITL_WIRING_AUDIT_2026-07-03.md`) — feature-completeness and cleanup, not
core-spine breaks:

| Item | Status | Note |
|------|--------|------|
| Portal-launch matrix | ✅ | Resolved (2026-07-15) — `provisionProposalForPortal` now populates `proposal_compliance_matrix` at provision, matching the create route |
| Shadow-admin god-view | ⚠ future | mig 097 meant `shadow_admin_grants` to replace the admin god-view, but `verifyTenantAccess` (`lib/db.ts:52`) still grants any admin global access — enforce the grant + retire the god-view |
| Buyer/outcome ledger · proposal-ready nudge · curation auto-skip | ⚠ future | master-OPP buyer ledger, sbir.gov outcome scrape, skeleton-ready nudge to mirror cards, and curation auto-skip for pre-built OPPs — see `docs/MASTER_MIRROR_OPP_DESIGN.md` §7, §2, §5 |
| Volume-doc tree grouping | 🟡 | data is real (volumes→artifacts→sections + page allocations); workspace still renders flat |
| Templates → skeleton | 🟡 | nothing sets `volume_required_items.template_id`, so authored templates don't reach provisioning; fix the admin template-list fetch shape |
| New-customer backfill | 🟡 | `backfillTenant()` runs only via a manual admin route → fresh tenants miss historical opportunities |
| Fan-out entitlement gate | 🟡 | every active/trial tenant receives every card regardless of Spotlight subscription (confirm intended) |
| Legacy dead code / deps | 🧹 | `tenant_pipeline_items` + 11 other rot tables **DROPPED** (mig 125) and the `library_units` family (mig 121); **16 unused frontend deps + 6 orphaned modules removed**; ~28 no-caller API routes (incl. `/spotlight/pin`) + confirmed-dead exports **cataloged** for a per-item decision — `docs/DEPRECATION_CLEANUP_2026-07-22.md` |
| 3-source strawman (`draft_v0`) | 🟦 | wired to `OnProposalCreated`; real Claude activates on deploy (`ANTHROPIC_API_KEY`) — unchanged from V9 |

---

## 12. What Changed Since V9

| Topic | V9 (2026-06-23) | V10 (2026-07-03) verified truth |
|-------|-----------------|----------------------------------|
| Customer opportunity surface | `tenant_pipeline_items` + Spotlight/Pipeline (scoring rows) | **Retired.** Canonical = `tenant_opportunity_cards` via the bridge; Spotlight/Pipeline redirect to `/cards` |
| Multi-topic RFP | umbrella card only | **one card per topic** (umbrella + every topic activated + published) |
| Admin→customer coupling | scoring job writes per-tenant rows | **forward-only `opportunity_bridge`** → fan-out to denormalized cards |
| Rankings | Spotlight threshold on scoring rows | **`tenant_bucket_scores`** auto-populated on fan-out; `/cards` ordered by best bucket score |
| Library | `library_units` (harvest log, atom-outcomes) | **`library_atoms`** (primitive/group/reference) + unified `taxonomy_terms` + visibility/provenance/lineage |
| Compliance matrix | empty shell (always 0%) | **populated at provision, advanced on lock, reset on unlock** |
| Section lock | editable-when-locked; no CAS | **423 reject + CAS + idempotent**; real optimistic lock (409); assigned-section authz |
| Event payloads | jsonb **string scalars** (`payload->>` = null) | **jsonb objects** via `sql.json`; migration 103 back-fills |
| Workflow templates | 9 | **12** (adds ProjectCollaboration, OnProposalSectionEdited, OnProposalOutcomeRecorded) |
| `process_instances` ↔ opportunity | spine columns added, unproven | **live: instances created carrying `opportunity_id`** from frozen overlay |
| RLS | enabled on 4 memory tables, **zero policies** | greenfield tenant tables ship **RLS + real policies** on `app.tenant_id` (`govtech_app` role) |
| Verification | file-by-file code read | **driven** — Playwright 17/17 + live engine run |

---

*This document records the greenfield-canonical refactor shipped on `claude/nice-hamilton-kBqtD` and its
drive-verification. It is a delta over ARCHITECTURE_V9.md, which remains canonical for the retained core.
Source of truth for the verification claims is `docs/archive/HITL_WIRING_AUDIT_2026-07-03.md` and the
`frontend/e2e/` suite; for the greenfield schema, `CLAUDE_CLIFFNOTES.md` and `db/migrations/094–103`.*
