# Role-by-Role Actions & Data-Processing Workflow Guide (with validation)

**Purpose.** A plain-text, step-by-step walk of every role and its actions — with a concrete
**validation** for each — focused on the **data-processing workflow executions**. Every route,
event, and workflow named here is real (grounded in the shipped code, not invented). The
"✅ verified this pass" markers are things I personally drove/tested on 2026-08-04 against the
sandbox (fresh build + live DB); everything else is committed + unit-tested and validated by the
same mechanism, but needs a prod service (the pipeline worker and/or `ANTHROPIC_API_KEY`) to
observe end-to-end.

---

## 0. How the data-processing workflows actually execute (read this first)

- A **workflow** is a declarative template: a **trigger** (a `system_events` type) + a DAG of
  **steps** (`ACTION` / `AI_INVOKE` / `NOTIFY` / `API_CALL` / `HITL_WAIT` / `TODO` / `CONDITION`).
  The 22 templates live in `pipeline/src/workflows/on_*.py`.
- **Nothing runs in the frontend.** A UI action **emits an event** into the shared `system_events`
  river. The **pipeline worker** (`run_workflow_processor`) polls that river, and for each matching
  event it **creates a `process_instances` row** and drives the steps, writing a
  `process_instance_transitions` row at every step's **start** and **end** (the audit gate). State
  lives entirely in the DB → the runtime is stateless and crash-recoverable, and it **refuses to run
  un-audited** (emits `system:workflow.engine_unavailable` if `process_instances` is missing).
- **Therefore: in a frontend-only environment `process_instances` stays empty** — that is expected,
  not a bug. Workflow executions appear once the **pipeline worker is running** (prod, or locally).
  ✅ *I proved the engine itself executes:* drove `OnSolicitationPushed` through `WorkflowManager`
  against the live DB → **status=completed**, both steps ran (`find_matching_tenants` →
  `send_spotlight_digest`), **3 transition rows** written.

**The universal validation pattern** for any workflow-triggering action below:
1. **UI/observable** — the screen state the user sees change.
2. **Event** — `SELECT type, created_at FROM system_events WHERE type='<ns>.<event>' ORDER BY created_at DESC LIMIT 1;`
3. **Execution** (needs the worker) — `SELECT workflow_name, status, step_status FROM process_instances
   WHERE trigger_event_id = <that event id>;` → expect `status='completed'` (or `parked` at a HITL gate).
4. **Data result** — the concrete row the workflow produced (a card, a matrix row, a contract, …).

---

## 1. Roles & where each lands after `/login`

| Role | Landing | Scope |
|---|---|---|
| **master_admin** | `/admin/dashboard` | Everything: migrations, all tenants, system state, agents. |
| **rfp_admin** | `/admin/dashboard` | RFP triage/curation, onboarding, releases, shadow-descent into a tenant. |
| **tenant_admin** | `/portal/<slug>/dashboard` | Their tenant: team, purchases, proposals, library, automation. |
| **tenant_user** | `/portal/<slug>/dashboard` | Per admin grant (all proposals, or per-proposal). |
| **partner_user** | `/portal/<slug>/proposals` | Stage-scoped access to a single proposal (view/comment/edit). |

**Validate login:** you land on the row above and a page reload does **not** bounce to `/login`.
✅ verified this pass for admin, tenant_admin, and partner (collaborator) via the e2e `setup` project.

---

## 2. Data-processing workflow executions — the reference table (your main concern)

Each row: the **trigger action** → the **workflow** → **how to confirm it ran**. (`ns` = event namespace.)

| # | Trigger action (who) | Event | Workflow (`on_*.py`) | Steps (data processing) | Confirm it ran |
|---|---|---|---|---|---|
| 1 | Push a curated solicitation (rfp_admin) | `finder:solicitation.pushed` | **OnSolicitationPushed** | `match_tenants` (score-read) → `notify` digest | ✅ instance `completed`, 2 steps; **and** a `tenant_opportunity_cards` row per tenant appears |
| 2 | A card lands / a bucket changes (system/tenant) | `capture:card.applied` · `capture:buckets.updated` | **OnTenantRescore** | `rescore` → upsert `tenant_bucket_scores` | card's `topScore` on `/cards` becomes > 0 (needs worker) |
| 3 | Opportunities ingested (system) | `finder:opportunities.detected` | **OnOpportunitiesDetected** | notify + TODO triage + `AI_INVOKE` analyst | new `opportunities` rows; a curation ToDo in `tasks` |
| 4 | RFP doc uploaded (rfp_admin) | `finder:rfp.uploaded` | **OnRfpUploaded** | parse/shred → compliance scaffold | `solicitation_compliance` / volumes populated |
| 5 | Portal released/provisioned (rfp_admin) | `proposal:proposal.created` | **OnProposalCreated** | matrix populate + section molds (`AI_INVOKE` drafter) | `proposal_compliance_matrix` non-empty; `proposal_sections` created |
| 6 | Section locked (tenant) | `proposal:section.edited` / advance | **OnProposalSectionEdited / OnProposalAdvanced** | matrix advance → `satisfied`; color-team review | matrix item flips `not_addressed`→`satisfied`; a returned library atom |
| 7 | Full draft requested (tenant_admin **or** rfp_admin doorbell) | `proposal:proposal.full_draft_requested` | **OnFullDraftRequested{ModeA,B,C}** | cohort `AI_INVOKE` (drafter/formatter/…); Mode C auto | one `requestFullDraft` audit row; sections drafted |
| 8 | Studio phase run (tenant_admin/doorbell) | `proposal:review_phase.requested` | **OnReviewPhaseRequested{Draft,Refine,Compliance}** | phase cohort `AI_INVOKE` → land in review gate | `proposals.studio_phase` advances; review artifacts |
| 9 | Assess ingest readiness (rfp_admin) | `tool:ingest.assess` | **OnIngestAssessmentRequested** | `rfp_ingest_manager` plans next specialists (advisory) | an advisory assessment record; no tenant write |
| 10a | Outcome = awarded (rfp_admin/tenant) — **frontend** outcome route | *(inline, in the txn)* | *n/a — deterministic route logic* | create `contracts` entity + **ProjectCollaboration kickoff** | a `contracts` row (`contractId`) + a kickoff `process_instance` |
| 10b | Outcome recorded (any) — **pipeline** reaction | `proposal:outcome.recorded` | **OnProposalOutcomeRecorded** | `attribute_outcome` (agent credit) → `AI_INVOKE` win/loss lesson | an attribution record; an `episodic_memory` lesson |
| 11 | Solicitation update scan (system) | `finder:solicitation.update_scan_requested` | **OnSolicitationUpdateScan** | amendment **detect → confirm(HITL) → fan-out → acknowledge** | `solicitation_amendments` + `proposal_amendment_flags`; tenant banner |
| 12 | Application accepted (rfp_admin) | `capture:application.accepted` | **OnApplicationAccepted** | onboarding side-effects (buckets/cards/library) | new tenant fully populated (see §4b) |

> Every one of these templates passes `Workflow.validate()` (✅ verified: **29 workflows → 0 unmapped
> `AI_INVOKE`**), so no step silently no-ops at boot. The `AI_INVOKE` steps produce **real drafts only
> when `ANTHROPIC_API_KEY` is set** (else a `placeholder`); the deterministic steps (scoring, matrix,
> contract, fan-out) run with **no key**.

---

## 3. master_admin — actions & validation

1. **Apply migrations / manage schema.** `DATABASE_URL=<prod> node db/migrations/migrate.mjs`.
   **Validate:** `_migration_history` head = `152_*`; `next build` clean. ✅ (mig 152 cold-apply + guard + idempotent verified this pass).
2. **View system state / events.** `/admin/system-state`, `/admin/events`.
   **Validate:** the `system_events` feed shows recent `finder/capture/proposal/system` types; counts move as you act.
3. **Agent Workforce oversight.** `/admin/agents` → roster + per-tenant usage (forward-only bridge).
   **Validate:** 36 archetypes listed; per-tenant usage counters. ✅ (fabric registers **36 archetypes**).
4. **Everything rfp_admin can do** (below), unrestricted.

---

## 4. rfp_admin — actions & validation (the data-processing engine room)

### 4a. Curate → push a solicitation → **fan-out** (workflow #1)
1. Open `/admin/rfp-curation/<solId>`. Fill the **spotlight-match summary** and confirm a **close date**
   on every topic (both are hard gates — push refuses without them).
2. Click **Push** (or `POST /api/tools/solicitation.push {input:{solicitationId}}`).
3. **Validate — UI:** the solicitation status flips to *pushed*; the **Customer Interest** panel lists
   tenants who pinned a card. **Event:** `finder:solicitation.pushed` appears. **Execution:**
   `OnSolicitationPushed` instance `completed` (✅ proven). **Data:** a `tenant_opportunity_cards` row
   per active tenant, auto-scored (`tenant_bucket_scores`).
   > ✅ verified this pass: the fanout e2e spec drives this exact push and asserts a card per topic
   > reaches the tenant; the negative control (blank spotlight summary) makes push **422** — proving
   > the gate is real.

### 4b. Onboard a company → **starter content copied** (workflow #12)
1. `/admin/tenants` → **New Company** (or accept a waitlisted application).
2. **Validate — Data:** the new tenant lands with **buckets** (`tenant_spotlight_buckets`), **cards**
   (`tenant_opportunity_cards` backfilled from the bridge), and its **own copy of the 18-foundation
   starter library** (`library_atoms`, `collection=my_library`, `derived_from` lineage). Zero master
   leakage; masters untouched.
   > ✅ verified this pass through **both** real routes (`POST /api/admin/tenants` and
   > `applications/[id]/accept`): 18 copies + lineage 303, full isolation; and the **empty-master
   > fallback** fires the one-click OFFER instead.

### 4c. Release a purchased portal → **provision** (workflow #5)
1. `/portal/<slug>/portals` (as rfp_admin; acknowledge the shadow-descent consent modal) →
   **Release** the `curation_pending` portal (`POST /api/portal/<slug>/portals/<id>?action=release`).
2. **Validate — UI:** the portal shows *launched* (UNLOCKED build). **Data:** a `proposals` row linked
   to the opportunity, a **populated `proposal_compliance_matrix`**, and `proposal_sections` (molds).
   > ✅ verified this pass: the matrix e2e spec provisions and asserts the matrix is non-empty and
   > `source='database'`.
3. **Free (comped) portal:** on `/portal/<slug>/portals`, use **Approve free portal** with an
   opportunity uuid → records a **$0 audited purchase** + a `guardrails_pending` portal.
   **Validate:** a `purchases` row (`metadata.grant='admin'`) + `capture:purchase.completed` event.
   ✅ verified this pass (the zzblockers drive approves a free portal and asserts *guardrails pending*).

### 4d. Assess ingest readiness (workflow #9)
1. Curation workspace → **Assess ingest readiness** (`→ OnIngestAssessmentRequested`).
   **Validate:** an advisory assessment (the `rfp_ingest_manager` plans next specialists); **injection-
   fenced, no tenant write.** ✅ (agent security suite proves the fence + tenant-binding).

### 4e. Proposal Auto-Drive doorbell (workflows #7/#8)
1. `/admin/agents` → the Auto-Drive card → `POST /api/admin/proposals/<p>/full-draft`.
   **Validate:** a single `requestFullDraft` audit row with `source='admin_doorbell'`; the same
   `proposal:full_draft_requested` trigger the tenant portal uses (one auditable front door).

### 4f. Record an outcome = awarded → **contract kickoff** (rows #10a/#10b)
1. Set the proposal outcome to **awarded** (`POST /api/portal/<slug>/proposals/<p>/outcome {outcome:'awarded'}`).
   **Validate — Data (deterministic, frontend, no API key):** the outcome route, inside its transaction,
   creates a **`contracts`** row (`contractId`) and launches a **ProjectCollaboration kickoff** gate
   (`kickoffLaunched=true`); co-active `spotlight` process_instances are archived (scoped off the contract).
   **Validate — Pipeline reaction (#10b, needs worker):** `OnProposalOutcomeRecorded` runs
   `attribute_outcome` (agent credit) + an `AI_INVOKE` win/loss lesson written to the tenant's memory.

---

## 5. tenant_admin — actions & validation

1. **Buy a proposal portal (comp code).** `/portal/<slug>/cards` → a card's **Purchase** →
   `promoCode: rfppipelinetest`. **Validate — Data:** `proposal_portals` row `curation_pending`
   (72h SLA) + `capture:purchase.completed`. ✅ (purchase modal + Stripe-fallback verified in the
   zzblockers drive).
2. **Invite / manage team.** `/portal/<slug>/team` → invite (`tenant_user`) or add a `partner_user`
   to a proposal. **Validate:** `user_memberships` (tenant_user) / `collaborator_stage_access`
   (partner) rows; an invited-collaborator event → **OnCollaboratorInvited** side-effects.
3. **Build the proposal / lock sections → matrix advances (workflow #6).** Open the build, edit a
   section, **Lock** it. **Validate — UI:** the compliance % climbs. **Data:** the matrix item for
   that section flips `not_addressed → satisfied`; **Unlock** resets it. ✅ (the matrix e2e spec
   asserts exactly this lock→satisfied→unlock→reset cycle).
4. **Run Proposal Studio (workflow #8).** The 3 gated loops **Draft → Refine → Compliance**; at each
   gate **comment + regenerate** (comments thread as `guidance`) or **approve → next**; or **run all 3**
   via the doorbell. **Validate:** `proposals.studio_phase` advances; the loop lands in a review gate
   (advisory — it never advances a stage, locks, or submits on its own).
5. **Request a full draft (workflow #7).** The single front door funnels to `requestFullDraft`
   (`source='portal'`). **Validate:** one audit row; sections drafted (real text only with the API key).
6. **Download the submission package.** `/api/portal/<slug>/proposals/<p>/package?format=json|docx|pdf|zip`.
   **Validate:** the file downloads; a `proposal:package.exported` audit event; sections ordered by the
   integer `sort_index`. ✅ (package route + audit verified in prior work; docx/pdf share one assembly).
7. **Archive (soft, reversible).** Archive a **portal** (cascades its BUILD `process_instances`), a
   **library atom**, or (rfp_admin+) a **tenant**. **Validate — Data:** `archived_at` set (never hard-
   deleted); the surface darkens; **Restore** clears it. ✅ (archive flows browser-driven in prior work).

---

## 6. tenant_user — actions & validation

1. **Access per grant.** If granted "all proposals" they see the list; if per-proposal, only theirs.
   **Validate:** `/portal/<slug>/proposals` shows only granted proposals; a non-granted proposal id
   returns **403 `FORBIDDEN`** (not a leak). ✅ (the collab e2e specs assert unassigned access is 403).
2. **Draft a section.** Edit + save within a granted proposal (`.../sections/<s>/save`).
   **Validate:** `proposal_sections.content` updates, `version` increments; a `proposal:section.edited`
   event → **OnProposalSectionEdited**. An **optimistic-lock** save on a stale base version is rejected
   **409**. ✅ (the collab e2e spec asserts the 409).
3. **Cold-start (zero-proposal member).** Dashboard shows the honest "you're on the team" card, not a
   redirect trap. ✅ (verified in the zzblockers drive for `member@ubihere.com`).

---

## 7. partner_user — actions & validation

1. **Stage-scoped access to one proposal.** Lands on `/portal/<slug>/proposals`; sees only the proposal
   + stages they were granted (view / comment / edit). **Validate:** `collaborator_stage_access` rows
   gate it; an out-of-scope stage or proposal → **403**. ✅ (collab e2e: unassigned collaborator rejected).
2. **Comment on a section.** Post a comment; read it back. **Validate:** the comment persists and is
   readable by the admin. ✅ (collab e2e "editor comments" asserts post + read-back).
3. **Scoped library visibility.** A partner sees tenant-shared + their own atoms only — **not** another
   member's `owner_only` atoms. ✅ (the library e2e spec asserts admin-sees-all vs collaborator-scoped).

---

## 8. What I personally verified this pass (2026-08-04, no results taken on faith)

- **Workflow engine executes:** `OnSolicitationPushed` driven live via `WorkflowManager` → `completed`,
  both steps, **3 audited transitions**. The 22 workflow-**execution** tests pass; the full pipeline
  suite is **979 pass / 28 skip** (with `DATABASE_URL`); **29 workflows validate → 0 unmapped `AI_INVOKE`**.
- **Committed & clean:** all 22 `on_*.py` templates + the schema (migs 043 process_instances, 054 catalog,
  144 studio_phase, 146 amendments, …) are on the branch; tree clean; head pushed.
- **Cross-checked flows** (e2e, fresh build, reproducible **62 pass / 0 fail / 1 skip** + a negative
  control): fan-out push, provision→matrix, section lock→advance, collaborator access/comment/lock,
  library visibility, free-portal approve, submitted-proposal unlock, keep+copy onboarding.
- **Honest gaps (need a prod service, not code):** live `process_instances` require the **pipeline
  worker** running; real `AI_INVOKE` **draft text** requires **`ANTHROPIC_API_KEY`**; **`ranking`**
  (bucket scoring) is the one flow gated behind the worker's `OnCardApplied` rescore. These are the
  Wave-A launch items (`ANTHROPIC_API_KEY`, pipeline running), not defects.
