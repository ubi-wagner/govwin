# Canvas styling and editing — what is usable today

**Last measured:** 2026-08-24, against the running app and the artifacts it produces.

This is the answer to "what can an author actually do, and will it survive the file they send the
government." Everything below is **measured**, not read off the source — three earlier attempts to
answer it from the code got it wrong, and the corrections are recorded at the end because the way
this was got wrong is reusable.

Two instruments back it:

| instrument | question it answers |
|---|---|
| `scripts/probe-style-matrix.mts` | does a style the model carries reach each exported format |
| `scripts/probe-deck-overlap.mts` | does a slide node's declared frame actually hold its content |
| `scripts/render-artifact-pages.mts` | what the customer sees — .pdf/.pptx/.docx/.xlsx → page images |
| `scripts/drive-control-reachability.mts` | can a person actually click it *(⚠️ incomplete — see Gaps)* |

---

## 1 · Styling — every capability, every format

The whole common Word/Google-Docs run of controls survives to every format that has the concept.
Measured by exporting the same document twice, once with the style and once neutral, and requiring
the artifacts to **differ** — presence alone proves nothing, because a writer can hardcode a value.

```
CAPABILITY               docx   pptx   xlsx  pdf/html
font family                 ✓      ✓      ✓         ✓
font size                   ✓      ✓      ✓         ✓
bold                        ✓      ✓      ✓         ✓
italic                      ✓      ✓      ✓         ✓
text colour                 ✓      ✓      ✓         ✓
underline                   ✓      ✓      ✓         ✓
strikethrough               ✓      ✓      ✓         ✓
highlight                   ✓      ✓      ✓         ✓
alignment                   ✓      ✓      ✓         ✓
indent                      ✓      ✓      ·         ✓
space before                ✓      ✓      ·         ✓
space after                 ✓      ✓      ·         ✓
shape fill                  ✓      ✓      ~         ✓
border                      ✓      ✓      ✓         ✓
opacity                     ·      ✓      ·         ✓
shadow                      ·      ✓      ·         ✓
rotation                    ·      ✓      ·         ✓

✓ the style did the work   · the format has no such concept   ~ applied, exact value unproven
```

**`·` is not a failure.** A spreadsheet cell has no paragraph indent; WordprocessingML has no
whole-run alpha. Those pairs are marked not-applicable deliberately, because a matrix with a column
of red nobody can act on is a matrix nobody reads.

**The one `~`.** `shape fill → xlsx` is applied — a shape in a worksheet is rasterised, so the fill
lands in the pixels of `xl/media/image1.png`. The artifact demonstrably changes when the fill is
set; what cannot be proven is that the *exact* hex arrived, because a colour is not locatable inside
base64 PNG bytes. Reported as partial rather than green, because a tick that means less than it says
is worse than an honest qualifier.

### Two formatting systems, not one

This distinction is invisible from the code and matters to anyone extending it:

* **Inline runs** — `InlineFormat` on a span of characters inside a text node: bold, italic,
  underline, superscript, subscript. Applied by the floating toolbar that appears on a selected text
  node (`canvas-renderer`, via `applyFormat`).
* **Node style** — `NodeStyle` on the whole node: everything in the table above. Applied by the
  block toolbar and the properties panel (`canvas-toolbar`, `node-format-controls`, via `onStyle`).

The matrix above measures **node style**. Inline-run survival through the four writers is a separate
question and is **not yet measured** — see Gaps.

---

## 2 · Which controls apply to which node type

Four groups, mirroring the ribbon tabs people arrive from (`lib/canvas/format-controls.ts`):

| group | what it carries | node types |
|---|---|---|
| **text** | font · size · B/I/U/S · colour · highlight · alignment | heading, text_block, bulleted_list, numbered_list, caption, footnote, url, text_box, callout, blockquote, shape, code_block, equation, signature |
| **box** | fill (+opacity) · border colour/width/style/radius · opacity · rotation · shadow | shape, text_box, callout, image, chart, video |
| **arrange** | position x/y/w/h · text wrap · **layering** | shape, text_box, image, chart, video |
| **element** | the one type-specific control | shape kind · callout variant · chart type · divider style · code language · signature label |

A node shows exactly the groups its type supports — a heading has no fill, an image has no
strikethrough.

---

## 3 · Layering

`position.z` orders overlapping content. The editor and the PDF path have always honoured it; the
**deck exporter did not until 2026-08-24**, because in PowerPoint z-order *is* emission order and the
writer emitted in document order. A dense slide's arrangement came back rearranged.

Verbs live in **Arrange**:

| verb | effect |
|---|---|
| Bring to front | `z = 900` — drawn last, sits on top |
| Send to back | `z = 1` |
| Send behind text | `wrap = 'behind'` — the floor, below every un-layered node |
| reset | back to the default `z = 5` |

The sort is **stable**: equal z keeps document order, so a deck with no layering is never reshuffled
by the mechanism meant to preserve arrangement. Locked by
`__tests__/unit/pptx-layer-order.test.ts`, whose cases move the *first* node to the front and the
*last* to the back — the only shape of test that can distinguish a writer that sorts from one that
does not.

### A slide node is sized from its text — since 2026-08-24

Until B121 the deck writer sized six node types without reading their text: a table was
`rows × 0.36in`, a list `items × 0.42in`, a paragraph `length / 95`. Each describes a single line at
one assumed width and font size, so a wrapping cell was taller than the frame it was given — **and
PowerPoint clips rather than spilling.** A three-row risk register was delivered with its third row
absent; a three-bullet list was delivered with its third bullet painted underneath an opaque
callout. Heights now come from `wrappedLines`, the page ruler's own model, so a deck and a document
cannot disagree about the same paragraph.

**This is why authoring dense is safe and why the checks above were not enough.** The bytes were
always complete — every row is in the slide XML. Only a rendered page shows the loss.

### Off-frame content is supported, not a defect

A proposal deck is authored dense. Primitives and groups may sit partly or wholly off the frame on
the canvas and be cropped on export — that is a design decision, and the compliance floor treats it
as one. `slide_overflow` is **advisory**: it is reported so an author never discovers a crop in the
delivered file, and it does **not** make the deck non-compliant.

That severity split is the point. A gate that cannot tell "the agency will reject this" from "you
packed a slide" teaches people to ignore it — and the page-limit warning is the one that saves a
bid. `blockingViolations()` is what the `compliant` verdict counts; the full code list is still
emitted, so nothing is hidden.

---

## 4 · Where the controls are

| surface | where formatting lives |
|---|---|
| **document** (letter/custom) | block toolbar across the top · floating inline toolbar on a selected text node · properties panel → **Node** tab |
| **deck** (16:9 / 4:3) | `SlideEditor` canvas · same properties panel |
| **sheet** (spreadsheet) | `SheetEditor` — its own cell-styling path (`resolved.style`), separate from `NodeStyle` |

**Two things worth knowing before looking for a control:**

1. The block toolbar's buttons render **disabled until something is selected**. Present and usable
   are different states.
2. The properties panel is **tabbed and opens on `compliance`**, and the shape, arrange and layering
   groups live under **Node**. Selecting a node now **moves the panel to Node for you** — but only
   from that default tab. The guard is the substance of the fix: the `Add` tab selects the node it
   just inserted, so a rule that fired on every selection would throw the author out of the insert
   panel on every insert, which is worse than the friction it removes. Moving off `compliance` is an
   expressed preference; sitting on the untouched default is not. `shouldFocusNodeTab`
   (`lib/canvas/format-controls.ts`), unit-tested in both directions — the naive unconditional rule
   fails six of the ten cases.

---

## 5 · Gaps — what is NOT usable or NOT measured

Stated plainly, because a capability document that lists only what works is a sales sheet.

**A stated bias, not a bug.** The table of contents now carries page numbers with leader dots,
resolved from `paginate().perNode` — the same ruler the export gate judges the document by, so an
entry points at the page a heading ACTUALLY prints on rather than where a naive height division
would put it. That ruler is deliberately tuned to over-count rather than under-count (B64), and the
contents page inherits the bias: on a long document a late entry can read **one page high**.
Measured — a twelve-page volume whose References section prints on page 12 is listed at 13.

Calibrating the TOC against a rendered PDF would fix the number and create a second opinion about
pagination, disagreeing with the editor gauge and the export gate; B112 records what that costs. One
ruler, one answer. If the numbers must be exact, the fix is to make the ruler exact.

**Absent from the model entirely** — these cannot be authored at all:

* **per-node line spacing** (there is a document-level `line_spacing`, but no per-node override)
* **theme / colour palette** — every colour is a raw hex; no named theme colours, so brand
  consistency across a proposal is manual
* **list style / bullet character / numbering format**
* **table cell merge** (`colspan` / `rowspan`)
* **multi-column text**, **small caps**, **tab stops**

**Built but unmeasured:**

*(A boxed node's height used to sit here. It is now measured — by text baseline against the box
rect rather than by ink, since a node that paints its own fill defeats an ink measurement.)*

* **inline-run survival through the writers.** The matrix covers node style. Whether a
  superscript run inside a paragraph reaches `.docx` is not proven.
* **control reachability per surface.** `drive-control-reachability.mts` exists and is instrumented
  (`data-control` attributes across the format components) but reports zero controls on all three
  surfaces, which is provably wrong — an existing document opened by hand shows the toolbar
  rendering. It is committed with a WIP banner and **deliberately not registered in the branch
  suite**. Ruled out as the cause, by measurement: the save is fine (a fresh create+save lands
  `node_count=2`, `canvas.nodes` length 2).

---

## 6 · How this was got wrong, three times

Kept because the failure mode is reusable, and every one of these produced a confident, specific,
wrong answer.

**Grep for a style key.** `style.highlight` reported "highlight is exposed in 0 components" and a
fully built, wired control was recommended as missing work. The component destructures to `s`, so
`s.highlight` never matched.

**Regex over an artifact.** The first style matrix reported `bold → xlsx ✓`. False — the heading
case hardcodes `bold: true`, so `<b/>` is in the file whether or not the author asked. Proven by
exporting `weight:'normal'` and `weight:'bold'` and getting identical bytes. *A matcher that cannot
tell honoured from hardcoded reports the writer's defaults back as the customer's formatting.*

**Difference without normalising.** With difference as the signal, the xlsx column flipped after a
change touching only pptx. OOXML stamps `docProps/core.xml` with `dcterms:created`, so two exports
of the same document differ across a second boundary — the probe was reading the clock.

**Measuring the wrong slide.** The slide-balance test built every case with a level-1 heading and
`text_block` siblings — which is exactly the condition that routes to the HERO layout, a path with
its own fixed constants that never reads the code under test. Three assertions passed and one
failed, all four about a hardcoded subtitle and an accent rule.

**Three instruments for one defect, each convincing, each wrong** (B121). Declared geometry: always
clean, because the writer leaves a tidy gap under the frame it believes in. Ink position: caught the
table, passed the list. Text presence: found every authored phrase *including the invisible one*,
because occluded text is still painted into the PDF.

The rule that survives all of them: **the first output of a new instrument describes the
instrument.** Validate it against a known answer — in both directions — before believing a finding.

---

*Regenerate the matrix: `cd frontend && npx tsx scripts/probe-style-matrix.mts` — it is a survey and
always exits 0. Two consecutive runs must agree exactly; if they do not, the instrument is unstable
and its output is not evidence.*
