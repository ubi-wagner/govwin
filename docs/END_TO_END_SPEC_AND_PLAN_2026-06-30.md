# RFP Pipeline — End-to-End Spec & Implementation Plan

**Date:** 2026-06-30
**Status:** Authoritative model + plan. Synthesizes the eleven grounded investigations and the two companion analyses (`DOC_ANNOTATION_ATOM_GAP_ANALYSIS_2026-06-30.md`, `END_TO_END_SPINE_ANALYSIS_2026-06-30.md`). Every "as-built" claim is grounded; every extension is marked; held items are gated.

> **Ground rules.** (1) No assumptions — as-built = verified in code; extensions = labeled NEW; mappings/decisions = labeled DECISION. (2) Some `docs/V1_*` gap lists are stale (pre-R5); code is truth. (3) The skeleton-extraction / cross-tenant transfer is **HELD** pending the published content-use policy — documented here only so we don't violate it.

---

## PART I — THE MODEL

### 1. Core unit: one opportunity = one submittable proposal
An **opportunity** is exactly one unique submittable proposal, located in the hierarchy **Department : Service-Org : Solicitation : Topic**. We do **not** bundle multiple topics into one card. *(Aligns with as-built: `opportunities` are per-topic with `agency`/`office`/`program_type` + `solicitation_id`.)*

- **RFP = master record** → `curated_solicitations` (`namespace` = `{agency}:{program_office}:{type}:{phase}`).
- **Topic / area of interest = the submittable** → `opportunities` (`solicitation_id`, `topic_number`, `topic_branch`, `tech_focus_areas`).
- The **opportunity card** is the spine's **read-model**: it carries **summary + aggregated compliance matrix + recommended/attached template(s) + expert artifacts/notes + readiness**. *(As-built: spotlight detail already renders the matrix + bucket-fit + Build-Proposal; summary + template slot + readiness are the additions.)*

### 2. The compliance matrix = a 4-level aggregation with precedence  *(EXTENSION)*
The matrix is the **union** of requirements at four levels, with **conflicts resolved by precedence (most-specific wins):**

```
Topic  ▷ overrides ▷  Solicitation  ▷ overrides ▷  Service-Org  ▷ overrides ▷  Department
(opportunity)         (curated_solicitations)      (program_office)            (agency)
```
- **As-built:** compliance merges **topic → solicitation-baseline → hardcoded defaults** (`compliance-resolver.ts`); rules live in `solicitation_compliance` (named columns + `custom_variables`).
- **NEW:** add **Service-Org and Department level rule sets** keyed by the namespace prefix (agency / agency:office), merged beneath topic+solicitation. This is what makes "assisted mapping of future similar solicitations" work — a new USAF SBIR round inherits the agency/office layer automatically.
- **Component axis (NEW):** the matrix also aggregates **service/unit/offering** requirements (a third source beside solicitation+topic) — e.g. a product/service-specific submission rule.

### 3. Source anchoring = audit + future reuse  *(PARTIAL → first-class)*
Every compliance-matrix entry the RFP admin builds on ingest **anchors the page(s) + text** it came from.
- **As-built:** `compliance.save_variable_value` already stores `source_excerpt` + `anchor`; `SourceAnchor`/`AnchorRect` (% page coords) exists; the PDF viewer computes rects from selection.
- **NEW:** make the anchor a **first-class, reviewable, reusable** record per matrix entry → (a) audit back-reference on the proposal, (b) seed for future-similar mapping at the Service-Org/Department level. Default boundary when a doc has no structure = **PDF section breaks / headers** (manual visual anchoring is always available).

### 4. Three RFP-Pipeline upload surfaces (one intake architecture)
All three feed the **same unified pipeline: upload-card → atoms → canvas → (collaborate) → generate → convert → download.**

| Surface | Purpose | As-built | Extension |
|---|---|---|---|
| **(a) RFP ingestion** | source docs → shred → topics → matrix + card | 🟢 shred + AI extraction + topics + matrix; 🟡 anchoring | NEW: 4-level hierarchy compliance, first-class anchoring, card auto-create on "new" |
| **(b) Admin materials** | templates/reference tied to Dept/Agency/Org/Solicitation (from old or public sources) | 🟢 atomization exists | NEW: an **admin/global "RFP-Pipeline library"** scope (today `library_units.tenant_id` is NOT NULL → needs a reserved platform tenant or nullable+scope) |
| **(c) CMS dropbox** | resources/announcements/agency & solicitation info, each with a **context prompt** ("AFWERX announcement re: upcoming solicitation") | ⚪ MISSING (CMS now in Pipeline) | NEW: a simple context-tagged dropbox feeding **manual scouting, spotlight-bucket nudges, and marcom/resource context** |

### 5. Opportunity push = on create AND on any update
- When a new opportunity is ingested and marked **new**, the **card is auto-created + populated**, carried forward as info accrues.
- **Any** new opp **or update** to its card (uploaded docs, pre-selected/pre-built skeletons, expert artifacts/notes) **triggers a push across all client bridges** → each tenant's **spotlight buckets re-run their analysis** (per-instance rankers). **All customers are pushed to (for now).** *(As-built: `solicitation.push` → `OnSolicitationPushed` → `match_tenants` → `tenant_pipeline_items` + `spotlight_bucket_scores`. EXTENSION: fire on card update too, not just initial push.)*

### 6. Customer side (post-purchase)
On purchase the customer has: baseline matrix + selected solicitation/topic + matrix & template built on ingest + expert/manager-approved artifact templates (**V0.5 = framework-ready**), and their **uploaded initial artifacts** (company + per-bucket; some may be prior proposals).
- **V0** = the **strawman drafted into that framework** from 3 sources (RFP excerpt + the customer's library atoms + tenant profile). *(KEYSTONE — `publish_section_draft` built, caller missing.)*
- **Customer library = theirs alone**, plus **templates we've shared** + **create-from-scratch**, 100% on the canvas/atom framework.
- **Collaborators can meta-tag uploads** to mark relevant sections for the agent teams.
- **Atoms are searchable by `Department-Agency-Solicitation-Topic` + section/type/context + copy-but-revise** — letting customers/agents **reframe atoms of one solicitation into sections of another.**

### 7. Atom granularity = node level  *(EXTENSION)*
To recombine freely, an **atom must be addressable at the node level** ("a single discrete thing" — one `CanvasNode`). *(As-built: atomization currently mints **section-level** atoms carrying a `canvas_nodes[]` array. EXTENSION: make atoms addressable/groupable at the node level so any single node can be lifted into another proposal.)*

### 8. The privacy boundary + skeleton flywheel  *(HELD — do not build yet)*
Two loops separated by an airtight boundary:
- **Private content loop** (per tenant): harvest → `library_units` → AI-assist-for-*their*-win. **Never shared.**
- **Shared skeleton loop** (cross tenant, HELD): extract **structure only** — expressed in the **`section_standards` taxonomy + format spec**, never verbatim text/headings — → shared `document_templates`, filled with **synthetic example content**. Gated on the published content-use policy; cross-tenant transfer requires consent.
- **The expert may, at portal purchase, review the customer's library and extract a skeleton-as-template** for that customer and (held) for the Dept:Agency:Sol:Topic transfer. **Capture the customer's own skeletons for their own reuse now; cross-tenant sharing is held.**

---

## PART II — AS-BUILT MAPPING (grounded; see companion docs for citations)

| Capability | State |
|---|---|
| RFP shred → text/sections → AI compliance matrix | 🟢 EXISTS |
| Topic association (multi-topic BAA, tranched/multi-year) | 🟢 EXISTS (`opportunities.solicitation_id`, `bulk_add_topics`) |
| Admin matrix authoring + audit (`curation_revisions`, episodic memory) | 🟢 EXISTS |
| Source anchoring on matrix entries | 🟡 PARTIAL (`anchor`/`source_excerpt` stored; not first-class/reused) |
| 4-level (Dept/Service-Org) compliance precedence | 🔴 NEW (today topic→solicitation→default) |
| Solicitation **summary** authoring | 🔴 MISSING |
| Admin materials → library atomization | 🟢 EXISTS (tenant-scoped) |
| Admin/global RFP-Pipeline library scope | 🔴 NEW (`library_units.tenant_id` NOT NULL) |
| CMS context dropbox (resources/announcements) | 🔴 MISSING |
| Opportunity card auto-create on "new" + carry-forward | 🟡 PARTIAL (spotlight detail is the de-facto card) |
| Push on create | 🟢 EXISTS; **push on update** 🔴 NEW |
| Spotlight per-instance ranking + buckets (C5) | 🟢 EXISTS |
| Purchase → 72-hr `ProjectCollaboration` gate | 🟢 EXISTS |
| Proposal/section creation from volumes + template seed | 🟢 EXISTS |
| **V0 strawman (3-source) generation** | 🔴 CALLERLESS (keystone) |
| V0.5 = framework-ready pre-purchase | ⚪ define (this doc) |
| Collaboration, tasks, locks, harvest, outcome scoring | 🟢 BUILT (R5) |
| Library → canvas insertion | 🟡 PARTIAL (text-only cast drops structure) |
| Node-level atom granularity | 🔴 NEW (section-level today) |
| Atom search by Dept:Agency:Sol:Topic + section/type | 🟡 PARTIAL (tags/`section_type`/`subcategory` exist; hierarchy tagging NEW) |
| Customer library = own + shared templates + scratch | 🟡 PARTIAL (own library + Template Studio exist; sharing held) |
| Collaborator meta-tagging of uploads | 🔴 NEW |
| Embeddings on + populated | 🔴 NEW (infra exists, off) |
| Skeleton extraction + cross-tenant transfer | ⏸️ HELD (policy-gated) |

---

## PART III — IMPLEMENTATION PLAN (build-test-build)

> Sequenced so each phase ships + tests independently. The keystone (V0 strawman) is pulled early because the whole flywheel pays off only once generation runs.

### Phase 0 — Lock the decisions (no code)
- **D1** Hierarchy mapping: confirm Department=agency, Service-Org=program_office; compliance precedence Topic>Solicitation>Service-Org>Department; add the component/offering axis.
- **D2** Global library scope: reserved "RFP-Pipeline" platform tenant **vs** `library_units.tenant_id` nullable + `scope` column.
- **D3** Atom granularity: node-level atoms (one `CanvasNode` = one addressable atom) — store node-atoms or make section-atoms decomposable.
- **D4** Privacy boundary (for the HELD phase): skeleton = taxonomy-normalized structure + format spec only; cross-tenant gated on content-use policy + consent.
- **D5** Push-on-update scope: all tenants for now; debounce/batch updates.
*Test: decisions recorded here.*

### Phase 1 — Unified upload-card intake + the three surfaces
- **T1.1** A single **upload-card** component + intake (context prompt + classification) reused by all surfaces. *Test: upload routes to the right pipeline by surface.*
- **T1.2 (a)** Ingestion: first-class **source anchoring** per matrix entry (persist + render overlay; default to PDF section/header boundaries). *Test: an anchored matrix entry deep-links to its page/rects.*
- **T1.3 (b)** Admin/global **RFP-Pipeline library** (per D2) — admin materials atomized + tagged to Dept:Agency:Org:Solicitation. *Test: an admin-uploaded reference atom is searchable by hierarchy, no tenant leak.*
- **T1.4 (c)** **CMS context dropbox** — file + context prompt → tagged record feeding scouting/spotlight-nudge/marcom. *Test: an "AFWERX announcement" upload appears as a scouting/nudge signal.*

### Phase 2 — 4-level matrix + opportunity card read-model
- **T2.1** Service-Org + Department compliance rule sets keyed by namespace prefix; extend `compliance-resolver` to the 4-level merge (+ component axis). *Test: a topic with no rule inherits office→agency; a topic override wins.*
- **T2.2** Solicitation **summary** authoring (`curated_solicitations.summary` + structured highlights). *Test: summary persists + renders on the card.*
- **T2.3** **Opportunity card** = summary + aggregated matrix + recommended/attached template(s) + expert artifacts/notes + **readiness** flag. *Test: card shows all five; "framework ready" when V0.5 done.*

### Phase 3 — Push-on-update
- **T3.1** Fire the spotlight re-score on opp **create OR card update** (docs/skeletons/artifacts/notes), all tenants, debounced. *Test: editing a card re-ranks tenants' buckets.*

### Phase 4 — V0 strawman (KEYSTONE)
- **T4.1** Emit `proposal.v0_requested` (on `proposal.created` or 72-hr-gate release); invoke `fabric.handle_event` → `ProposalArchitect` per section → `section_drafter` (RFP excerpt + library atoms via `library/similar` + tenant profile) → `publish_section_draft`. *Test: purchase → empty sections become `ai_drafted` into the framework, audited in `canvas_versions`.*
- **T4.2** Define **V0.5** = framework-ready pre-purchase (expert/manager-approved templates + matrix), surfaced as card readiness. *Test: an opp flips to V0.5 when approved.*

### Phase 5 — Node-level atoms + recombination + search
- **T5.1** Node-level atom addressability (per D3) + fix the **library→canvas cast** (insert from `canvas_nodes`, not text). *Test: a single table/image node lifts from one proposal into another as a real node.*
- **T5.2** Tag atoms with the **Dept:Agency:Sol:Topic** hierarchy + section/type/context; search across all axes + copy-but-revise. *Test: find a "technical.work_plan" atom from a different agency's similar RFP and reframe it.*
- **T5.3** Turn on + backfill **embeddings** → vector ranking. *Test: semantic match beats keyword-only.*

### Phase 6 — Customer library + V1.1 self-service
- **T6.1** Customer library = own atoms + **shared templates** + **create-from-scratch**; collaborator **meta-tagging** of uploads. *Test: a collaborator tags an upload; agents see the marks.*
- **T6.2 (V1.1)** Customer can **verify recommendations / swap template / mark a missed required doc** (build it from a template); self-service portal purchase ("full freight"). *Test: customer adds a required doc + builds from template without admin.*

### Phase 7 — Skeleton flywheel  ⏸️ **HELD (policy-gated)**
- **T7.1** Skeleton extractor: proposal/library doc → **taxonomy-normalized structure + format spec**, content-free → `document_templates`. *Test: extracted template has zero verbatim content.*
- **T7.2** Customer's own skeletons available as templates (low-risk, their reuse).
- **T7.3** (gated on content-use policy + consent) cross-tenant promotion + synthetic example fill.

---

## PART IV — Invariants (guardrails)
1. **Tenant content never crosses tenants.** Shared artifacts derive only from taxonomy-normalized skeletons + synthetic fill (Phase 7, held).
2. **Agents and customers are bound to atoms** — they may create/refactor/revector/reformat/reframe atoms, but every atom carries provenance (`library_unit_id`, `source_anchor`, Dept:Agency:Sol:Topic) for audit.
3. **One opportunity = one submittable.** Hierarchy associates; it never bundles.
4. **Everything is the same architecture:** upload-card → atoms (node-level) → canvas → collaborate → generate → convert → download — admin and customer alike.
5. **Source anchoring is the audit spine** — every matrix entry and drafted section traces to its origin.
