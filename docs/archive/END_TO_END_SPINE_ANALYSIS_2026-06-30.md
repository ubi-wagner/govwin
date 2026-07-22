# End-to-End Spine: As-Built & Gap Analysis

**Date:** 2026-06-30
**Scope:** The fully integrated spine — **RFP ingestion → shred → admin compliance matrix (+ summary) → spotlights → portal purchase → 72-hr V0/V0.5 generation → collaboration → harvest → library → matching** — across the RFP-Pipeline (admin) side and the customer-portal side.
**Companion:** `docs/DOC_ANNOTATION_ATOM_GAP_ANALYSIS_2026-06-30.md` (the ingest/atom/annotation half).
**Method:** Six + five parallel read-only code investigations, each required to cite files/lines/columns and flag callerless/stub. Two load-bearing claims hand-verified.

> ⚠️ **Meta-caveat (important):** some `docs/V1_*` design docs carry gap inventories that **predate work already shipped** (e.g. the W-K/W-M/W-N "collaboration" gaps were closed by the R5 track — human `createTask`, typed completers, nudge→email). The `V1_CONTROL_PLANE_DESIGN.md` doc itself notes an earlier sweep "badly under-counted… wrongly reported missing." **Treat code as truth; verify any doc-sourced "gap" against the source before acting.**

---

## 1. The spine at a glance (as-built)

| # | Stage | Status | Anchor |
|---|---|---|---|
| L0 | Admin uploads RFP source docs | 🟢 EXISTS | `app/api/admin/rfp-upload/route.ts` → `solicitation_documents` |
| L1 | Shred → text + sections | 🟢 EXISTS | `OnRfpUploaded` → `pipeline_jobs(shred_solicitation)` → `pipeline/src/shredder/runner.py` (pymupdf4llm); `extracted_text`, `full_text`, S3 `text.md` |
| L1.5 | AI section + compliance extraction | 🟢 EXISTS | Claude `section_extraction` + `compliance_extraction` → `solicitation_compliance` (named cols + `custom_variables`) + `curated_solicitations.ai_extracted`; status `ai_analyzed` |
| L1.6 | Topic/offering association | 🟢 EXISTS | `opportunities.solicitation_id`, `solicitation_type ∈ {single,multi_topic}`, `opportunity.bulk_add_topics`; compliance resolves topic→baseline→default |
| L2 | Admin verifies/builds matrix | 🟢 EXISTS | `compliance.save_variable_value` → `custom_variables` + `verified_by/at`; `curation_revisions` audit; curator `episodic_memories` |
| L2.5 | Admin authors **summary** | 🔴 MISSING | no `curated_solicitations.summary` / authored narrative; `solicitation_summary` view is metadata-only |
| L3 | Push to pipeline | 🟢 EXISTS | `solicitation.push` → `opportunities.is_active=true` → `finder:solicitation.pushed` |
| L4 | Spotlight scoring | 🟢 EXISTS | `OnSolicitationPushed` → `match_tenants()` → `tenant_pipeline_items` + `spotlight_bucket_scores` (5 buckets, C5) → tenant emails |
| L5 | Spotlight surfaces | 🟢/🟡 | Portal **feed** (score/filter/pin→`pursue_decision` task) + **detail** (compliance matrix shown, bucket-fit "#2/47", **Build Proposal**). Admin spotlight mgmt 🟡 partial |
| L6 | Purchase → workspace | 🟢 EXISTS | Stripe webhook → `capture:purchase.completed` → `launchProjectCollaboration(scope='opp', dueMinutes=4320 /*72h*/)` (R3.3 closed the orphan) |
| L7 | Proposal + section creation | 🟢 EXISTS | `proposals/create` → `resolveTopicCompliance` → `volume_required_items` → `proposal_artifacts` (frozen `format_spec`/`compliance_spec`) + `proposal_sections` (`section_type`-tagged) + **template seed** (`template_id`→`canvas_document`, interpolated) + supporting-docs; emits `proposal.v0_provisioned` |
| **L8** | **V0 strawman (3-source draft)** | 🔴 **CALLERLESS** | **THE keystone gap** — `publish_section_draft` built; `ProposalArchitect`/`section_drafter` defined but `proposal.v0_requested` never emitted and `fabric.handle_event` never invoked (8/10 archetypes unreachable) |
| L9 | 72-hr admin review gate | 🟢 EXISTS | `ProjectCollaboration` TODO gate, nudges [1,3], due +72h (phantom `AdminProposalSetup` removed) |
| L9.5 | "V0.5" | ⚪ NOT A STAGE | "Phase 0.5b" is a dev-phase label; proposal stages are `draft/review/final/submitted/archived` — **needs a product definition if it's to be a real stage** |
| L10 | Collaboration + locks | 🟢 BUILT (R5) | `tasks` ledger, section/artifact locks, `canvas_versions` audit; human `createTask`, typed completers, nudge→email shipped in R5 (docs list these as gaps — **stale**) |
| L11 | Harvest → library on lock | 🟢 EXISTS | `lib/proposal-harvest.ts` (atom_hash dedup, `outcome_score`) |
| L12 | Outcome scoring (win/loss) | 🟢 EXISTS | `proposals/[id]/outcome` feeds `library_units.outcome_score` |
| L13 | Library → canvas matching | 🟡 PARTIAL | `library/similar` scopes by `section_type`; **text-only cast** drops structure (`canvas-editor.tsx:292`); **embeddings off/unpopulated** |

**Headline:** the spine is **~80% wired end-to-end**. A purchase already provisions a fully-specced, template-seeded, compliance-aware proposal workspace behind a real 72-hr gate. The one break that stops it being *generative* is **L8 — the strawman is never requested.**

---

## 2. The keystone gap (L8) — the 3-source strawman

Everything needed exists **except the trigger + dispatch**:
- 🟢 `publish_section_draft` (landing primitive; gates on `empty`/`ai_drafted`, writes section + `canvas_versions` + emits `proposal:section.drafted`).
- 🟢 `section_drafter` archetype (tools: `search_library`, `get_compliance`) and `ProposalArchitect` (tools: `get_opportunity_detail`, `get_compliance`, `search_library`, `search_memory`).
- 🟢 The 3 sources are all reachable: RFP excerpt (`solicitation_compliance`/`ai_extracted`/shredded sections), library atoms (`library/similar` by `section_type`), tenant profile (`tenant_profiles`).
- 🔴 **Missing wiring:** nothing emits `proposal.v0_requested`; `fabric.handle_event()` is never called, so `ProposalArchitect`/`section_drafter` never run; `publish_section_draft` has no caller.

**This is the same gap found independently in the first sweep — now triply-confirmed.** Closing it turns "provisioned skeleton" into "meat-on-bones V0."

---

## 3. Your vision vs. as-built (the #3 thread)

> "solicitation requirements → admin builds a **matrix and summary** → fuels **spotlights** → identifies the **best templates** for the 72-hr post-purchase V0/V0.5."

| Vision element | As-built | Gap |
|---|---|---|
| requirements → matrix | 🟢 auto first-pass + admin verify | — |
| admin **summary** | 🔴 no field/authoring | **Add** `curated_solicitations.summary` (+ optional structured highlights) authored in curation; surface on spotlight card + portal |
| → fuels spotlights | 🟡 matrix **shown** on detail; spotlight **scoring** uses profile only | Optional: feed matrix signals (set-aside/ITAR/required-artifact fit) into bucket scoring; surface the summary on the **feed card** |
| → best **template** | 🔴 templates chosen at proposal-create by `template_id`/`resolveTemplateKey` | **Add** matrix→template "best fit" (by program/agency/required-items, later win-rate) + show "recommended template" pre-purchase |
| templates persist as artifacts | 🟢 no delete; system templates read-only; save-as-new | **Add** an explicit `archived_at` (your "remain unless archived") |
| reuse across similar (USAF SBIR rounds) | 🔴 no clone/fork of volumes/required-items/matrix across solicitations | **Add** "clone solicitation structure" (volumes + required-items + matrix + template links) |
| 72-hr V0 | 🟢 gate · 🔴 V0 draft (L8) | wire L8 |
| V0.5 | ⚪ undefined | **Decide** what V0.5 is (e.g. post-review enriched draft) or drop the term |

---

## 4. #2 — sheets / cost volume (decision)

**Confirmed:** the canvas already renders a **full sheet** (`canvas-editor.tsx:61-71` routes `format==='spreadsheet'` → `SheetEditor`: cells, multiple sheet tabs, styling, undo/redo), and `TableContent` already models `is_spreadsheet`/`formula`/`number_format`/`cell_type`/`value`. **But it's formula-blind** (UI-only formula bar; Python ingests `data_only=True`; `exceljs` export ignores `.formula`), and there's **no frontend XLSX reader** (`.xlsx` upload falls through to empty).

**Recommendation (do NOT deprecate the editor):**
- Keep `SheetEditor` as the live-edit/collaboration surface (Python can't do WYSIWYG/multi-user).
- **Ingest XLSX through Python** (`xlsx_agent` openpyxl, comprehensive — even detects cost/schedule/gantt categories) → `CanvasBundle` → canvas full-sheet. (Matches your instinct; the canvas already consumes it.)
- **Preserve formulas** end-to-end (`data_only=False`; carry `.formula`; write formulas on `.xlsx` export so Excel evaluates).
- **Add a work-plan/schedule artifact** as a fast-follow (the model + category detection already lean this way) — cost + schedule are the two SBIR spreadsheet artifacts that matter.

## 5. #4 — PDF→DOCX conversion (answer)

DOCX heading detection keys **only** on HTML `<h1>–<h6>` (`docx-reader.ts:163`), which `mammoth` emits **only** from Word **named heading styles**. A user-converted PDF→DOCX usually has **direct formatting, not heading styles** → zero headings detected → atomization collapses to one blob. **So converting PDF→DOCX loses structure too.** Mitigation: prefer native-authored Office for the library; on a converted file detect "no headings" → warn / fall back to the PDF reader's heading heuristics rather than minting one giant atom.

---

## 6. Cross-cutting gap register (prioritized, deduped)

| Pri | Gap | Where |
|---|---|---|
| **P1** | **V0 strawman unwired (L8)** — the spine isn't generative without it | pipeline workflows/archetypes |
| P1 | **Frictionless library authoring** — `section_standards`-driven atom-type dropdown (replace hardcoded `CATEGORIES`), doc-type-on-ingest, heading pre-fill/confirm, Office-only ingest | atom-detail-modal / library upload |
| P1 | **library→canvas text-only cast** drops image/table structure | `canvas-editor.tsx:292` |
| P2 | **Solicitation summary** authoring + surface | curation + spotlight |
| P2 | **Matrix→best-template** selection + **cross-solicitation reuse** (clone) + template `archived_at` | templates / solicitation |
| P2 | **Embeddings off/unpopulated** — semantic match is nominal | `embeddings.py`, `library/similar` |
| P2 | **Image atoms** (extract on ingest) + **XLSX ingest reader** + **formula preservation** | readers / xlsx_agent |
| P3 | **Compliance signals → spotlight scoring** (optional); **summary on feed card** | score_tenants / spotlight |
| P3 | **Admin spotlight management UI**; **admin proposal overview** (`/admin/proposals/[id]`) | admin pages |
| P3 | **V0.5 definition** (product decision) | — |

---

## 7. Integrated build sequence (build-test-build)

**Phase A — close the spine (make it generative).**
- **A1 Wire L8:** emit `proposal.v0_requested` (on `proposal.created`, or on 72-hr gate release), invoke `fabric.handle_event` → `ProposalArchitect` fans per section → `section_drafter` (RFP excerpt + `library/similar` atoms + `tenant_profiles`) → `publish_section_draft`. *Test: a purchase → all `empty` sections become `ai_drafted` from the 3 sources, audited in `canvas_versions`.*

**Phase B — frictionless library (the classify-in-canvas pivot).**
- **B1** Office-only ingest; `section_standards`-driven type dropdown per atom (replaces hardcoded `CATEGORIES`), storing `section_type`. *Test: classify an atom; it matches a section of that type.*
- **B2** Doc-type-on-ingest + heading→`section_type` pre-fill + confirm. *Test: upload a Technical Volume → sections pre-typed, user confirms.*
- **B3** Fix the library→canvas cast (insert from `canvas_nodes`). *Test: a table/image atom inserts as a real node.*

**Phase C — atom quality.**
- **C1** Turn on + backfill embeddings → vector ranking in `library/similar`.
- **C2** Image atoms on ingest; XLSX ingest via Python + formula preservation.

**Phase D — admin spine completeness.**
- **D1** Solicitation summary (author + surface on spotlight/feed).
- **D2** Matrix→best-template selection + cross-solicitation clone + template `archived_at`.
- **D3** (optional) compliance→bucket scoring; admin spotlight mgmt + `/admin/proposals/[id]` overview.

---

## 8. One-line status

The spine **is built and wired from RFP upload through scored spotlights, purchase, a fully-specced/template-seeded 72-hr proposal workspace, collaboration, harvest, and matching** — the single break that stops it being *generative* is the **unwired 3-source V0 strawman (L8)**. The rest are quality/frictions (library authoring, structure round-trip, embeddings, summary, template reuse) — none require new core schema; `SourceAnchor` + `section_standards` + `canvas_nodes` + `ProjectCollaboration` already provide the connective tissue.
