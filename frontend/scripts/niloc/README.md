# NILOC Technologies — gold example set

NILOC Technologies is the parent company of RFP Pipeline. This package is a **gold, IP-safe
example library**: three complete SBIR **Phase II** multi-volume proposals (technical + cost) plus
the company profile, built end-to-end through the platform's own canvas / cost / library machinery.

Unlike the pristine **templates** (`frontend/lib/templates/*`, which ship blank with `{anchors}`),
these are **fully filled, realistic proposals** — the reference for "what good looks like" and a
live corpus for exercising drafter reuse, cost roll-up, compliance, and tenant isolation.

## Why it's safe to be real

Each proposal is built around a **real federal technology offered for license** through the DoD
tech-transfer ecosystem (TechLink / lab T2 offices). NILOC's model is to *license lab-proven IP and
mature it* — so these read as genuine proposals NILOC could file, with **no third-party IP exposure**.
Every narrative **states the licensing basis honestly** and uses `[bracketed]` planning estimates for
anything not yet measured.

| Tag | Technology | Base (honestly cited in the narrative) |
|-----|-----------|-----------------------------------------|
| **CADENCE™** | Pattern-of-Life / activity-based-intelligence analytics | AFRL Information Directorate (Rome, NY), U.S. Patent 11,308,384 B1 |
| **AURA™** | Counter-UAS RF sensing / passive electronic support | NSWC Crane counter-UAS RF work, U.S. Patent 12,461,538 |
| **PolarHawk™** | Low-SWaP compact-polarimetric monopulse radar for small-UAS | NRL compact-polarimetric radar, U.S. Patent 11,828,868 |

Principal Investigator on all three: **Eric Wagner, Founder & CEO**.

## Contents

```
_shared.mts              content generators (md→canvas, cost specs + fill, mini formula engine)
cadence-technical.md     ┐
aura-technical.md        ├─ the three gold technical volumes (source markdown, ~2,300–2,600 words each)
polarhawk-technical.md   ┘
company.md               Eric Wagner bio + NILOC capability statement (with [confirm] flags)
seed.mts                 idempotent DB seed: company atoms + land 6 volumes → decompose into library
export.mts               regenerate deliverables (technical→docx/pdf, cost→xlsx/pdf) into dist/
verify.mts               prove cost roll-up == computeBudget (to the cent) + drafter reuse + isolation
```

## Run

```bash
cd frontend

# 1. Seed the library (needs the NILOC tenant + Eric user to already exist — see note below).
DATABASE_URL=… node --import tsx scripts/niloc/seed.mts

# 2. (optional) turn on the semantic index so reuse ranks by meaning, then prove everything.
ATOM_EMBED=local node --import tsx scripts/embed-atoms.mts niloc
DATABASE_URL=… ATOM_EMBED=local node --import tsx scripts/niloc/verify.mts

# 3. Regenerate the downloadable files (PDF needs Chromium — set PLAYWRIGHT_CHROMIUM_EXECUTABLE).
node --import tsx scripts/niloc/export.mts            # → scripts/niloc/dist/ (git-ignored)
```

`seed.mts` is **idempotent** (skips anything already present) and does **not** create the tenant or
user — identity/auth is the product's job. Create the NILOC tenant (slug `niloc`) + Eric Wagner
(`eric.c.wagner@gmail.com`, tenant_admin) through normal onboarding first; the seed then loads the
gold library on top.

## What's proven (verify.mts)

- **Cost roll-up = engine, to the cent.** Each 24-month burden workbook's `TOTAL PROPOSED PRICE`
  equals `lib/proposal/cost-model.ts` `computeBudget` exactly — so a tenant transcribes the sheet
  1:1 into the portal cost volume. (CADENCE $1,859,211 · AURA $1,807,743 · PolarHawk $1,876,009.)
- **Drafter reuse.** `selectForSection` (the section-drafter's exact retrieval) surfaces NILOC's own
  gold-proposal atoms for a new draft section (6/6 on-topic per technology with the semantic index on).
- **Tenant isolation.** The same queries run for a different tenant return **zero** NILOC atoms.

## [confirm] — specifics Eric should supply before any real submission

- **Bio/biosketch:** education, prior roles/companies, years of experience, clearances, awards.
- **Business registration:** CAGE code, UEI, SAM registration, any socioeconomic set-aside status.
- **Contact:** official proposal email/phone.
- **Cost inputs:** replace the indirect rates (fringe/OH/G&A/fee) and labor rates with NILOC's
  actual (DCAA-audited or provisional) numbers; the workbooks recompute automatically.
- **`[bracketed]` figures** in the narratives are planning estimates to confirm with modeling /
  Phase I feasibility / Phase II test data.

See `docs/NILOC_GOLD_EXAMPLES.md` for the full write-up.
