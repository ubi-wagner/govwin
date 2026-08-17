# Design — Master OPP → Mirrored Cards → Purchase → Curation → Proposal V0→V1

> **As-built correction (deepest-review sweep).** The verified bridge map (both directions, every message)
> is **docs/START_END_FRAMEWORK.md** §3. Two corrections to this design doc: (1) card scoring is **NOT**
> done inside the fan-out transaction — it is tenant-side + event-driven (`applyToTenant` emits
> `capture:card.applied` → pipeline `OnCardApplied` → `rescore.py`); the former in-tx `autoScoreCard` was
> dead code and has been removed. (2) The fan-out apply is now genuinely forward-only (a stale out-of-order
> apply no longer regresses a tenant card) and version allocation is race-safe.

> **AS-BUILT UPDATE (#117, 2026-07-19) — agents on the bridge.** The tenant-space AI agents (scoring,
> analysis, drafting, packaging, …) are **part of the forward-only bridge**: they act **inside a single
> tenant's mirror** (tenant-bound, tenant_user authority — the trusted task tenant, never model-chosen), and
> their **usage** rolls **up** to the RFP admin for oversight (`/admin/agents`, per-tenant) while their
> **outputs and the tenant's data stay in the tenant** — exactly the bridge invariant (info/control forward
> + up, tenant data never flows out; the only backflow is an admin descending into the tenant's RLS shadow
> to inspect). Agent output is advisory → guardrail → land-or-review, never an auto-write across the
> boundary. Canonical detail: **`docs/AGENT_WORKFORCE.md`** (§4 bridge invariant, §7–8 isolation + safety).

**Status:** design of record for the customer-facing opportunity lifecycle. Describes the
**intended architecture** and grounds every stage in the **as-built** code (file:line refs).
Anything not yet wired is marked **⚠ future** with the intended shape — the doc is honest about
now-vs-later so it can double as the build backlog. Supersedes `archive/CUSTOMER_PURCHASE_TO_V1_FLOW.md`
(folded in) and is the source the HITL click-plans derive from.

Verified against the tree on branch `claude/nice-hamilton-kBqtD` (migrations 001→108).

---

## 0. The one sentence

There is **one master OPP** in the RFP-side data house; it is **mirrored** to every customer as a
denormalized card over a **forward-only bridge**; the *only* thing that ever flows back up is a
**ToDo — an event, never customer data** — whose sole job is to **redirect a privileged actor down
into a specific customer's RLS-scoped shadow account** to do work there.

---

## 1. Master + mirror, one-way bridge

Two layers, data flows **down only**:

```
  RFP-SIDE MASTER (global, admin-written)                 CUSTOMER MIRRORS (per tenant, RLS FORCE)
  ───────────────────────────────────────                ──────────────────────────────────────────
  opportunities                                           tenant_opportunity_cards   (L1 mirror)
  curated_solicitations (spotlight_summary)                 · card JSONB (snapshot at bridge_version)
        │                                                    · is_pinned, pin_update_available
        │  publishToBridge → next version                    · pinned_docs, submission_stage
        ▼                                          one-way    · lifecycle_status / pursuit_status
  opportunity_bridge  (L0, append-only, vN) ═══════════════► (upsert per tenant on fan-out)
        │  fanOutBridgeEvent: every active/trial tenant   data
        │  autoScoreCard (in the same tx)              (DOWN only)  tenant_bucket_scores  (ranked vs
        │                                                            tenant_spotlight_buckets)
        │
        │        ToDo event (navigational, carries NO customer data)
        └───────────────────────────────────────────────────◄─── capture:purchase.completed, etc.
                          ▲
        RFP expert / EconDev shadow admin ── the ToDo routes them DOWN into the tenant's
                                             RLS-scoped shadow account to build + release
```

**L0 — `opportunity_bridge`** (`db/migrations/094_oppcard_bridge_spine.sql:31-45`): append-only,
`UNIQUE(opportunity_id, version)`, `event_type ∈ {published,updated,closed,reopened,awarded}`, each
row a full customer-visible `card JSONB` snapshot. Grant is **`SELECT, INSERT` only** — no
UPDATE/DELETE — so it is structurally forward-only. Written by `publishToBridge`
(`frontend/lib/opportunity-bridge.ts:151`, version = `max(version)+1`).

**L1 — `tenant_opportunity_cards`** (`094:48-76`; `pinned_docs` from `095`, `submission_stage` from
`100`): one denormalized row per `(tenant_id, opportunity_id)` (soft ref, **no cross-shard FK**),
`bridge_version`, `is_pinned`, `pin_update_available`, pursuit/lifecycle status.

**Fan-out**: `applyToTenant` upserts one card (`opportunity-bridge.ts:175`, `ON CONFLICT
(tenant_id, opportunity_id) DO UPDATE`) and, in the **same transaction**, `autoScoreCard`
(`:207` → `bucket-ranking.ts:88`) ranks it against every active `tenant_spotlight_buckets`
(`096`) into `tenant_bucket_scores`. `fanOutBridgeEvent` (`:221`) loops every
`tenants WHERE status IN ('active','trial')`; `backfillTenant` (`:281`) catches up a new customer.

**Update propagation**: `republishIfReleased` (`:260`) publishes a **new** bridge version and
re-fans; on re-apply, `pin_update_available` flips to true only for **pinned** cards whose
`bridge_version` advanced (`:194-200`) — the amber "update available" nudge.

> **Backflow rule.** The bridge carries card data one way. The only "upward" signal is a **ToDo
> event** (§4) — it moves no customer content to the master; it exists purely to navigate an actor
> into a tenant. This keeps tenant content sharded and private while still letting the RFP side act.

> **Two spine systems — copies, not one shared spine.** The master side is one spine
> (`opportunities → curated_solicitations → opportunity_bridge`, global / admin-written). Each
> customer's mirror card is the **head of a SEPARATE, tenant-scoped spine** —
> `tenant_opportunity_cards` (a **copy** at `bridge_version`) → `proposal_portals` → `proposals` →
> `process_instances` → `tasks` → `system_events`, all RLS / `tenant_id`-scoped. The two connect ONLY
> via the forward-only bridge (master pushes card updates down — on change, and within 72h of purchase
> for the skeleton) and the **soft `opportunity_id` reference** (no cross-shard FK). A customer's
> workflow runs + audit live entirely on **their** spine; the portal reads only their own
> (`/processes`, `/activity` — `verifyTenantAccess` + `WHERE tenant_id`, verified). The mirror card also
> lives its own per-customer, per-bucket life as a **Spotlight** informer (`tenant_bucket_scores` vs
> `tenant_spotlight_buckets`). So `opportunity_id` is the *link between* two spines, not a shared one.

---

## 2. Two releases per OPP

An OPP is released **twice**, for two different surfaces. They are **decoupled** — Release 2 can
precede or follow any purchase.

### Release 1 — **Spotlight** (basic ingest = minimums)
The customer-discovery surface. Minimal by design.
- Ingest the OPP with **minimums** + attached files; write a **`spotlight_summary`**
  (`curated_solicitations.spotlight_summary`, `107`) — the plain-language "why this matches."
- **Approve + push** → `solicitation.push` (`frontend/lib/tools/solicitation-push.ts:53`), gated on
  `submission_format` **and** a non-empty `spotlight_summary` (`:140-145`) → flips the solicitation
  to `pushed_to_pipeline`, activates the landing opp + all topics, and fans a bridge version to
  every tenant, auto-ranked (§1).
- A customer **pin** copies the OPP's attached files into their space
  (`tenant_opportunity_cards.pinned_docs`, `095`; `/…/cards/[oppId]/pin`) and arms nudges/pushes.

Everything a customer needs for Spotlight — purchased or not — stops here.

### Release 2 — **Proposal portal** (the robust skeleton, built once on the master)
The build surface. Built **globally on the master solicitation**, then **reused per tenant**.
- **Full compliance** on the master: `solicitation_compliance` (`001:229+`, incl.
  `submission_format`, `custom_variables`), `solicitation_volumes` + `volume_required_items`
  (`012`), and **blank templated molds** — `document_templates` (`017` / `086` `canvas_document`)
  linked to items via `volume_required_items.template_id` (+ `expert_notes`). A mold is **blank but
  carries the guardrails/context**: e.g. a "1-page technical summary" that is a 15-page Word doc
  with the required font, margins, type, and page limit.
- This master skeleton is **built once**. Every tenant that provisions instantiates from it
  (`provisionProposalForPortal`, `frontend/lib/provision-proposal.ts:35`): proposals → artifacts
  per volume → sections per item → a per-tenant `proposal_compliance_matrix` row per item
  (`:133`, `status='not_addressed'`) → molds interpolated (`{company_name}` → tenant name, `:151`).
- **Timing:** may be built **any time in advance** by any RFP admin (whether or not anyone bought).
  If it is **not** done when the **first** portal is purchased, the **72h SLA** fires (§5).

> **Why decoupled + global.** If one SBE buys a portal for a CSO, others may too. Building the
> skeleton once on the master and reusing it per tenant means the **second buyer is instant** — a
> ~15-minute shadow-admin library plug-and-play (§6), no 72h. The master card list + history stay
> canonical for everyone, including RFP Pipeline itself.

**✅ BUILT — "proposal-ready" broadcast (the provisioning cockpit, PV-1..6, docs/PROVISIONING_WORKSPACE_DESIGN.md).**
When the master skeleton completes, every *mirror* card for that OPP flips to "proposal-ready" — a legit
nudge that never reveals it was built for a specific buyer. As-built: an rfp_admin's **Complete & Release**
(`/admin/provisioning/[portalId]`) calls `completeBuildOut(solId)` → sets `curated_solicitations.build_complete`
(mig 182) and RE-PUBLISHES every activated opp of it as a bridge **`updated`** version → the existing fan-out
delivers it → `buildCardSnapshot` carries `provisionReady=true` on each `tenant_opportunity_cards.card` so the
nudge surfaces like `pin_update_available`. The completion is bracketed `finder:opportunity.build_completed`
(start/end, carrying `cardsRefreshed` = the true reach). This is OUTCOME 1 (broadcast to the shared master);
OUTCOME 2 (provision the buyer's private portal + kick off their workflow) is layered on the same action —
one auditable two-outcome release. Proven live: `frontend/scripts/drive-provisioning-cockpit.mts` (23/23).

---

## 3. Actors & access — shadow admins, RLS, consent

| Role (`frontend/lib/rbac.ts:12-16`) | In this flow |
|---|---|
| `master_admin` / `rfp_admin` | ingest, first-pass, push, build the master skeleton, release, shadow-curate |
| `tenant_admin` / `tenant_user` (customer) | library, buckets, pin, purchase, build V0→V1 |
| `partner_user` | lowest portal tier (per-proposal collaborators) |

**Shadow admin = a ToDo-driven visit, not standing access.** A privileged actor enters a tenant by
resolving a ToDo (§4) that drops them into the tenant's RLS-scoped context. Every route wraps DB
work in `withTenant(tenantId, …)` (`frontend/lib/rls.ts`) which sets `app.tenant_id` for the tx; the
`tenant_isolation` RLS policy scopes the rows. Grants are recorded in **`shadow_admin_grants`**
(`097:41-63`, portal-scoped, `source ∈ {t_and_c, invite}`, `active`, revocable via
`?action=revoke-shadow`).

**Generalized shadow admins (RFP experts *and* appointed EconDev).** The same mechanism is meant to
carry **Economic Development professionals appointed by us or by a customer** — they receive only the
intermediary ToDos, which push them into the **customer-allowed** RLS shadow account. The hook
exists: `shadow_admin_grants.source='invite'` is exactly the appointed-shadow path. **⚠ future:** no
EconDev/appointed-shadow *role or invite UI* yet (`partner_user` is a base RBAC tier, not a stage- or
portal-scoped appointment).

**T&C consent → the automation surface.** The T&C are **opt-in to the shadow admin by default** (the
customer must explicitly **opt out**); **assume everyone opts in now.** That opt-in is what licenses
automation to push ToDos/nudges into **approved accounts — the shadow admin *and* the company's own
admins.** As-built, the purchase tx unconditionally writes a `shadow_admin_grants` row
(`purchase/route.ts:110-113`, `source='t_and_c'`). **⚠ future:** there is no *pre-purchase opt-out
toggle* — only after-the-fact revocation.

> **⚠ security gap to close.** `097` intended `shadow_admin_grants` to **replace** the admin
> "god-view", but `verifyTenantAccess` still returns `true` for any `rfp_admin`/`master_admin`
> (`frontend/lib/db.ts:52`). So today the grant is **auditable + revocable metadata**, not the
> enforced gate — revoking it does not actually cut a route-level admin off. Hardening (enforce the
> grant, drop the god-view) is a tracked ToDo; the intended model above is grant-enforced.

---

## 4. ToDos — the navigational backflow

The one thing that flows "up." A ToDo is an **event** that parks a task and routes an actor down.

- **Ledger:** `tasks` (`053_tasks_ledger.sql`). The pivotal row is `task_type='proposal_setup'`,
  `tenant_id`=buyer, `assignee_role='rfp_admin'`, due in 72h — created by `launchProjectCollaboration`
  (`frontend/lib/process/project-collaboration.ts:59`) from the purchase route.
- **Surface:** `listOpenAdminTriageTasks` (`frontend/lib/tasks/tasks.ts:109`) shows admin tasks
  **plus** the one tenant-scoped exception (`proposal_setup`) so the buyer's opp/tenant is reachable;
  rendered at `/admin/rfp-curation` (`triage-todos.tsx`).
- **Events:** emitted via `emitEventStart/End` (`frontend/lib/events.ts`), namespaces
  `finder | proposal | capture`. `automation_rules` (`019`) drives outward notifies — the
  `capture:purchase.completed → notify_admin` rule is seeded by `106`; the CMS
  `event_listener.py` emails `ADMIN_NOTIFICATION_EMAIL`.
- **Nudges already exist:** the `proposal_setup` task carries `nudgeDays:[1,3]`
  (`purchase/route.ts:146-159`).

This is the whole backflow contract: a ToDo appears on the RFP side, an actor clicks it, RLS drops
them into the tenant to act — **no customer content ever crosses to the master.**

---

## 5. The 72-hour SLA — skeletoning only

- **Trigger:** the **first** portal purchase for an OPP. `POST /api/portal/[slug]/purchase`
  (`route.ts:49`, comp code `rfppipelinetest`) opens `proposal_portals` at `curation_pending`,
  `curation_due_at = now()+72h` (`105`; `CURATION_SLA_HOURS=72`, `:29`), writes a `$0` completed
  `purchases` row, the `shadow_admin_grants` row, emits `capture:purchase.completed`, and parks the
  72h `proposal_setup` gate.
- **What the clock covers:** completing + releasing the **master skeleton** (Release 2) — the full
  compliance matrix and molds — so the buyer is provisioned within 72h. **If pre-built, it's a
  ~15-min expert review**, not 72h.
- **What it does *not* cover:** the proposal **draft** (V0.5→V1). No clock on the build itself.
- **Every purchase fires an emitter** and appends to the buyer set; only the *first* (for an
  un-skeletoned OPP) starts the 72h. Later buyers reuse the skeleton (§2) and get a fast release.

**⚠ future — auto-skip for pre-built OPPs.** Today **every** purchase opens `curation_pending`; a
pre-built OPP just gets a fast admin release rather than an automatic skip straight to `launched`.
Intended: if the master skeleton already exists, open the portal past curation (or auto-release).
**As-built fast-track (PV):** the provisioning cockpit (`/admin/provisioning/[portalId]`) renders a
`build_complete` master as "Meets the bar · Marked complete" → the admin's **Complete & Release** is
one click, no re-authoring. Full auto-release stays deliberately gated (the owner's segregation model
keeps a human on the release), so this remains a *fast* path, not a *skip*.

---

## 6. Version model — V0 → V0.5 → V1

| Stage | What it is | Who | Clock |
|---|---|---|---|
| **→ V0** | skeleton **instantiated** for the tenant (matrix + molds + guardrails, blank) | RFP expert builds master; provision instantiates | the 72h (skeletoning) |
| **V0 → V0.5** | **library plug-and-play** — atoms pulled into the molds → first draft | customer admin **or** shadow admin | none (~15 min) |
| **V0.5 → V1** | draft, compliance, finalize | customer (shadow-assisted today) | none |

- **Release → provision (unlocked).** `POST …/portals/[portalId]?action=release` →
  `releaseFromCuration` CAS (`portal-launch.ts:112`, `curation_pending→launched`) → `provisionAndInstantiate`
  → `provisionProposalForPortal` (build is **unlocked**), then `OnProposalCreated → draft_v0`
  (`pipeline/src/workflows/on_proposal_created.py`) auto-drafts empty/`ai_drafted` sections via the
  `section_drafter` archetype.
- **Draft grounding.** A section with no atoms falls back to **all** tenant atoms
  (`lib/atoms.ts selectForSection`); the item's `expert_notes` become the drafter's instruction (the
  blank-mold prompt).
- **HITL draft (the canvas tools) — pick → regen → mold + RFP-prompt.** V0→V0.5 is customer/shadow
  driven **in the canvas**, not the autonomous agent loop. The `proposal.draft_section` tool
  (`lib/tools/proposal-draft-section.ts`) takes the **mold** constraints (page/font/spacing/
  subsections), the **RFP context** (`rfpExcerpt`), the **picked atoms**, and an **instruction** →
  regenerates canvas nodes. It's triggered from `AIRevisionPanel` (per node: quick actions **or** a
  custom prompt — the "easy-bake-oven"), `draft-all-sections`, and the `ai/draft` batch route (carrying
  the user `instructions`); it runs with or without an API key (placeholder mode). The agent workforce
  stays parked (see `docs/AUTOMATION_DESIGN.md`).
- **Advance.** `draft → final` (relabeled **V0.5 → V1**); **Force advance to V1** (`force=true`)
  finalizes without locking every section. Lock flips matrix rows toward `satisfied`
  (`…/sections/[sectionId]/lock`). Download is a real `.docx`.

**⚠ future — Workplan automation** (end-to-end design: `docs/AUTOMATION_DESIGN.md`). V0→V0.5→V1 is meant to be driven by **Workplan automation**:
nudges + actions pushed into the approved (shadow + company admin) accounts, with the goal of a
**mostly customer-executed** build — the shadow admin is today's bootstrap, not the end state. The
substrate exists (`ProjectCollaboration` parks gates + nudges; `draft_v0` auto-drafts), but the full
V0→V1 nudge/action automation is **partial**: `color_team_reviewer` is event-only and
`compliance_reviewer` runs inline in the route, not through the pipeline agent loop.

---

## 7. Buyer / outcome ledger (RFP-admin-only) — **⚠ future**

The master OPP card carries an **RFP-admin-only** ledger: **who bought a portal** for this OPP and
(eventually) **the outcome** — never the proposal content (that stays private per portal). Purpose:
"someone else bought; everything is in their portal," and cross-tenant reuse economics.

- **Today (derivable, not a ledger):** `purchases(tenant_id, opportunity_id)` makes buyers
  queryable; `v_opportunity_rollup` (`088:23-42`) aggregates `ranked_tenants`, `pinned_tenants`, and
  proposal counts — but has **no purchaser list and no win/loss dimension**. Proposal outcomes are
  recorded only as a `proposal:outcome.recorded` event + `library_units.outcome` (atom learning),
  never back onto the opp.
- **Intended:** an OPP-level buyers ledger (buyer tenant, purchased_at, portal, outcome) surfaced on
  the master card; outcomes backfilled later by the **sbir.gov outcome scrape** (6–12 months out,
  whether or not they tell us — **⚠ not built**; `pipeline/src/ingest/sbir_gov.py` ingests
  opportunities only).

---

## 8. End-to-end workflow (the spine)

Two RFP-side passes around the customer; **manual/shadow-assisted today**, automation-driven later.

**A — RFP admin, ingestor (master, Release 1):**
1. **Ingest minimums** — `/admin/rfp-upload` (hardened: `content_hash` includes the oppId → no
   dup-title 500; S3 failure rolls back the orphan).
1b. **Topic files → topic opportunities (multi-topic BAAs).** In the curation workspace, drop the
   individual topic files into the topic drop-zone → `POST /api/admin/upload-topic-files` →
   `ingestTopicFilesForSolicitation` (`frontend/lib/ingest/ingest-topic-files.ts`) creates **one
   topic `opportunities` row per file** — deduped (content-hash + `(solicitation_id, topic_number)`),
   text-extracted, and linked to its file via `opportunities.origin_document_id` (mig 122). The
   umbrella flips to `solicitation_type='multi_topic'`. Nothing is customer-visible yet; **Push**
   (step 4) fans umbrella + every topic over the existing `WHERE solicitation_id = <sol> OR id =
   <landing>` activation set — so 1 solicitation + 20 topic files → **21 bridge cards**.
2. Shred → the OPP is **recommended** to the rfp_admin (triage).
3. Write the **first pass: spotlight summary** (the push gate).
4. **Approve + push** → `solicitation.push` → Opportunity Pipeline → auto-ranked → **mirrored to all
   tenants**. *(Release 1 done.)*

**Master skeleton (Release 2) — any time, or within 72h of first purchase:**
5. Build **volumes / required items / full compliance / blank molds** on the master solicitation
   (link `template_id` + `expert_notes`). Reused by every future buyer.

**B — Customer (e.g. `eric@immobileyes.com`):**
6. Sees Navy ranked vs their buckets; upload artifacts → atomize → tag; create 2–3 buckets.
7. **Pin** Navy → copies the OPP files into their space; arms nudges.
8. **Purchase** → code `rfppipelinetest` → portal `curation_pending`, 72h SLA, `$0` purchase, shadow
   grant, `capture:purchase.completed`, admin ToDo parked.
9. Portal shows **"Waiting for RFP Expert Curation" + live countdown.**

**C — RFP admin, shadow (curation #2, in-tenant via the ToDo):**
10. Resolve the `proposal_setup` ToDo at `/admin/rfp-curation` → routed into the tenant. If the
    skeleton (step 5) exists → **~15-min review**; else build it now (within 72h).
11. **Release** (`action=release`) → `curation_pending→launched`, provision **unlocked** →
    `draft_v0` auto-draft → the buyer receives the matrix + molds + guardrails. *(→ V0.)*

**D — Customer build (shadow-assisted → self-serve):**
12. **Library plug-and-play** — pick atoms into the molds; empty sections fall back to all atoms +
    the expert note. *(V0 → V0.5, ~15 min.)*
13. **Lock all**, or **Force advance to V1.** *(V0.5 → V1.)*
14. **Save / download** the final V1 `.docx`.

**Next buyer of the same OPP:** their own portal + skeleton instance + templated automation (mostly
identical, tightly bound) — molds already exist → straight to step 12, no 72h.

---

## 9. As-built reference + gap register

| Stage | Table(s) | Route / function | Ref |
|---|---|---|---|
| Bridge L0 | `opportunity_bridge` | `publishToBridge` | `opportunity-bridge.ts:151` |
| Mirror L1 + fan-out | `tenant_opportunity_cards` | `applyToTenant` / `fanOutBridgeEvent` | `opportunity-bridge.ts:175,221` |
| Auto-rank | `tenant_spotlight_buckets` / `tenant_bucket_scores` | `autoScoreCard` | `bucket-ranking.ts:88` |
| Push (Release 1) | `curated_solicitations` | `solicitation.push` (gated on `spotlight_summary`) | `tools/solicitation-push.ts:53,140` |
| Pin (copy files) | `tenant_opportunity_cards.pinned_docs` | `…/cards/[oppId]/pin` | `095` |
| Master skeleton | `solicitation_volumes` / `volume_required_items` / `solicitation_compliance` / `document_templates` | curation + template studio | `012`,`017`,`086` |
| Provision (Release 2 → tenant) | `proposals` / `proposal_artifacts` / `proposal_sections` / `proposal_compliance_matrix` | `provisionProposalForPortal` | `provision-proposal.ts:35` |
| Purchase | `proposal_portals` / `promo_codes` / `purchases` | `…/purchase/route.ts` | `105`, `route.ts:49` |
| Wait UI | `proposal_portals.curation_due_at` | `proposal-portals.tsx` | `105` |
| ToDo backflow | `tasks(proposal_setup)` | `launchProjectCollaboration` / `listOpenAdminTriageTasks` | `project-collaboration.ts:59`, `tasks.ts:109` |
| Release + unlock | `proposal_portals` | `action=release` → `releaseFromCuration` | `portal-launch.ts:112` |
| Auto-draft | `proposal_sections` | `OnProposalCreated → draft_v0` (`section_drafter`) | `on_proposal_created.py` |
| Advance / force V1 | `proposals.stage` | `…/advance` (`force=true`) | session work |
| Shadow grant | `shadow_admin_grants` | `assumeShadowAdmin` / `revokeShadowAdmin` | `097:41`, `portal-launch.ts:49,130` |

**Gap register (⚠ future / to-build):**
1. **Buyer/outcome ledger** on the master OPP (buyers derivable from `purchases`; no ledger, no
   win/loss). §7.
2. **sbir.gov outcome scrape** to backfill outcomes (6–12 mo). §7.
3. ~~**"Proposal-ready" nudge** fanned to mirror cards on skeleton completion.~~ **✅ BUILT (PV) — the
   provisioning cockpit's Complete & Release broadcasts it; §2.**
4. **T&C shadow opt-out toggle** (grant is unconditional; only post-hoc revoke). §3.
5. **Auto-skip curation** when the skeleton is pre-built — the cockpit gives a *fast-track* (one-click
   release on a `build_complete` master), full auto-skip stays deliberately gated. §5.
6. **Full V0→V1 Workplan automation** (nudges/actions to shadow + company admins; customer-executed
   target). §6.
7. **EconDev appointed-shadow role/invite UI** (`shadow_admin_grants.source='invite'` is the hook). §3.
8. **Security:** enforce `shadow_admin_grants` and retire the `verifyTenantAccess` god-view
   (`db.ts:52`). §3.
