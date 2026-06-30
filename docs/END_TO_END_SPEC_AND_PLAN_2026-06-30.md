# RFP Pipeline — End-to-End Spec & Implementation Plan

**Date:** 2026-06-30 · **Rev:** 3 (collaborator partition + recursive disclosure)
**Status:** Authoritative model + plan. Synthesizes the eleven grounded investigations and the companion analyses (`DOC_ANNOTATION_ATOM_GAP_ANALYSIS_2026-06-30.md`, `END_TO_END_SPINE_ANALYSIS_2026-06-30.md`). Every "as-built" claim is grounded; every extension is marked NEW; schema choices are marked RECOMMENDED (pending sign-off); held items are gated.

> **Ground rules.** (1) No assumptions — as-built = verified in code; NEW = extension; RECOMMENDED = a schema choice awaiting confirmation; DECISION = open. (2) Some `docs/V1_*` gap lists are stale (pre-R5); code is truth. (3) The skeleton-extraction / cross-tenant transfer is **HELD** pending the published content-use policy.

---

## PART I — THE MODEL

### 1. Core unit: one opportunity = one submittable proposal
An **opportunity** is exactly one unique submittable proposal, located in **Department : Service-Org : Solicitation : Topic**. We never bundle topics into one card. *(As-built: `opportunities` are per-topic with `agency`/`office`/`program_type` + `solicitation_id`.)*

- **RFP = master record** → `curated_solicitations` (`namespace = {agency}:{program_office}:{type}:{phase}`).
- **Topic / AOI = the submittable** → `opportunities`.
- **Example (CSO):** one solicitation + name, topics = discrete areas of interest; the **solicitation-level matrix can carry company-wide rules** (e.g. "max N proposals per company") that **every topic inherits** — i.e. the 4-level resolution in §2.
- **Provisional vs official:** an opp **without a solicitation is a provisional card — not yet an official opp — and not purchasable.** With a solicitation + enough info it is **official → purchasable whenever the customer wants.** Readiness gates the buy button, nothing else.
- The **opportunity card = the spine's read-model**: **summary + aggregated matrix + recommended/attached template(s) + expert artifacts/notes + readiness**. *(As-built: spotlight detail renders matrix + bucket-fit + Build-Proposal; summary + template slot + readiness are the adds.)*

### 2. Compliance matrix = 4-level aggregation with precedence  *(NEW extension of a 2-level merge)*
Union of requirements across four levels; **conflicts resolved most-specific-wins:**
```
Topic ▷ Solicitation ▷ Service-Org ▷ Department
```
- **As-built:** merges topic → solicitation-baseline → defaults (`compliance-resolver.ts`); rules in `solicitation_compliance` (named cols + `custom_variables`).
- **NEW:** Service-Org + Department rule sets keyed by namespace prefix (so a new USAF-SBIR round inherits the agency/office layer = "assisted mapping of future similar solicitations"). Plus a **component/offering axis** (service/unit requirements).
- Solicitation-level constraints (submission counts, eligibility) sit at the solicitation level and flow down to all its topics.

### 3. Source anchoring = the audit spine  *(PARTIAL → first-class)*
Every matrix entry anchors the **page(s)+text** it came from → audit back-ref on proposals **and** the seed for future-similar mapping.
- **As-built:** `compliance.save_variable_value` stores `source_excerpt`+`anchor`; `SourceAnchor`/`AnchorRect` (% coords); PDF viewer derives rects from selection. Default boundary when unstructured = **PDF section breaks/headers**; manual visual anchoring always available.
- **NEW:** make the anchor first-class, reviewable, reusable.

### 4. Three RFP-Pipeline upload surfaces — one intake architecture
All feed the **same pipeline: upload-card → atoms (node-addressable) → canvas → (collaborate) → generate → convert → download.** Every upload is **typed** (its source/purpose) and atomized by the agreed schema.

| Surface | Purpose | As-built | NEW |
|---|---|---|---|
| **(a) RFP ingestion** | source docs → shred → topics → matrix + master card | 🟢 shred + AI extraction + topics + matrix; 🟡 anchoring | 4-level matrix, first-class anchoring, card auto-create on "new" |
| **(b) Admin materials** | templates/reference tied to Dept/Agency/Org/Solicitation (old or public) | 🟢 atomization | lands in the **Platform library** (§5) |
| **(c) CMS context dropbox** | resources/announcements/agency & sol info, each with a **context prompt** | ⚪ MISSING | dropbox feeding **manual scouting, spotlight-bucket nudges, marcom/resource context** |

### 5. Library scopes & master/mirror cards  *(the privacy architecture)*
**Four scopes, isolated by construction:**

1. **Platform (RFP-Pipeline) library — OURS, customers never see it.** Holds opportunities/master cards, solicitation **source docs**, training data, customer-derived materials, admin templates, reference. **RECOMMENDED impl:** a reserved **"RFP-Pipeline" platform `tenants` row** → `library_units.tenant_id` stays `NOT NULL`; the verified `WHERE tenant_id=$x` isolation keeps customers out with **zero new leak surface**.
2. **Tenant library — THEIRS.** Populated by (a) **copy-on-pin/purchase** from the platform library (solicitation docs → `customers/{slug}/…` + tenant rows), and (b) their **typed uploads** (company / collaborator / template / customer / …), all atomized by the schema.
3. **Collaborator library — two-level, derivative of the customer.** A collaborator (`partner_user`) gets a **discrete** library partition under the customer (tenant) who **assigned** them to a proposal. It **persists** for that customer's future proposals but is **locked until re-assigned** (access = an active `proposal_collaborators` assignment). **Discrete per collaborator → no cross-collaborator contamination**; moving an artifact to another collaborator requires **re-upload** (by them, or the customer admin uploading *into that collaborator's* partition). The customer admin may **visualize + ingest** a collaborator's artifacts **only those uploaded + approved-for-atomization for that project**. They get **create-from-template + populate-from-their-library** → they do the work, offloading the customer admin. **RECOMMENDED impl:** `library_units.owner_user_id` (uploader) + a per-proposal **`library_unit_shares(unit_id, proposal_id, approved_by, approved_at)`** approval (sharing is per-proposal, per-section); the lock is the assignment check, not a column.
4. **Shared templates — HELD.** `document_templates.is_system` (separate table → no content in the shared layer by construction). Policy-gated, §9.

**Recursive approval disclosure** (same mechanics at every tier — `us ◁ customer ◁ collaborator`): until the owner **marks sections "approved for sharing + atomization,"** the up-tier sees **only the foundational-document names + upload metadata**, never the content/atoms. *(This is the existing `library_units.status` draft→approved gate applied at each boundary.)* A later toggle lets an owner pick **"share all" vs "restrict until approved"** — same mechanics (held for detail).

**God view, no backward copy** (the hard invariant): **we (platform) SEE everything** (read/god, for support/QA) **but cannot copy content backward into our partition** — content moves up only as an **approved skeleton** (§9, held), never as raw atoms. **Customer admin** sees all of *their* tenant content + **collaborator content approved for the specific proposal**. **Collaborator** sees their own partition (when unlocked). **Visibility ≠ copy; partitions never merge upward.**

**Master → mirror cards + graduated disclosure:**
- We hold the **master card** (platform); it accrues new material/announcements/dates.
- An **update → push → per-tenant worker** creates/updates that tenant's **mirror card** → **rerank (new opp)** or **mark-updated (existing)** → enables **alerts on pinned cards**.
- Disclosure ladder: **spotlight mirror (ranked summary)** → **pin (copy docs for more info)** → **purchase (full portal)**. Pin **and** purchase both fire the copy into the tenant's solicitation documents.
- Push semantics = **same as spotlight push/refresh**, all tenants (for now), debounced.

### 6. Customer side (post-purchase)
On purchase: baseline matrix + selected solicitation/topic + matrix & template from ingest + expert/manager-approved artifact templates (**V0.5 = framework-ready**) + their uploaded initial artifacts (some may be prior proposals — held as **foundational documents** in their library).
- **V0** = the **strawman drafted into that framework** from 3 sources (RFP excerpt + their library atoms + tenant profile). **KEYSTONE** (`publish_section_draft` built, caller missing).
- **Customer library = theirs alone** + **templates we've shared** + **create-from-scratch**, 100% on the canvas/atom framework.
- **Collaborators** meta-tag uploads to mark relevant sections for the agent teams.
- **Search atoms by `Dept:Agency:Sol:Topic` + section/type/context + copy-but-revise** → reframe atoms of one solicitation into sections of another.
- **Workflow roles:** collaborators/employees **mark complete**; admins **lock + accept**. Same canvas everywhere (visualize → modify → review).
- **Rights assigned at portal-creation:** when the customer admin builds the automation (the `ProjectCollaboration`/proposal-setup template), they assign per-person **comment / edit / accept** rights to employees + collaborators. *(As-built: `proposal_collaborators` + `collaborator_stage_access` = stage-scoped view/comment/edit; "accept/mark-complete" = the R5 completion right.)*
- **Content-availability checks** — for each section, what atoms/docs are available across the *allowed* partitions + approvals — **feed the ToDos** ("section X has no available content → assign an upload task") for **V0, V0.5, and admin V1**.

### 7. Atom granularity = node-addressable  *(RECOMMENDED hybrid)*
Keep the **section atom** as the unit of approval/outcome/dedup (the learning loop + matching key off it), but guarantee **node-level addressability**: every `CanvasNode` keeps a stable id + type + inherits the atom's `Dept:Agency:Sol:Topic` + `section_type`; the insert path can lift a **single** node. Add a thin `library_nodes` projection later *only if* node-level search/scoring is needed — don't fragment atom rows. *(As-built today: section-level atoms carrying `canvas_nodes[]`.)*

### 8. (reserved)

### 9. Privacy boundary + skeleton flywheel  *(HELD)*
- **Private content loop** (per tenant): harvest → `library_units` → AI-assist-for-*their*-win. **Never shared.**
- **Shared skeleton loop** (cross tenant, HELD): extract **structure only** — `section_standards` taxonomy + format spec, **never verbatim text/headings** — → shared `document_templates`, filled with **synthetic example content**. Cross-tenant transfer requires consent + the published content-use policy.
- At purchase the expert may extract a **skeleton-as-template** from the customer's library — **for that customer's own reuse now**; cross-tenant promotion is held.

---

## PART II — AS-BUILT MAPPING (grounded; citations in companion docs)

| Capability | State |
|---|---|
| Shred → AI compliance matrix; topic association (multi-topic/tranched/multi-year) | 🟢 EXISTS |
| Admin matrix authoring + audit + episodic memory | 🟢 EXISTS |
| Source anchoring on matrix entries | 🟡 PARTIAL |
| 4-level (Service-Org/Department) precedence + component axis | 🔴 NEW |
| Solicitation **summary** authoring | 🔴 MISSING |
| Admin materials atomization | 🟢 EXISTS (tenant-scoped) |
| **Platform (our) library** scope | 🔴 NEW (reserved tenant) |
| **Collaborator sub-scope** (`owner_user_id`/`visibility`) | 🔴 NEW |
| CMS context dropbox | 🔴 MISSING |
| Master card auto-create on "new" + carry-forward | 🟡 PARTIAL |
| **Mirror card** per tenant + update propagation + pinned alerts | 🟡 PARTIAL (spotlight scoring exists; mirror/update-mark NEW) |
| Copy-on-pin/purchase → tenant solicitation docs | 🟢 EXISTS (purchase) / 🟡 (pin) |
| Push on create | 🟢 EXISTS · **push on update** 🔴 NEW |
| Provisional-vs-official (purchasable) gate | 🔴 NEW |
| Spotlight per-instance ranking + buckets (C5) | 🟢 EXISTS |
| Purchase → 72-hr gate → proposal/sections + template seed | 🟢 EXISTS |
| **V0 strawman (3-source)** | 🔴 CALLERLESS (keystone) |
| V0.5 = framework-ready | ⚪ define (this doc) |
| Collaboration, tasks, locks (mark-complete / lock-accept), harvest, outcome | 🟢 BUILT (R5) |
| Library → canvas insertion | 🟡 PARTIAL (text-only cast) |
| Node-addressable atoms + Dept:Agency:Sol:Topic tagging + search | 🟡/🔴 |
| Customer library = own + shared templates + scratch; collaborator libs + meta-tag | 🟡 PARTIAL |
| Typed tenant uploads (company/collaborator/template/customer) | 🔴 NEW |
| Embeddings on + populated | 🔴 NEW (infra off) |
| Skeleton extraction + cross-tenant transfer | ⏸️ HELD |

---

## PART III — IMPLEMENTATION PLAN (build-test-build)

### Phase 0 — Lock decisions (no code)
- **D1 Hierarchy/matrix:** Dept=agency, Service-Org=program_office; precedence Topic>Solicitation>Service-Org>Department; + component axis. **(confirmed)**
- **D2 Library scope — RECOMMENDED:** reserved platform tenant (ours; `tenant_id` stays NOT NULL); collaborator = `owner_user_id` + per-proposal `library_unit_shares` approval + assignment-gated lock (no `tenant_id` change); shared templates = `document_templates.is_system` (held). Recursive draft→approved disclosure at every tier. **Confirm.**
- **D3 Atom granularity — RECOMMENDED:** section-atom = unit; node-addressable via stable id + inherited tags; optional `library_nodes` projection later. **Confirm.**
- **D4 Privacy boundary** (held phase): skeleton = taxonomy-normalized structure + format spec only; cross-tenant consent-gated.
- **D5 Push-on-update:** same as spotlight push/refresh, all tenants, debounced.

### Phase 1 — Unified upload-card intake + 3 surfaces + library scopes
- **T1.1** One **upload-card** intake (context prompt + **type**: rfp / admin-material / cms-resource / company / collaborator / template / customer) reused everywhere. *Test: each type routes correctly + atomizes.*
- **T1.2** Library scopes per D2: **platform tenant** + collaborator `owner_user_id`/`visibility`. *Test: platform atoms invisible to any tenant; collaborator `owner_only` atoms hidden from peers, visible to tenant admin.*
- **T1.3 (a)** First-class **source anchoring** per matrix entry (persist + overlay; default PDF section/header). *Test: matrix entry deep-links to page/rects.*
- **T1.4 (c)** **CMS context dropbox** → tagged record feeding scouting/spotlight-nudge/marcom. *Test: an "AFWERX announcement" surfaces as a scouting/nudge signal.*

### Phase 2 — 4-level matrix + master card read-model
- **T2.1** Service-Org + Department rule sets + component axis; extend the merge. *Test: topic inherits office→agency; topic override wins; "max props/company" flows to all topics.*
- **T2.2** Solicitation **summary** authoring (`curated_solicitations.summary` + highlights). *Test: persists + renders on card.*
- **T2.3** **Master card** = summary + aggregated matrix + recommended/attached templates + expert artifacts/notes + **readiness/official flag**. *Test: card shows all; provisional (no solicitation) is not purchasable.*

### Phase 3 — Master→mirror push + graduated disclosure
- **T3.1** On opp create OR card update → push (same as spotlight) → per-tenant **mirror card** create/update → rerank(new)/mark-updated(existing). *Test: editing the master re-ranks + marks tenant mirrors.*
- **T3.2** **Pin and purchase** both fire copy of solicitation docs → tenant library; pin = "more info," purchase = full portal. *Test: pin copies docs; purchase opens portal.*
- **T3.3** Update-alert hook on **pinned** mirror cards. *Test: a master update notifies pinners.*

### Phase 4 — V0 strawman (KEYSTONE)
- **T4.1** Emit `proposal.v0_requested` → `fabric.handle_event` → `ProposalArchitect` per section → `section_drafter` (RFP excerpt + library atoms + tenant profile) → `publish_section_draft`. *Test: purchase → empty sections become `ai_drafted` into the framework, audited in `canvas_versions`.*
- **T4.2** Define/flag **V0.5 = framework-ready** (expert/manager-approved templates + matrix) on the card. *Test: opp flips to V0.5 on approval.*

### Phase 5 — Node-addressable atoms + recombination + search
- **T5.1** Node-addressability per D3 + fix library→canvas cast (insert from `canvas_nodes`). *Test: a single table/image node lifts into another proposal as a real node.*
- **T5.2** Tag atoms with `Dept:Agency:Sol:Topic` + section/type/context; search all axes + copy-but-revise. *Test: find a `technical.work_plan` atom from another agency's similar RFP and reframe it.*
- **T5.3** Embeddings on + backfilled → vector ranking. *Test: semantic match beats keyword.*

### Phase 6 — Customer + collaborator libraries + V1.1 self-service
- **T6.1** Customer library = own + shared templates + scratch; **collaborator** discrete partition (per D2) — derivative of the customer, **assignment-locked**, create-from-template + populate-from-library + **meta-tagging**; roles: collaborators **mark complete**, admins **lock+accept**. *Test: a collaborator builds + tags a doc from their partition; locks when unassigned; admin locks it.*
- **T6.2 (V1.1)** Customer verifies recommendations / swaps template / marks a missed required doc (builds from template); self-service portal purchase. *Test: customer self-adds a required doc without admin.*
- **T6.3** Recursive **approval disclosure** (`library_unit_shares` per-proposal; names-only until approved) at `us◁customer◁collaborator`; **content-availability checks per section → ToDos** for V0/V0.5/V1; god-view-no-backward-copy enforced. *Test: up-tier sees only names until approve; an empty section spawns an upload ToDo; no content reaches the platform partition.*

### Phase 7 — Skeleton flywheel  ⏸️ **HELD (policy-gated)**
- **T7.1** Skeleton extractor → taxonomy-normalized, content-free `document_templates`. *Test: zero verbatim content.*
- **T7.2** Customer's own skeletons as templates (their reuse).
- **T7.3** (consent + policy) cross-tenant promotion + synthetic fill.

---

## PART IV — Invariants (guardrails)
1. **Our platform library is never visible to any customer.** Customers see a **mirror card** only after push+rank; **pin/purchase** copies docs into *their* tenant.
2. **Tenant content never crosses tenants.** Shared artifacts derive only from taxonomy-normalized skeletons + synthetic fill (Phase 7, held).
3. **God view ≠ copy; partitions never merge upward.** Platform reads all (support/QA) but **never copies tenant/collaborator content into the platform partition** — only approved skeletons move up (§9, held). Customer admin sees all of theirs + **collaborator content approved for the specific proposal**; collaborators are **discrete + assignment-locked** (no cross-collaborator contamination). Visibility is recursive draft→approved; content flows up only by approval, never auto-copy.
4. **One opportunity = one submittable.** Hierarchy associates; never bundles. **No solicitation ⇒ provisional ⇒ not purchasable.**
5. **Same architecture everywhere:** upload-card → atoms (node-addressable) → canvas → collaborate → generate → convert → download. Collaborators/employees **mark complete**; admins **lock + accept**.
6. **Source anchoring is the audit spine** — every matrix entry and drafted section traces to its origin.
7. **Master holds truth; mirrors are derived** — updates flow master → mirror → rerank/alert.
