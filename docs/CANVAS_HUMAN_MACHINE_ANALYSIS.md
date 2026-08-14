# Canvas Capability Analysis — Human × Machine (2026-08, re-run)

> **Historical analysis (2026-08 snapshot).** Canonical canvas architecture: `docs/CANVAS_ARCHITECTURE.md`.

A fresh, evidence-grounded re-run of the four-phase canvas analysis, this time along the
two axes that matter for the ask: **how easily can a HUMAN, and how well can the MACHINE,
_add · modify · refine · regenerate_ every common content type — with styling and
primitives — and control the frame (size / margins / header-footer) across extensible
pages · slides · sheets?**

Method: not a re-read. Three lenses were exercised against the live tree (`2873492`):
an empirical export harness (one node of every type × 3 formats × 4 exporters), a
full editor-surface map, and a full agent-production map. Every verdict below traces to
code (`file:line`) or a run artifact.

---

## 0. Executive verdict

**The foundation is strong; the disappointment is real and specific.** The canvas *data
model* (22 node types, full styling, frame spec) and the *export layer* are genuinely
robust — 18+ primitives round-trip to docx/pdf/pptx/xlsx with zero exporter failures. So
the "canvas errors" are **not** in whether content types exist or export. They live in the
**authoring surfaces**:

- **The human editor is rich but has two data-affecting bugs and a cluster of
  insert-and-freeze types.** You can *add* a chart, a callout, a code block, a text box,
  an equation — and then you cannot *edit their content at all*. "Replace from Library"
  silently corrupts an image/table/chart. Free-positioning ("Arrange") is a no-op the
  WYSIWYG promise disowns.
- **The machine is thin.** Every AI path emits 4 of 22 node types (heading, text, two
  list kinds), never styles anything, never touches the frame, and — outside one
  auto-strawman — only reaches the canvas when a human clicks to land it.
- **The frame is rigid.** You cannot switch a document to a deck, set a custom page size,
  or style the header/footer font; format is fixed at creation.
- **Discoverability is fragmented.** Three disjoint insert menus and two disagreeing style
  surfaces mean a user hunting for "Chart" or "Footnote" often won't find it.

The model can hold a rich, styled, multi-format document. The human can *almost* author
one (with sharp edges). The machine can only draft its plain-text half. Closing that
triangle — not rebuilding the model — is the work.

---

## 1. The three-layer reality

| Layer | State | One-line |
|---|---|---|
| **Model + Export** | **STRONG** | 22 node types; all common primitives export to docx/pdf/pptx/xlsx; charts native in pptx, rasterized in docx, SVG in pdf. No exporter throws. |
| **Human editor** | **RICH but DEFECTIVE** | Every base type fully editable + true inline B/I/U; but 2 BROKEN paths, 6 insert-and-freeze extended types, fragmented menus, rigid frame. |
| **Machine (agents)** | **THIN** | 4/22 node types, no styling, no frame authoring; 1 autonomous write path, the rest advisory→human-lands. |

The gap between what the **model can hold** and what the **human/machine can author** is
the whole finding.

---

## 2. Empirical export fidelity (the reassuring layer)

Built one node of all 22 types (styled) into a letter doc, a 16:9 deck, and a spreadsheet;
exported each through the real exporters.

- **All 5 export runs succeeded; zero throws.**
- **18 primitives render** in docx/pdf/pptx: heading, text, bulleted/numbered list, table,
  image, text_box, callout, code_block, blockquote, equation, video, signature, url,
  caption, footnote, shape, chart.
- **chart**: native OOXML chart in pptx (`chart1.xml`), rasterized PNG in docx, SVG in pdf.
  ⚠️ docx has a `[Chart: bar]` placeholder *fallback* (`docx-exporter.ts:622`) if raster
  is unavailable — a conditional fidelity risk in a no-raster environment.
- **xlsx** lays prose nodes (heading/callout/code) into cells + tables into sheets + shapes
  into a drawing overlay — not tabular-only.
- The unified size ruler is frame-aware: it flagged the 22-node deck as `slide_overflow`.

**Takeaway:** export is not where the errors are. Effort belongs upstream, in authoring.

---

## 3. HUMAN capability matrix

Verdicts: **WORKS** · **HARD** (many steps / undiscoverable) · **BROKEN** (no-op or corrupts) · **MISSING**.

### 3a. Add / Modify / Style, by content type

| Content type | Add | Edit content | Style | Verdict |
|---|---|---|---|---|
| heading (H1/2/3) | ✅ | ✅ inline + level | ✅ | **WORKS** |
| text_block | ✅ | ✅ inline + **char-range B/I/U/sup/sub** | ✅ | **WORKS** (corrects prior "no inline formatting" claim) |
| bulleted / numbered list | ✅ | ✅ add/indent | ✅ | **WORKS** |
| table | ✅ | ✅ cells, +row/col | ⚠️ cell bg/fg/border only in **spreadsheet** mode, not doc mode | **HARD** |
| image | ✅ | ✅ replace/alt/size | ✅ box style | **WORKS** |
| caption / footnote / url | ✅ | ✅ inline | ✅ | **WORKS** (footnote/url are Add-tab-only) |
| shape | ✅ | ✅ kind + inner text | ✅ fill/border/rotate | **WORKS** |
| **chart** | ✅ | ❌ **data frozen** (only type+title editable) | ✅ box | **insert-and-freeze** |
| **text_box** | ✅ | ❌ **body uneditable** | ✅ box | **insert-and-freeze** |
| **callout** | ✅ | ❌ **body uneditable** (only variant+title) | ✅ box | **insert-and-freeze** |
| **code_block** | ✅ | ❌ **code uneditable** (only language) | — | **insert-and-freeze** |
| **blockquote** | ✅ | ❌ **no editor at all** | — | **insert-and-freeze** |
| **equation** | ✅ | ❌ **LaTeX uneditable** | — | **insert-and-freeze** |
| divider / signature | ✅ | partial (signature label) | — | **WORKS (thin)** |
| **video** | ❌ **no insert path anywhere** | — | — | **MISSING** (type+renderer exist, unreachable) |

### 3b. Frame (page setup) — `canvas-sidebar.tsx` Settings tab

| Control | Verdict |
|---|---|
| Margins, default font+size, line spacing, max_pages/slides, header/footer template | **WORKS** |
| Header/footer **font** | **MISSING** (hardcoded size 10) |
| **Change format** (letter ↔ slide 16:9/4:3 ↔ spreadsheet) | **MISSING** — fixed at creation |
| **Custom width/height**, 4:3 slides | **MISSING** |
| min_font / images_allowed / watermark | **MISSING** (in spec, no UI) |
| Frame controls in **spreadsheet** mode | **MISSING** (SheetEditor has no sidebar) |
| Gating | loose — a `tenant_user` can change the page-cap the capability model reserves for admins (`capabilities.ts:92` vs sidebar render `:421`) |

### 3c. Workspace / extensibility

| Capability | Verdict |
|---|---|
| Add page / slide / sheet-tab, rows+cols, slide thumbnails, tab rename | **WORKS** |
| One shell adapts doc / slide / sheet | **WORKS but divergent** — the **spreadsheet fork loses** sidebar, AI, comments, history, frame, autosave, and 20 of 22 node types |
| Free-position on a slide (PowerPoint-style) | **BROKEN** — `node.position` ignored by the renderer; no drag handles |
| Section/group structure (keep_together / page_budget) | **MISSING** — v2 flattened on load (`toEditableFlat`); the "Sections & Budget" card is suppressed |

### 3d. Refine / Regenerate (human-triggered AI)

| Entry point | Verdict |
|---|---|
| Per-node AI revise (regen/shorter/longer/fix-compliance…), **text_block & heading only** | **WORKS** (live) |
| Same on **standalone documents** | **MISSING** — documents mask `canDraftAI` |
| Same on tables/images/lists/extended nodes | **MISSING** |
| Draft All Sections (bulk) · Proposal Studio (Draft→Refine→Compliance) · Stage→Accept AI | **WORKS** (Studio stages; a human accepts) |
| Inline / slash / at-cursor AI | **MISSING** — it's a sidebar panel only |

### 3e. Proven defects (the real "canvas errors")

1. **BROKEN — "Replace from Library" corrupts non-text nodes.** Shown for *every* node
   (`canvas-sidebar.tsx:607`), it overwrites any node's content with `{text: atom.content}`
   (`canvas-editor.tsx:542`), destroying an image/table/chart shape (image loses
   `storage_key`). Data corruption; an error boundary hides the white-screen but the node is
   mistyped.
2. **BROKEN — "Arrange" free-positioning is a silent no-op.** The sidebar writes
   `node.position` (x/y/w/h/wrap); `CanvasRenderer` never reads it. The "what you see is
   what exports" promise is false for any positioned element.
3. **6 extended types are insert-and-freeze** (§3a) — you can add them but not edit their
   core content.
4. **`video` is unreachable** — modeled, rendered, but on no insert surface.
5. **SheetEditor formula bar is cosmetic** — `=A1+B1` is stored as literal text; no
   `formula`/`number_format` editor. Size/font selects change the whole-doc default, not the
   active cell.
6. **Admin document editor** hardcodes `actorId="admin"` and disables autosave (no
   `autosaveKey`); spreadsheet mode has no localStorage recovery.
7. **Discoverability tax** — 3 disjoint insert menus (toolbar Insert · toolbar Elements ·
   sidebar Add) and 2 disagreeing style surfaces (toolbar text-only vs sidebar all-nodes).

---

## 4. MACHINE capability matrix

| Capability | Verdict | Where it lands |
|---|---|---|
| Auto strawman on proposal creation (`draft_v0`) | **WORKS** (autonomous, 4 types, empty sections only) | live content |
| Human-clicked Draft-All / per-section | **WORKS** (live, 4 types) | save route |
| Per-node text refine (shorter/longer/regen) | **WORKS** (live, **text only**) | node in editor |
| **Rich node types** (table/image/chart/callout/shape/code/eqn/…) | **MISSING** | — |
| **Node styling** (font/color/align/inline emphasis) | **MISSING** — `style:{}` everywhere; emphasis stripped | — |
| formatter reformat / stylist restyle | **ADVISORY-ONLY** (staged) | `canvas_versions` via human `land-revisions` |
| continuity / traceability / redaction | **ADVISORY-ONLY** (findings, not canvas) | review report |
| Full-draft (Modes A/B/C) + Proposal Studio | **ADVISORY-ONLY** (human lands both hops) | `land-revisions`→`accept-ai-revisions` |
| Charts / images | **MISSING** — no generation tool | — |
| Frame authoring by agents | **MISSING** — frame frozen from the admin mold | — |

**The node-type ceiling is the load-bearing fact:** both generators (`pipeline/…/markdown_to_canvas.py`,
`frontend/lib/tools/proposal-draft-section.ts`) emit exactly heading / text_block /
bulleted_list / numbered_list, and the pipeline builder's own docstring says tables/images
are "intentionally out of scope." The machine drafts competent prose; it cannot compose the
document's richer, styled half.

---

## 5. Adversarial critique — why it *feels* broken

A user who opens the editor, adds a callout and a chart to make a page look designed, and
finds neither can be edited — then clicks "Replace from Library" on an image and watches it
break — will (correctly) conclude the canvas is unreliable, even though text/table/list
authoring and every exporter are solid. The failure is one of **honesty of affordance**: the
UI *offers* twelve extended primitives and a free-position "Arrange" panel it cannot honor.
The same asymmetry hits the machine: the Studio promises a full draft, but what lands is
plain prose in four node types, no styling — the rich look the model advertises never
arrives from AI. **The fix is to make the surfaces tell the truth: either finish the
insert-and-freeze editors and the position renderer, or don't offer what can't be edited;
either teach the generators the richer node types, or label the draft as a text strawman.**

---

## 6. Prioritized plan (STOP — for sign-off, not yet built)

Tiered so each tier is independently shippable. Nothing below is built yet.

### P0 — Stop the bleeding (bugs; ~0.5–1 day)
- **P0.1** Guard "Replace from Library" to text-bearing nodes only (or type-preserving map); hide it for image/table/chart. *(defect #1)*
- **P0.2** Either render `node.position` (absolute box in the flow) or hide the "Arrange" panel until it does. *(defect #2)*
- **P0.3** Fix the SheetEditor "Size/font" mislabel (target the cell) and make the formula bar set `formula`/`value` or drop the `fx` affordance. *(defect #5)*
- **P0.4** Give the admin document editor a real actor + autosave key. *(defect #6)*

### P1 — Author-parity for the extended primitives (~2–3 days)
- **P1.1** Add content editors for chart (categories/series grid), text_box, callout body, code_block code, blockquote, equation LaTeX. *(the insert-and-freeze cluster)*
- **P1.2** Doc-mode table cell styling (bg/fg/border) — reuse the sheet-mode controls.
- **P1.3** Wire `video` into an insert surface (or remove the type).
- **P1.4** Unify the three insert menus into one categorized picker; reconcile the two style surfaces.

### P2 — Machine coverage (~3–4 days)
- **P2.1** Teach the generators (both) a richer node vocabulary: at least `table` and native `chart` from structured data, and pass-through of inline emphasis.
- **P2.2** Have `formatter`/`stylist` set real `style` (fonts/colors/alignment) in their staged canvas, not just scaffold.
- **P2.3** Extend per-node AI refine beyond text_block/heading (lists, table cells) and to standalone documents.

### P3 — Frame & extensibility (~3–5 days)
- **P3.1** Format switcher (letter ↔ slide 16:9/4:3 ↔ spreadsheet) + custom width/height + header/footer font, in a real page-setup panel; fix the frame-edit gating to match `canManageFloorplan`.
- **P3.2** Section/group structure editing (keep_together / page_budget) instead of flatten-on-load.
- **P3.3** Bring the spreadsheet fork up to shell parity (autosave, frame, comments) or converge the three shells.

### Cross-cutting
- The **polymorphic artifact key / "one canvas"** refactor (deferred in the build log) is
  the structural unlock that makes standalone documents first-class (versions, comments,
  AI) — it underlies P2.3 and much of P1 for documents. Scope it explicitly before P2.

**Recommendation:** do **P0 now** (they are proven bugs), then decide P1 vs P2 by whether the
priority is *human authoring polish* or *machine authoring reach*. I can turn any tier into a
worked, tested change set on approval.

---

## 7. Implementation ledger — P0 + P1 SHIPPED (for launch)

Signed off for launch as "P0 + P1 100%." All landed on `claude/nice-hamilton-kBqtD`, each
`tsc --noEmit` 0 · `vitest` 987 green, committed + pushed.

| Item | What shipped | Commit |
|---|---|---|
| **P0.1** | Replace-from-Library maps a prose atom into a node's EXISTING text/code field and no-ops (returns null) for image/table/chart/list; button hidden for those types (`canReplaceFromLibrary`). No more shape corruption. | `6d3dce3` |
| **P0.2** | `NodeRenderer` renders `node.position` (absolute left/top/w/h in inches + z-index) for a non-inline wrap — mirroring the exporters. Arrange is WYSIWYG, not a silent no-op. | `6d3dce3` |
| **P0.3** | SheetEditor fx bar stores a real `formula` for `=`-values (xlsx exports a live Excel formula) while keeping the cost-volume numeric-value sync; the doc-wide Size/Font selects relabelled "Sheet font:". | `6d3dce3` |
| **P0.4** | Admin document editor uses the real signed-in actor (GET returns it) + an `autosaveKey` so autosave/recover works; no more hard-coded "Admin". | `6d3dce3` |
| **P1.1** | `NodeFormatControls` gains content editors for the 6 insert-and-freeze types — chart (categories + per-series data grid), callout body, code, text_box, blockquote (text + cite), equation (LaTeX + display). | `a3549d4` |
| **P1.3** | `video` wired into the Elements insert list + a url/caption editor (was a modeled orphan). | `a3549d4` |
| **P1.2** | Doc-mode table cell styling — a focused-cell toolbar (bold / align / background) writing `TableCellStyle`, which the renderer + all exporters already honor. | `1bf6489` |
| **P1.4** | The sidebar Add tab is now the ONE categorized insert surface — all 22 node types under Text · Structure · Media & elements (was 12; the extended elements were toolbar-only). | `c7e5231` |

**Deferred to P2/P3** (unchanged from §6): machine coverage (agents emitting rich types +
styling), the format switcher / custom page size / section-structure editing, and the
polymorphic-artifact "one canvas" refactor.
