# Immobileyes — DON26BX03-NP002 (NAVAIR/NAVSEA C-UAS) — generated with the govwin system

Two downloadable deliverables for the Immobileyes **GHOST / STORM / DEXTER** counter-UAS SBIR
Phase I effort, produced end-to-end **through the govwin proposal platform** (upload → atomize →
compliance matrix with the DON template → provision → AI-assisted draft → lock → export):

| Deliverable | File | How produced | Verified |
|---|---|---|---|
| **Technical Volume (Vol 2)** | `Immobileyes_DON26BX03-NP002_Technical_Volume.docx` | govwin **canvas → docx exporter** (`renderCanvas('docx', assembleArtifactCanvas(...))`) from the drafted+locked proposal sections | **9 / 10 pages** (system counter), 8.5×11, 1″ margins, TNR, header+footer; 6 figures inline+captioned; 5 tables; all 8 DON TV2 sections |
| **Technical Volume — preview** | `Immobileyes_DON26BX03-NP002_Technical_Volume_PREVIEW.pdf` | Chromium print of a faithful twin (LibreOffice is unavailable in this sandbox) | page-count + visual check |
| **Cost Volume (Vol 3)** | `Immobileyes_DON26BX03-NP002_Cost_Volume.xlsx` | live-formula workbook (openpyxl) from the firm's real TACFI rate stack; the cost table also lives in-system as the Cost artifact | **Base $199,502 ≤ $200k · Option $114,464 ≤ $115k**, formulas green |

Content is grounded in the supplied sources: the **GHOST draft** (directional), the **TACFI
Technical Volume** (past performance: TRL-5 HALAR-L, 72d SFS Tinker AFB, AlphaMicron, Lighthouse
Avionics/VICTOR, FAA), the **TACFI cost proposal** (indirect-rate methodology), the **resumes**
(Dr. Bahman Taheri PI, Atossa Alavi PM — both U.S. citizens), and **figures cropped from the
Immobileyes deck** (threat headline, graduated-escalation framework, without/with-laser dazzle,
field pod, optics lab, manufacturing floor).

## The govwin workflow that produced this (fully reproducible)

```bash
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'
cd frontend
# 1) Seed the OPP + the real 6-volume CSO compliance matrix (Cover / Technical / Cost / CCR / Supporting / FWA)
DATABASE_URL=$DATABASE_URL node --import tsx scripts/seed-cuas-immobileyes.mts
# 2) FULL CHAIN: align Vol 2 to the DON Phase-I Open-Topic TV2 template + link a TV2 mold →
#    provision → atomize the supporting docs into library_atoms → AI-assist-draft the 8 sections
#    (GHOST direction + atoms + cropped figures) → lock (matrix → satisfied) → export the .docx
DATABASE_URL=$DATABASE_URL node --import tsx scripts/drive-navair-build.mts
# 3) (verification) render a page-count/visual twin via Chromium
DATABASE_URL=$DATABASE_URL node scripts/render-tv-preview.mjs
# 4) Cost workbook (live formulas, then inject cached values since LibreOffice recalc is unavailable here)
python3 docs/proposals/immobileyes-cuas/cost-build/build_cost_xlsx.py && python3 docs/proposals/immobileyes-cuas/cost-build/inject_values.py
```

`drive-navair-build.mts` is idempotent (re-running re-provisions the proposal and re-atomizes the
7 supporting docs). It imports the platform's own libraries — `provisionProposalForPortal`,
`createAtom`, `assembleArtifactCanvas` / `renderCanvas` — so the deliverables come from the real
system code path, not a side script.

### What the system state looks like after the run (screenshots in `img/`)
- `01-cards` — the DON26BX03-NP002 card ranks **#1** in the Immobileyes Opportunity Pipeline.
- `10-atoms-populated` — the 7 atomized supporting docs in `library_atoms`, taxonomy-tagged.
- `21-proposal-workspace` — the 6-volume matrix; **Volume 2: Technical Volume — 8/8 locked · 9/10 pages · ✓ Volume locked · Download PDF**, every section APPROVED.

## Gaps encountered and how they were overcome (sandbox, not the product)

1. ~~**LibreOffice cannot load any file in this sandbox** (a VCL/init failure).~~
   **CORRECTED 2026-08-24 — the symptom was right, the diagnosis was wrong, and the wrong half
   was expensive.** It is not a VCL/init failure: the image carries `libreoffice-core` and
   `-common` with **no document filter packages at all**, so `soffice` has nothing to open any
   format with. `apt-get install -y --no-install-recommends libreoffice-impress` (plus
   `-writer` / `-calc`) fixes it, and our `.pptx` then converts cleanly.

   Worth keeping because the reasoning went wrong at exactly one step. The control here was
   **right** — "fails on the known-good samples too" is precisely the check that separates a
   broken tool from a broken artifact, and it was run. What followed was a guess at the
   mechanism, stated as fact, and it hardened into "LibreOffice will not open the .pptx this
   product writes." That ruled out the only instrument that could see whether a delivered deck
   matches what the author wrote — and B121 (rows and bullets missing from exported decks) sat
   behind it undetected until the tool was actually tried again.

   *Overcome (still true):* the docx exporter is `docx-js` (Node, no LibreOffice), so the system
   export is unaffected; for the cost workbook, cached values are injected into the XML
   (`inject_values.py`) while formulas are preserved (they recompute in Excel/Sheets); page-count +
   visual verification uses **Chromium** print-to-PDF (`render-tv-preview.mjs`).
2. **No pipeline `ANTHROPIC_API_KEY`** in the sandbox, so the autonomous `section_drafter` worker
   can't make live calls. *Overcome:* used the **AI-assist** path — sections drafted through the
   platform's section-content model (`proposal_sections.content` = CanvasDocument) and locked via the
   normal lock/matrix flow. In a keyed environment the same sections would be produced by the agent.
3. **The DON Phase-I Open-Topic TV2 template** has 8 sections (1.0 Description, 1.1 Objectives,
   1.2 SOW, 1.3 Related Work, 1.4 Defense Need, 2.0 Key Personnel, 3.0 Commercialization,
   Facilities/Equipment) — Volume 2 was realigned to it and a `document_templates` TV2 mold was
   linked via `volume_required_items.template_id`, so "the specific template is included in the matrix."
4. Two seed-script robustness fixes: FK-ordered cleanup on re-seed; camelCase read transform
   (`@/lib/db`) honored in the driver.

## Naming note (kept truthful)
The current architecture is branded **STORM** (detect/track + escalation), **DEXTER** (AlphaMicron
liquid-crystal beam routing), and **GHOST** (the Navy optical-countermeasure concept). The prior
**AF TACFI/STTR** work is branded **HALAR-L** (with the **VICTOR** sensor by Lighthouse Avionics);
it is cited as the funded, TRL-5 **past-performance** foundation this Navy effort extends — not
relabeled.
