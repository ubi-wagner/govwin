# Faithful re-run — every step through the platform's REAL cores/tools (audit closure)

Follow-up to `PROCESS_AUDIT.md`: the steps I had originally emulated with direct DB writes
are re-run here through the **genuine code the UI routes wrap** — no short-circuits — with the
two real product improvements that fell out of doing it honestly. Screenshots in `img/faithful/`.

| Step | Real core/tool invoked | Evidence | Status |
|---|---|---|---|
| **Upload → atomize** | `atomizeDocumentIntoLibrary` (the core behind `POST /atoms/atomize-package`) on the 5 actual uploads | **5 reference + 19 primitive atoms + 5 cocoons**, auto-tagged across 8 taxonomy dims; rendered in the Library UI (`img/faithful/A-atoms-real-atomizer.png`) | ✅ faithful |
| **Draft sections** | `proposalDraftSectionTool.handler(...)` — the **same `proposal.draft_section` tool the "Draft all sections" UI invokes** — per Vol-2 section, grounded in the real atoms | tool executed on **8/8 sections**, running its **budget-guard + fit-check** (target ≈1090 words/2-pg, `withinBudget:true`) + node generation; `placeholder` branch (no API key) | ✅ faithful (agent ran) |
| **Cost canvas → .xlsx** | `renderCanvas('xlsx', assembleArtifactCanvas(costSections,'cost',…))` — the system exporter | 3 sheets (Summary/Base/Option) with **live formulas** + cached results + `$` formats; Base **$199,501.73 ≤ $200k**, Option **$114,464.25 ≤ $115k** | ✅ faithful |
| **Provision + matrix** | `provisionProposalForPortal(...)` | 6 artifacts, 18 sections, matrix; **10 rows satisfied** (8 Technical + 2 Cost) | ✅ faithful |
| **Template → mold** | atomize the DON TV2 template docx → **templify** via `pastProposalToCanvas → extractTemplateSkeleton → document_templates` (the "Save as template" core), linked to Vol 2 | 9-section **content-stripped skeleton** mold (18 nodes) linked to Volume 2 item 1 | ✅ faithful |
| **Lock** | `lockSectionCore(...)` — the exact core the lock route runs (CAS lock + compliance→satisfied + harvest + roll-up) | **8/8 locked · 8 approved · 8 matrix satisfied** | ✅ faithful |

## Two real improvements this produced (not just the demo)

1. **`feat(xlsx-export)`** — the canvas→xlsx exporter now honors `TableCell.formula` / `value` /
   `number_format` / `cell_type`, so a **cost canvas exports as a live-formula workbook** (was
   static `cell.text` only). Benefits every cost volume. `d1f3ea4`.
2. **`harden(atomize)`** — a Type-3-font PDF extracts invalid UTF-8 (NUL / lone surrogates) that
   Postgres rejects (22021), silently losing the whole document. Added `cleanText()` at the
   extraction boundary (content + `canvasNodes`), so **all 5 uploads now atomize**. `112c7f5`.

## Honest constraint (unchanged)
`proposal.draft_section` has a documented dual mode: **with `ANTHROPIC_API_KEY` → Claude-authored
content; without → placeholder nodes.** This sandbox has no usable key (the agent proxy 401s a noop
key), so the drafter runs its full machinery but emits placeholders; the section prose is AI-assist
(authorized), landed through the section-content model. In a keyed deploy the same tool call yields
the model draft — no code change.
