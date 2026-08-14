# Session close-out — 2026-08-10 · Universal cost volume + TVSF Round-45 (card + proposal)

Branch `claude/nice-hamilton-kBqtD`. All work committed + pushed; migration head **169**;
`tsc` 0 · `vitest` 959 · `next build` clean; admin system views verified live.

## What shipped

### 1. Universal cost volume — computed, agency-neutral, common-form
The cost/budget volume is no longer a static DoD-only template. See **docs/COST_VOLUME_FORMS.md**.
- `lib/proposal/cost-model.ts` — the burden-waterfall engine, a TS port of the Python
  `budget_model.py`, **parity to the cent** (`roundCents` = Python banker's rounding, 0 divergences
  over a 2,220-value sweep).
- `lib/proposal/cost-volume-canvas.ts` — the computed waterfall canvas + `parseStructuredCostInputs`.
- `lib/proposal/cost-forms.ts` — the FORM layer: `resolveCostForm` picks `burden_waterfall`
  (DoW/DoD), `sf424a` (NSF/DOE grants), or `otf_state_budget` (Ohio TVSF / state EDA); `buildCostVolume`
  dispatches.
- `lib/numeric-cell.ts` — one shared money/percent/K-M-B parser, wired into the canvas editors so an
  edited cell's numeric `value` stays in sync (tenant edits drive the readiness roll-up + exports).
- `lib/provision-proposal.ts` — routes the cost item to the right form + data-bearing section.
- `lib/proposal/submission-readiness.ts` — deterministic cost roll-up (price + STTR work-split).

### 2. Ohio TVSF Round-45 OPP card — rebuilt from scratch (real admin process)
From the finding (docs/TVSF_SPEC.md) + Paul Jackson / EC's `TVSF_Outline_Template` (Round-45 DMVEC
preset): seeded opp + curated_solicitation → **apply-preset** → **publish/fan-out**. Card live on
8 tenants; 3 volumes (Proposal 7pp Abstract+Q1-14 · Budget · Supporting Letters); the Budget provisions
as the **OTF state-budget form** ($200k cap · 20% personnel · no cost share).
- Durable: **`db/migrations/168_seed_tvsf_r45_opp.sql`** (27 rows / 7 tables).
- Reproducers: `scripts/build-tvsf-opp.mjs`, `scripts/gen-tvsf-seed-migration.mjs`.

### 3. Final Foundation 3DCP proposal off that card
Provisioned as the tenant, authored complete + Round-45-compliant (Budget as a separate OTF volume,
no cost share, Personnel ≤ $40k, pro-forma 2027–2031), **all 18 sections locked, readiness GO (0
blockers), narrative 7/7 pages**, exported **docx + pdf with no compliance violations** and delivered.
- Durable: **`db/migrations/169_seed_tvsf_foundation_proposal.sql`** (42 rows / 7 tables:
  proposals · artifacts · 18 sections · compliance matrix · templates · portal).
- Reproducers: `scripts/build-foundation-tvsf-proposal.mjs`, `scripts/gen-tvsf-proposal-seed.mjs`.

## Verification
- **tsc 0 · vitest 959** (cost-model parity + edges, cost-volume-canvas round-trip/edit, cost-forms,
  numeric-cell, + regressions).
- **Live E2E:** DoW STTR → waterfall workbook; TVSF → OTF budget at exactly $200k; Foundation proposal
  authored → locked → readiness GO → docx/pdf export compliant.
- **Adversarial:** three independent reviewer passes; every proven finding fixed with a regression test
  (stale-`value` edit bug, Python-exact rounding, K/M/B parse, cost-artifact selection, OTF scaling,
  `resolveCostForm` over-match).
- **Admin views:** `/admin/{system-state,opportunities,proposals,workflows,cards,templates}` all render
  clean; the Opportunity Rollup shows "Ohio TVSF Round 45" with **8 ranked · 1 building · 1 final**
  (the final = this locked Foundation proposal).

## Migrations added this session
- `168_seed_tvsf_r45_opp.sql` — TVSF Round-45 OPP card (opp/curation/compliance/volumes/items/bridge/card).
- `169_seed_tvsf_foundation_proposal.sql` — the tenant-side Foundation proposal (proposals/artifacts/
  sections/matrix/templates/portal). Deployment-verification bundle for the next push.

## Open / optional follow-ups (non-blocking)
- **Q14 native Risk table** — the Foundation proposal uses a risk→mitigation bulleted list; the EC preset
  suggests a 4-column native Risk table. Held to keep the exact 7-page limit; swap-in is a small edit.
- **OTF/SF-424A readiness total** — readiness surfaces the total price for the burden-waterfall form;
  extending the parser to read the OTF/SF-424A total cell would surface those in the readiness chip too
  (the OTF volume already carries its own PASS compliance panel).
- **Standing guardrail** (task #118) — sharing stays copy-inward only; no cross-tenant shared objects.
