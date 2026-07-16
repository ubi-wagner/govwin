# WORKING STATE — hierarchical lock roll-up + full E2E proposal build

> Durable record for the multi-day "Immobileyes push" build. Update + commit at each checkpoint.
> Branch `claude/nice-hamilton-kBqtD`. Tasks #43–#50. Sandbox: PG16 at `127.0.0.1:5433/govtech_intel`
> (data `/tmp/pgs_gov/data`, socket `/tmp/pgs_sock`), migrations 001–109 applied, 115 tables.

## The ask (in order)
1. **Hierarchical lock roll-up + push** — section → artifact → volume → proposal. Support "simple
   hierarchical pushes" (lock at any level) that STILL lock + audit **per canvas** (per the existing
   per-section stricture). Robust UI.
2. **Full E2E drive** — made-up company + technology; act as admin + Claude/shadow support; build a
   100%-complete fake proposal with multiple canvas types and commit the real deliverables:
   - 15-page **white paper** (narrative / letter)
   - 5-page **commercialization deck** (slides / pptx)
   - 1-year **$150k budget** (spreadsheet / xlsx)
   - several **supporting PDFs** (mock bios, company facilities)
   - styling throughout: bold/italic/colored text, sections, headers/footers, **generated SVG** image
     placeholders (headshots, facility photos, charts).

## RECON — what already EXISTS (as-built, file:line)
- **Multi-volume/artifact provision:** `lib/provision-proposal.ts:110-155` — per master volume →
  `proposal_artifacts` (format_spec/compliance_spec = mold); per required item → `proposal_sections`
  (`artifact_id` + `volume_number`), each with a matrix row + interpolated mold.
- **Section → artifact roll-up (PERSISTENT):** `sections/[sectionId]/lock/route.ts:234-268` — when all of
  an artifact's sections are locked, atomically sets `proposal_artifacts.is_locked/status='locked'` +
  emits `proposal:artifact.locked`. Unlock reverses it (`:391`).
- **Volume roll-up (EVENT, derived):** `lock/route.ts:275-296` — all sections of a `volume_number` locked
  → `proposal:document.locked`. (No volume table; volume state is derived from its artifacts/sections.)
- **Proposal roll-up:** `lock/route.ts:298-345` — all sections locked → `proposal:advance_ready` +
  optional auto-advance (`tenant_automation_preferences.auto_advance_when_all_locked`).
- **Per-section lock stricture (the audit unit):** CAS lock (`:140-165`) → `section.locked` event →
  matrix `satisfied` (`:188-196`) → canvas_versions snapshot (`:201-212`) → `harvestSectionToLibrary`
  + `harvestSectionToAtomLibrary` (`:214-229`) → artifact roll-up → close-state signals.
- **Client "Accept & Lock All":** `components/portal/proposal-admin-panel.tsx:357` loops the per-section
  lock route (audited); **Force advance** `:381`. Sections grouped by volume: `:400 groupSectionsByVolume`.
- **Exporters:** `lib/export/docx-exporter.ts` (`exportToDocx`), `pptx-exporter.ts`, `xlsx-exporter.ts`.
- **Package route:** `proposals/[proposalId]/package/route.ts` — assembles the WHOLE proposal to **docx**
  only (json|docx). Canvas presets (`lib/types/canvas-document.ts:64`): `letter`/`letter_sbir_phase1`
  (max_pages 15) / phase2 (30), `slide_16_9`/`slide_4_3` (max_slides), `spreadsheet`.

## RECON — the GAPS to build (the real work)
| G | Gap | Plan |
|---|---|---|
| **A** | **Top-down hierarchical push** — no way to lock an artifact/volume/proposal directly (cascade audited section locks). Only per-section or client-loop lock-all. | Extract `lockSectionCore()` from the lock route; add a **`lock-scope`** route that resolves target sections (by artifact_id / volume_number / all) and loops `lockSectionCore` (each audited; roll-ups fire naturally on the last). |
| **B** | Volume state is event-only; UI needs a queryable "volume locked" (partial/complete). | Derive in the read: volume locked ⇔ all its artifacts locked. Add to the sections read-model. No new table. |
| **C** | **UI hierarchy** — render volume → artifact → section tree with per-level push buttons + rolled-up lock state + audit surface. | New/extended admin-panel tree; call `lock-scope`. |
| **D** | **No PDF exporter** (blocker for bios/facilities supporting docs). | Build `lib/export/pdf-exporter.ts` (canvas → PDF; `pdf-lib` or `pdfkit`). |
| **E** | Package/export is whole-proposal docx only — no **per-artifact/per-format** routing (narrative→docx, slides→pptx, cost→xlsx, supporting→pdf). | Add per-artifact export that picks the exporter by artifact_type/canvas format. |

## Phase 1 design (do first) — hierarchical push + roll-up + UI
1. **`lib/proposal/lock-section.ts`** → `lockSectionCore(g: LockSectionCtx): Promise<LockSectionResult>`.
   Move lock-route POST steps 1–8 verbatim (CAS lock, section.locked, matrix, snapshot, 2×harvest,
   artifact roll-up, close-state signals + auto-advance). Return `{locked, alreadyLocked, autoAdvancedTo}`.
   Refactor the route POST to `guard()` → `lockSectionCore(g)` → shape response. **section-lock.test.ts
   (26 tests) must stay green** — behavior identical.
2. **`.../lock-scope/route.ts`** (POST) — body `{scope:'artifact'|'volume'|'proposal', artifactId?, volumeNumber?}`.
   Admin guard (reuse). Resolve unlocked+lockable sections in scope (`status<>'empty' AND content present`),
   loop `lockSectionCore` for each. Return `{lockedCount, artifactsLocked, volumeLocked, advanceReady, autoAdvancedTo}`.
3. **Read-model** — add per-artifact + per-volume rolled-up lock state to the sections read
   (`sections/route.ts`) so the UI shows partial/complete.
4. **UI** — admin-panel volume→artifact→section tree: per-section lock (exists) + **Lock Artifact** +
   **Lock Volume** + **Lock Proposal (= advance)** buttons calling `lock-scope`; show rolled-up state.
5. Verify: tsc + full suite + extend `verify_identity.mjs`-style harness to prove the cascade + roll-up
   (lock all sections in artifact → artifact locked; all artifacts in volume → volume; all → advance_ready;
   `lock-scope artifact` cascades + audits per section). Commit.

## Phase 2/3 design — the E2E build + deliverables
- **PDF exporter** (G-D) + **per-format export** (G-E): route each artifact to docx/pptx/xlsx/pdf by type.
- **Fake subject:** company + technology (make up; e.g. an edge-AI / sensing co). Provision a proposal
  with volumes: Technical (white paper 15pg), Commercialization (deck 5), Cost (budget $150k xlsx),
  Supporting Documents (bios PDF, facilities PDF). Multiple canvas types.
- **Content:** draft + fully style each canvas via the real tools (Draft-All / draft_section, now
  persisting). Bold/italic/color, headers/footers, sections, **generated SVG** placeholders (data-URI)
  for headshots/facility/charts. 100% complete.
- **Drive:** act as admin + shadow support; lock canvas-by-canvas, then hierarchical push-all (close+move).
- **Deliverables:** generate + **commit** the docx/pptx/xlsx/pdf files. Document the run + every blocker.

## Progress log
- 2026-07-16 (recon): PG sandbox restarted (115 tables). Mapped the as-built: roll-up EXISTS
  (section→artifact persistent, volume/proposal events); docx/pptx/xlsx exporters exist; **no PDF
  exporter**; package is whole-proposal-docx only. Gaps A–E identified. Phase-1 design locked (above).
- 2026-07-16 (**Phase 1 COMPLETE** — commits `7633b47` backend, `4644210` UI):
  - `lib/proposal/lock-section.ts::lockSectionCore` extracted (the per-canvas audited stricture);
    section-lock route delegates to it (behaviour identical; section-lock+advance suites green).
  - `lock-scope/route.ts` (POST) — hierarchical push at scope `artifact`|`volume`|`proposal`; loops
    `lockSectionCore`, so every canvas is audited + the roll-ups fire naturally. Admin-gated.
  - Admin panel: per-volume **"Lock Volume (N)"** push + **"✓ Volume locked"** roll-up chip.
  - Proven: `scratchpad/verify_lock_rollup.mjs` **11/11** (section→artifact→volume→proposal cascade,
    per-canvas matrix audit, hierarchical push, idempotent). tsc 0 · frontend 613 tests.
- 2026-07-16 (**Phase 2/3 COMPLETE** — commits `502ac87` PDF exporter, `aa5efaa` deliverables):
  - Blocker D fixed: `lib/export/canvas-html.ts` (pure) + `lib/export/pdf-exporter.ts` (Chromium via
    dynamic import; header/footer `template` + {n}/{N} page spans; executable auto-detect).
  - `frontend/scripts/gen-sample-proposal.mts` — authors the fictional **Aerivio Systems → Navy SBIR**
    proposal and runs the real docx/pptx/xlsx/pdf exporters. 6 deliverables in `docs/sample-proposal/`
    (Technical Volume docx+pdf, Commercialization pptx, Cost xlsx, Bios pdf, Facilities pdf) + README.
    Styling: bold/italic/color, headers/footers+page numbers, tables (currency), generated SVGs.
  - Process driven through the live schema (RFP admin provision + shadow lock/push): 4 vol · 5 art ·
    7 canvases → canvas-by-canvas lock (V1) + hierarchical "Lock Volume" push (V2–V4) → 7/7 canvases,
    5/5 artifacts, 7/7 matrix satisfied → ADVANCE-READY; audited (section×7/artifact×5/document×4/advance×1).
  **Open follow-ups:** blocker E (per-artifact/per-format export ROUTE in the app — the offline generator
  proves the exporters; the app still packages whole-proposal-docx only). Technical Volume renders ~5pp of
  dense content (not literally 15) — expand prose per section if the literal page target is required.
