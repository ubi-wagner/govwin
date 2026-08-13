# CANVAS_PRIMITIVES.md — the canvas primitive catalog

> **Current reference for the primitive catalog.** The canvas architecture single source is `docs/CANVAS_ARCHITECTURE.md`.

> **Canvas is everything.** Every artifact the platform produces — a proposal narrative, a cost
> workbook, a slide deck, a letter, a template, an OPP sheet — is ONE `CanvasDocument`: a typed,
> format-independent tree of **primitives** (nodes). A single set of renderers turns that tree into
> docx · pptx · xlsx · pdf · HTML, so a primitive added once shows up everywhere. This is the
> catalog of primitives, what each renders to, and how to add more. Add common ones freely — the
> contract below keeps every format in lockstep.
>
> Types: `frontend/lib/types/canvas-document.ts` · Renderers: `frontend/lib/export/{canvas-html,docx-exporter,pptx-exporter,xlsx-exporter}.ts` · In-app editor: `frontend/components/canvas/canvas-renderer.tsx`.

## The primitive contract
Every node is:
```ts
{ id, type: NodeType, content: <type-specific payload>, style: NodeStyle,
  provenance: { source, … }, history: NodeEdit[], library_eligible: boolean, position? }
```
- `type` selects the payload shape (the `*Content` interfaces) and the renderer branch.
- `style` (extends `FontSpec`) is the common run/box formatting every format understands.
- `position` (optional) lifts a node out of the text flow (free placement, slides).
- A document is `version 1` (flat `nodes[]`) or `version 2` (section→group→node); readers use
  `docNodes(doc)` to get a flat view of either.

## Catalog — current primitives

| Primitive (`type`) | Payload | docx | pptx | xlsx | pdf/html | Notes |
|---|---|---|---|---|---|---|
| `heading` | `HeadingContent` (level 1–3, text, numbering) | ✓ | ✓ | ✓ | ✓ | outline levels drive the TOC |
| `text_block` | `TextBlockContent` (text + inline formats) | ✓ | ✓ | ✓ | ✓ | the workhorse paragraph |
| `bulleted_list` / `numbered_list` | `ListContent` (nested items) | ✓ | ✓ | ✓ | ✓ | indent levels |
| `table` | `TableContent` (headers, rows, `TableCell` styling, `is_spreadsheet`, `sheet_name`) | ✓ | ✓ | ✓ (native cells) | ✓ | cells carry `value`+`number_format`+`cell_type` for real spreadsheet math |
| `image` | `ImageContent` (storage_key/data-URI, dims, caption) | ✓ | ✓ | ✓ | ✓ | S3 keys inlined at export |
| `caption` | `CaptionContent` (prefix Figure/Table/Chart, number, text) | ✓ | ✓ | ✓ | ✓ | renderer prepends "`{prefix} {number}. `" — do **not** repeat it in `text` |
| `chart` | `ChartContent` (see chart sub-primitives) | ✓ (rasterized SVG) | ✓ (native chart) | ✓ (rasterized) | ✓ (inline SVG) | **now labeled** — see below |
| `callout` | `CalloutContent` (info/warning/tip/note/success) | ✓ | ✓ | ✓ | ✓ | colored box |
| `blockquote` | `BlockquoteContent` | ✓ | ✓ | ✓ | ✓ | pull-quote |
| `code_block` | `CodeBlockContent` (language, code) | ✓ | ✓ | ✓ | ✓ | monospace |
| `shape` | `ShapeContent` (rectangle/ellipse/line/arrow/star/diamond/callout_bubble) + fill/border/opacity/rotation | ✓ (rasterized) | ✓ (native shape) | ✓ | ✓ | `renderShapeSvg` |
| `text_box` | `TextBoxContent` | ✓ | ✓ | — | ✓ | free-positioned box (ignores margins) |
| `equation` | `EquationContent` (LaTeX/MathML) | ✓ | ✓ | — | ✓ | math |
| `divider` | `DividerContent` | ✓ | ✓ | ✓ | ✓ | horizontal rule |
| `url` | `UrlContent` (href, text) | ✓ | ✓ | ✓ | ✓ | hyperlink |
| `toc` | `TocContent` | ✓ | — | — | ✓ | built from headings |
| `footnote` | `FootnoteContent` | ✓ | — | — | ✓ | |
| `signature` | `SignatureContent` (label, name, email) | ✓ | ✓ | — | ✓ | → vault/contract |
| `video` | `VideoContent` | link | link | — | embed | media |
| `page_break` / `spacer` | layout | ✓ | ✓ | — | ✓ | flow control |

### Chart sub-primitives (`chart.chart_type`)
`bar · line · area · pie · doughnut · scatter · **gantt**` — one shared renderer (`renderChartSvg`)
used by **all** formats. As of 2026-08-10 every chart renders WITH **category labels, y-axis value
ticks, a multi-series legend, and pie/doughnut slice labels** (previously unlabeled = an
uninterpretable picture). **`gantt` is a new standard**: a horizontal timeline where
`series[0].data` = start month and `series[1].data` = end month per `category` (milestone), drawn
with a month axis + per-row labels. This is the canonical way to render a Gantt/schedule (e.g. the
TVSF Q3 "native Gantt/timeline" mandatory element).

## Standards elevated this pass (2026-08-10)
- **Labeled charts** — charts are now real graphs, not pictures (labels/ticks/legend).
- **Gantt** — a first-class chart standard (`chart_type:'gantt'`), the canonical timeline primitive.

## Candidate primitives to add next (common, high-value — add as needed)
Pick from these as they come up; each is a small, well-scoped addition:
- **`timeline`** — a milestone/decision-gate timeline (distinct from a duration Gantt).
- **`kpi` / `metric`** — a stat tile (big number + label + delta) and KPI rows (dashboards, exec summaries).
- **`comparison_matrix`** — a first-class ✓/✗ capability matrix (today authored as a `table`; the TVSF Q2 competitor comparison is exactly this — worth promoting so it styles consistently).
- **`org_chart`** — team/key-personnel hierarchy (management sections).
- **`map`** — a location/geography primitive (site, service area).
- **`definition_list`** — term/definition pairs (glossaries, acronym lists).
- **`cover_page`** — a structured title/cover primitive (proposal + volume covers).
- **`checklist`** — a compliance/checklist primitive with checked state.
- **`swimlane` / `process`** — a process/lane diagram (workflows, SOWs).

## How to add a primitive (the checklist)
Adding a primitive is a bounded, five-touch change — keep all formats in lockstep:
1. **Type** — add the `type` to the `NodeType` union and a `*Content` interface in `lib/types/canvas-document.ts`.
2. **Renderers** — add a branch to `renderNode` in each exporter that supports it:
   `canvas-html.ts` (pdf/html), `docx-exporter.ts`, `pptx-exporter.ts`, `xlsx-exporter.ts`.
   Formats without a native equivalent should **rasterize an SVG** (see `renderShapeSvg`/`renderChartSvg`) so it still exports, never silently drops.
3. **Editor** — render + edit it in `components/canvas/canvas-renderer.tsx` (and the toolbox that inserts it).
4. **Compliance/estimate** — if it affects pagination or the format floor, teach `estimatePageCount` / `validateCanvasAgainstSpec`.
5. **Tests** — add a case to `__tests__/canvas-html-elements.test.ts` (+ any exporter test) asserting it renders with labels/content, and keep `tsc`/`vitest` green.

A primitive that renders in every format and survives export is "done." Anything less is a picture,
not a primitive.
