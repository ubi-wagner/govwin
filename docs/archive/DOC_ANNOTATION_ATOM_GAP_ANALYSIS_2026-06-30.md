# Document → Annotation → Atom → Match: As-Built & Gap Analysis

**Date:** 2026-06-30
**Scope:** The pre-proposal UI pipeline — uploading documents into the library, hand-annotating them with boxes to define typed atoms (text-with-context / image / table), and matching those atoms to proposal canvas sections. Annotation must serve **both** the library ingestor and the solicitation/proposal side.

**Method:** Six parallel read-only code investigations (library, template/DOCX atomization, canvas atoms, annotation/boxes, file storage/format, admin-page launch-readiness). Every claim below is grounded in a file path; the two load-bearing claims (§2) were re-verified by hand. Items needing a human decision are isolated in §6 and **not** assumed.

---

## 1. Target capability (restated in code terms)

> Upload a document of **any** kind → render it → let a user **draw boxes** on it → classify each box as **text-section / image / table** → mint a typed `library_units` atom (with content + box geometry + metadata) → that atom matches into a proposal **canvas section** (same node types).

The same box-annotation surface is wanted on the **ingestor** (building the library) and on **solicitations** (curation/compliance).

---

## 2. The unifying spine (key architectural insight — VERIFIED)

A single resolution-independent anchor model already threads annotations, library atoms, and canvas nodes together. **It is built; it is just not wired end-to-end.**

- `frontend/lib/types/source-anchor.ts` — `AnchorRect { x, y, w, h }` stored as **percentages 0–100** (zoom/DPI independent), plus `page`, `excerpt`, `char_offset/length`, `section_key`, `method: 'manual_selection' | 'ai_extraction' | 'pattern_match' | 'imported'`.
- `frontend/lib/types/canvas-document.ts:273-279` — **VERIFIED**: `CanvasNode.provenance = { source: NodeSource; library_unit_id?: string; source_anchor?: SourceAnchor; … }`. A canvas atom can already point back to the exact box on the source page **and** to the `library_units` row it came from.
- `solicitation_annotations.source_location` (JSONB) already persists `AnchorRect[]` from the PDF viewer.

**Implication:** "box → typed atom → canvas node" is one data lineage by design. The work is UX + wiring, not a new data model.

---

## 3. As-built common capabilities (EXISTS — grounded)

| Capability | Status | Evidence (files) |
|---|---|---|
| Object storage (R2/S3) + presigned up/download + per-tenant isolation | EXISTS | `frontend/lib/storage/s3-client.ts`, `frontend/lib/storage/paths.ts` (`assertKeyBelongsToTenant`) |
| Multi-format upload (PDF/DOCX/DOC/PPTX/PPT/TXT/MD) | EXISTS | `app/api/portal/[tenantSlug]/library/upload/route.ts`, `app/api/admin/rfp-upload/route.ts`, `.../supporting-docs/route.ts` |
| Auto-atomization → typed canvas nodes in the library | EXISTS (text/list/table) | `app/api/portal/[tenantSlug]/library/atomize/route.ts`; readers `frontend/lib/import/{docx,pptx,pdf,text}-reader.ts` (DOCX via `mammoth`, PDF via `pdf-parse`, PPTX via JSZip) |
| Library data model (seminal + child atoms, learning loop) | EXISTS | `library_units` (migrations 001, 017, 030, 080): `canvas_nodes` JSONB, `document_metadata`, `heading_text`, `char_offset/length`, `is_seminal`, `parent_unit_id`, `outcome/outcome_score`, `atom_hash`, `embedding vector(1536)` + HNSW |
| Library ingestion paths (upload, harvest-on-lock, outcome scoring, paste) | EXISTS | `lib/proposal-harvest.ts`; `.../proposals/[id]/lock`, `.../outcome/route.ts` |
| Library management UI (filter/search/approve/archive/review) | EXISTS | `components/portal/library-dashboard.tsx`, `atom-review.tsx`, `bulk-upload.tsx`; `app/api/portal/[tenantSlug]/library*` |
| Canvas atom types: text / **image** / **table** with full editor CRUD | EXISTS | `lib/types/canvas-document.ts` (`NodeType`, `ImageContent`, `TableContent`); `components/canvas/canvas-renderer.tsx` (ImageNode upload, TableNode CRUD) |
| In-browser PDF render + text-selection annotation → box geometry + highlight overlays | EXISTS | `components/rfp-curation/pdf-viewer.tsx` (`react-pdf` + `pdfjs-dist`); `solicitation_annotations` (migration 009); `lib/tools/solicitation-save-annotation.ts` |
| Library → canvas insertion + tag/bucket matching | EXISTS (text only) | `components/canvas/library-picker.tsx`; `app/api/portal/[tenantSlug]/library/similar/route.ts` (scopes by `section_type`/`subcategory`, ranks by `outcome_score`) |
| Proposal artifact/section/version model + landing primitive | EXISTS | `proposal_artifacts` (083), `proposal_sections` (`content` TEXT, `section_type`), `canvas_versions` (045); `pipeline/src/workflows/actions/publish_section_draft.py` |
| Office→PDF/format conversion (export direction) | EXISTS | `pipeline/src/document/converter.py` (LibreOffice headless) |
| Parallel Python document agents (docx/pptx/pdf/xlsx) + `CanvasBundle` | EXISTS | `pipeline/src/document/{base,docx_agent,pptx_agent,pdf_agent}.py` |

**Bottom line:** ingestion, the library, the canvas atom types, PDF rendering, box geometry, matching, and the learning loop are **already built**. The gaps are concentrated in *human box-annotation as an authoring surface* and in a handful of *wiring* breaks.

---

## 4. Gap analysis matrix (what blocks the target)

| # | Desired capability | State | Evidence / why | What's needed |
|---|---|---|---|---|
| G1 | **Draw freeform boxes** (click-drag) on a document | **PARTIAL** | Boxes today are a *side-effect of text selection* only (`pdf-viewer.tsx` computes rects from `window.getSelection()`); no drag-to-draw layer | A drawing overlay that emits `AnchorRect[]` directly |
| G2 | **Render non-PDF docs** for annotation | **MISSING** | Only PDF renders in-browser; DOCX/PPTX/images are stored, never displayed | Render surface: convert Office→PDF (reuse `converter.py`) and/or rasterize to page images; render images directly |
| G3 | **Image region selection** (box around a figure) | **MISSING** | No image viewer/annotator anywhere | Image render + box-draw + crop-to-atom |
| G4 | **Box → typed library atom** (mint an atom from a box) | **MISSING** | Annotation writes `solicitation_annotations` (compliance tags), never `library_units`; the two are disconnected | Pipeline: box geometry → extract content (text/crop/table) → insert `library_units` child with `canvas_nodes` + `source_anchor` |
| G5 | **Annotation generalized beyond solicitations** | **MISSING** | `solicitation_annotations` is FK-scoped to `curated_solicitations`; no document-agnostic annotation | Generic annotation keyed by `document_id`/`storage_key` (new table or generalize existing) |
| G6 | **Image atoms end-to-end** (extract images on ingest) | **MISSING** | `mammoth`/PPTX readers drop images to placeholder text; no image atoms minted | Extract embedded media (mammoth image handler / JSZip media) → image atoms |
| G7 | **library → canvas structure preservation** | **PARTIAL (bug)** | **VERIFIED** `canvas-editor.tsx:292` `content: { text: atom.content } as any` flattens every atom to text; `library_units.canvas_nodes` (typed) is ignored on insert | Insert from `canvas_nodes` so image/table atoms round-trip |
| G8 | **Semantic matching actually running** | **PARTIAL** | `embedding` column + HNSW index + OpenAI provider exist, but `EMBEDDINGS_PROVIDER` defaults **off** and **nothing populates the column** (`pipeline/src/agents/embeddings.py`); `/library/similar` uses tag+recency | Turn provider on; backfill + on-write population; switch ranking to vector |
| G9 | **3-source strawman wired** | **MISSING** | `publish_section_draft` is fully built but **callerless** (verified across pipeline; `CLAUDE_CLIFFNOTES.md:893`); `section_drafter` archetype dormant | Workflow step: assemble RFP excerpt + matched atoms + tenant profile → draft → `publish_section_draft` |
| G10 | **Admin proposal section management** | **PARTIAL** | No `/admin/proposals/[proposalId]` overview; sections only created tenant-side (`portal/proposals/create`); admin reaches sections by deep URL only | Admin proposal overview + section create/organize |
| G11 | **Compliance-requirement → section linking** | **MISSING** | Curation extracts compliance vars; proposal sections live in a separate namespace; no cross-reference UI | Link `solicitation` compliance ↔ `proposal_sections` |
| G12 | **PDF export** (doc + section editors) | **DISABLED** | `canvas-editor.tsx:~417` button `disabled title="Coming soon"`; `documents/[documentId]/page.tsx:~63` no-ops `if (format==='pdf')` | Enable export (LibreOffice path exists for conversion) |
| G13 | **Librarian AI cataloguing/scoring** | **MISSING** | Archetype defined but nothing emits `library.unit.created` (`pipeline/src/agents/archetypes/librarian.py`) | Emit the event on atom create/atomize |
| G14 | **OCR / text-in-box on scanned PDFs & images** | **MISSING** | No OCR dependency found in any reader | Decision: add OCR (e.g. for image-only regions) or restrict to text-layer PDFs |

---

## 5. Terminology reconciliation (so we stay aligned)

- The **"template builder that atomizes DOCX"** in practice = the **import/atomization system** (`frontend/lib/import/docx-reader.ts` + `library/atomize` route), *plus* a parallel Python path (`pipeline/src/document/*`). The `/admin/templates` page itself is a **read-only browser**; it does not atomize.
- **MS documents (DOCX/PPTX)** yield reliable structure + metadata via the readers (headings/paragraphs/lists/tables + core.xml metadata). **PDF** structure is **heuristic** (`pdf-reader.ts`) and tables are detected but not node-ified — which is exactly why PDF (and images) are the formats that most need **human box annotation**.

---

## 6. Decisions needed (NOT assumed — please confirm)

1. **Format strategy.** Recommendation: **do not require DOCX and do not convert to DOCX** (PDF→DOCX is lossy). Instead: keep **auto-atomization for MS docs**, and for **PDF/images (and as a manual override on any doc)** render to **PDF/page-image** and **hand-box-annotate**. Conversion is used only to *render* (Office→PDF via the existing LibreOffice converter), never as the atom source of truth. — **Confirm?**
2. **Annotation storage.** New document-agnostic `document_annotations` table (keyed by `document_id`/`storage_key`, `page`, `rects` JSONB, `atom_type`, extracted payload) **vs.** generalizing `solicitation_annotations`. Recommendation: **new generic table**, with the solicitation workspace migrated onto it. — **Confirm?**
3. **Atom typing.** Introduce an explicit `atom_type` (`text_section | image | table`) chosen at annotation time (maps 1:1 to `NodeType`), instead of today's implicit `source_id` inference. — **Confirm?**
4. **Runtime prerequisites (must verify before building G2):** Is **LibreOffice** actually available to the render path in the deployed environment? Is there budget/intent for **OCR** (G14)? Is **cross-tenant** library access in the admin editor (G7/admin) architecturally allowed, or is box-annotation library-minting **tenant-scoped only**?
5. **Embeddings (G8).** Turn on a provider (`EMBEDDINGS_PROVIDER=openai`) + backfill — cost/ops decision.

---

## 7. Build-test-build task list (sequenced)

Each task lists scope, key files, and an **acceptance test**. Phases 1–2 are the headline you asked to start from; later phases close the wiring gaps. Nothing here assumes the §6 decisions — they gate Phase 1.

### Phase 0 — Decisions & prerequisites (no code)
- **T0.1** Confirm §6 decisions 1–5. *Test: decisions recorded in this doc.*
- **T0.2** Verify LibreOffice availability + a server route that can convert an uploaded Office file → PDF for rendering. *Test: POST a .docx, get back a rendered PDF URL.*

### Phase 1 — Box-annotation MVP on a rendered document (G1, G2, G5)
- **T1.1** Generic annotation store: `document_annotations` table (`document_id`/`storage_key`, `page`, `rects` JSONB, `atom_type`, `label`, `extracted` JSONB, `created_by`) + CRUD route. *Test: POST/GET annotations for an arbitrary uploaded doc.*
- **T1.2** Render surface for any doc: reuse `pdf-viewer.tsx`; add Office→PDF (T0.2) and image rendering. *Test: a DOCX and a PNG both render in the annotator.*
- **T1.3** Freeform **draw-box** overlay emitting `AnchorRect[]` (drag to create; reuse `source-anchor.ts` geometry). *Test: draw 3 boxes on a PDF, reload, overlays persist in correct positions across zoom.*
- **T1.4** Box **type picker** (text-section / image / table) replacing the compliance-only popover for this surface. *Test: each box shows its chosen type.*

### Phase 2 — Box → typed library atom (the ingestor) (G3, G4)
- **T2.1** Content extraction per box: **text** from the PDF text layer within the rect; **image** = crop region → upload to R2 → `ImageContent`; **table** = region capture (table or image fallback). *Test: each box type extracts correctly on a sample doc.*
- **T2.2** Mint `library_units` child atom from a box: `canvas_nodes` (typed node), `source_anchor` (the box), `source_filename/_storage_key`, category/tags, `status='draft'`. *Test: 3 boxes → 3 atoms of the right types appear in the library, each with geometry.*
- **T2.3** Surface minted atoms in `atom-review` / library dashboard for approval. *Test: approve a box-minted atom; status → approved.*

### Phase 3 — Image atoms & faithful round-trip (G6, G7)
- **T3.1** Extend DOCX/PPTX readers to extract embedded images → image atoms (`mammoth` image handler / JSZip media → R2 + `ImageContent`). *Test: upload a DOCX with an image → an image atom is created.*
- **T3.2** Fix `handleReplaceFromLibrary` (and the picker insert path) to build nodes from `library_units.canvas_nodes`, not the text-only cast. *Test: insert a table atom and an image atom into a section → they render as table/image nodes, not text.*

### Phase 4 — Matching & strawman (G8, G9, G7-admin)
- **T4.1** Make the library picker available + atom-type-aware in the admin section editor (pass tenant context per §6.4). *Test: picker opens in `/admin/proposals/.../section/...`.*
- **T4.2** Turn on embeddings + backfill `library_units.embedding` (on-write + batch) and switch `/library/similar` to vector ranking with tag fallback. *Test: a semantically-similar atom outranks a keyword-only match.*
- **T4.3** Wire the 3-source strawman: assemble RFP excerpt + matched atoms + tenant profile → `section_drafter` → `publish_section_draft`. *Test: request a strawman on an empty section → typed nodes land, sourced from atoms, status `ai_drafted`.*

### Phase 5 — Admin curation completeness (G10, G11, G12, G13)
- **T5.1** `/admin/proposals/[proposalId]` overview (all sections, statuses) + section create/organize. *Test: see and add sections without deep URLs.*
- **T5.2** Compliance-requirement ↔ proposal-section linking UI. *Test: link a page-limit requirement to a section; it shows on the section.*
- **T5.3** Re-enable PDF export via the LibreOffice path. *Test: export a section to PDF.*
- **T5.4** Replace `prompt()`-based compliance tagging with a real form (batch-tag multiple excerpts). *Test: tag 2 excerpts as one variable in one action.*
- **T5.5** Emit `library.unit.created` so the librarian archetype catalogues/scores atoms. *Test: minting an atom triggers a librarian task.*

---

## 8. One-line status

The **ingestion, library, canvas atom types, PDF rendering, box geometry, matching, and learning loop are built**; the launch-blocking work is a **human box-annotation authoring surface** (Phases 1–2) plus a few **wiring fixes** (text-only cast, embeddings population, strawman caller). No new core data model is required — `SourceAnchor` already unifies box ↔ atom ↔ canvas node.
