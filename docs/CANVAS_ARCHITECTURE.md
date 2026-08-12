# CANVAS_ARCHITECTURE.md — the common canvas: as-is map + gap register

**Phase-1 deliverable of the Common-Canvas redesign (2026-08-09).** The verified as-is understanding of
every interaction with the canvas — ingestion → deconstruction → `library_atoms` → the canvas editor →
export — across all actors, agents, and automation. This is baseline memory; it grows with the system.

- **Verification:** every load-bearing claim below was confirmed against code (`file:line`) or the live DB by
  hand — mapped by six parallel read agents, then personally re-verified. Claims marked **✓** were re-checked
  directly this pass.
- **Agreed target** (for Phases 2–4): **async-collaborative, real-time-ready** (presence · section ownership ·
  comments · suggestions/track-changes · "who's here", built on today's versioning, data model designed so live
  co-editing can drop in later); **balanced** admin + tenant human lens; **Google-Docs/M365 stickiness**.
- **Companions:** `docs/DATA_FLOW.md` (UI→DB spine), `docs/CANVAS_DOCUMENT_ARCHITECTURE.md` (node model),
  `docs/AGENT_WORKFORCE.md`, `docs/FULL_DRAFT_LANDING_DESIGN.md`, `/admin/architecture` explorer.

---

## 0. Thesis

The **Canvas is one React shell** (`components/canvas/CanvasEditorPage` → `CanvasEditor`) over **one JSON
document type** (`CanvasDocument`, `frontend/lib/types/canvas-document.ts`), mounted in **three modes** that
differ only in storage target, capability mask, and save/export routes. It is the intended universal surface
for every artifact — proposal volumes/sections, standalone letters/flyers/decks, and library foundations. It
is fed by an **ingest → deconstruct → `library_atoms`** pipeline and rendered out to **docx / pptx / xlsx /
pdf** (html is an internal render only). The architecture is strong; the **human experience is uneven** — the
gap register (§6) is the redesign fuel.

---

## 1. The canvas core — one shell, one model, three modes

### 1.1 `CanvasDocument` model (`lib/types/canvas-document.ts`)
- `CanvasDocument` `:486-500`: `{version:1|2, document_id, canvas:CanvasRules, nodes:CanvasNode[], sections?, metadata}`. **v1 flat `nodes[]` is canonical**; v2 adds a section layer but the editor **always flattens v2→v1 to edit** (`toEditableFlat:734`), so section/group layout intent (keep_together/page_budget/pinned) is invisible in the editor.
- `CanvasRules` `:30-49` (the frame: format/size/margins/header/footer/font/max_pages) vs **`ComplianceSpec`** `:58-66` (the enforceable contract: max_pages/min_font_size/images_allowed/required_sections/header_required — frozen onto `proposal_artifacts.compliance_spec` at purchase).
- `NodeType` `:130-153`: **11 base** (heading, text_block, bulleted/numbered_list, image, table, caption, footnote, toc, page_break, url, spacer) + **10 extended** (shape, text_box, callout, code_block, blockquote, chart, equation, divider, video, signature). `CanvasNode` `:398-417` carries `provenance`, `history:NodeEdit[]`, `comments?` (the typed field is **unused** — see G5), `library_eligible`.
- `CANVAS_PRESETS` `:69-126` (letter_standard, letter_sbir_phase1 max15, phase2 max30, slide_cso, spreadsheet). `createEmptyCanvas` always emits `version:1`.

### 1.2 The three modes
| | **SECTION** | **DOCUMENT** | **FOUNDATION** |
|---|---|---|---|
| Mount | `proposals/[p]/sections/[s]` | `documents/[d]` | `library/foundation/[f]` |
| Storage | `proposal_sections.content` = **TEXT/JSON-string** ✓ (mig 071; live DB confirms `content=text`) | `tenant_documents.canvas` = **JSONB** | `library_atoms.canvas_nodes` = **JSONB** |
| History | `canvas_versions` snapshots | **none** | **none** (no `version` field at all) |
| Lock | per-section `is_locked` (Accept & Lock) | whole-doc `status='final'` | none |
| Concurrency | baseVersion CAS → 409 | baseVersion CAS → 409 | none |
| Caps | `resolveCanvasCapabilities` (full role×stage×perm) | `resolveDocumentCapabilities` (masks lock/comment/atomize/draftAI/annotate) | same masked set |
- **Same shell, three different durability/collab contracts** — the central inconsistency (G6).

### 1.3 Edit ergonomics (`components/canvas/*`, `lib/canvas/*`)
- Ribbon (SECTION only, `section-top-ribbon.tsx`): breadcrumb + chips (version, page-budget est/alloc, status, 🔒, compliance) + Undo/Redo w/ history-trail + Save + Accept&Lock (admin) + Export dropdown + panel toggle. DOCUMENT/FOUNDATION get a minimal back/title bar.
- Toolbar (`canvas-toolbar.tsx`): insert nodes; **all formatting is block-level** (whole node) — `TextBlockContent.inline_formats` exists in the type but the toolbar writes only `node.style` (no inline-range formatting).
- Right sidebar tabs: compliance · node · add · review · history · settings. Node tab = `AIRevisionPanel`; Review = comments; History = version list.
- Undo/redo: client-only stacks, cap 50, Ctrl/Cmd+Z; **no Ctrl+S; no autosave** (G4); `beforeunload` guards dirty.

### 1.4 Versioning + concurrency (the collab substrate)
- **`canvas_versions`** keyed on `section_id` ONLY (documents/foundations have no history). Invariant `proposal_sections.version > MAX(version_number)`: writers snapshot prior content at the live version, then advance the counter (CAS). Writers: section-save, `lock-section.ts`, `land-revisions`, `proposal-advance.ts`, `seed-job/apply`.
- **Section save** (`sections/[s]/save/route.ts`): archive prior content → CAS `WHERE version=${baseVersion}` → **409 CONFLICT + currentVersion** if someone saved first. Client UX = *"changed by someone else… Reload before saving"* — **lock-and-reload, no merge, unsaved edits lost** (G1).
- **No realtime, no presence.** ✓ No websocket/CRDT/yjs anywhere; `editing_by/editing_since` columns exist (mig 044, live DB confirms `editing_by uuid`) but are **only ever set to NULL** — presence is unimplemented dead scaffolding.

---

## 2. Ingestion → `library_atoms`

### 2.1 Tenant side — the ONLY real "drop a file → reusable atom" path (`tenant_user`+)
- Doors (all → `createAtom` `lib/atoms.ts:67`, RLS-wrapped): **atomize-package** (auto: `document_cocoons` + whole-doc `reference` atom + per-block `primitive` atoms, tagged/pedigreed, all `status='approved'`) · **atoms/upload** (hand-shred: one `reference`, blocks returned for manual pick) · **capture** (screen regions → draft image atoms) · **create-canvas foundation** (`decomposeAndIngest` → foundation⊃section⊃group⊃primitive) · **manual** `POST /atoms`.
- Store: `library_atoms` (`tenant_id NOT NULL` + `tenant_isolation` RLS), `atom_tags` (taxonomy: vol/kind/fmt/agency/…), `atom_lineage` (derived_from/reused_from), `atom_members` (containment), `document_cocoons`. `visibility ∈ tenant|owner_only|shared_for_proposal|admin_only|vault` — **but only `tenant` and `vault` have writers**; owner_only/admin_only/shared_for_proposal are unused enums (G9).
- Derivative loop: on section-lock, `proposal-atom-harvest.ts` mints a `download_derivative` primitive with `origin_proposal_id`/lineage → feeds the seed pool + outcome learning.

### 2.2 RFP-admin side — **no ingest→atom path** ✓
- A grep for `atomize|createAtom` across `app/api/admin`+`app/admin` is **empty**. Admin ingest (RFP docs, scouts, social/content, templates, example finals) terminates in a **parallel model**: `solicitation_documents`, `curated_solicitations.ai_extracted`, `solicitation_compliance`, `solicitation_volumes`/`volume_required_items` (the proposal **molds**), `solicitation_annotations`, `scout_*`/`source_*`, `document_templates`, and the CMS. The **only** admin→atom bridge is a static seed (mig 152) of the hand-authored `starter-set.ts` into the platform tenant, which tenants **copy** on use.
- Consequence (G8): "winning final documents" and curated wins have **no admin ingest surface** — an RFP admin can seed a tenant/shared library only by **shadow-descending** into a tenant and uploading as them. Two parallel template systems (`document_templates` molds vs `system_starter` foundations) never converge.

### 2.3 Prior-proposal reuse — **two disconnected pipes** ✓ (G16)
- **Content → an opportunity build = the seed-job** (`library_seed_jobs`): suggester scans `library_atoms WHERE origin_proposal_id IS NOT NULL AND status='approved'` → admin selects → mapper → admin applies (reused atoms merge into `proposal_sections.content` as red-italic nodes). **Every seed-job route is `['master_admin','rfp_admin']`-only** ✓ — despite the panel showing for tenant_admin. And **uploaded** past proposals are invisible to it (they lack `origin_proposal_id`, which only harvest-at-lock/atomize-node set) — only platform-built-and-locked proposals feed the seed pool.
- **Structure → a template = templify** (`templates/extract`, tenant_admin+): a past-proposal cocoon → tenant `document_templates` row → but "New draft" from it seeds a **standalone `tenant_documents`** doc, NOT an opportunity build. `provisionProposalForPortal` never consults a tenant's own `document_templates` (only master `volume_required_items.template_id`/built-in). So **"save a past proposal as a template, then start your next opportunity from it" is not wired.**

### 2.4 Custom per-tenant opportunity (TVSF-style) — **no scoping mechanism** ✓ (G17)
- `stageIntake` creates `opportunities(is_active=false, source='intake:admin')` + `curated_solicitations('new')`. `solicitation.push` is `tenantScoped:false` ✓ → `fanOutBridgeEvent` loops **`tenants WHERE status IN ('active','trial')`** ✓ (no subset filter). A niche opp stays single-tenant only by **never being pushed** (the one buyer reaches it via comp-code purchase → provision). The single-tenant TVSF card (mig 140) is a seed-DB artifact, not a code path.

---

## 3. Export / download (`lib/export/`, `renderCanvas` dispatcher)

- **Per-format:** docx (`docx` npm, node-walk) · pptx (`pptxgenjs`, most native — native charts/shapes/tables, per-slide) · xlsx (`exceljs`, real formulas/number-formats, one sheet per table) · pdf (Chromium `page.pdf`, the **only true pagination**, vector figures) · **html is NOT a download** — only the PDF exporter's input.
- **Whole-proposal package** (`package/route.ts` `?format=json|docx|pdf|zip`) — **not** pptx/xlsx at whole-proposal level; `zip` is per-volume-native; sort by integer `sort_index`. Two assemblers (per-artifact `assembleArtifactCanvas` vs the package route's inline whole-proposal assembly, duplicated in `preview`).
- **Fidelity gaps (see G3/G11/G12):** uploaded (S3 `storage_key`) images **never render** in docx/pptx/xlsx ✓ (→ `[Image: alt]` stub; only inline `data:` figures render, raster for office / vector for pdf-html); docx TOC is a static heading list (not a live field); equations are raw strings; docx `url` is blue text not a hyperlink; pptx has no overflow-to-next-slide; **zip never contains PDF** despite the button label; whole-proposal export runs **no** compliance validation.

---

## 4. Actors, access & collaboration

- Roles: master(100)/rfp_admin(80)/tenant_admin(60)/partner_admin(50)/tenant_user(40)/partner_user(20). Gates: `verifyProposalAccess` (coarse) + `resolveUserAccess` (per-section) + `isTenantWideMember`.
- **Home staff edit is tenant-WIDE**, not per-section: any `tenant_user`+ edits *every* section of *every* proposal in their tenant. Section `assigned_to` is **display-only** (not consulted by any gate). Per-section scoping applies only to non-tenant-wide collaborators.
- **Sharing is coarse + admin-gated** (G9): the only way to grant a specific person a specific canvas is a `tenant_admin` inviting a `proposal_collaborators` row (email + role + **one** permission + section checkboxes); a contributor can't share; new invitees must set a password via `/invite`; **no link-share, no guest, no post-invite permission edit** (collaborators route has DELETE but **no PATCH** — `collaborator_stage_access` per-stage granularity collapses to one permission at invite). Cross-company = separate login or a **vault** (segregated library, whole-download-only for the partner).
- **Comments are real but section-level** (G5): `proposal_comments` keyed by section (not text-range/node); live in sidebar Node/Review tabs; **masked off entirely in DOCUMENT/FOUNDATION mode**; no anchored/inline comments, no @mentions, no notifications. The typed `CanvasNode.comments` and the `DiffView` component are **dead** (no writer/importer). `handleRevertNode` only appends history — it does **not** restore `previous_content`.
- **Presence:** none (§1.4). RFP-admin shadow descent = live god-view (`verifyTenantAccess` unconditional true for rfp/master); `shadow_admin_grants` is an audit record, not the gate.

---

## 5. Agents & automation on the canvas + one-off artifacts

- **Path 1 — LIVE auto-landing:** `section_drafter` via the `draft_v0` ACTION on `OnProposalCreated` writes **live** `proposal_sections.content` (+ `canvas_versions`) but **only into `empty`/`ai_drafted`** sections (never clobbers human work); a guardrail `review` verdict → section HELD.
- **Path 2 — STAGED, human-landed:** the full-draft cohort (`OnFullDraftRequested{A,B,C}`) + Proposal Studio (`OnReviewPhaseRequested{Draft,Refine,Compliance}`) run agents as AI_INVOKE steps that **stage, never persist** (`{persisted:false, source:'ai_revision', canvas}` buried in `process_instances.step_results`). The engine's no-dead-end + input-map-ancestor invariants make a pipeline step consuming that output structurally illegal, so the landing lives on the frontend: `land-revisions` scans step_results → writes **PROPOSED** `canvas_versions` rows. **But there is no restore path** ✓ (G2): the only `proposal_sections SET content` writer is provisioning; `land-revisions` only advances the counter; the versions route is GET-only. So **staged AI drafts land in history and can never be applied** — the "Apply AI-proposed revisions" button + Version-History tab are a dead-end.
- **In-editor AI** = `AIRevisionPanel` (sidebar; select node → Node tab → quick-action/prompt) via the synchronous `proposal.draft_section` frontend tool — **no inline/at-cursor/slash/ghost-text**, and **gated off for standalone docs** (G10). "Draft with AI" route just records + emits an event ("actual drafting happens client-side") ✓ (G15).
- **One-off artifacts** (letters/flyers/marketing) = DOCUMENT-mode `tenant_documents` or FOUNDATION artifacts — **the same shell with AI, comments, version-history, and review all stripped**, and **no agent ever drafts them** (the whole 36-archetype workforce is bound to `proposal_sections`); standalone-doc saves don't even snapshot versions (G7). CMS marketing is a **third, unrelated** model (`cms_posts` HTML / `content_pages` blocks / `govtech_cms` DB) — no canvas nodes, no Office exporters.
- **Doc/code drift:** `formatter.py`/`stylist.py` headers still say DORMANT but are wired LIVE (`processor.py:238-243`) (G13). `section save` discards incoming revision-source metadata → history badges mislabel as "Human Edit" (G14).

---

## 6. GAP REGISTER (verified) — the redesign fuel

Ordered by impact on the **frictionless, sticky, human** goal. ✓ = personally verified this pass.

| # | Gap | Evidence |
|---|-----|----------|
| **G1** | **No live presence / co-editing.** 2nd concurrent save = 409 "reload before saving", no merge, **unsaved edits lost**. `editing_by` never set ✓ → not even a "who's editing" banner. | `sections/[s]/save/route.ts` CAS; no ws/CRDT; mig 044 cols NULL-only ✓ |
| **G2** | **No version restore.** ✓ AI full-draft/Studio landings stage `ai_revision` versions that **can never be applied**; "restore this version" doesn't exist. | only `content` writer = provision-proposal.ts:158; versions route GET-only; land-revisions advances counter only ✓ |
| **G3** | **Uploaded images don't render in docx/pptx/xlsx.** ✓ → `[Image: alt]` stub. | image-raster.ts:35 nulls non-`data:`; exporters pass raw storage_key ✓ |
| **G4** | **No autosave** (manual save, no Ctrl+S; crash loses work). | canvas-editor.tsx undo/save handlers |
| **G5** | **Comments section-level only** (not anchored to text/node), masked in doc/foundation mode; no @mentions/notifications; DiffView + typed node.comments dead; revert doesn't restore. | proposal_comments; canvas-sidebar gates; collaboration.tsx:185 |
| **G6** | **Mode inconsistency** — section(TEXT+history+per-section-lock) vs document(JSONB+no-history) vs foundation(no-version). ✓ content=text confirmed. | live `\d`; save routes |
| **G7** | **One-off artifacts 2nd-class** — same shell, AI/comments/history/review stripped; no agent drafts them; no version snapshots. | canvas-sidebar gates; documents/save (no canvas_versions) |
| **G8** | **RFP-admin has no ingest→atom** ✓; winning finals/curated wins can't be seeded except by shadow-descent; two parallel template systems. | empty grep app/api/admin; mig152 |
| **G9** | **Sharing coarse + admin-gated** — tenant_user=tenant-wide (all-or-nothing); per-proposal share = tenant_admin-only, email-heavy, no link/guest, no PATCH; no per-user atom ACL. | collaborators route (no PATCH); atoms visibility unused tiers |
| **G10** | **In-doc AI is a sidebar panel**, not inline/slash/ghost-text; off for standalone docs. | ai-revision-panel.tsx; canvas-sidebar:793 |
| **G11** | **3 disagreeing page-count heuristics** feed the compliance check (estimatePageCount ignores font+image); whole-proposal package runs **no** compliance validation. | estimatePageCount vs paginate vs len/3000; package route |
| **G12** | **Export lossy** — docx TOC static, equations raw, docx url not hyperlink, pptx no overflow, xlsx degrades, **zip has no PDF** despite label. | docx/pptx/xlsx exporters; package:285 |
| **G13** | **Doc/code drift** — formatter/stylist headers say DORMANT, wired LIVE. | formatter.py:6-9 vs processor.py:238 |
| **G14** | **section-save discards revision-source metadata** → history mislabels "Human Edit". | save route parses source/aiInstruction, unused |
| **G15** | **"Draft with AI" is a misleading near-no-op** ✓ (records + emits; drafting is client-side). | ai/draft/route.ts:150 ✓ |
| **G16** | **Prior-proposal reuse fragmented + admin-gated + upload-blind** ✓. | seed-job routes rfp/master-only ✓; suggester needs origin_proposal_id |
| **G17** | **No per-tenant opp scoping** ✓ (push fans to all active/trial). | solicitation-push tenantScoped:false ✓; bridge:259 ✓ |

---

## 7. Sources / cross-links
Mapped by 6 verified read agents (RFP-ingest · tenant-ingest · canvas-core · export · actors/collab · agents/one-off), personally re-verified. See `docs/DATA_FLOW.md`, `docs/CANVAS_DOCUMENT_ARCHITECTURE.md`, `docs/AGENT_WORKFORCE.md`, `docs/FULL_DRAFT_LANDING_DESIGN.md`, `docs/MASTER_MIRROR_OPP_DESIGN.md`, and the live `/admin/architecture` explorer.

_Phase 1 of the Common-Canvas redesign. Phase 2 (capability analysis) → Phase 3 (adversarial, human lens) → Phase 4 (sequenced TODO) build on this; execution is gated on sign-off._
