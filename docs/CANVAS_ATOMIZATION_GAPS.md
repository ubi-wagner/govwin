# Gaps: canvas build-up vs. atomization (ingest → deconstruct)

Two opposite motions share the canvas model:

- **Build-up** — blank canvas → typed blocks → styled document → export. *Hardened this
  cycle* (styling parity across doc/pdf/ppt/xls: shapes, images, backgrounds, number
  formats, cell fg/borders, media). It's in good shape; the gaps here are minor.
- **Deconstruct** — an existing document → **ingest → parse → break into atoms → tag →
  curate → reuse.** This is where the large, easy-to-spot-and-fix gaps live.

This is an engineering read of the biggest + cheapest wins, grouped by the atomization
pipeline stage, tagged by lens (**capability / style / ease-of-use**) and effort
(**trivial / small / medium / big-bet**). File:line anchors are the fix sites.

> **✅ Shipped 2026-08-11** — the ★ (Library Review) + the six quick wins below are built,
> tested, and live: `lib/atom-review.ts` (+ tests) → `GET /atoms/review` →
> `components/portal/library-review.tsx` (the **Review** tab: dedup + quality flags +
> one-click, audited cleanup); auto-tags now land unconfirmed; the double-archive is
> collapsed; legacy `.doc/.ppt/.xls` dropped; bulk-tag is a datalist; the detail drawer edits
> tags inline; atomize reports skipped short blocks.
>
> **✅ Also shipped (follow-up)** — **preview-before-atomize**: the drop card no longer writes
> on drop; a dry-run (`atomize-package?preview=1`) shows exactly what would be created (title +
> word count per atom, short blocks skipped) and you **confirm** before anything lands. Shared
> `planDocumentAtomization` (pure, unit-tested) is the single brain behind preview + commit, so
> the preview can't lie. Live-verified (drop → "Ready to atomize — 2 atoms · skipped 1" →
> Create → +3 rows, one `package.atomized` event). A `toCamel` row-mapping sweep also fixed a
> latent bug in the whole-proposal document assembly (`document/route.ts` read `r.volume_name`
> → undefined → volume grouping dropped). The **big bets** remain open.

---

## ★ The one standout — a finished brain that's unplugged

**Surface the `librarian` agent's catalog recommendations.** *(capability · medium · highest ROI)*

The pipeline `librarian` (`pipeline/src/agents/archetypes/librarian.py`) is a fully-built
adversarial cataloger: per-atom quality + relevance scores, **`duplicate_candidates`**,
freshness, and a decisive **keep / retag / merge / reject** recommendation "a tenant admin
one-clicks." It is **enqueued on every upload** (`atoms/atomize-package/route.ts:75-85`) —
and **nothing in the frontend consumes its output.** The dedup / quality-gate / de-bloat
engine the code was clearly designed around runs and is thrown away.

Fix: a review panel in `AtomLibrary` that reads the librarian result and offers its one-click
actions. This single wire-up delivers **dedup, quality-gating, and library de-bloat** at once
— the highest value-per-hour on this list, because the hard part (the AI) already ships.

---

## Atomization — quick wins (trivial → small, high signal)

| # | Gap | Lens | Where |
|---|---|---|---|
| 1 | **Double "archive" per row** — curation `status='archived'` and soft-archive `archived_at` are two near-identical buttons on every atom; even the code comments flag the orthogonality. Pick one model, relabel/remove the other. | style · ease | `components/portal/atom-library.tsx:245-252` |
| 2 | **Auto-tags stamped `confirmed=true`** — machine guesses masquerade as human-confirmed, so the review signal is dead on arrival. Stamp auto tags `confirmed=false`. | ease | `lib/atomize-package.ts:138-140` |
| 3 | **Misleading accepted types** — the picker advertises `.doc/.ppt/.xls`, but the parser (mammoth) reads only OOXML, so a legacy `.doc` silently yields an empty atom. Drop them from the picker (or convert on upload). | capability | `components/portal/upload-atomize-card.tsx:15` |
| 4 | **Bulk-tag is a free-text box** — typo-prone, unvalidated, and only *adds* one tag (no bulk retag/remove). Make it the taxonomy dropdown; the faceted list (`listAtomsFaceted`) is already built but bypassed. | ease · style | `atom-library.tsx:196` · `lib/atoms.ts:373` |
| 5 | **Read-only detail drawer** — you can *see* an atom's tags / lineage / content but can't edit or retag there; retagging forces you back into the Atomize flow. Add inline edit + tag add/remove. | ease | `atom-library.tsx:255-278` |
| 6 | **Silent discards** — auto-mode drops any block under 10 words (`MIN_ATOM_WORDS`) with no notice, so captions, one-line metrics, and short headings vanish. Surface "skipped N short blocks" (or let the user keep them). | ease · feedback | `lib/atomize-package.ts:20,134` |

---

## Atomization — bigger, still-tractable (medium)

- ✅ **Shipped** — **Preview/confirm before auto-atomizing on drop.** The "Add content" card
  used to write atoms the instant you drop a file. It now runs a dry-run
  (`atomize-package?preview=1`) and shows the exact plan (per-atom title + word count, short
  blocks skipped) for you to **confirm or cancel** before anything lands —
  `components/portal/upload-atomize-card.tsx` + `lib/atomize-package.ts` (`planDocumentAtomization`).
- **Two overlapping upload paths.** `atomize-package` (multi-file, auto, immediate) vs
  `atoms/upload` (single-file, manual hand-select) are different routes with different
  behavior and different UIs (the "Upload package" tab vs the "Atomize" tab). Unify to one
  upload → preview → (auto or hand-pick) flow. *(ease · consistency)*
- **PPTX loses tables + images on ingest** — only slide title + body text become nodes, so a
  deck's data tables and figures never make it into atoms. *(capability)* —
  `lib/import/pptx-reader.ts:63-95`.
- **Two overlapping *reuse* surfaces.** `LibraryInsertPanel` (multi-insert) and
  `LibraryPicker` (single-node replace) are separate components with different data shapes;
  `LibraryPicker` even throws the atom's tags away (`library-picker.tsx:66`). Consolidate. *(consistency)*

---

## Atomization — the big bets (worth naming, not "easy")

- **AI-suggested segmentation at ingest.** Today the split is heuristic (headings/regex) at
  ingest; the smart pass (librarian) only runs *after*. An LLM segmentation suggestion at
  atomize time would cut manual cleanup dramatically.
- **Box-on-the-rendered-document atomizer.** Document atomization is a **flat checkbox list**
  (`atomizer.tsx:217-229`) — you never see the doc *as a doc*. The spatial "draw a box"
  interaction only exists for screen-capture (`capture-atomizer.tsx`). Bringing box-select to
  the rendered upload would be the single biggest ease-of-use leap (it's the direct inverse of
  the fluid canvas's "highlight → atomize").
- **Semantic/vector reuse ranking.** Selection ranking is pre-vector — tag overlap +
  `content ILIKE` (`lib/atoms.ts:249,262`) — so it misses paraphrases. Embeddings would make
  reuse actually find the right prior content.
- **Content-hash dedup on re-upload** (atomizing the same package twice mints duplicates), and
  **async atomization with per-file progress** (today it parses the whole package
  synchronously inside the POST — a big package hangs/timeouts; `atomize-package/route.ts:55-61`).

---

## Canvas build-up — mostly solid (minor)

After this cycle the build-up side is strong: 22 node types, full styling (fill / border /
opacity / rotation / Arrange), the slide-frame control, sheet number-formats + fg/borders +
media, and **export parity** (the pptx image-styling gap was the one real hole — now fixed).
What remains is small: inserted atoms land **raw** with no adaptation unless the AI drafter
rewrites them (`library-insert-panel.tsx:71`), and the reuse-surface duplication noted above.

---

## If I had a day

1. **Wire the librarian review panel** (the ★) — dedup + quality gate + de-bloat, mostly
   frontend since the AI already emits the JSON.
2. **The six quick wins** above (double-archive, `confirmed=true`, accepted-types, bulk-tag
   dropdown, editable drawer, silent-drop feedback) — a half-day of small edits that visibly
   lift the curation experience.
3. **Preview-before-atomize** on the drop card — removes the scariest "it already happened"
   moment in the whole flow.

The through-line: the *deconstruct* direction has a finished AI brain and a solid parser, but
the **curation UX between them is thin and the AI's best output is unplugged.** That's where
the cheap, large wins are.
