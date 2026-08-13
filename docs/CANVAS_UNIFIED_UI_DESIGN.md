# One Canvas, Three Surfaces — the unified authoring UI

**The ask (verbatim intent):** land on a **single canvas + UI implementation** where
**doc and pdf** are the fluid document structure; **ppt/slides** are **discrete, section-per-slide**
but *still* carry the overlays for interaction + WYSIWYG + AI-assist; and **xls/sheets** are a
**generic chart UI + a rudimentary-but-high-value ribbon-bar** spreadsheet. All three share **one**
interaction layer (overlays · selection-verbs · AI-assist) so it reads as one product, three surfaces.

This is the superset of `docs/CANVAS_MERGE_MAP.md` (which covered the doc/pdf surface only) and finishes
the `docs/CANVAS_FLUID_REDESIGN.md` scope boundary (which already split narrative-fluid vs slides-discrete
vs sheets-native). **Design only; no code moves until it's signed off.**

---

## 1. Ground truth — what is already built (so we finish, not reinvent)

Four-surface source sweep (evidence in `file:line`):

- **One model, one discriminator.** There is **no `canvasType`/`kind` field** and **no `pdf` format**.
  The only content discriminator is `canvas.format ∈ {letter, custom, slide_16_9, slide_4_3, spreadsheet}`
  (`lib/types/canvas-document.ts:28`). Every artifact is the same `CanvasDocument`
  (`sections → groups → nodes`, 22 node types). **PDF is purely an export target** of a `letter`/`custom`
  canvas — `docx` is the native render, `pdf` is the Chromium print of the *same* document
  (`lib/export/artifact-export.ts:33`; `pdf-exporter.ts`). So "all doc and pdf are this structure" is
  already literally true.
- **The editor already forks into THREE bespoke surfaces by format** — this is the spine of "single canvas,
  many surfaces," and it exists today:

  | Surface | `canvas.format` | Component | Fork site |
  |---|---|---|---|
  | **Document / PDF** | `letter` · `custom` | `CanvasRenderer` (continuous flow page) | `canvas-editor.tsx:1134` (else) |
  | **Slides** | `slide_16_9` · `slide_4_3` | `SlideEditor` (thumbnail rail + single-slide WYSIWYG) | `canvas-editor.tsx:362,1121` |
  | **Sheets** | `spreadsheet` | `SheetEditor` (grid + sheet tabs + formula bar + format bar) | `canvas-editor.tsx:190` (early return) |

- **The shared interaction chrome already spans doc + slides.** `CanvasToolbar` (`:1111`), the
  **`SelectionToolbar`** selection-verbs (`:1146`, gated `format !== 'spreadsheet'`), and the full
  **`CanvasSidebar`** (node tray · format · AI-revise · comments · history, `:1196`) all live in
  `CanvasEditorInner`, which renders **both** the doc *and* the slide fork (the slide fork only swaps the
  center renderer). **Slides are not starting from zero** — they already carry the verbs + AI sidebar.
- **The spreadsheet is the one siloed surface.** `SheetEditor` returns *before* `CanvasEditorInner`
  (`:190`), so it has **none** of the shared chrome — no overlays, no selection/range-verbs, no AI-assist,
  and (media strip is images+shapes only, `sheet-media-strip.tsx:34`) **no chart affordance inside the grid**.
  It is a genuine grid (formula bar, sheet tabs, add/del rows·cols, number-format dropdown), but it is an island.
- **The F3 overlay layer is net-new for everyone.** No surface paints togglable Structure / Atoms /
  Compliance / Provenance / Budget layers yet (`CANVAS_FLUID_REDESIGN.md` F3 = "planned"). The provenance/
  compliance *data* already exists on every node (`node.provenance`, `validateCanvasAgainstSpec`,
  `paginate`, `estimateSlideCount`, `overflowingSlides`) — only the togglable *painting* is missing.
- **Selection-verbs today:** `Atomize` · `Annotate` · `Regenerate` exist as props
  (`selection-toolbar.tsx:16`). `Reuse` and `Compliance-check` do **not** exist as selection verbs (they
  exist only at whole-proposal scope). The fluid read-only view wires Atomize + Annotate (Regenerate is
  deliberately deferred to F2).
- **Charts:** a native `chart` node (`ChartContent`: type · categories · series, `canvas-document.ts:331`)
  renders as **hand-built inline SVG** (`canvas-html.ts:236` `renderChartSvg`) — read-only on screen; data
  editable only via a side-panel form (`node-format-controls.tsx:52` `ChartDataEditor`) in doc/slide mode.
  xlsx export rasterizes charts to PNG (exceljs has no native chart primitive).

**Net:** the model is unified, the three surfaces exist, the shared chrome already spans two of them, and the
data behind every overlay is present. The unified design is **three finishing moves**, not a rebuild.

---

## 2. The single canvas + UI — the one unifying move

**Factor the interaction layer out of the doc path into a shared layer that all three surfaces mount.**
The *surface* differs by modality (scroll · slides · grid); the *interaction* is identical everywhere:

```
        ┌──────────────────── the ONE canvas shell (canvas-editor.tsx) ────────────────────┐
        │  action bar (Stage · Studio · Download · Assign · ⋯) · Scope lens · Overlay chips  │  ← shared
        ├───────────────────────────────────────────────────────────────────────────────────┤
        │   surface = f(canvas.format):                                                       │
        │     letter/custom  → Fluid Document (continuous scroll)                              │
        │     slide_16_9/4_3 → Slide Deck (thumbnail rail + discrete slide)                    │  ← differs
        │     spreadsheet    → Sheet (grid + sheet tabs + chart panel + ribbon)                │
        ├───────────────────────────────────────────────────────────────────────────────────┤
        │  Overlay layer · Selection/Range-verb menu · AI-assist · Provenance chrome          │  ← shared
        └───────────────────────────────────────────────────────────────────────────────────┘
```

Three shared pieces, mounted by every surface (the "single implementation"):

- **`OverlayLayer`** — reads `node.provenance`, `validateCanvasAgainstSpec`, `paginate`/`estimateSlideCount`,
  and the section map; paints the five togglable layers. Surface-aware *projection*: on a document it tints
  spans + boundaries; on a slide it tints regions + rail badges; on a sheet it tints cells + row/column
  markers. One data source, three projections.
- **`ActOnSelection`** — the selection/range-verb menu: **Atomize · Regenerate · Annotate · Reuse ·
  Compliance-check**. On doc/slide it reads a text/node span (today's `selectionToModel`); on a sheet it
  reads a **cell range**. Same five verbs, surface-specific target resolution.
- **`AssistPanel`** — the AI-assist entry (today's `CanvasSidebar` AI-revise + Studio), available on every
  surface: "regenerate this span/slide/range," "check this against the spec," "recompute this budget."

Everything below the fork stays the same shared `CanvasNode[]` model, `sectionOf` routing, and
`proposal-access.ts` permissions. **Zero data migration.**

---

## 3. Per-surface design

### 3a · Document / PDF — the fluid surface (per `CANVAS_MERGE_MAP.md`)

One continuous, editable fluid document (default · all roles). Section boundaries, the `Manage` tab-row,
and node/section action trays fold into the **overlay chips**, the **selection-verb menu**, the
**collaboration lens** (`Scope: All | My sections`), and a slim **action bar**. PDF needs no surface of its
own — it is the same document, delivered via the Chromium print path. *(Full detail: `CANVAS_MERGE_MAP.md`
§3–4; this doc adopts it verbatim as the document surface.)*

### 3b · Slides — discrete, section-per-slide, WYSIWYG, overlay-carrying

Keep `SlideEditor`'s thumbnail rail + single-slide WYSIWYG + 16:9↔4:3 frame control + background fills
(all shipped). Three finishing moves:

1. **Make `section = slide` canonical end-to-end.** Today the editor collapses v2 sections back into
   `page_break` runs (`toEditableFlat`) and re-splits on export. Treat each `CanvasSection` as the discrete
   slide across editing *and* export (the exporter already does one-section-one-slide), so a slide is a
   first-class, addressable unit — not a delimiter artifact. The thumbnail rail becomes the section list.
2. **Paint the shared overlays per-slide + on the rail.** `Sections` = the slide's mold/compliance identity
   + accept/lock chip; `Atoms` = reusable-primitive outlines on the slide; `Compliance` = the deck's
   `over_slide_limit` / `slide_overflow` state (a rail badge on any overflowing slide, from
   `overflowingSlides`); `Provenance` = AI/library/reuse tint on regions; `Budget` = the slide-count gauge
   (`estimateSlideCount` vs `max_slides`) on the rail.
3. **On-slide direct manipulation + the shared verbs/AI.** The model already supports absolute placement
   (`NodePosition` float/behind/front; renderer + pptx exporter honor it) — expose drag/resize on the slide,
   not only via the sidebar Arrange panel. Wire `ActOnSelection` (select a region → Atomize/Regenerate/
   Annotate/Reuse/Compliance-check) and `AssistPanel` ("redraw this slide," "tighten to fit the frame")
   consistently, since the sidebar + selection toolbar already mount here.

### 3c · Sheets — grid + generic chart UI + high-value ribbon (bring the island into the shell)

Keep `SheetEditor`'s grid, formula bar, sheet tabs, and cell model (`TableCell` carries `value` +
`number_format` + `cell_type` + `formula`, kept in sync by `lib/numeric-cell.ts`). Four finishing moves:

1. **A high-value ribbon** — replace the flat format-bar with a **rudimentary, grouped ribbon** of the
   highest-use actions (the familiar Excel muscle-memory, nothing more): **Home** (font · align · fill ·
   text color · borders · number-format), **Insert** (chart · image · shape · rows/cols), **Data**
   (formula · sum/quick-agg · sort), **Format** (cell styles · sheet). Rudimentary but every high-value
   action is one click. (`section-top-ribbon.tsx` is a *section-nav* bar, not this — this is a sheet ribbon.)
2. **A generic chart UI** — the one true net-new surface. Insert a `chart` node **from a selected cell
   range** (categories + series inferred from the range), with a live chart panel (type · series · title) on
   the sheet — not a doc-mode side-panel form. Renders via the existing `renderChartSvg`; edits write the
   `chart` node; xlsx export keeps its current PNG rasterization (native-Excel-chart export stays a
   later option, flagged, not blocking).
3. **Bring the shell to the sheet** — mount `OverlayLayer` (Provenance tint on AI-filled cells; Compliance
   on the ask-ceiling / cost-share rows the cost-forms already emit; Atoms on reused sheet-tables), a
   **range** `ActOnSelection` (Atomize a table → library; Annotate a range; Regenerate/Reuse a block), and
   `AssistPanel` ("recompute the burden waterfall," "explain this variance") — so the sheet stops being an
   island and joins the one interaction layer. The cost engine (`cost-model.ts` / `cost-forms.ts`) remains
   the deterministic source of the computed cells; AI-assist is advisory over it.

---

## 4. Full-functionality preservation matrix (nothing dropped)

| Function | Lives today | Merged home | ✓ |
|---|---|---|---|
| Edit a section / node (doc) | per-section `CanvasEditor` | **Fluid doc** edit-in-place (§3a) | ✅ |
| Accept & Lock / Unlock | sidebar node tray · admin panel | **Sections overlay** inline chip (all surfaces) | ✅ |
| Atomize / Annotate / Regenerate span | `SelectionToolbar` (doc + slide) | **`ActOnSelection`** (all surfaces) | ✅ |
| Reuse · Compliance-check | whole-proposal only | **`ActOnSelection`** verbs (new, all surfaces) | ✅ |
| AI-revise a node | `CanvasSidebar` (doc + slide) | **`AssistPanel`** (all surfaces incl. sheet) | ✅ |
| Slide thumbnail rail · frame · background | `SlideEditor` (shipped) | **Slides surface** (§3b), + section=slide | ✅ |
| Slide count / overflow gauges | `estimateSlideCount` · `overflowingSlides` | **Budget/Compliance overlays** on the rail | ✅ |
| On-slide placement | model + exporter only (no UI) | **On-slide drag/resize** (§3b, `NodePosition`) | ✅ |
| Spreadsheet grid · formula bar · sheet tabs | `SheetEditor` (shipped) | **Sheets surface** (§3c) | ✅ |
| Cell format (fill/align/border/number-format) | sheet format-bar | **Ribbon → Home** (§3c-1) | ✅ |
| Chart (insert / edit / render) | side-panel form (doc/slide) only | **Generic chart UI** on the sheet (§3c-2) | ✅ |
| Cost/budget computed cells | `cost-model.ts` / `cost-forms.ts` | unchanged; **AssistPanel** advisory over it | ✅ |
| Page/slide/section budgets | `paginate` · `sectionPageSpan` | **Budget overlay** (all surfaces) | ✅ |
| Compliance floor | `validateCanvasAgainstSpec` (save + export) | **Compliance overlay** + gate unchanged | ✅ |
| Provenance / lineage | `node.provenance` · `source_atom_ids` | **Provenance overlay** (all surfaces) | ✅ |
| Collaboration scoping | assigned_sections · contributor view | **Scope lens** over the same surface | ✅ |
| Stage · Studio · Download · Assign · Archive | scattered (StageControl · page · admin panel) | **Action bar** (all surfaces) | ✅ |
| Export docx/pdf/pptx/xlsx/zip | 3 export routes (unchanged) | unchanged (surface picks the native format) | ✅ |

---

## 5. Phased path (each phase: green backbone + live-proven, both lenses)

0. **Revert the nav-sectioning** (the compartment drift; per `CANVAS_MERGE_MAP.md` Step 0).
1. **Shared `OverlayLayer` (F3)** — the five togglable layers as one component with three surface
   projections (doc spans · slide regions/rail · sheet cells). Ships the "toggle section breaks + atom
   outlines" the whole design rests on.
2. **`ActOnSelection` unification** — the five-verb menu; add Reuse + Compliance-check; wire Regenerate into
   the fluid view; add the sheet **range** target resolver.
3. **Sheets into the shell** — the grouped ribbon + the generic chart-from-range UI + mount OverlayLayer +
   range-verbs + AssistPanel on `SheetEditor`.
4. **Slides finish** — section=slide canonical end-to-end + on-slide drag/resize + overlays on the rail.
5. **Fluid document as default** (per `CANVAS_MERGE_MAP.md` §5) — list view becomes optional; the `Manage`
   tab-row dissolves into overlays + summoned panels.
6. **Consistency pass** — one action bar, one Scope lens, one AssistPanel across all three surfaces; retire
   the doc/slide/sheet chrome divergence that isn't intrinsic to the modality.

---

## 6. Two-lens check (the standing rule)

- **Human (highest priority):** one product, three surfaces that each match how a person actually works in
  that modality — read a document, arrange slides, drive a grid — with an identical interaction grammar
  (same chips, same verb menu, same AI-assist) so nothing is re-learned when you switch artifacts. Structure
  is summoned, never a place you navigate to.
- **Machine (correct + efficient):** one `CanvasDocument` model, one `canvas.format` discriminator, one
  shared `CanvasNode[]`, one compliance floor, one page/slide/section ruler, one export dispatcher. The
  overlays read data that already exists; the verbs route through `sectionOf`; permissions stay in
  `proposal-access.ts`. **No data migration, no new discriminator, no per-type data model.** Agents keep
  targeting sections/atoms exactly as today.

*(Grounded in the four-surface source sweep: `lib/types/canvas-document.ts` · `components/canvas/canvas-editor.tsx`
· `canvas-renderer.tsx` · `slide-editor.tsx` · `sheet-editor.tsx` · `canvas-sidebar.tsx` · `selection-toolbar.tsx`
· `canvas-toolbar.tsx` · `fluid-document-view.tsx` · `lib/canvas/assemble-proposal.ts` · `lib/export/*` ·
`lib/proposal/cost-forms.ts` · `lib/numeric-cell.ts`; and `CANVAS_FLUID_REDESIGN.md` + `CANVAS_MERGE_MAP.md`.)*
