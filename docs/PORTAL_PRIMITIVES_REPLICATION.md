# Portal Primitives — One Spine, Many Portals

**Status:** design analysis (as-built spine + forward replication plan).
**Date:** 2026-07-16.
**Thesis (founder, concurred):** the *same four primitives* — **library + atoms**,
**canvas-template-mold**, **card + workflow + collaboration + automation**, all over
**tenant-isolated RLS** — compose to make every portal the platform will sell. The
proposal portal is the reference implementation. A **project-management portal** and a
**customer MARCOM/CRM portal** are the *same spine* with a different card source, a
different mold vocabulary, and different automation producers. Nothing in the spine is
proposal-shaped by necessity; the few places that are proposal-*coupled* today are
enumerated in §6 as the generalization delta.

Canonical companions: `ARCHITECTURE_V10.md` (as-built spine), `docs/MASTER_MIRROR_OPP_DESIGN.md`
(opp → purchase → curation → proposal), `docs/CANVAS_DOCUMENT_ARCHITECTURE.md` (mold),
`docs/CRM_CMS_PHASE1.md` (the CMS/CRM engine), `docs/AGENT_FABRIC_DESIGN.md` (workforce),
`docs/AUTOMATION_DESIGN.md` (events/rules).

---

## 1. The four primitives

| # | Primitive | What it is | Where it lives (as-built) |
|---|-----------|-----------|---------------------------|
| **P1** | **Library + Atoms** | A tenant's reusable content universe: meta-tagged atoms with lineage, indexed by a program-aware Dewey taxonomy, bound into "cocoons" (foundational documents). | `db/migrations/101_unified_library_taxonomy.sql`: `library_atoms`, `atom_tags`, `atom_lineage`, `atom_members`, `document_cocoons`, `taxonomy_terms`. Code: `frontend/lib/atoms.ts`, `frontend/lib/proposal-atom-harvest.ts`. |
| **P2** | **Canvas-template-mold** | One document model (`CanvasDocument`) that is authored, molded from a template/skeleton, drafted (manual or AI), locked, and exported to any format. | `frontend/lib/types/canvas-document.ts` (`CanvasDocument`/`CanvasNode`); `frontend/lib/export/{docx,pptx,xlsx,pdf}-exporter.ts` + `artifact-export.ts`; `document_templates` (defined mig 017, expert-editable via Template Studio mig 086); section molds carry `section_type` + budget. |
| **P3** | **Card + Workflow + Collaboration + Automation** | A ranked work-item card, a workflow that advances it, scoped multi-party collaboration, and event-driven automation. | Cards/bridge/buckets (mig 088/094+): `tenant_opportunity_cards`, `opportunity_bridge`, `tenant_spotlight_buckets`, `tenant_bucket_scores`. Workflow: `process_instances`/`process_definitions` (pipeline). Workforce: `AgentFabric` + `agent_task_queue`. Collab: `proposal_collaborators`, `collaborator_stage_access`, `shadow_admin_grants`. Automation bridge: `system_events` + `automation_rules` (CMS). |
| **P0** | **Tenant isolation (the substrate)** | Every row above is tenant-scoped; RLS + explicit `tenant_id` predicates + a 4-way atom `visibility` enforce it. | `frontend/lib/rls.ts::withTenant` (sets `app.tenant_id` GUC), the `govtech_app` non-owner role, `library_atoms.visibility ∈ (tenant, owner_only, shared_for_proposal, admin_only)`. |

These are not four subsystems bolted together — they interlock. An **atom** (P1) is a
**canvas fragment** (P2). A **mold** (P2) is drafted by grounding on **selected atoms**
(P1), advanced by a **workflow** (P3), and on lock **harvests back into the library**
(P1) — the virtuous loop. The **card** (P3) is what a customer buys and what a portal
opens onto.

---

## 2. The shared spine, in detail (portal-neutral today)

### P1 — Library + Atoms (the Dewey engine)
- **`taxonomy_terms`** — ONE curated vocabulary across ten dimensions:
  `vol | kind | grain | fmt | dept | agency | program | phase | party_role | access`.
  Program-aware (SBIR/STTR/OTA/CSO/BAA) with an **`other` escape in every dimension** —
  so a new portal can start tagging *without a schema change* and promote hot `other`
  values into curated vocab later.
- **Two orthogonal tag axes** (both stamped by the real harvest path,
  `proposal-atom-harvest.ts`): **content-class** (`kind` + `vol`) and **source-context**
  (`agency`/`program`/`phase` + open `sol`/`topic`). The context axis feeds the
  `ctxMatches` overlap score in the selection query (`lib/atoms.ts`, dimensions
  `agency/program/phase/tech/dept`), so reuse ranks by *where an atom came from*, not just
  *what it is*. This is the AFWERX→Navy reuse pivot, and it is portal-agnostic.
- **`library_atoms.grain ∈ (primitive, group, reference)`** — a selectable primitive, an
  ordered aggregate (`atom_members`), or a whole source document. `selectForSection`
  excludes `reference`; primitives and groups are moldable.
- **`document_cocoons` (scope `section|document`)** — the "foundational document." Any
  locked artifact becomes a cocoon whose sections are seminal atoms with lineage
  (`atom_lineage`: `derived_from` / `reused_from`).
- **`visibility`** — 4-way, RLS-enforced. `tenant` is the shared library; `owner_only`
  private; `admin_only` the RFP-admin/system library; `shared_for_proposal` a per-work
  share (proposal-coupled name — see §6).

### P2 — Canvas-template-mold
- **`CanvasDocument`** is format-carrying: `letter` / `slide_16_9` / `spreadsheet`, with
  header/footer (`template` field, `{n}`/`{N}`), `NodeStyle` (color/bold/italic),
  `inline_formats`, tables, lists, images (incl. inline SVG). One model → **every**
  exporter.
- **Exporters** are pure transforms of that model: `docx`, `pptx`, `xlsx` (pure Node),
  `pdf` (canvas→HTML→Chromium). `artifact-export.ts` assembles an artifact's locked
  sections into one canvas and picks the format. **Format-agnostic and portal-agnostic** —
  a marketing flyer, a project SOW, and a proposal volume all export through the same code.
- **Molds** = a skeleton section (`section_type` + a size budget) plus an optional
  `document_templates` row. Drafting fills a mold; the mold constrains size/shape.
- **`document_templates`** (defined mig 017, expert-editable via Template Studio mig 086;
  columns include `template_type` / `agency` / `program_type` / `is_system`) is where
  **marketing collateral templates** live today (per CLAUDE.md's content-class/marketing
  split: marketing = templates, *not* atoms). This is already the second portal's mold
  library in embryo.

### P3 — Card + Workflow + Collaboration + Automation
- **Card**: a denormalized, ranked work-item row (`tenant_opportunity_cards`), fanned from a
  forward-only bridge (`opportunity_bridge`), scored into buckets on arrival
  (`tenant_spotlight_buckets`/`tenant_bucket_scores`). The customer surface (`/cards`) opens
  onto cards. **The card is the portal's front door.**
- **Workflow**: `process_definitions` → `process_instances` carrying an entity id
  (`opportunity_id` today), a live Python engine, HITL pause/resume.
- **Workforce**: `AgentFabric` (10 archetypes; `section_drafter` live end-to-end,
  `compliance_reviewer` inline, `color_team_reviewer` via the queue, ~7 dormant), fed by
  `agent_task_queue`.
- **Collaboration**: identity is **email-alone** (one login/home-company/global-role);
  cross-company work is granted per-work via `proposal_collaborators` (UNIQUE(work, email),
  nullable user_id) + `collaborator_stage_access` (stage-scoped) + `shadow_admin_grants`
  (RFP-engine/econ-dev shadow access). See `docs/IDENTITY_AUTHZ_MODEL.md`. **This grant
  model is entirely work-type-neutral.**
- **Automation**: the frontend writes `system_events`; the CMS engine polls them against
  `automation_rules` and executes (email/content/social/campaign). The bridge is a table,
  not a portal assumption.

### P0 — Tenant isolation
`withTenant(tenantId, fn)` sets `app.tenant_id` (SET LOCAL) so RLS policies scope every
statement; explicit `tenant_id = …` predicates are the belt to that suspenders. Same in
every portal — a portal is not a security boundary; the **tenant** is.

---

## 3. The proposal portal = the reference composition

```
BUY        comp-code purchase pins a card (P3) → proposal_portal (curation_pending)
RELEASE    RFP admin releases from the shadow account → provision UNLOCKED
MOLD       matrix + volumes + artifacts + section molds (P2) instantiated from the master
DRAFT      each mold drafted — AI (section_drafter, P3) grounded on selected atoms (P1),
           or by hand — styled on a CanvasDocument (P2)
LOCK       lockSectionCore: CAS lock → section.locked event → compliance matrix satisfied →
           canvas snapshot → HARVEST to library (P1) → artifact/volume/proposal roll-up
LIBRARY    each locked section returns as a seminal PRIMITIVE atom, dual-axis tagged;
           the locked document becomes a cocoon (a new foundational doc)
EXPORT     artifact-export assembles locked sections (P2) → docx/pptx/xlsx/pdf
```

Verified end-to-end in `frontend/scripts/usaf-cso-e2e.mts` and the sample deliverables in
`docs/sample-proposal/`. **Read the loop above with the primitive letters removed and it is
just: open a card, mold work-products, collaborate, draft from the library, lock, harvest,
ship. That sentence has nothing to do with proposals.**

---

## 4. Replication — one spine, three portals

| Spine element | Proposal portal (LIVE) | Project-management portal (future) | MARCOM / CRM portal (future) |
|---|---|---|---|
| **Card (P3)** | Opportunity card, ranked by spotlight buckets | Project / task / milestone card, ranked by due-date/priority | Campaign / lead / content card, ranked by stage/score |
| **Card source** | Bridge fan-out from master OPP | Project created by tenant/PM | Lead captured / campaign scheduled (CMS already does this) |
| **Mold vocab (P2)** | `vol`: problem/objectives/SOW/… (SBIR volumes) | `vol`: charter/SOW-task/deliverable/status-report | `vol`: flyer/email/landing-block/case-study (⟵ `document_templates` marketing index already exists) |
| **Atom kinds (P1)** | `kind`: narrative/bio/table | `kind`: task-spec/acceptance-criteria/risk | `kind`: headline/CTA/testimonial/boilerplate |
| **Context tags (P1)** | agency/program/phase/sol/topic | client/program/phase/contract | segment/persona/channel/campaign |
| **Workflow (P3)** | provision→draft→review→advance | backlog→in-progress→review→done | draft→approve→schedule→publish |
| **Workforce (P3)** | section_drafter, compliance_reviewer, color_team | project_manager, status_summarizer (dormant archetypes) | content_writer, social_poster (CMS engine, live) |
| **Automation (P3)** | agent_task_queue + events | task SLA/reminder events | drip/campaign executor (CMS, live) |
| **Collaboration (P3)** | proposal_collaborators + stage access + shadow | same grants, keyed to project | same grants, keyed to campaign/account |
| **Export (P2)** | docx/pptx/xlsx/pdf | same exporters (status PDF, SOW docx) | same exporters (flyer PDF, email HTML) |
| **Lock→harvest (P1)** | section → seminal atom + cocoon | deliverable → reusable work-product atom | collateral → reusable marketing atom |
| **Isolation (P0)** | RLS/withTenant | identical | identical |

The columns differ only in **vocabulary and producers**. Every *row* is the same code.
The MARCOM column is the closest to shipping because the **CMS/CRM engine already exists**
(`services/cms/`, `docs/CRM_CMS_PHASE1.md`): email, content pipeline, social, campaigns,
page-block editor, its own `govtech_cms` DB, bridged by `system_events`. The delta there is
not "build a portal" — it is "route the CMS content pipeline through P1/P2" so marketing
collateral flows the same atomize→mold→draft→lock→harvest loop instead of a parallel one.

---

## 5. The invariants that make replication safe

1. **The tenant is the boundary, not the portal.** Add a portal → no new isolation model;
   `withTenant` + `tenant_id` predicates already scope everything.
2. **The `other` escape means no schema migration to begin a new portal's taxonomy.** A
   project portal can stamp `vol:deliverable` / `kind:acceptance_criteria` as `is_other`
   on day one and curate them into `taxonomy_terms` once they prove out.
3. **Any locked artifact is a foundational document.** The cocoon + harvest loop is not
   proposal logic — it is "when a thing is finished, its parts become reusable, with
   lineage." A marketing flyer with nothing to do with a proposal still deposits its own
   atoms + lineage on lock. (Founder's explicit requirement.)
4. **One document model, N exporters.** No portal needs its own renderer.
5. **Events are namespaced, not portal-coded.** `finder/capture/identity/proposal/library/
   system/tool` today; a new portal adds `project` / `marcom` (never `admin`/`cms`/
   `spotlight`). The bridge (`system_events`/`automation_rules`) is shared plumbing.

---

## 6. The generalization delta (the "clean up")

The spine is portal-neutral in shape; these are the *named couplings* to widen so
replication is real, not aspirational. None is load-bearing enough to block the thesis;
each is a rename/relax, not a redesign.

| Coupling (today) | Where | Generalization |
|---|---|---|
| `document_cocoons.origin_proposal_id`, `library_atoms.origin_proposal_id` / `origin_section_id` | mig 101 | Add a polymorphic origin (`origin_kind` + `origin_id`) or per-portal nullable FKs. Atoms already carry `cocoon_id` + lineage, so origin is provenance, not a hard dependency — a low-risk additive migration. |
| `visibility = 'shared_for_proposal'` | mig 101 CHECK | Rename to `shared_for_work` (or add `shared_for_project`/`shared_for_campaign`); the enforcement logic is scope-generic. |
| `vol` / `kind` vocab is SBIR-flavored | `taxonomy_terms` seeds | Additive seeds per portal; `other` escape means zero-migration start. |
| `proposal_collaborators` / `collaborator_stage_access` named for proposals | identity model | The grant semantics (email+work UNIQUE, stage scope, shadow) are work-type-neutral; generalize to `work_collaborators` or add sibling tables keyed to project/campaign. |
| `process_instances.opportunity_id` | workflow | Already migrating toward `opportunity_id` as the spine key (mig 088); widen to a generic `subject_kind`/`subject_id` for non-opportunity workflows. |
| Card spine is opportunity-shaped (`tenant_opportunity_cards`, spotlight buckets) | mig 088/094 | Each portal gets its own card table + ranking, or a generic `tenant_cards` with a `card_kind`; the fan-out/scoring pattern is reused, not rewritten. |
| ~7 dormant `AgentFabric` archetypes have no producer | agent fabric | Wiring, not schema — a project/MARCOM portal is where several of them (`project_manager`, `content_writer`) find their producer. |

**Recommended sequencing:** (a) widen `origin_*` + `visibility` names additively (one
migration, no behavior change); (b) generalize the collaborator/workflow subject keys; (c)
route the **existing** CMS content pipeline through P1/P2 to ship the MARCOM portal first
(least new code — the engine exists); (d) add the project portal's card table + dormant
archetype producers.

---

## 7. Bottom line

The platform already *is* the general engine; the proposal portal is the first skin on it.
The library, the atoms and their Dewey tags, the canvas-mold-export model, and the
card-workflow-collaboration-automation loop are the product — and they are one spine. The
next two portals are **new vocabulary and new producers over the same tables and the same
code**, plus a short list of additive renames to shed the proposal-specific coupling. That
is the whole concur: build once, skin thrice.
