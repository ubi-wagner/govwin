# NILOC Technologies — Gold Example Set

**Status:** built + proven (2026-08-14). Canonical package: `frontend/scripts/niloc/`
(content + reproducible seed/export/verify). Deliverables regenerate via `scripts/niloc/export.mts`.

## What this is (and how it differs from templates)

The platform has two distinct reference-content classes:

| | **Templates** (`frontend/lib/templates/*`) | **Gold examples** (this) |
|---|---|---|
| Purpose | reusable forms customers instantiate | "what good looks like" + a live corpus |
| Data | **pristine** — blank inputs, `{anchors}` | **fully filled**, realistic, real company |
| Company | none (generic) | **NILOC Technologies** (Eric Wagner, CEO) |
| Bridge | fan out to every tenant as mirror library meta | **NILOC-tenant-scoped**, not fanned out |

NILOC is the **parent company of RFP Pipeline**, so the examples can carry the real founder, real
capability statement, and a real proposal voice. The gold examples double as the substrate for the
larger goal — **making RFP OPP ingest simpler**: the more high-quality filled proposals the library
holds, the more the drafter has to reuse, and the less an operator has to author from scratch.

## The three technologies (IP-safe by construction)

Each proposal is built around a **real federal technology offered for license** through the DoD
tech-transfer ecosystem (TechLink / lab technology-transfer offices). NILOC's business model is to
**license lab-proven IP and mature it** under SBIR/STTR/BAA/OTA — so these are genuine proposals
NILOC could file, with **no third-party IP exposure**. Every narrative **states the licensing basis
honestly** and marks unverified quantities as `[bracketed]` planning estimates.

| Tag | Product | Domain | Base technology (cited in-narrative) |
|-----|---------|--------|--------------------------------------|
| **CADENCE™** | Continuous Anomaly Detection & Entity Normalcy Engine | ABI / pattern-of-life analytics (AI) | AFRL Information Directorate, U.S. Patent 11,308,384 B1 |
| **AURA™** | Autonomous RF Understanding for counter-UAS | RF / electronic support | NSWC Crane counter-UAS RF, U.S. Patent 12,461,538 |
| **PolarHawk™** | Low-SWaP compact-polarimetric monopulse radar | radar / EM | NRL compact-polarimetric radar, U.S. Patent 11,828,868 |

They deliberately span NILOC's core competencies — **AI/ML, RF/EM, radar/systems** — and honor the
user's steer (electronics / software / systems; RF/EM/CV/AI/automation; not biological).

## What was built (all landed in the NILOC tenant)

Per technology, a **multi-volume** set:

- **Technical Volume** — a complete SBIR Phase II narrative (~2,300–2,600 words, 9 sections:
  Executive Summary · Significance · Technical Objectives · Approach & Work Plan · Related Work ·
  Key Personnel · Commercialization · Quad Chart). Landed as a `tenant_documents` row and
  **decomposed into `library_atoms`** (foundation → sections → primitives) so the drafter can reuse it.
- **Cost Volume** — a 24-month (Year 1 + Year 2) burden-waterfall workbook (Rates · Labor · ODC ·
  Summary), filled with realistic NILOC labor/rates/ODC and **formula-cached**, landed likewise.

Plus company foundation atoms: **Eric Wagner's CEO bio** and the **NILOC capability statement**.

NILOC library after seeding: **498 atoms**; **6 gold documents** (3 technical + 3 cost).

## Proof (`scripts/niloc/verify.mts`)

1. **Cost roll-up = portal engine, to the cent.** Each workbook's `TOTAL PROPOSED PRICE` equals
   `lib/proposal/cost-model.ts` `computeBudget` exactly, so a tenant transcribes the sheet 1:1 into
   the portal cost volume with no drift:
   - CADENCE **$1,859,211** · AURA **$1,807,743** · PolarHawk **$1,876,009** (realistic DoD Phase II).
2. **Drafter reuse.** `selectForSection` (the section-drafter's exact retrieval) surfaces NILOC's own
   gold-proposal atoms for a new draft section — **6/6 on-topic** for each of the three technology
   queries with the semantic index on (`ATOM_EMBED=local` or Voyage). With the engine off it still
   retrieves (tag/context only), just without the semantic lift.
3. **Tenant isolation.** The same queries run for a different tenant return **zero** NILOC-branded
   atoms — proven at the app layer (and RLS-backstopped once the `govtech_app` cutover flips).
4. **Compliance + export.** All six volumes export to `docx`/`pdf` (technical) and `xlsx`/`pdf`
   (cost) via the platform's own exporters; the cost `xlsx` carries **live Excel formulas** (edit a
   rate and the waterfall recomputes).

## Deliverables

`scripts/niloc/export.mts` regenerates 12 files (2 per volume) into `scripts/niloc/dist/`
(git-ignored): `NILOC-{CADENCE,AURA,PolarHawk}-technical.{docx,pdf}` and `-cost.{xlsx,pdf}`.

## [confirm] — before any real submission

Eric to supply / replace: biosketch specifics (education, prior roles, years, clearances, awards);
CAGE / UEI / SAM registration + set-aside status; official contact email/phone; NILOC's actual
indirect + labor rates (the workbooks recompute automatically); and confirmation of every
`[bracketed]` planning figure via modeling / Phase I feasibility / Phase II test data.
