# CANVAS_ARCHITECTURE.md — the single source of truth for the canvas

**THIS is the one canonical canvas document.** Every other `docs/CANVAS_*.md` is historical analysis, a
build log, the data-model reference, or a superseded design that has been folded into this file — the full
map is §9. Read this first; when the canvas changes, change this.

_Last realigned: **2026-08-23** — a full design-vs-as-built re-verification against the code (the previous
realignment, 2026-08-13, had gone stale in BOTH directions: it understated two shipped phases and
overstated one gap). Every status in §2 and §7 below was re-read from source this pass; line refs marked
"(P1)" are Phase-1-dated (fact holds, exact line may have drifted)._

> **Two different things are called "one canvas". Keep them apart.**
>
> **(A) The unified canvas UI** — "one canvas, three surfaces, ONE interaction layer" (§3, §7). This is a
> *UI* programme. **Substantially shipped**: phases 0, 1 and 5 are done, phase 2 is built but unevenly
> mounted, phase 3 is part-done. Phases 4 and 6 are not.
>
> **(B) T2.x — the polymorphic artifact key.** This is a *data-model* refactor: re-key `canvas_versions`
> and `proposal_comments` off `(artifact_type, artifact_id)` so a standalone document stops being
> second-class. **Not done, and structurally visible:** `canvas_versions.section_id` is
> `NOT NULL REFERENCES proposal_sections(id)` (`017_canvas_templates.sql:49`) and
> `proposal_comments.proposal_id` is `NOT NULL REFERENCES proposals(id)` (`001_baseline.sql:382`), so a
> one-off document **cannot** carry version history or comments at all. No migration introduces
> `(artifact_type, artifact_id)` on either table. This is what `LAUNCH_READINESS_2026-08.md` descopes, and
> what T7.x (agents drafting letters/marketing) is gated on.

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
- **Selection-verbs (re-read 2026-08-23 — the previous text here was wrong on both counts).**
  `SelectionToolbar` accepts **all five** verbs as optional props — `onAtomize · onRegenerate · onAnnotate ·
  onReuse · onComplianceCheck` (`selection-toolbar.tsx:18-22`). What differs is what each host *mounts*:
  | Host | Verbs wired | Ref |
  |---|---|---|
  | Fluid document view | Atomize · Annotate · **Reuse · Compliance-check** (no Regenerate — read-only) | `fluid-document-view.tsx:543-546` |
  | Section canvas editor | Atomize · Regenerate · Annotate | `canvas-editor.tsx:1175-1177` |
  | Sheet editor | **none** — it returns before the shell | `canvas-editor.tsx:191` |
  So the verb *component* is unified; the **mounting** is not. That is the whole of the remaining Phase 2.
- **The fluid document view is the DEFAULT surface, not an admin-only tab.** `proposal-workspace.tsx:177`
  opens tenant-wide members on `document` and scopes non-tenant-wide collaborators to `my-sections` — which
  is simultaneously "fluid as default" (§7.5) and the collaboration lens (§3). The earlier "behind the
  admin-only Document tab" line described a state the product left behind. The tab row as rendered is
  **Document · All Sections · My Sections · Timeline** (`:228-230`; the `workspace` key is labelled
  "All Sections"), and the fluid view carries the §3 slim action bar — overlay chips left, save state right,
  with the comment at `fluid-document-view.tsx:437` recording that "the Manage tab-row dissolves into this."

> **A method note, because it cost a wrong statement in this very file.** The first pass of this review
> read the `OVERLAYS` **array** and concluded "Compliance + Budget do not exist." The screenshot of the
> running page showed five chips. Both layers were there, hand-rolled next to the shared bar. Reading a
> definition is not reading a surface — the same confusion that let a 200 stand in for a rendered page
> (bug log B78/B79). **For any claim in this document about what a user sees, look at the capture:**
> `docs/assets/guides/customer/09b-fluid-document.png`.
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

## 7. Phased path to the unified UI — status re-verified against source 2026-08-23

| # | Phase | Status | Evidence |
|---|---|---|---|
| 0 | Revert nav-sectioning (compartment drift) | ✅ **DONE** | — |
| 1 | Shared **`OverlayLayer`** | ✅ **all 5 layers on the default surface — but only 3 are SHARED** | `canvas-overlays.tsx:19-21` defines `sections · atoms · provenance`, mounted on the fluid view (`:437`), the section editor **and the sheet grid** (`sheet-editor.tsx:692`). **Compliance + Budget also ship** — but as hand-rolled buttons with their own `showCompliance`/`showBudget` state in `fluid-document-view.tsx:440-450`, reading real data (the compliance matrix `:100`, the page budget `:109`). So a reader of the fluid view sees all five chips; the editor and the sheet can never get the last two, because they are not in `OVERLAYS`. The gap is **not unbuilt layers — it is two layers built outside the shared abstraction.** |
| 2 | Unify **`ActOnSelection`** | 🟡 **BUILT, UNEVENLY MOUNTED** | All five verbs are props on `SelectionToolbar` (`:18-22`); the fluid view wires 4, the editor 3, the sheet 0. Nothing left to *build* — only to mount. |
| 3 | **Sheets into the shell** | 🟡 **PART-DONE — overlays only** | The sheet got `CanvasOverlayBar`, but `canvas-editor.tsx:191` still early-returns to `SheetEditor` *before* `CanvasEditorInner`, so it has no selection verbs, no sidebar, no AI. No ribbon. `sheet-media-strip.tsx:33` filters `image \| shape` → **no chart-from-range**. |
| 4 | **Slides finish** | ❌ **NOT DONE** | `slide-editor.tsx:35` still splits the flat node list on `page_break`; section=slide is not canonical. No `position` handling → no on-slide direct placement. |
| 5 | **Fluid as default** | ✅ **SHIPPED** | `proposal-workspace.tsx:177` — tenant-wide members open on `document`; scoped collaborators on `my-sections`. |
| 6 | Consistency pass (one action bar · one lens · one **`AssistPanel`**) | ❌ **NOT DONE** | No `AssistPanel` component exists (`components/canvas/` has `ai-revision-panel.tsx`, reachable only through `CanvasSidebar` → doc + slides). The lens shipped with phase 5; the single action bar did not. |

**The honest one-liner:** the *model* was already unified before this programme began (§1) — one
`CanvasDocument`, one `canvas.format` discriminator, no second type key. What phases 1–6 unify is the
**interaction layer**, and that is **about two-thirds done**: overlays and the fluid default are in, the
verb component is built but not mounted everywhere, and the two genuinely unbuilt pieces are the
**spreadsheet's escape from its early return** and the **shared assist panel**.

### 7a. What the unfinished phase actually costs — the cost volume is on the island

Phase 3 is not an abstract tidiness item. **Every cost/budget volume is a `spreadsheet`-format canvas**
(`lib/artifact-spec.ts:115` — `artifactType === 'cost'` → the spreadsheet preset; `artifact-export.ts:41`
→ xlsx; the `dod-sbir-phase1-cost` and `sf424a-budget` templates are declared `format:'spreadsheet'`,
`lib/templates/index.ts:189,221`). And `spreadsheet` is the one format that returns *before* the shell.

So the customer filling in the volume with the **highest compliance and arithmetic risk** — the one an
agency rejects outright for a wrong indirect rate or a missing form line — is the only one working without:

- the **selection verbs** (no Atomize, no Regenerate, no Compliance-check on a range),
- the **sidebar**, and with it the whole **Compliance tab** (`canvas-sidebar.tsx:531`), which is simply
  unreachable for a sheet because the sidebar mounts inside `CanvasEditorInner`, and
- any **AI assist** at all.

They do get the overlays (phase 1 reached the grid). The deterministic burden engine
(`cost-model.ts`/`cost-forms.ts`) is still the source of computed cells, so the *numbers* are sound — what
is missing is every affordance for checking, revising, or reusing them. Closing phase 3 is therefore worth
more than its position in the list suggests, and "add a ribbon + chart-from-range" undersells it: **the
valuable half is moving the early return so the sheet mounts the shell.**

### 7b. Phase 3 design — how the sheet gets into the shell (DESIGN, not yet signed off)

**Why it is not a wiring change.** `SheetEditor` is **1,225 lines** and is a *whole editor*: it owns
`doc` state (`:122`), undo/redo stacks (`:132-133`), the save cycle (`onSave`/`saving`/`dirty`/
`saveError`, `:127-129`, `:592`), cell + sheet selection (`:123-126`), and its own chrome — sheet tabs,
formula bar, media strip, overlay bar. `CanvasEditorInner` owns all of the same for doc and slides.
Mounting one inside the other duplicates every one of them: two doc states, two save buttons, two
overlay bars. Deleting the early return at `canvas-editor.tsx:191` is the *last* step, not the first.

**The shape to aim at.** `CanvasRenderer` and `SlideEditor` are presentational — they take `document`,
a selection, and `onUpdateNode`, and the shell owns everything stateful. The sheet must become the
third of those. Extract **`SheetSurface`**: the grid, and nothing else.

| Stays in the shell (already there for doc + slides) | Genuinely sheet-specific — becomes props/callbacks |
|---|---|
| `doc` state · undo/redo · save + dirty + error | Worksheet tabs (which `table` node is active) |
| `CanvasToolbar` · `CanvasSidebar` (incl. the Compliance tab) | Formula bar (edit the active cell's `formula`) |
| `SelectionToolbar` verbs · `CanvasOverlayBar` | Cell/range selection · add/remove rows + columns |

**Order — smallest reversible steps, each independently verifiable:**

1. **3a · Extract `SheetSurface`, no behaviour change.** `SheetEditor` keeps owning all state and
   renders the new component. *Verify:* the sheet still edits and saves; `verify-exports-on-stored-artifacts`
   produces byte-identical xlsx for every stored cost volume.
2. **3b · Lift the state up.** Move `doc`/undo/redo/save out of `SheetEditor` into `CanvasEditorInner`;
   `SheetEditor` becomes a thin adapter over `SheetSurface`. *Verify:* same as 3a, plus undo/redo and
   the 409 non-destructive save path still behave.
3. **3c · Delete the early return.** The centre fork becomes three-way
   (`isSlideFormat ? SlideEditor : isSheet ? SheetSurface : CanvasRenderer`). *Verify:* opening a cost
   volume now reaches the sidebar, and **the Compliance tab is finally reachable on a spreadsheet**
   (`canvas-sidebar.tsx:531`) — the whole point of the phase.
4. **3d · Range-aware verbs.** `ActOnSelection` reads a **cell range** on the sheet, not a span; wire
   Atomize/Regenerate/Compliance-check against it. Completes phase 2 for the third surface.
5. **3e · Move Compliance + Budget into `OVERLAYS`.** They exist today only as hand-rolled buttons on
   the fluid view (§2); promoting them to the shared array gives the editor and the sheet the last two
   layers and closes the phase-1 residual found on 2026-08-23.

**The invariant that must not break, at any step.** The deterministic burden engine
(`cost-model.ts`/`cost-forms.ts`) stays the source of computed cells; `lib/numeric-cell.ts` keeps edited
`value`s in sync so tenant edits still drive the roll-up and the exports; AI is advisory *over* the
numbers and never writes them. A cost volume that changes its arithmetic during this refactor is a
failed step, not a merge conflict — `verify-exports-on-stored-artifacts.mts` is the gate.

**Do not start at step 3.** Deleting the early return first is the tempting one-line change and it
produces two doc states editing the same document — the class of bug that looks like it works until a
save races.

Each remaining phase: green backbone (`tsc` 0 · `vitest` · `next build`) + live-proven, both lenses.

## 8. Two-lens rule (standing)

**Human (highest priority):** one product, three surfaces matching each modality, identical interaction
grammar (same chips, same verb menu, same assist); structure summoned, never navigated to; a collaborator
sees only their sections. **Machine:** one model, one `canvas.format` discriminator, one `CanvasNode[]`, one
compliance floor, one ruler, one export dispatcher; overlays read existing data; verbs route through
`sectionOf`; permissions in `proposal-access.ts`. No data migration, no new discriminator.

## 8b. Measured, not asserted — the 88-cell matrix (2026-08-24)

`__tests__/node-vocabulary-coverage.test.ts` proved all 22 primitives survive all four writers, by
building a `CanvasDocument` in memory and calling `exportToDocx(doc)` directly. It never touched the
create route, the save route (`validateStandaloneCanvas` + the compare-and-swap), the export route
(gate, `X-Compliance-Violations`, audit event), or an authenticated actor with RLS on. The claim was
true of a function call.

`frontend/scripts/drive-canvas-authoring.mts` now authors from a **blank canvas** as both a
`tenant_admin` and an `rfp_admin`, saves, **reads the row back from the database**, and exports —
because the export route takes the document in its request BODY, so exporting proves nothing about
what was persisted.

**22 primitives × 4 formats = 88 cells · 0 silent drops.** Three arrive as an embedded raster by
design (`chart`→docx, `chart`/`shape`→xlsx), each with a media part to show for it. Two are
deliberate no-ops in xlsx (`page_break`, `spacer` — a grid has no pages and no whitespace to place;
`xlsx-exporter.ts:120`).

**One number per node.** B109: a `spacer` had five readers and four different heights, none of them
the author's — the ruler read `content.height`, canvas-html read `style.space_after` and fell back to
a hardcoded 12pt, docx hardcoded 200 twips, pptx 0.3in, the editor `h-8`. `spacerHeightPt()` is now
the one answer for all five. The single remaining asymmetry is deliberate and documented at the call
site: with no author height the writers use 12pt and the ruler a body line, because §8's ruler may
over-count and must never under-count.

**On instruments.** The structural primitives (`toc`, `page_break`, `spacer`, `divider`) carry no
text, so the marker search that proves the other 18 cannot see them. The differential built for them
was wrong five times before it was right — measuring them alone (a `toc` with no headings correctly
renders nothing), byte-comparing a zip (the same input does not always compress to the same length),
and page-counting a `toc` (which adds content, not a page). **No single metric answers for all four
types in all four formats.** The drive's table therefore names its instrument and REPORTS; the
decisive per-node assertions live in `scripts/probe-structural-nodes.mts`, where each type is
measured by the effect it actually has. Both are registered in `run-branch-drives.sh`.

## 8c. The ruler system (2026-08-24)

Four layers over the page, sharing ONE geometry — `gridGeometry` is called once, so a ruler
gradation, a grid line and a page boundary are the same number by construction rather than three
functions that happen to agree today.

| layer | what it answers | source | cost |
|---|---|---|---|
| **Grid** | spacing — how far is that? | `CanvasRules` | pure |
| **Rulers** | absolute position, in the gutter | same geometry | pure |
| **Boundaries** | where the page actually breaks | `paginate().perNode` + DOM | measured |
| **Group boxes** | how tall is this run, and do the page and the ruler agree? | DOM + `nodesHeightPt` | measured |

**The step ladder is 72 · 36 · 18 · 12 · 6pt.** Every step divides 72, because a step that does not
puts its lines off the inch marks that make a grid readable as a ruler — 72/5 = 14.4, which is why
6pt and not 5pt is the floor. It is deliberately NOT a pure halving: 72/36/18 are inch fractions and
12/6 are picas, and 12pt is a body line, the measurement an author reaches for most.

**Boundaries follow the PAGINATOR, never arithmetic (B112).** `fitKeep` relocates a block that will
not fit — table, figure, `keep_together` group — wholesale to the next page. A line at
`marginTop + k × usableHeight` therefore falls *inside* a block that actually begins the page. The
hatched band shows the whitespace a relocation leaves behind, which is the thing an author
experiences as "the image jumped a page" and which a continuous editor otherwise shows nowhere.

**Only two layers measure.** The grid and rulers are pure geometry. Boundaries and group boxes read
the DOM, on a rAF-batched pass **after paint** — `offsetHeight` forces a synchronous reflow, and
doing that per keystroke is jank where a writer notices it. `offsetTop`/`offsetHeight`, never
`getBoundingClientRect`, because client rects are post-transform.

**What building it found.** Four defects, each invisible because the page *looked* right: a spacer
with five readers and four heights (B109), the ruler and renderer disagreeing about it, the page
scaling itself twice (B111), and boundaries drawn from a model the product does not use (B112). A
measurement layer earns its keep by being impossible to build without pinning down what everything
else only assumed.

Driven end to end by `scripts/drive-ruler-overlays.mts`; geometry by `probe-measure-grid.mts` (all
10 presets) and `__tests__/measure-grid.test.ts`; the page-scale class by `probe-page-scale.mts`.

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
