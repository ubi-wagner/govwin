# NILOC Gold Examples — Build Provenance (in-system vs. bespoke)

An honest audit of *how* the NILOC gold examples were built: which steps used the platform's own
tools/processes, and which used bespoke scaffolding. Where a bespoke piece duplicated a capability
the product should own, it has been **folded into the product** (see "Folded in" below).

## In-system — the platform's own tools did the real work

Every step that touches product data went through the platform's own functions:

| Step | Product tool used |
|------|-------------------|
| Atomize a document → library (foundation → sections → primitives) | `decomposeAndIngest` (`lib/library/foundation.ts`) |
| Create company profile atoms (bio, capability) | `createAtom` (`lib/atoms.ts`) |
| Pristine cost **template** (formula workbook) | `buildBurdenCostSheet` (`lib/templates/cost/burden-cost-sheet.ts`) |
| Cost math / roll-up engine (the parity target) | `computeBudget` (`lib/proposal/cost-model.ts`) |
| Export to docx / pdf / xlsx | `exportToDocx` / `exportToPdf` / `exportToXlsx` (`lib/export/*`) |
| Drafter retrieval (the reuse proof) | `selectForSection` (`lib/atoms.ts`) |
| Semantic index backfill | `scripts/embed-atoms.mts` → `upsertAtomEmbedding` / `atomEmbedText` (`lib/atom-embed.ts`) |
| Fill template `{anchors}` | `interpolateTemplate` (`lib/templates/index.ts`) — *now* (see folded-in #2) |
| Markdown draft → CanvasDocument | `markdownToCanvasDocument` (`lib/import/markdown-canvas.ts`) — *now* (see folded-in #1) |

## Out-of-system — bespoke scaffolding I wrote, and what became of it

| Bespoke thing | What it did | Resolution |
|---------------|-------------|-----------|
| `mdToNodes` / `toSections` in a scratch script | markdown → CanvasDocument | **Folded in** → `lib/import/markdown-canvas.ts` (built on the product's own `parseMarkdown`); the seed now calls it |
| a `{anchor}` walker | interpolate cost-sheet anchors | **Removed** → seed now calls the product's `interpolateTemplate` |
| a mini spreadsheet formula engine (`evalFormula`) | fill a template's cells + cache computed values, and prove the roll-up equals `computeBudget` | **Kept as a verification harness** (`scripts/niloc/verify.mts`). It is a *proof* tool, not a product path; the product's own computed cost path is `buildCostVolume` (see "still bespoke", below) |
| Claude subagents authoring markdown | wrote the gold prose | **By design.** Gold examples are hand-authored reference content, not agent-fabric output. The product's live drafter is `section_drafter` / Proposal Studio / the full-draft workforce; this reference corpus is authored, then imported through product tools |
| raw `INSERT INTO tenant_documents` in the seed | create the document row | **Documented, low-risk.** Offline seed convenience; the product's real create path is `POST /api/portal/[tenantSlug]/documents` (auth + `verifyTenantAccess` + event). A shared `createTenantDocument` lib the route and seed both call is the clean follow-up (not yet done) |
| `extract-agent.mjs`, Playwright screenshots, entity-decode | pull authored text out of agent transcripts; visual QA | Plumbing / QA, never a product path — stays in scratch |

## Folded in (this change)

1. **`lib/import/markdown-canvas.ts` — `markdownToCanvasDocument(md, opts)`** (+ `groupNodesIntoSections`).
   A first-class prose→CanvasDocument importer, built on the **same** `parseMarkdown` the
   upload→atomize flow uses — so a pasted/uploaded markdown draft and a seeded example produce
   identical nodes and decompose to identical atoms. This is a genuine product capability
   (paste/upload a markdown draft → a new canvas document) a route can call; the NILOC seed now
   uses it instead of a hand-rolled converter. Covered by `__tests__/markdown-canvas.test.ts`.
2. **Exported + hardened `parseMarkdown`** (`lib/import/text-reader.ts`): it is now exported, and it
   strips inline markdown (`**bold**`, `__bold__`, `` `code` ``) via the new `stripInlineMarkdown`
   — a small improvement that also cleans up the product's real document-upload path.
3. **`interpolateTemplate`** is now used for cost-sheet anchor fill (the bespoke walker is deleted).

## Still bespoke on purpose (documented, not folded)

- **Cost fill + formula evaluation** (`verify.mts`): this exists to *prove* the pristine template a
  tenant fills rolls up to `computeBudget` to the cent — a verification, not a build path. The
  in-system way to emit a *filled/computed* cost volume from inputs is **`buildCostVolume` /
  `buildCostVolumeCanvas`** (`lib/proposal/cost-forms.ts`), which wraps `computeBudget` and supports
  the agency-neutral forms (`burden_waterfall` / `sf424a` / `otf_state_budget`). A natural next step
  is to render the NILOC cost volumes (and the TVSF budget, via `otf_state_budget`) through
  `buildCostVolume` so the *computed* artifact also comes straight from the product.
- **Direct `tenant_documents` insert** in the seed: convenience for an offline, idempotent seed.
  Promote to a shared `createTenantDocument` helper if/when the seed should mirror the route exactly.

## Bottom line

The substance — atomization, retrieval, the cost engine, the exporters, embeddings — was always the
platform's own code. The glue that was bespoke was either **folded into the product** (markdown
import, interpolation) or is **verification/authoring scaffolding** that isn't a product path. The
one remaining "use more of our own tools" opportunity is to emit the *computed* cost volumes through
`buildCostVolume` (including the TVSF's `otf_state_budget` form).
