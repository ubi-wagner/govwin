# CANVAS_ARCHITECTURE.md — the single source of truth for the canvas

**THIS is the one canonical canvas document.** Every other `docs/CANVAS_*.md` is historical analysis, a
build log, the data-model reference, or a superseded design that has been folded into this file — the full
map is §9. Read this first; when the canvas changes, change this.

_Last realigned: 2026-08-13 — a four-surface source sweep (doc/pdf · ppt · xls · editor shell) plus the
unified-UI direction. Line refs below were re-verified this pass unless marked "(P1)" (Phase-1-dated —
authoritative fact holds, exact line may have drifted)._

---

## 1. The model — one canvas, one discriminator

- **One JSON document type**, `CanvasDocument` (`lib/types/canvas-document.ts:545`): `{ version:1|2,
  document_id, canvas:CanvasRules, nodes:CanvasNode[], sections?:CanvasSection[], metadata }`. v1 = flat
  `nodes[]` (canonical); v2 = a `sections → groups → nodes` layer (`:519`/`:505`/`:457`) carrying layout
  intent (`SectionLayout.mode ∈ flow|keep_together|pinned`, `page_budget`, `box`). Both render.
- **The ONLY content discriminator is `canvas.format`** (`CanvasFormat`, `:28`) ∈ `letter · custom ·
  slide_16_9 · slide_4_3 · spreadsheet`. **There is no `canvasType`/`kind` field, and no `pdf` format** —
  PDF is an *export target* of a `letter`/`custom` canvas (docx = native, pdf = Chromium print of the same
  document). "All doc and pdf are one structure" is therefore already literally true.
- **22 node types** (`NodeType`, `:187`): 12 base (heading, text_block, bulleted/numbered_list, image,
  table, caption, footnote, toc, page_break, url, spacer) + 10 extended (shape, text_box, callout,
  code_block, blockquote, chart, equation, divider, video, signature). `CanvasNode` (`:457`) carries
  `provenance` (source · `library_unit_id` · `source_anchor`), `history`, `comments?`, `library_eligible`,
  `position?` (float/behind/front). A **spreadsheet cell** is a `TableCell` (`:255`) with
  `value`/`number_format`/`cell_type`/`formula`; a **chart** is a native `ChartContent` (`:331`).
- **Rulers are single-source:** `estimatePageCount` delegates to `paginate()` (`:692`/`:765`);
  `estimateSlideCount`/`overflowingSlides`/`sectionPageSpan` (`:717`/`:722`/`:732`) extend it to decks +
  section budgets; `validateCanvasAgainstSpec`/`validateStandaloneCanvas` (`:920`/`:1043`) are the one
  compliance floor, enforced at save + export.
- Data-model deep reference: **`docs/CANVAS_DOCUMENT_ARCHITECTURE.md`** (still current for the node model);
  geometry/section-layer detail: **`docs/CANVAS_GEOMETRY_REDESIGN.md`**; primitive catalog:
  **`docs/CANVAS_PRIMITIVES.md`**.

## 2. As-built surfaces — the editor already forks by format

`CanvasEditor` (`components/canvas/canvas-editor.tsx:184`) normalizes the doc (`toEditableFlat`) then **forks
on `canvas.format` into three bespoke surfaces over the same `CanvasNode[]`:**

| Surface | `canvas.format` | Component | Fork site |
|---|---|---|---|
| **Document / PDF** | `letter` · `custom` | `CanvasRenderer` (continuous flow page) | `:1134` (else) |
| **Slides** | `slide_16_9` · `slide_4_3` | `SlideEditor` (thumbnail rail + single-slide WYSIWYG) | `:362`, `:1121` |
| **Sheets** | `spreadsheet` | `SheetEditor` (grid + sheet tabs + formula bar + format bar) | `:190` (early return) |

- **The shared chrome already spans doc + slides.** `CanvasToolbar` (`:1111`), the **`SelectionToolbar`**
  selection-verbs (`:1146`), and the full **`CanvasSidebar`** (node tray · format · AI-revise · comments ·
  history, `:1196`) live in `CanvasEditorInner`, which renders *both* the doc and the slide fork (slides
  only swap the center renderer). **Slides are not starting from zero.**
- **The spreadsheet is the one siloed surface** — `SheetEditor` returns *before* the shell, so it has no
  overlays, no selection/range-verbs, no AI-assist, and no chart affordance in the grid
  (`sheet-media-strip.tsx:34` = images+shapes only).
- **Selection-verbs today:** `Atomize · Annotate · Regenerate` (`selection-toolbar.tsx:16`). `Reuse` and
  `Compliance-check` do **not** exist as selection verbs. The read-only fluid view
  (`fluid-document-view.tsx`, behind the admin-only "Document" tab) wires Atomize + Annotate only.
- **Export** (`lib/export/*`, `renderCanvas` dispatcher): docx (`docx`) · pptx (`pptxgenjs`, one section =
  one slide) · xlsx (`exceljs`, one table = one worksheet, real formulas) · pdf (Chromium). Whole-proposal
  package `?format=json|docx|pdf|zip`. Uploaded S3 images now inline to data-URIs across all four (W4.3).

## 3. The direction — one canvas, three surfaces, ONE interaction layer

**Signed off 2026-08-13.** Keep the three surfaces (they match how a person works in each modality); factor
the interaction layer *out of the doc path* so all three mount it. Surfaces differ by modality; the
interaction grammar is identical. **Zero data migration — no new discriminator, no per-type model; sections
stay the compliance + agent-targeting scaffold, permissions stay in `proposal-access.ts`.**

Three shared pieces, mounted by every surface:
- **`OverlayLayer`** — five togglable layers, **off by default**, painted from data that already exists
  (`node.provenance`, `validateCanvasAgainstSpec`, `paginate`/`estimateSlideCount`, the section map):
  **Sections** (dotted boundary + identity + accept/lock) · **Atoms/Primitives** (dotted outline + lineage)
  · **Compliance** (coverage · slide-overflow · cost caps) · **Provenance** (AI/library/manual/reuse heatmap)
  · **Budget** (page/slide/tab gauges). Surface-aware projection: doc spans · slide regions+rail · sheet
  cells. The "toggle section breaks + atom-primitive outlines on/off" is exactly this.
  **BUILT (2026-08-13) — the `OverlayLayer` is live across all four surfaces:** Sections + Atoms +
  Provenance on the fluid document; Atoms + Provenance on the per-section editor + slides (shared
  `CanvasRenderer`) and on the sheet grid. One component (`components/canvas/canvas-overlays.tsx` —
  `CanvasOverlayBar` · `useOverlays` · `overlayClass`) + one CSS block (`.cv-ov` in `app/globals.css`),
  painted off the `data-node-id` / `data-node-source` the node wrapper already carries. Off by default;
  live-driven per surface; coexists with the selection/AI toolbar (proven). Still to wire: the
  Compliance + Budget layers and a slide-rail treatment.
- **`ActOnSelection`** — the five-verb menu **Atomize · Regenerate · Annotate · Reuse · Compliance-check**;
  doc/slide read a span, sheet reads a **cell range**.
- **`AssistPanel`** — AI-assist on every surface (regenerate span/slide/range · check-vs-spec · recompute
  budget). Advisory → guardrail → land-or-review; never auto-advances a gate.

Per-surface, to spec:
- **Document / PDF** — one fluid, editable document (default, all roles); the section list + the `Manage`
  tab-row dissolve into overlays + a slim action bar (Stage · Studio · Download · Assign · ⋯) + a
  collaboration lens (`Scope: All | My sections`). PDF = the same canvas, Chromium-printed.
- **Slides** — discrete **section = slide**, WYSIWYG, carrying the overlays (rail budget gauge, overflow
  badge, section identity, atom/provenance tint) + on-slide direct placement (`NodePosition`, already
  honored by renderer + exporter) + the shared verbs/AI. Make section=slide canonical end-to-end (today the
  editor collapses to `page_break` runs).
- **Sheets** — the grid stays; add a **generic chart UI** (insert a chart from a selected range) and a
  **rudimentary-but-high-value ribbon** (Home · Insert · Data · Format), then mount the shared overlay +
  range-verb + AI layer so it stops being an island. The cost engine (`cost-model.ts`/`cost-forms.ts`) stays
  the deterministic source of computed cells; AI is advisory over it.

Interactive reference mock (three surfaces, shared overlays+verbs+assist, dotted-overlay toggle):
`scratchpad/ux/canvas-3mode.html` (published artifact).

## 4. Ingest → `library_atoms` → export (the pipeline around the canvas)

- **Tenant ingest → reusable atom** (`createAtom`, `lib/atoms.ts`, RLS-wrapped): atomize-package (auto
  cocoon + reference + per-block primitives) · atoms/upload (hand-shred) · capture (screen regions) ·
  create-canvas foundation (`decomposeAndIngest`) · manual. Store: `library_atoms` (`tenant_id NOT NULL` +
  `tenant_isolation`), `atom_tags`/`atom_lineage`/`atom_members`/`document_cocoons`. Hybrid retrieval
  (`selectForSection`) blends tag/context with semantic cosine (gated; `atom_embeddings`, mig 170).
- **Prior-proposal reuse:** self-serve now (W3.1 dropped the admin gate); uploads carry origin-lineage into
  the reuse index (W3.2).
- **Export:** per-format exporters + the whole-proposal package; `sort_index` ordering (never string-sort
  `section_number`); compliance validated at the artifact gate (`X-Compliance-Violations`).

## 5. Actors, access, collaboration

- Roles master(100)/rfp_admin(80)/tenant_admin(60)/partner_admin(50)/tenant_user(40)/partner_user(20). Gates:
  `verifyProposalAccess` (coarse) + per-section `proposal-access.ts` (`editable/commentable/viewableSections`)
  + tenant-wide membership. Home staff (`tenant_user`+) edit is **tenant-wide**; `assigned_sections` scopes
  only non-tenant-wide collaborators — this drives the **collaboration lens** (§3).
- Comments are section-scoped (`proposal_comments`); annotate-on-span (F2) quotes the span into the owning
  section. No realtime/presence (`editing_by` is dead scaffolding). Non-destructive 409 on concurrent save
  (W0.1) — explicit-overwrite confirm, no silent last-write-wins.

## 6. Gap register — realigned (many have since shipped)

From the Phase-1 baseline (G1–G17), updated to current reality:

| # | Gap | Status |
|---|-----|--------|
| G1 | No live presence / co-editing | **Open** (realtime unbuilt); 409 now non-destructive (W0.1) |
| G2 | No version restore | **Closed** — writable restore path + Restore (W1.1, mig 163 `content_source`) |
| G3 | Uploaded images don't render in docx/pptx/xlsx | **Closed** — S3 keys inlined to data-URIs (W4.3) |
| G4 | No autosave | **Closed** — autosave + recover-on-reload (W1.2) |
| G5 | Comments section-level, not anchored | **Partial** — annotate-on-span shipped; storage still section-scoped |
| G6 | Mode inconsistency (section/document/foundation durability) | **Open** |
| G7 | One-off artifacts 2nd-class | **Partial** — `validateStandaloneCanvas` + self-serve reuse shipped; AI on standalone still limited |
| G8 | RFP-admin no ingest→atom | **Partial** — `rfp_ingest_manager` + assess-ingest (advisory) shipped |
| G9 | Sharing coarse + admin-gated | **Open** (copy-inward-only guardrail is the standing rule) |
| G10 | In-doc AI is a sidebar panel, not inline | **Partial** — fluid selection-verbs; still no slash/ghost-text |
| G11 | Disagreeing page-count heuristics; package no compliance | **Closed** — `estimatePageCount`→`paginate()` one engine; export gate validates |
| G12 | Export lossy | **Partial** — images fixed (G3); TOC/equation/zip-PDF residuals remain |
| G13 | formatter/stylist DORMANT-vs-LIVE drift | **Closed** — workforce docs realigned |
| G14 | section-save discards revision-source metadata | **Closed** — `content_source` provenance (mig 163) |
| G15 | "Draft with AI" misleading no-op | **Closed** — dead button removed (W0.2) |
| G16 | Prior-proposal reuse fragmented + admin-gated + upload-blind | **Closed** — W3.1 + W3.2 |
| G17 | No per-tenant opp scoping | **Open** (niche opps stay single-tenant by never pushing) |

## 7. Phased path to the unified UI (design only until each phase is signed off)

0. Revert the nav-sectioning (compartment drift) — **DONE**. 1. Shared **`OverlayLayer`** (F3, dotted layers +
toggle) — **SHIPPED** (Sections/Atoms/Provenance across all four surfaces; Compliance/Budget layers pending).
2. Unify **`ActOnSelection`** (+ Reuse/Compliance-check + sheet range). 3. **Sheets into the shell** (ribbon +
chart-from-range + overlays + AI). 4. **Slides finish** (section=slide canonical + on-slide placement).
5. **Fluid as default** (list view optional; `Manage` tabs dissolve). 6. Consistency pass (one action bar,
one lens, one AssistPanel). Each phase: green backbone (`tsc` 0 · `vitest` · `next build`) + live-proven,
both lenses.

## 8. Two-lens rule (standing)

**Human (highest priority):** one product, three surfaces matching each modality, identical interaction
grammar (same chips, same verb menu, same assist); structure summoned, never navigated to; a collaborator
sees only their sections. **Machine:** one model, one `canvas.format` discriminator, one `CanvasNode[]`, one
compliance floor, one ruler, one export dispatcher; overlays read existing data; verbs route through
`sectionOf`; permissions in `proposal-access.ts`. No data migration, no new discriminator.

## 9. Canvas doc map — the single source → everything else

This file is authoritative. The rest, classified:

- **Data-model / reference (current):** `CANVAS_DOCUMENT_ARCHITECTURE.md` (node model — cited by
  `canvas-document.ts`), `CANVAS_GEOMETRY_REDESIGN.md` (section-layer geometry), `CANVAS_PRIMITIVES.md`
  (primitive catalog).
- **Historical analysis (dated snapshots; context, not current spec):** `CANVAS_CAPABILITY_ANALYSIS.md`
  (Phase 2), `CANVAS_ADVERSARIAL.md` (Phase 3), `CANVAS_HUMAN_MACHINE_ANALYSIS.md`, `CANVAS_AUDIT.md`,
  `CANVAS_ATOMIZATION_GAPS.md`.
- **Superseded design → folded into §3 here (kept as thin redirect stubs):** `CANVAS_MERGE_MAP.md`,
  `CANVAS_UNIFIED_UI_DESIGN.md`.
- **Prior design/plan (kept for history; superseded by §3 + §7 here):** `CANVAS_FLUID_REDESIGN.md`,
  `CANVAS_REDESIGN_PLAN.md`.
- **Execution log (living record of shipped work):** `CANVAS_BUILD_LOG.md`.

Companions outside the canvas set: `docs/DATA_FLOW.md`, `docs/AGENT_WORKFORCE.md`,
`docs/FULL_DRAFT_LANDING_DESIGN.md`, and the live `/admin/architecture` explorer.
