# COST_VOLUME_FORMS.md — the universal cost volume + common-form layer

> As-built (2026-08-10). The cost/budget volume is now **computed** and **agency-neutral**: one
> deterministic burden engine, rendered in whichever **common government form** the solicitation
> requires. Ships across DoW/DoD SBIR·STTR (burden waterfall), NSF/DOE (SF-424A), and Ohio TVSF /
> state EDA (OTF spend-type budget). Verified end-to-end and durable in migrations 168–169.

## Why
The government cost volume is the same arithmetic everywhere — Direct Labor → Fringe → Overhead →
Other Direct Costs / Subcontracts → G&A → Fee → Price — but that engine lived **only in the Python
pipeline** (`pipeline/src/proposal/budget_model.py`), and only DoD SBIR Phase I had a (static) cost
template. Every other agency's cost item provisioned as an **empty section**. This makes a computed
cost volume universal, and lets the *form* (layout the agency wants) vary over the *same numbers*.

## The pieces

### 1. The engine — `frontend/lib/proposal/cost-model.ts`
A faithful TypeScript port of `budget_model.py` `compute_budget`: the burden waterfall (bands A..I),
PoP bucketing (`popByMonths`/`popByYear`/`popBasePlusOption`), work-share, and cost-realism flags
(ceiling, indirect caps, partner limit, SBIR/STTR floors, fee reasonableness). Pure, DB-free.

- **Cross-service parity to the cent.** A shared fixture is run through both engines; `roundCents`
  matches Python `round()` (banker's / half-to-even, computed on the true decimal — **0 divergences
  over a 2,220-value sweep**). The frontend cost volume therefore agrees with the pipeline
  `cost_estimator`'s advisory numbers exactly.

### 2. The universal canvas — `frontend/lib/proposal/cost-volume-canvas.ts`
`buildCostVolumeCanvas()` emits the burden-waterfall cost volume with **computed** numbers (rate
schedule, labor detail, ODC, subcontracts, summary roll-up, SBIR/STTR work-share) — replacing the
retired static DoD template's hand-maintained strings. Money cells carry a full-precision `value`
(whole-dollar display), so exports and the readiness parse never lose cents.
`parseStructuredCostInputs()` inverts the generator (canvas → typed inputs) for the readiness roll-up.

### 3. The form layer — `frontend/lib/proposal/cost-forms.ts`
`resolveCostForm({agency,program,volumeName,volumeFormat})` picks the form; `buildCostVolume()`
dispatches:

| Form | Agencies | Shape |
|---|---|---|
| `burden_waterfall` | DoW/DoD SBIR·STTR + default | the full computed waterfall (via the universal canvas) |
| `sf424a` | NSF · DOE · grants.gov (NIH/USDA/NASA) | SF-424A "Budget Information (Non-Construction)", Section B object-class categories a–k. Driven by the **same engine**; grants pay **no fee**, so total k = Total Direct (a–h) + Indirect (j) = the engine's Total Estimated Cost. |
| `otf_state_budget` | Ohio TVSF / state EDA | a spend-type table (Personnel / Equipment / Supplies / Purchased Services / Other → project funds + total) with a hard **ask ceiling**, a **personnel-share cap**, and a **no-cost-share** rule, plus a PASS/OVER Budget Compliance panel. |

`resolveCostForm` is deliberately conservative: DOE is matched by `\bdoe\b`/"department of energy"
(no bare `\benergy\b`, which would grab DoD "Directed Energy" offices), and the grant token is
word-bounded (`\bgrant\b`, not bare "grant" which matches "migrant"). `provisionalOtfLines` scales
every line with the ceiling (no hardcoded floor) so a small micro-grant stays non-negative and
compliant, and floors Personnel so it never rounds over the share cap.

### 4. Provisioning wiring — `frontend/lib/provision-proposal.ts`
For a cost artifact, provisioning picks the **data-bearing item** in the cost volume (spreadsheet/cost
type or a data-looking name — never a prose "Basis of Estimate" sibling), resolves the form, extracts
the OTF caps from the compliance `customVariables` (`budget_cap_usd`, `personnel_max_pct`,
`cost_share_allowed`), and renders the computed volume in that form. One workbook per cost volume.

### 5. Readiness roll-up — `frontend/lib/proposal/submission-readiness.ts`
Scans **all** cost-ish artifacts (a cost-narrative volume ahead of the workbook no longer hides it),
parses the structured workbook, runs the **same** engine, and surfaces the total proposed price
(universal) + the STTR work-split from the explicit RI column (no free-text label guessing). The
free-text reader (`sttr-split.ts`) remains as the fallback for uploaded/unstructured cost tables.

### 6. The shared numeric parser — `frontend/lib/numeric-cell.ts`
One parser for `$`, thousands commas, `%` (→ fraction), K/M/B suffixes ("$1.2M"), and accounting
negatives. Used by the canvas editors (to keep a numeric cell's machine `value` in sync with an
edited text — so a tenant's edit drives the readiness recompute + exports, not a stale provisioned
number) and by the cost-volume parser.

## What proves it
- **Unit:** `cost-model` parity + edges, `cost-volume-canvas` generate/parse/edit round-trip,
  `cost-forms` (form resolution + SF-424A vs engine + OTF scaling), `numeric-cell`. (part of vitest 959)
- **Live:** DoW STTR → burden waterfall ($253,515 computed workbook, ai_drafted, work-split from the
  engine); Ohio TVSF → OTF budget filled to **exactly $200,000**, Personnel at the 20% cap, no cost
  share, PASS compliance panel, and explicitly **not** the DoD waterfall.
- **Adversarial:** three independent reviewer passes; every proven finding fixed with a regression
  test (stale-`value` edit bug, Python-exact rounding, K/M/B parsing, cost-artifact selection, OTF
  scaling, `resolveCostForm` over-match).

## Durable seeds (deployment verification)
- **`mig 168`** `168_seed_tvsf_r45_opp.sql` — the Ohio TVSF Round-45 OPP card (opportunity +
  curated_solicitation + compliance + 3 volumes + 18 items + bridge + Foundation card), built via the
  real admin process (apply-preset → publish/fan-out).
- **`mig 169`** `169_seed_tvsf_foundation_proposal.sql` — the tenant-side Foundation 3DCP proposal off
  that card: proposals + artifacts + 18 sections + compliance matrix + templates + portal. Complete +
  compliant (all sections locked, readiness GO, narrative 7/7 pages, exports docx/pdf with no
  violations). Depends on base seed + mig 140 + mig 168.

Reproducers: `scripts/build-tvsf-opp.mjs` (the card), `scripts/gen-tvsf-seed-migration.mjs` (mig 168),
`scripts/build-foundation-tvsf-proposal.mjs` (the proposal), `scripts/gen-tvsf-proposal-seed.mjs` (mig 169).
