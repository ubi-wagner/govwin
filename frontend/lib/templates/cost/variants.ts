/**
 * The cost-volume PoP variants — the common periods of performance, each a
 * formula-driven burden-waterfall workbook (see ./burden-cost-sheet.ts). All
 * roll up identically to the portal cost engine (lib/proposal/cost-model.ts), so
 * a filled template transcribes 1:1. PRISTINE — inputs ship blank.
 */
import { buildBurdenCostSheet } from './burden-cost-sheet';

/** Phase I: 6-month base + 6-month option — the most common DoD SBIR/STTR Phase I shape. */
export const COST_PHASE1_BASE_OPTION = buildBurdenCostSheet({
  documentId: 'template-cost-phase1-base-option',
  title: 'Cost Volume — Phase I Base (6 mo) + Option (6 mo)',
  program: 'sbir',
  periods: [{ name: 'Base', months: 6 }, { name: 'Option', months: 6 }],
  ceilingNote: 'confirm the Phase I base + option ceiling in your solicitation',
});

/** Under 12 months — a single all-in period (short Phase I / feasibility study). */
export const COST_UNDER_12MO = buildBurdenCostSheet({
  documentId: 'template-cost-under-12mo',
  title: 'Cost Volume — Under 12 Months',
  program: 'sbir',
  periods: [{ name: 'Period of Performance', months: 12 }],
  ceilingNote: 'confirm the Phase I ceiling in your solicitation',
});

/** 18 months — 12-month base + 6-month option (common Phase II first increment / bridge). */
export const COST_18MO = buildBurdenCostSheet({
  documentId: 'template-cost-18mo',
  title: 'Cost Volume — 18 Months (Base 12 + Option 6)',
  program: 'sbir',
  periods: [{ name: 'Base', months: 12 }, { name: 'Option', months: 6 }],
  ceilingNote: 'confirm the Phase II ceiling in your solicitation',
});

/** 24 months — Year 1 + Year 2 (standard SBIR/STTR Phase II). */
export const COST_PHASE2_24MO = buildBurdenCostSheet({
  documentId: 'template-cost-phase2-24mo',
  title: 'Cost Volume — 24 Months (Phase II, Year 1 + Year 2)',
  program: 'sbir',
  periods: [{ name: 'Year 1', months: 12 }, { name: 'Year 2', months: 12 }],
  ceilingNote: 'confirm the Phase II ceiling in your solicitation',
});

/** Custom — three editable periods for any other PoP shape. */
export const COST_CUSTOM = buildBurdenCostSheet({
  documentId: 'template-cost-custom',
  title: 'Cost Volume — Custom (Multi-Period)',
  program: 'sbir',
  periods: [{ name: 'Period 1', months: 0 }, { name: 'Period 2', months: 0 }, { name: 'Period 3', months: 0 }],
});
