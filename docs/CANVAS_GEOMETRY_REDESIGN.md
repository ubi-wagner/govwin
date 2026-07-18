# Canvas Geometry Redesign — frames, sections, and the annotation atomizer

**Status:** design analysis + path to completion. **Date:** 2026-07-18.
**Premise (founder):** lean into the *x/y of rectangles* (documents, slides, pages);
content is **atoms → groups → sections** with per-level layout intent (fit one
page/slide, or flow across pages); an **annotation/selection toolkit** on ingest lets
the uploader box-and-tag content into atoms/groups/sections fast; the **floorplan**
(margins, header/footer, slide titles, inline images) is enforced on the canvas; page
budgets are managed by **drag-resizing section boxes**.

This is right, with one load-bearing correction (§4). Below: what's already here, the
real gap (including the page-continuity symptom), the evolved model, the toolbar
architecture, and a phased path.

---

## 1. TL;DR

- **Keep:** `CanvasRules` (the floorplan — it already carries margins, header/footer
  zones, font floor, image ceilings, page/slide caps), the atom → group → library
  spine, `SourceAnchor` (atoms already point back to source regions), and the four
  exporters.
- **Shed:** the **flat `nodes: CanvasNode[]` with `page_break` as a *content* node.** A
  page break is a *layout outcome*, not content. Forcing one before every section (to
  hit exact page counts) is what produces the bottom-of-page whitespace and the
  no-continuity look in the current generations.
- **Add:** a **Section → Group** layer between the frame and the atoms, each carrying a
  **layout intent** (`flow | keep_together | pinned`) and a **page/box budget**; a
  **measure/paginate pass** so page usage is computed (not hacked); an **annotation
  atomizer** (box-and-tag on rendered upload); and **slide geometry** (x/y/w/h boxes)
  where it's literally required.

---

## 2. What's already in place (don't rebuild)

Grounded in `frontend/lib/types/canvas-document.ts`:

- **The frame exists as `CanvasRules`** (canvas-document.ts:25) — `format`, page `width/
  height`, `margins`, `header`/`footer` (`{template, height, font}`), `font_default`,
  `line_spacing`, `max_pages`/`max_slides`, `min_font_size`, `images_allowed`,
  `image_max_width/height`, `watermark`. That IS the floorplan the vision asks for; it's
  just under-exposed in the UI and under-enforced in layout.
- **`ComplianceSpec`** (canvas-document.ts:53) — the enforceable contract (`max_pages`,
  `required_sections`, `header_required`, `footer_required`). The page-budget gauge
  reads this.
- **Atoms → groups → library** — `library_atoms` (grain primitive/group/reference),
  `atom_members` (a group's ordered members), `atom_tags` (the Dewey axes), `atom_lineage`,
  `document_cocoons`. The "atoms:groups:sections" content hierarchy already exists for the
  first two levels; **section is the missing third**.
- **`SourceAnchor`** on every `CanvasNode.provenance.source_anchor` and every atom
  (`[{ sourceAtomId, nodeIds, region }]`) — atoms already remember *where in the source
  they came from*. This is the seed of the annotation atomizer: a drawn box becomes a
  `region`.
- **Node-level `comments`** (canvas-document.ts:236) — collaboration primitive already
  present per node.
- **Exporters** — `docx/pptx/xlsx/pdf` in `lib/export/*`. The pptx exporter already
  *places by box* (accent bar, title zone, positioned figures); the pdf path reflows via
  Chromium HTML; docx/xlsx reflow natively. These are reusable renderers for the new model.

## 3. The real gap (and why the pages don't flow)

1. **No SECTION as a first-class layout unit.** "Section" today is either a
   `proposal_sections` DB row (one per mold, exported independently) or just a `heading`
   node inside the flat list. Neither is a *bounded region with intent*. So nothing can
   say "keep this group on one page," "let this section flow 1.5 pages," or "this section
   gets 3 pages of the budget."
2. **Pagination is a hack, and it shows.** The renderer flows top-to-bottom; to hit
   *exactly* 15/10/5 pages the generators insert a `page_break` node before each section
   (`gen-sample-proposal.mts`, `gen-navy-sttr-proposal.mts`). Result: a section ends
   mid-page, a hard break fires, the rest of the page is **whitespace**, and content
   never flows section-to-section across a boundary. **This is the exact symptom you
   flagged.** The fix is to delete the forced breaks, let sections flow, mark only the
   genuinely un-splittable ones `keep_together`, and let a measure pass *report* the page
   count instead of forcing it.
3. **Slides aren't spatial.** A `slide_16_9` canvas flows nodes with a rough height
   estimate (`pptx-exporter` `curY += added`). Slides are the one surface that is
   *genuinely* x/y — title box, content box, image box — and the model has no box
   geometry, so slides can overflow or misalign.
4. **No measure/reflow engine.** Nothing computes "does this section fit its budget," so
   there's no basis for a page-fill gauge or drag-resize budgeting.
5. **Atomization is textual + blind.** The atomizer splits pasted text on blank lines;
   there's no *visual* box-drawing over rendered upload content, no group/section boxing,
   no bulk context-tagging at ingest.

## 4. The load-bearing correction: rectangles ≠ absolute x/y for documents

Slides are spatial; **documents must reflow.** If we pin document paragraphs to absolute
x/y, we break the thing the whole product depends on — reflow under a page/font/margin
constraint (the compliance floor). So "rectangles" means two different things:

- **Slides / pinned blocks:** true geometry — `box {page, x, y, w, h}`, snapped to frame
  zones. Content is placed.
- **Document sections:** *bounded flow regions with intent*, not fixed coordinates. A
  section is a rectangle in the sense that it has a **width (the content column) and a
  page/height budget**, and a rule for what happens at a page edge (`flow` vs
  `keep_together`). Content flows inside it. Resizing a section = changing its **budget**,
  which the paginator honors — not moving a box.

Getting this right is what keeps compliance (exact page counts, font floors) intact while
still giving you the box-driven UX.

## 5. The evolved data model (specifics)

Extend `CanvasDocument` with a **section layer**, backward-compatible (a legacy flat
`nodes` list compiles to a single implicit `flow` section):

```ts
interface CanvasDocument {
  version: 2;                 // bump; a v1 doc lifts into one section on read
  document_id: string;
  canvas: CanvasRules;        // the FRAME / floorplan (unchanged; add slide `zones` — §7)
  sections: CanvasSection[];  // NEW — ordered
  metadata: CanvasDocumentMetadata;
}

interface CanvasSection {
  id: string;
  title: string;
  section_type: string;                 // the `vol` (maps to the mold / matrix element)
  layout: SectionLayout;
  groups: CanvasGroup[];                 // ordered
  source_atom_ids?: string[];           // lineage (already threaded to harvest)
}

interface SectionLayout {
  mode: 'flow' | 'keep_together' | 'pinned';
  break_before?: boolean;               // force a new page/slide start
  page_budget?: number;                 // soft target pages (documents) — drives gauge + reflow
  box?: { page: number; x: number; y: number; w: number; h: number }; // slides / pinned
}

interface CanvasGroup {
  id: string;
  label?: string;                       // "Team Bios"
  keep_together?: boolean;              // don't split this group across a page/slide
  atom_ref?: string;                    // library atom this group instantiates (optional)
  nodes: CanvasNode[];                  // the compiled content (unchanged CanvasNode)
}
```

- **Hierarchy = your model exactly:** Section → Group → Node(atom). Constraints attach at
  each level: an atom never splits (implicit); a group is `keep_together` ("all four bios
  on one page"); a section is `flow` / `keep_together` / `pinned` + a `page_budget`.
- **`page_break` node retires.** Break intent lives in `SectionLayout.break_before`. The
  exporters stop seeing breaks as content.
- **Migration is cheap:** a v1 `nodes[]` → one `flow` section with one group; the harvest,
  save, and export paths keep working while the section-aware paths roll in.

### 5a. Atom taxonomy — image / table / list grains (confirmed)

Every content object is an atom; the grain decides reuse granularity.

- **Image = a primitive atom.** `grain: primitive`, `kind: figure`, `canvas_nodes:
  [image node]`. Self-contained and reusable — box a figure at ingest → an image atom;
  drop it into any section inline. (`library_atoms.canvas_nodes` already stores the node,
  so no schema change.)
- **Table = an *extendable* atom OR a *group of rows*.** Two grains, same render:
  - *Extendable atom* — `grain: primitive`, `kind: table`, `canvas_nodes: [table node]`.
    One reusable unit; its rows are edited **inline** (add / remove / reorder) — the
    "extendable" property. Reuse the whole "Direct Labor" table.
  - *Group of rows* — `grain: group`; each **row is a member atom** (a one-row table
    fragment), assembled in order via `atom_members`. Reuse a single "PI labor line"
    across budgets; reorder/insert rows by editing membership.
- **List = an *extendable* atom OR a *group of items*.** Same duality:
  - *Extendable atom* — the whole list is one atom; bullets edited inline.
  - *Group of items* — each **item is a member atom**; "Team Bios" is a group whose
    members are the individual bio atoms (your example, exactly). Delete a member → the
    group shrinks; reuse a bio elsewhere.

The **grain is chosen at atomize time** (the box toolkit — §7 — offers "as one atom" vs
"as rows/items") **or at insert time**. Both grains render identically; a group just
carries no content of its own and assembles from its ordered members (already how
`selectForSection` materializes groups).

### 5b. Inline addition inside a section (confirmed)

A section is an **ordered** sequence of groups → nodes with a layout intent, so the
geometry supports **inline addition at any caret position**:
- Drop an **atom or group** between existing content in a section → it takes that ordinal;
  `paginate()` reflows the section within its page budget.
- Add a **row/item** to an extendable table/list atom, or a **member** to a table/list
  group → the container grows in place and reflows.
- A `keep_together` group that no longer fits after an inline add moves wholesale to the
  next page (documents) or flags overflow (pinned/slide) — the intent still governs.

So: images are atoms; tables and lists are extendable atoms *or* groups of rows/items; and
sections accept inline atom/group insertion with reflow. **Confirmed.**

## 6. The measure / paginate engine (the missing piece)

A pure function `paginate(doc, vars) → LayoutResult` that lays sections into the frame:

- Reserves the header/footer/margin bands from `CanvasRules`; the remaining band is the
  content column (width) and per-page height.
- Flows each section's groups; a `keep_together` group or section that would straddle a
  page edge moves wholesale to the next page; `pinned`/slide boxes place at their
  coordinates.
- Returns: `{ totalPages, perSection: [{ id, startPage, endPage, pagesUsed, overflow }],
  vsBudget, vsMaxPages }`.

Two fidelities, both already have the tooling:
- **Live (in the editor):** a fast text-metrics estimate (chars/line × line-height,
  tables/images measured by their declared size) → good enough for the page-fill bars and
  drag feedback.
- **Authoritative (save/export):** the real renderer — we already drive Chromium+`pdfjs`
  for exact page counts and `docx`/`exceljs` for the native files. `paginate` shares the
  HTML measure with the PDF path so the gauge and the download agree.

This *replaces* the forced-break hack: natural section-to-section flow, breaks only where
intent says, and a real number to show the user.

## 7. The annotation atomizer (ingest UX) — specifics

The highest-ROI new surface. On upload we already parse docx/pdf/pptx/xlsx into nodes with
char offsets + register a `reference` atom (`lib/atomize-package.ts`). Add a **rendered
recommendation view + a box/select toolkit**:

- **Render the parsed doc** as HTML in a scroll pane, each parsed block wrapped in a
  positioned element carrying its `data-node-id` / char-range. Auto-detected block
  boundaries get a faint dashed outline — the reader's *suggested atoms*.
- **Toolbar modes:**
  1. **Click-to-atomize** — click a suggested block → primitive atom. Marquee-select or
     shift-click several → they become the selection.
  2. **Box (lasso) an atom** — drag a rectangle over a region (one bio in a bulleted
     list). Hit-test: every block whose rect intersects the box → that atom's content.
     (For PDFs, use the pdf.js text layer positions to map the box to text spans.)
  3. **Box a group** — draw around several atoms → a `CanvasGroup` ("Team Bios",
     `keep_together` default on).
  4. **Box a section** — draw around the region → a `CanvasSection` ("Team Section",
     `mode: flow`).
  - **Grain prompt (§5a):** boxing a **table** or **list** asks *one extendable atom* vs
     *a group of rows/items*; boxing an **image** → an image atom directly. So the same
     box gesture mints the right grain — a whole budget table, a reusable labor row, a
     team of bios, or a figure.
- **Context on drop:** each box shows an inline tag-chip row (vol/kind curated + agency/
  program/phase/… free). Select many boxes → **bulk-tag** a context (the package
  "FROM" pedigree). One pass atomizes *and* tags everything.
- **Provenance for free:** each atom/group/section stores the box as its `SourceAnchor
  region`, so "this came from page 3 of the AFWERX proposal, the bios list" is recorded
  — the pedigree the library already ranks on.
- **Then:** "Add section to proposal" inserts the section (groups+atoms) into a proposal
  artifact; "delete some atoms in the group" edits `atom_members`; the section's layout
  intent rides along.

Box→content mapping is a hit-test, not OCR — we own the render, so we own the geometry.

## 8. The canvas editor + side-toolbar architecture

One editor, a context rail that swaps by mode (evolves today's `canvas-editor.tsx` +
`canvas-sidebar.tsx`):

| Rail panel | What it edits | Status |
|---|---|---|
| **Floorplan** | `CanvasRules`: margins, header/footer template+font, slide zones, font floor, image policy, page cap | data exists; expose it |
| **Sections** | ordered section list; per-section **page-fill bar** (used/budget), **mode** toggle (flow / keep-together / pinned), **drag-resize** budget handle; a **total-pages gauge vs max_pages** (green/amber/red) | NEW (needs §6) |
| **Insert from Library** | pick atoms/groups → drop into the active section | built (`LibraryInsertPanel`) |
| **Annotate / Atomize** | the box toolkit (§7), ingest mode | NEW |
| **AI** | draft/revise a section into its budget; **"fit to budget"** (shorten to hit target) | draft exists; add fit |
| **Collaborate** | node/section comments, presence, stage-scoped edit | comments exist |

The **drag-resize** is your P1→P2 story: each section shows a page allowance; drag its
handle to give it fewer/more pages; the live `paginate` re-measures; a section that no
longer fits turns red with "AI fit to budget" / "trim." Allow a temporary **overrun band**
(e.g. +5 pages P1→P2) as an artifact policy — the gauge shows amber in the band, red past
it — then "tighten to 10" by pulling section budgets down until green.

## 9. Path to completion (phased, shippable, spine intact)

**Phase 1 — Section layer + retire the page-break hack (fixes continuity). ✅ SHIPPED.**
Add `sections/groups` to `CanvasDocument` (v2, v1 lifts to one flow section). Teach the
exporters to walk sections→groups→nodes and emit `keep_together` (docx *keep-with-next /
keep-lines-together*; HTML `break-inside: avoid`; one section per slide). Rework the
generators to flow sections (delete forced `page_break`s). Add `paginate()` + a read-only
per-section/total page gauge. *Outcome: content flows across pages, whitespace gaps gone,
page counts emerge and are reported.*

> **As-built (2026-07-18).** `CanvasSection/CanvasGroup/SectionLayout` +
> `sections?` are additive on `CanvasDocument` (`lib/types/canvas-document.ts`), with
> `toSections()` (v1→section lift, split on `page_break`), `sectionsToNodes()`, `docNodes()`,
> `createSection/createGroup`. The exporters branch on `doc.sections?.length` — v2 walks
> the section layer (canvas-html `<section>` + `break-inside:avoid`; docx page-break-before
> + `keepLines/keepNext` + row `cantSplit`; pptx one-slide-per-section) while **v1 uses the
> untouched flat-node path** — the app's live section-save/harvest paths still emit v1, and
> `__tests__/canvas-sections.test.ts` pins that path (a v1 doc renders with no `<section>`
> wrapper and its `page_break` intact). `paginate()` (`lib/export/paginate.ts`) reports
> per-section start/end page, total, and vs `max_pages`. Both sample generators author v2
> flow: `gen-navy-sttr-proposal.mts` hand-authors sections (figures/tables = `keep_together`
> groups, **no forced breaks**); `gen-sample-proposal.mts` (AFWERX) lifts its docs with
> `liftToFlowSections()` — the mechanical v1→flow upgrade (drop page-breaks, auto-coalesce
> figure/table+caption). Measured (`measure-canvas-flow.mts`, real Chromium+pdfjs), **every
> document artifact flows gap-free within cap**: Navy TV 6 / SOW 4; AFWERX TV **8 (was a
> padded 15)** / Key Personnel 2 / Facilities 1 — no near-empty interior pages anywhere; the
> decks are one-section-per-slide. 636 tests green (incl. `canvas-sections.test.ts`), `tsc` clean.

**Phase 2 — Annotation atomizer.** The recommendation view + click/box/group/section
tools + bulk context tagging, writing atoms/groups/sections with `SourceAnchor` regions.
*Outcome: upload a package and box-and-tag it into reusable, sectioned content in one
pass.*

**Phase 3 — Slide geometry.** First-class `box{x,y,w,h}` per slide group + frame zones
(title/content/image); make the pptx placement read boxes. *Outcome: slides stop
overflowing; true WYSIWYG slide layout.*

**Phase 4 — Drag-resize budgeting + AI fit-to-budget + overrun policy.** Interactive
section-budget resize with live reflow; the P1→P2 overrun band; "fit to budget" shorten.
*Outcome: tighten 15→10 by dragging, not by hand-trimming.*

**Phase 5 — Template = frame + section skeleton.** Templates persist the floorplan + an
empty section skeleton (titles, budgets, zones, keep-together). *Outcome: fast templating,
one-click "new document from template + library," AI-draft into the skeleton.*

Every phase leaves `library_atoms`, the tags/lineage, and the exporters intact — this is
an evolution of the content model and the editor, not a rewrite of the spine.

## 10. What to keep vs shed (summary)

- **Keep:** `CanvasRules` (frame), `ComplianceSpec` (contract), atoms/groups/tags/lineage/
  cocoons, `SourceAnchor`, node-level comments, all four exporters.
- **Shed:** `page_break` as a content node; the "flat node list is the document" mental
  model; forcing exact page counts with hard breaks.
- **Add:** the Section/Group layer with layout intent; `paginate()`; the annotation
  atomizer; slide box geometry; the section-budget gauge + drag-resize.
- **Don't build:** an absolute-x/y layout engine for *documents* — reserve geometry for
  slides/pinned; documents get section-flow-intent + a measure pass, which is what keeps
  compliance sound.
