# Fluid Canvas Redesign — document-first, structure-as-overlay, selection-as-verb

The next canvas evolution. Signed off 2026-08. Builds on the human×machine analysis
(`docs/CANVAS_HUMAN_MACHINE_ANALYSIS.md`) — the model + export layer are strong; this is a
UI/interaction re-architecture over them, **not** a data migration.

## The three moves

1. **Document-first rendering.** The document is the object; render it as one continuous,
   fluid page — not a stack of section/cocoon boxes. The section/mold structure is
   scaffolding for compliance + agent targeting, not the layout.
2. **Structure-as-overlay.** Section boundaries, compliance coverage, provenance/lineage,
   page budgets become togglable *layers* painted over the document. Default view is a clean
   document; you summon a layer when you need it.
3. **Selection-as-verb.** Highlight any span (across nodes/sections) → a floating menu acts
   on it: **atomize · regenerate · annotate · reuse · compliance-check**. One interaction
   replaces the scattered node-scoped + section-scoped action surfaces.

Feasible because the model already carries everything: `sections → groups → nodes`, node
provenance (`library_unit_id`, `source_anchor`), section `source_atom_ids`, the atomize
pipeline, per-section AI, and comments.

## Scope boundary (per sign-off)

The fluid document-first model is for **narrative volumes** (letter / PDF). Decks and
workbooks are legitimately different modalities and get a *cleaner-native* track, not the
scroll:

- **Slides** — WYSIWYG and **discrete**. They need only: **size · aspect ratio · number of
  slides**, then it's **styling · backgrounds · primitives**. No fluid scroll; a clean
  slide surface + a slide-frame control (size/ratio/count) + the existing element palette
  with background fills. (Track: SLIDES-clean.)
- **Sheets** — **fancy tables**. The spreadsheet surface is a styled grid; keep it native,
  clean it up (the P0.3 formula/cell-style work already started this). (Track: SHEETS-clean.)

## Phased plan

| Phase | Ships | Status |
|---|---|---|
| **F0 · Selection spine + first actions** | `data-node-id` anchors + `selectionToModel` (Range→model, pure, unit-tested) + a floating `SelectionToolbar` + the actions **Atomize** (span → library atom w/ lineage) and **Regenerate** (AI re-draft the spanned nodes). | **in progress** |
| **F1 · Fluid document view** | Continuous scroll render of the whole document (all sections inline), page *markers* not boxes, sections as boundary chips + a left outline rail. Opt-in "Document view". | planned |
| **F2 · Selection actions ++** | Annotate/comment on a span, Reuse-from-library, Compliance-check-this. | planned |
| **F3 · Overlay layers** | Togglable Structure / Provenance (atom·cocoon lineage heatmap) / Compliance overlays over the fluid doc. | planned |
| **F4 · Multi-target ops** | A selection spanning N sections → regen all N / atomize into N atoms. | planned |
| **SLIDES-clean** | Slide-frame control (size/ratio/count) + backgrounds + clean discrete WYSIWYG. | planned |
| **SHEETS-clean** | Continue the fancy-table cleanup (cell styles, formulas). | started (P0.3) |

## F0 build record

- `lib/canvas/selection.ts` — `selectionToModel(doc, startNodeId, endNodeId) → { nodeIds,
  text, groupTitles, singleNode }` (pure, order-independent). `selectionLabel`. 6 unit tests
  (`__tests__/unit/canvas-selection.test.ts`).
- `components/canvas/canvas-renderer.tsx` — `data-node-id` on every node wrapper.
- `components/canvas/selection-toolbar.tsx` — the floating menu (reads the DOM selection →
  model → places at the selection rect; actions are host callbacks).
- Wiring (atomize → library-atom route; regenerate → the existing AI-revision path) +
  editor mount + live verification: see the commits + the section below.
