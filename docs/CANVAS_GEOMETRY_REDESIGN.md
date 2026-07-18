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

### 5c. Placement laws — the geometry rules (founder, 2026-07-18)

**The major floorplan actors** are the seven levels of the chain, split by role:
**frame actors** — `document` (page size/format), `header`, `footer`, `margins` — are the
fixed floorplan, authored/locked first, together with the **grid + spacing gap** (5 pt / cm)
that is the snapping substrate; **content actors** — `section`, `group`, `atom` — are mapped
*into* that frame and snap to its grid. Frame is stable; content flows and snaps.

The floorplan-then-map-it-out model runs on a few load-bearing laws. **Every level keeps
its hierarchy and meta-context** — an atom, the group it belongs to, and the section that
holds the group each carry their own Dewey tags + FROM-pedigree, and lifting a section into
a proposal (or extracting a template) preserves that lineage. On top of that, placement is
**grain-specific** — mutability differs by what a thing *is*:

- **Text is mutable geometry.** A text atom reflows to fill the column and **may wrap around
  an image** (float): it yields space and rewraps. Text has no fixed box — only an ordinal
  and a section budget.
- **Images are rigid.** An image atom occupies a real box and **cannot overlap another
  image** (they would collide/overlap). Image placement is collision-checked: two images
  reserve disjoint boxes; text fills the remainder. So a section can inline an image and let
  the surrounding text wrap, but it can never stack two images into the same space.
- **Tables / pinned blocks** behave like images for collision (rigid box), like text for
  internal reflow (rows extend).

**Floorplan first, then map.** The frame (`CanvasRules`) is authored/locked first — margins,
header/footer bands, image policy, page/slide cap. Content is then *mapped into* the frame,
snapped to a **grid**:

- **Snap targets:** the four margins, and a canvas-wide grid across the content column.
- **Definable spacing gaps:** a unit choice (**5 pt** default, or **cm**) sets the grid pitch
  and the inter-block gap; drag/resize snaps to it. This is what makes "almost anything"
  layable-out without free-floating chaos — everything lands on the grid or a margin.

Implications for the model: an image node gains an optional **box** (like `SectionLayout.box`,
§5) with grid-snapped `x/y/w/h`; a section's non-image content flows and wraps around any
boxed images it contains; the paginator (§6) collision-checks image boxes and reserves them
before flowing text. Documents keep flow-intent (compliance reflow); slides use true boxes
(§3, Phase 3). Grid + gap unit live on `CanvasRules` (a new `grid: { unit: 'pt'|'cm'; size }`).

### 5d. Template extraction on ingest (founder, 2026-07-18)

Ingesting old proposals builds the **library** (atoms) *and*, when the admin declares a
package **a sound template** ("standard AFWERX 15-page with these sections"), yields a
reusable **template** in one pass. Extraction = **keep the frame + the section skeleton,
strip the specific content**: the floorplan (`CanvasRules`), the ordered section titles/
headings, each section's **page budget** and layout intent (flow / keep-together), and the
FROM-pedigree (agency/program/phase) — but not the prose/figures. The result is a
`document_templates` row (frame in `canvas_preset`, skeleton in `canvas_document`) that
"new document from template + library" (Phase 5) drafts into. This is Phase 5 pulled forward
to ingest time, because that is where the admin already knows the structure is sound.

**A document is not one glob — it is a skeleton with well-defined organs, muscles, and skin,
and the organs are transplantable (founder).** The canonical containment chain (founder) is:

> **document → header · footer · margins (the frame) → section → group → atom**

and it maps 1:1 to the model — `CanvasDocument` → `CanvasRules.{header, footer, margins}` →
`CanvasSection` → `CanvasGroup` → `CanvasNode`. In anatomy terms: **skeleton** = the frame
(`CanvasRules` — the header, footer, and margins the whole body hangs on); **organs** =
sections; **muscles** = groups (a "Team Bios" group, a figure, a table); **skin** =
heading/node styling + the floorplan's visual rules. Each organ and muscle is a **typed, swappable slot** with a clean interface —
a section carries a `section_type`, a group a slot `kind` (narrative / figure / table / list)
+ `keep_together` — so "draft from template" **fills** each slot from the library, and you can
later **replace a kidney** (swap one section or group for a better library atom/group via
`source_atom_ids` / `atom_ref`) without disturbing the rest of the body. Extraction preserves
exactly this anatomy and strips only the tissue (the specific prose/figures).

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
| **Formatting toolbar** | always-visible Insert group (heading/text/list/table/image/caption) + Format group (bold/italic/align/size/color) on the selected block | **SHIPPED** (`CanvasToolbar`) |
| **Floorplan** | `CanvasRules`: margins, header/footer template+font, slide zones, font floor, image policy, page cap | built (sidebar Settings) |
| **Sections** | ordered section list; per-section **page-fill bar** (used/budget), **mode** toggle (flow / keep-together / pinned), **drag-resize** budget handle; a **total-pages gauge vs max_pages** (green/amber/red) | **gauge SHIPPED** (`VolumeLayoutGauge`, all doc types); mode toggle + drag-resize = Phase 4 |
| **Insert from Library** | pick atoms/groups → drop into the active section | built (`LibraryInsertPanel`) |
| **Annotate / Atomize** | the box toolkit (§7), ingest mode | NEW |
| **AI** | draft/revise a section into its budget; **"fit to budget"** (shorten to hit target) | draft exists; add fit |
| **Collaborate** | node/section comments, presence, stage-scoped edit | comments exist |
| **Export** | per-section **docx / pptx / xlsx / pdf** from the toolbar; per-volume native + PDF from the workspace | **SHIPPED** (pdf added to both section routes with a 503-when-Chromium-down fallback) |

The **drag-resize** is your P1→P2 story: each section shows a page allowance; drag its
handle to give it fewer/more pages; the live `paginate` re-measures; a section that no
longer fits turns red with "AI fit to budget" / "trim." Allow a temporary **overrun band**
(e.g. +5 pages P1→P2) as an artifact policy — the gauge shows amber in the band, red past
it — then "tighten to 10" by pulling section budgets down until green.

## 8a. The ONE canvas — what's constant vs what varies (founder, 2026-07-18)

**There is a single canvas ("browser") for every user, every role, every artifact
type, every stage.** Switching from a locked Technical Volume to a Cost Volume — or
logging in as a partner instead of the tenant admin — **does not swap the canvas.**
Three things vary on top of the one constant shell:

**Constant (the shell):** the editor chrome (title/status/save/export/undo), the
document model (`document → header · footer · margins → section → group → atom`), the
sidebar frame, and the library. Same component (`CanvasEditor`) mounted everywhere —
admin and portal, via thin per-context wrappers (`CanvasEditorPage`,
`TemplateCanvasEditor`). Confirmed: no fork.

1. **Content rendering — varies by ARTIFACT TYPE.** A document paginates + flows
   (`CanvasRenderer`), a deck lays out slides (`SlideEditor`), a spreadsheet is a grid
   (`SheetEditor`). Same shell, swap the *inner renderer* — never the shell. *(Divergence
   to reconcile: `SheetEditor` is currently an early-return fork with its own chrome;
   it must become a renderer inside the common shell, the way `SlideEditor` already is.)*

2. **Tools — vary by ROLE × PROCESS-STAGE.** All toolbars exist for everyone; their
   **enabled/visible** state is resolved from `(role × stage × artifact-type × permission)`
   — not hidden per-user, *gated* per-context. Ingest/curation → the annotate+atomize
   toolbar; draft → format + insert-from-library + AI-draft; review → comment; lock →
   read + export. A partner_user in review sees comment enabled; a tenant_admin in draft
   sees the full authoring set; a locked section is read+export only. This is a single
   pure resolver — `resolveCanvasCapabilities({ role, stage, artifactType, permission })
   → { canFormat, canInsertLibrary, canAtomize, canAnnotate, canComment, canDraftAI,
   canEditStructure, canManageFloorplan, … }` — that every toolbar/panel reads, so the
   gating is defined once and identical across the shell. (Today's `readOnly` +
   `canAtomize`/`canInsertLibrary` flags are the seed of this resolver.)

3. **Data — varies by the DOCUMENT loaded.** Same shell, different content; a v2
   section doc normalizes to editable flat nodes on load (`toEditableFlat`) and
   re-sections on export.

**Net:** one canvas; the renderer follows the artifact type, the tools follow role×stage,
the content follows the document. That is the whole document-and-library solution — and
because the foundation is already one shared editor, reaching it is an evolution (a
capabilities resolver + folding `SheetEditor` into the shell), not a greenfield.

**8a-i. Third target: standalone documents (Tier 2, ✅ SHIPPED).** The same shell now
serves a THIRD persistence target alongside proposal sections and admin templates:
a **standalone tenant document** (`tenant_documents`, mig 110) — the founder's *"quick
document creation from template and library … a super simple 1-page flier or the whole
proposal."* Entry is `/portal/[t]/documents` → **+ New Document** → a chooser
(`/documents/new`) that starts from a **blank preset** (flier / letter / deck / workbook)
or from any **`document_templates`** skeleton (the tenant's own extracted templates + the
system library — the same rows the extraction flow writes; §5d). `starterFromTemplate`
resolves the skeleton three ways (real body → `toEditableFlat`; outline-only
`metadata.sections` → one heading per name; else page-rules-only), and the doc opens in
`CanvasEditorPage` (now dual-mode: section **or** document). Tools are resolved by
`resolveDocumentCapabilities` — the standard resolver with the proposal-scoped powers
(section-lock, proposal-comments, harvest-to-library, proposal-grounded AI, ingest
annotate) **masked off**, since no section/matrix sits behind them; **insert-from-library
stays on** (tenant-scoped), so "from template AND library" holds. Save is the same
optimistic-locked contract (`baseVersion` compare-and-swap); export reuses the same real
docx/pptx/xlsx/pdf exporters. One shell, three targets — the renderer still follows the
artifact type, the tools still follow role×stage.

## 8b. The toolbox — the sidebar as a role×context card list (founder)

The sidebar is **one component-card list**. Which cards show, and their order
(**most-likely-for-this-context first**), is resolved by `resolveCanvasToolbox`
(`lib/canvas/toolbox.ts`) on top of the capability resolver. `cards[0]` is the
**primary** tool for the (role × context); ambient cards (Compliance/Status,
Export) sort last. Sometimes the list is essentially one card; sometimes many.
Walked end-to-end across every actor (verified in `__tests__/canvas-toolbox.test.ts`):

| Actor (role) | Context | Primary card | Toolbox (ordered · `[ambient]`) |
|---|---|---|---|
| **Collaborator** (partner_user) | review · comment grant | **Review · Modify · Lock** | Review · `[Compliance · Export]` — *essentially one card* |
| Collaborator | draft · edit grant | **Insert** | Insert · Format · Library · AI · Review · `[…]` |
| Collaborator | view grant | *(none)* | `[Compliance · Export]` only |
| **RFP Admin** | **ingest an RFP** | **Annotate & Atomize** | Annotate · Template · Sections · Floorplan · Insert · Format · Library · AI · `[…]` — *many* |
| RFP Admin / Tenant Admin | template building | **Template** | Template · Sections · Floorplan · Insert · Format · Annotate · Library · `[…]` |
| **Tenant Admin** | proposal build (draft) | **Insert** | Insert · Format · Library · AI · Sections · Floorplan · Template · `[…]` |
| Tenant Admin | review | **Review · Modify · Lock** | Review · AI · Format · `[…]` |
| Tenant Admin | ingest (own library) | **Annotate & Atomize** | *(as RFP-admin ingest — the tenant curates its own library)* |
| **Tenant User** | draft | **Insert** | Insert · Format · Library · AI · `[…]` — *no curation/structure cards* |
| **Anyone** | locked (ToDo done) | **Review** | Review · `[Compliance · Export]` — read + comment + export |
| **Automation** (agents) | headless | — | no sidebar; the same capability/route gates apply server-side |

Each card is capability-gated (§8a) and stage-ordered. **The cards are actionable**
(`onToolAction` / tab switch), not just indicators: Compliance/Insert/Format/
Floorplan/Review → sidebar tabs; Library/Atomize/Export/Template → the editor's
panels/rails/actions. **"Complete your ToDo" = Complete & Lock**, wired from the
canvas (toolbar button + the Review tab) to the admin-gated section-lock route
(`canLock`); a non-admin editor saves and an admin accepts+locks. The **Review
tab** is the collaboration workbench — section comments + revise-on-canvas +
Complete & Lock — so a collaborator's primary card is a first-class flow. The
card *bodies* are today's panels (Compliance, Node/Format, Insert, Floorplan =
Settings, Review = comments + lock) plus the editor rails (Library insert,
Annotate/Atomize) and actions (Template = save-as-template from the canvas,
Export) — the toolbox decides which appear, in what order, for who, and launches
each.

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

**Phase 2 — Annotation atomizer. ✅ SHIPPED.** The recommendation view + click/box/group/section
tools + bulk context tagging, writing atoms/groups/sections with `SourceAnchor` regions.
*Outcome: upload a package and box-and-tag it into reusable, sectioned content in one
pass.*

> **As-built (2026-07-19).** `components/portal/atomizer.tsx` is the annotation
> atomizer. Upload (`atoms/upload` now returns each block's real `nodes` +
> `primaryType`) or paste → typed, selectable objects. Mint at the right GRAIN:
> image → a **figure atom**; table/list → one **extendable atom** OR a **group of
> rows/items** (`splitTableRows`/`splitListItems`); several objects → a **group**
> ("Team Bios"). A **section tray** boxes a **section** over the groups/atoms you
> made (a group-of-groups — "Team Section", tagged `kind:section`). A **session
> FROM-pedigree** (agency/program/phase/sol/topic) stamps every mint; every atom
> keeps a `SourceAnchor` to its source block. Verified against the live DB: figure
> atom, table→2-row group, Team Bios group, Section=group-of-groups, context tags,
> and lineage all persist. The box-drawing marquee over a rendered page (vs the
> structured object list) is the one visual enhancement deferred.

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
