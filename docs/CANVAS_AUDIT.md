# CANVAS_AUDIT.md — the heart, the muscles, the nervous system (2026-08-02)

> **Historical analysis (2026-08-02 snapshot).** Canonical canvas architecture: `docs/CANVAS_ARCHITECTURE.md`.

> Full audit of the canvas subsystem, mapped in the architecture's own terms:
> **Canvas = the heart** (document model · renderer/editor · exporters · preview),
> **Sidebar = the muscles** (toolbox cards + panels that move the document),
> **Automation + agents = the brain & nervous system** (what fires agents, what they write back).
> Produced by four parallel mappers; **every headline finding below was independently re-verified by
> hand (file:line + live DB)** before it was written down. No code changed — this is the map + the gap list.

Scale: **22 node types · 4 native exporters (docx/pptx/xlsx) + the HTML/PDF path + the new in-app preview ·
13 toolbox cards · 16 canvas↔agent paths.** Verified green baseline unaffected (this is read-only analysis).

---

## 0. The one-paragraph verdict

The **model is rich and the four native exporters are near-complete** — the heart is strong. The failures cluster
in three places: (1) the **HTML/PDF/preview path** silently drops the TOC and mis-draws non-box shapes (and that
path now backs the "see it as it downloads" preview I just shipped — so my fidelity claim has two real holes);
(2) the **sidebar has three more dead cards** (`ai`, `sections`, `annotate`) of the exact class as the Preview
bug I already fixed — muscles wired to nothing; (3) the **brain barely connects to the heart** — the headline
**Full-Draft Manager (Modes A/B/C) fires end-to-end and lands nothing back on the canvas**, and the interactive
canvas AI is served by a *different* brain (frontend-inline Claude) than the pipeline agent workforce. Plus the
**numbering** you flagged: an overloaded free-text `section_number` used as both label and sort key, off-by-one
from the `#N` baked into titles.

---

## 1. THE HEART — canvas core (22 node types)

Node types (`lib/types/canvas-document.ts:130-153`): heading · text_block · bulleted_list · numbered_list ·
image · table · caption · footnote · toc · page_break · url · spacer · shape · text_box · callout · code_block ·
blockquote · chart · equation · divider · video · signature. (No `figure` type — image + a `caption`; quote is
`blockquote`.) Editor create/select/move/delete → `canvas-editor.tsx`/`canvas-renderer.tsx` (+ `sheet-editor`,
`slide-editor`). Exporters: `docx-exporter.ts`, `pptx-exporter.ts`, `xlsx-exporter.ts`, and the shared HTML path
`canvas-html.ts` (`renderNode`) that backs BOTH the PDF (`renderCanvasToHtml`→Chromium) and the in-app preview
(`renderCanvasPreviewHtml`) — so **PDF and preview share every node gap**.

**Round-trip: VERIFIED consistent** — `proposal_sections.content` is TEXT; writes `JSON.stringify`, reads
`coerceJsonb`/`JSON.parse`; `canvas_versions` (jsonb) written via `sql.json(JSON.parse(...))`. The mig-071 fixes
hold; no site treats persisted content as pre-parsed. (Not a gap.)

### Gaps (ranked; ✅ verified by hand)
| # | Gap | Evidence | Impact |
|---|---|---|---|
| H1 | **TOC silently dropped in PDF + preview** | `canvas-html.ts:402 case 'toc': return ''` while docx renders a real TOC (`docx-exporter.ts:492`) ✅ | HIGH — core furniture, invisible drop, **affects the preview's "matches download" claim**. Trivial fix (heading-list exists). |
| H2 | **Editor page-count is a fiction** | `canvas-renderer.tsx:226` = `Math.ceil(nodes.length/8)`; the real `estimatePageCount()` (`canvas-document.ts:555`) has **zero non-test callers** ✅; `paginate()` lives only in the portal gauge | HIGH — a builder sees "~2 of 15" while the real export blows a page cap. Three divergent engines; editor shows the crudest. |
| H3 | **Compliance floor/cap defined + resolved but NEVER enforced** | `validateCanvasAgainstSpec` is named in the model comment (`canvas-document.ts:54`) but **has 0 definitions/callers** ✅; `ComplianceSpec` (min_font_size/max_pages) resolved+stored, read by nobody | HIGH — for a compliance product, the enforcement layer is a stub; font stepper clamps 6–72 hardcoded, not the RFP floor. |
| H4 | **Non-box shapes → rectangles in PDF + preview** | `canvas-html.ts:352 case 'shape'` only special-cases ellipse/rounded; the correct `renderShapeSvg` (`:286`) is in the same file and **never called** by renderNode ✅ | MED — star/arrow/triangle/line correct in editor + docx + pptx, a box in PDF/preview. WYSIWYG break, **affects the preview**. |
| H5 | **Free-placement (`node.position`/"Arrange") honored by 2 of 4 surfaces** | pdf/html (`canvas-html.ts:133`) + pptx `placeBox` apply it; the **editor renderer** (`canvas-renderer.tsx:451`) lays everything in flow, and **docx** never reads it | MED — what you drag isn't where it renders in the editor or Word. |
| H6 | **`video` has no insert affordance** | full model + renderer + all exporters, but absent from toolbar INSERT/ELEMENTS and the Add tab; only arrives via AI/library/import | MED — the only node with export support + zero UI entry. |
| H7 | **`equation` never typeset** | every surface emits raw LaTeX/MathML as literal text (`canvas-html.ts:378`, docx:627, …); no KaTeX/MathJax | MED — `\frac{a}{b}` shows raw TeX; hurts technical/BAA volumes. |
| H8 | **`url` is a dead link in `.docx` only** | `docx-exporter.ts:478` emits a blue TextRun with no `ExternalHyperlink` (the `video` node in the same file does use one) | LOW — links silently non-clickable specifically in Word. |
| H9 | **Spreadsheet numeric layer exportable but not authorable** | xlsx honors `formula`/`value`/`number_format` (`xlsx-exporter.ts:184`) but `SheetEditor` edits only `text` and leaves a **stale formula** attached when you edit a formula cell (`sheet-editor.tsx:204`) | MED — a cost model can be exported (if AI/import built it) but not safely hand-edited. |
| H10 | Caption punctuation diverges (PDF `Figure 1.` vs docx `Figure 1:`); TOC in xlsx is a stub string; video `poster` unused; `slide_4_3`/`letter_sbir_phase2`/A4 have no reachable preset | LOW — cosmetic/edge. |

---

## 2. THE MUSCLES — sidebar toolbox (13 cards)

Dispatch (`canvas-sidebar.tsx:388-398`): a card fires **only** if its id is in `CARD_TAB` (switches an inline tab)
or `ACTION_CARDS` (calls `onToolAction`); a card in **neither renders `disabled` with an `undefined` onClick** —
it looks like a tool and does nothing. ✅ verified. Handler `handleToolAction` (`canvas-editor.tsx:636`) handles
`library/atomize/preview/template/lock/export`.

**Wired (10):** review, template, floorplan, library, insert, format, atomize, compliance, **preview** (my fix),
export — plus all inline panels (Compliance, Node/Format, Add, History, Review) and sub-components
(LibraryPicker, LibraryInsertPanel, AIRevisionPanel, Comments, VersionHistory, AtomBubbleRail) and the top ribbon
(Save/Undo/Redo/Lock/Export/Panel) — all to real APIs.

### Gaps — three more dead cards (same class as the Preview bug) ✅
| Card | State | Evidence | Fix |
|---|---|---|---|
| **AI Assist** (`ai`) | INERT | in neither `CARD_TAB` nor `ACTION_CARDS`; visible to **every editable user** (`canDraftAI`). AI still works via Node-tab → `AIRevisionPanel`, so it's a discoverability dead-end | add `ai:'node'` to `CARD_TAB` |
| **Sections & Budget** (`sections`) | INERT | neither set; **no alternative surface exists** — a fully dead feature promise; visible to tenant_admin+ | build the target (section list/gauge/drag-resize) |
| **Annotate & Atomize** (`annotate`) | INERT **+ capability unreachable** | neither set; and `canAnnotate` is set true only for `stage∈{ingest,template}` (`capabilities.ts:100`) while the sole live caller hardcodes `stage:'draft'` (`sections/[sectionId]/page.tsx:164`) ✅ — the whole ingest/template curation surface is spec'd + unit-tested but wired to no page | `ACTION_CARDS` + handler + wire `canAnnotate` |

**Systemic root:** there is **no test asserting every non-ambient card resolves to a live dispatch.** That one
invariant test would have caught `preview` AND these three. → recommended guard (§6). Minor: the ribbon page
estimate (`nodes/3`) diverges from the Compliance tab's word-budget — a fourth "pages" number (see H2).

---

## 3. THE BRAIN & NERVOUS SYSTEM — automation + agents

**The load-bearing finding: there are two brains wired to the canvas, and they barely touch.**
1. **Frontend-inline AI** (synchronous, in the Next process, via `/api/tools/[name]` + `/ai/*`) — what the canvas
   **buttons** call. Draft-All, AI-Revise, Check-Compliance. These borrow archetype *names* as spend labels but are
   **not** the pipeline archetypes. Gated on the *frontend* key.
2. **Pipeline agent workforce** (async, `agent_task_queue`/`AI_INVOKE`, drained by `process_task_queue`) — the real
   archetypes, attached to **lifecycle gates** (provision `draft_v0`, advance `color_team`/`compliance`, lock,
   upload `librarian`, + the `research_scout` bridge). Gated on the *pipeline* key **and the worker running**.

**Demo reality (✅ live DB):** `canvas_versions` for the TVSF proposal = **only `system` rows (13), zero
`ai_revision`/`ai_draft`**; queued pipeline tasks sit `pending` with 0 results. So today only the **frontend-inline**
and **deterministic** paths reach the canvas; the pipeline workforce is **WIRED-but-dormant** in the sandbox.

### Gaps (ranked; ✅ verified)
| # | Gap | Evidence | Impact |
|---|---|---|---|
| **B1** | **Full-Draft Manager (Modes A/B/C) fires but lands NOTHING on the canvas** | every generative step is `AI_INVOKE`, and `_execute_ai_invoke` is contractually advisory (`processor.py:302` "Never writes to business tables"); `formatter.py:367` says *"Staged, NOT persisted. A wired review step lands this as a canvas_versions row"* → `persisted:False` (also stylist); **no code writes that row**; DB shows 0 `ai_revision` ✅ | **HIGHEST** — the P3 "Run full draft" computes a plan+drafts+restyle and drops all of it; the UI says "watch the version history as they arrive" and nothing arrives. |
| **B2** | Full-draft "draft_all_sections" step is mis-wired to a **single-section** drafter | `AI_INVOKE tool.proposal.draft_all_sections` → `section_drafter` (drafts ONE section, never loops/publishes); only the separate `draft_v0` ACTION loops + calls `publish_section_draft` | MED — compounds B1; even past the advisory boundary it couldn't draft/land "all sections". |
| **B3** | Canvas node **"Atomize to library" skips the librarian** | `atomize-node/route.ts:113` bare `createAtom`, no `requestAgentTask` — unlike `atomize-package` which enqueues `librarian` ✅ | MED — node-harvested atoms never get catalog/dedup/quality/freshness, yet they feed Draft-All + Insert-from-Library. |
| **B4** | Two disconnected **compliance** brains | canvas "Check Compliance" (`ai/compliance`) writes nothing (advisory JSON to UI); the pipeline `compliance_reviewer` on advance lands nowhere the canvas reads | LOW/MED — the pipeline pink-team result is invisible in the build UI. |
| **B5** | Color-team write-back silently drops if `requested_by` missing (`fabric.py:1013`); the live advance path supplies it, so safe today | LOW |

**Automation-policy gates touching the canvas:** `proposal:proposal.advanced` (gates the color-team enqueue —
`proposal-advance.ts:441`), `proposal:document.locked` (`condition.auto_advance` — the read I repointed in the
security pass), `section_review`/`final_review` (pre-staged ToDos at provision). The **full-draft workflow does
not consult `resolveGatePolicy`** — it hardcodes `assignee_role='tenant_admin'`.

---

## 4. PROVISIONING + THE NUMBERING ROOT CAUSE ✅ (fix held for the reference TVSF)

**Provision path:** admin release → `provisionProposalForPortal` → `compliance-resolver` (volumes `ORDER BY
volume_number`, items `ORDER BY item_number` — both numeric) → flatten to `requiredItems[]` with a global
`itemNumber = gi++` → INSERT one `proposal_sections` row per item. Template only fills `content`, never
`section_number` — so **templates/ingest are not the number source**; the compliance-matrix item ordinal is.

**Numbering — two independent defects, both born at provisioning:**
1. **String-sort.** `section_number` is a **TEXT** column written as `${String(item.itemNumber)}`
   (`provision-proposal.ts:132`, `create/route.ts:397`, seed `140:195`) ✅ → values `"1".."13"` sort
   lexicographically (`"10" < "2"`) at **~14 product `ORDER BY section_number` sites** (preview:86, package:265/408,
   artifacts export/layout, editor lists, several pipeline agents). Only the drive/e2e scripts use `::int` — which
   is why *those* exports looked right and the product ones don't.
2. **Double / off-by-one.** Titles already carry the solicitation's own `#1..#12` (Abstract = ordinal 1, no `#`),
   so `section_number` is off-by-one from the title's `#N`. The assembled heading is `"{section_number}. {title}"`
   → **"2. #1 Market Opportunity", "10. #9 Competitive Landscape"** (`preview/route.ts:98` + client renderers).

**Why a blanket `::int` sort is WRONG:** `section_number` is intentionally free-text — it's meant to hold labels
like `"3.1.a"` (`proposal-admin-panel.tsx:1082` does `.split('.')[0]`) ✅. A `::int` cast throws on any dotted label.

**Recommended fix (for your approval, after the reference TVSF):**
- **Ordering:** add a real integer sort key (e.g. `sort_index`, populated from `item.itemNumber` at the 3 INSERT
  sites + a backfill), and repoint the ~14 `ORDER BY section_number` → `ORDER BY volume_number, sort_index`. Keeps
  `section_number` free for real labels; no `::int` hazard.
- **Double-number:** decide ONE scheme — stop prepending `section_number` when the title already carries `#N`, OR
  normalize requirement labels at ingest so the title has no `#N` and `section_number` is the sole display number.
  **This is the decision your completed TVSF will settle.**

**Persistence — one residual (low) risk:** the two snapshot writers fall back to `sql.json(rawString)` on a JSON
parse failure (`save/route.ts:228`, `lock-section.ts:108`) — which would produce the mig-071 jsonb-string shape.
Can't trigger on normally-saved content; only seed/external non-JSON content would surface it.

---

## 5. CROSS-CUTTING — the preview I shipped inherits H1 + H4

The new "see it as it downloads" preview renders through `canvas-html.ts`, so it inherits **H1 (TOC dropped)** and
**H4 (non-box shapes → rectangles)**. My "the .docx you download matches this content" banner is therefore *almost*
true — the two exceptions are exactly these. Both fixes live in the same file (`renderShapeSvg` already exists;
the TOC heading-list already exists in docx/pptx) and would improve the **PDF export and the preview together**.

---

## 6. PRIORITIZED FIX LIST (proposed — awaiting your call on sequence)

1. **B1 — build the Full-Draft landing step** (write the staged `ai_revision` canvas_versions so Modes A/B/C
   actually produce reviewable drafts). This is the biggest "brain not wired to the heart" gap. (+ B2 loop fix.)
2. **H1 + H4 — fix the preview/PDF fidelity** (TOC + non-box shapes) — small, same-file, improves the feature I
   just shipped.
3. **Numbering (§4)** — **held for your reference TVSF**; then sort-key + double-number decision.
4. **Muscles — the 3 dead cards** (`ai` easy; `sections` needs a target; `annotate` needs the ingest surface) +
   the **card-dispatch invariant test** (would have caught all four).
5. **H3 — compliance enforcement** (`validateCanvasAgainstSpec` at save/export) — the stubbed thesis-critical layer.
6. **H2 — one honest page-count** (use `paginate()` in the editor; retire `nodes/8` + `estimatePageCount`).
7. **B3 — enqueue the librarian on node-atomize**; **H6/H7/H9** authoring gaps as product decisions.

---

## 7. RECOMMENDED GUARD (the systemic root)

Add one invariant test: **every non-ambient `TOOL_CARD` id must resolve to a live dispatch** (present in `tabs`
via `CARD_TAB`, or in `ACTION_CARDS` AND handled by `handleToolAction`). It would have caught `preview`, and now
`ai`/`sections`/`annotate`, at CI time instead of in a manual sweep.
