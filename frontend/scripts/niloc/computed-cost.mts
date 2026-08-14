/**
 * The IN-SYSTEM computed cost path for the NILOC examples.
 *
 * `buildFilledCost` (in _shared.mts) fills the pristine burden TEMPLATE a tenant edits. This module
 * instead emits the **computed** cost volume straight from the product's own agency-neutral builder
 * `buildCostVolume` (lib/proposal/cost-forms.ts) — the artifact the portal produces from inputs:
 *   · burden_waterfall  → each NILOC SBIR/CSO/NASA cost volume (computed, not a fill-in template)
 *   · otf_state_budget  → the Ohio Third Frontier TVSF budget in the state's own form
 *
 * Proof: the computed volume's TOTAL PROPOSED PRICE equals the template roll-up (buildFilledCost)
 * AND computeBudget, to the cent — so the template a tenant fills and the computed portal volume
 * agree. Run: cd frontend && node --import tsx scripts/niloc/computed-cost.mts [--export outDir]
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildCostVolume, type CostFormMeta, type OtfSpendLine } from '@/lib/proposal/cost-forms';
import { computeBudget, popBasePlusOption, singlePeriod, type LaborLine, type OtherDirectCost, type Subcontract, type Period } from '@/lib/proposal/cost-model';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import type { CanvasDocument, CanvasNode, TableContent, TableCell } from '@/lib/types/canvas-document';
import { COST_SPECS, buildFilledCost, costPrice, HERE, type CostSpec } from './_shared.mts';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const specPoP = (s: CostSpec): Period[] => s.periods.length === 1 ? singlePeriod(s.periods[0].name) : popBasePlusOption(s.periods.map((p) => [p.name, p.months]));

/** Map a NILOC CostSpec → the burden-engine inputs buildCostVolume/computeBudget consume. */
function specInputs(spec: CostSpec) {
  const labor: LaborLine[] = spec.labor.map((l, i) => l ? ({ name: `code${i}`, category: `cat${i}`, hours: sum(l.hours), unburdenedRate: l.rate, allocation: l.hours }) : null).filter(Boolean) as LaborLine[];
  const odcs: OtherDirectCost[] = ([
    { kind: 'materials', label: 'Materials', amount: sum(spec.materials), allocation: spec.materials },
    { kind: 'travel', label: 'Travel', amount: sum(spec.travel), allocation: spec.travel },
    { kind: 'equipment', label: 'Equipment', amount: sum(spec.equipment), allocation: spec.equipment },
    { kind: 'odc_other', label: 'Other', amount: sum(spec.other), allocation: spec.other },
  ] as OtherDirectCost[]).filter((o) => o.amount > 0);
  const subs: Subcontract[] = sum(spec.subs) > 0 ? [{ org: spec.subOrg, role: 'sub', amount: sum(spec.subs), allocation: spec.subs }] : [];
  return { labor, rates: spec.rates, odcs, subs, periods: specPoP(spec) };
}

/** The product's COMPUTED cost volume (burden_waterfall form) for a NILOC spec. */
export function buildComputedCost(spec: CostSpec): CanvasDocument {
  const meta: CostFormMeta = { title: spec.title, companyName: 'NILOC Technologies', program: spec.program ?? 'sbir', topicNumber: spec.topic };
  return buildCostVolume('burden_waterfall', meta, specInputs(spec));
}

/** The Ohio Third Frontier TVSF budget in the state's own `otf_state_budget` form. */
export function buildTvsfBudget(): { doc: CanvasDocument; total: number; ceiling: number } {
  const ceiling = 200000, personnelMaxPct = 0.20;                 // canonical Ohio TVSF caps
  const lines: OtfSpendLine[] = [
    { type: 'Personnel', amount: 40000, note: 'PI (Eric Wagner) + ML/ontology engineer — ≤ 20% personnel cap [confirm FTE %]' },
    { type: 'Purchased Services', amount: 60000, note: 'Battelle OATS license/option (US 12,430,376) + independent validation consultant [confirm terms]' },
    { type: 'Equipment', amount: 45000, note: 'Compute / dev workstations for the document-intelligence engine' },
    { type: 'Supplies', amount: 40000, note: 'Cloud / data / software subscriptions for validation' },
    { type: 'Other Direct Costs', amount: 15000, note: 'Travel, IP / freedom-to-operate review, program admin' },
  ];
  const meta: CostFormMeta = { title: 'NILOC — TVSF Budget (Battelle OATS commercialization)', companyName: 'NILOC Technologies', agency: 'Ohio Third Frontier — TVSF', ceiling, personnelMaxPct, costShareAllowed: false };
  const doc = buildCostVolume('otf_state_budget', meta, undefined, lines);
  return { doc, total: sum(lines.map((l) => l.amount)), ceiling };
}

/** Pull the numeric total from a computed volume's `TOTAL PROPOSED PRICE` / `Total OTF Project Funds` row. */
export function computedTotal(doc: CanvasDocument, label = /TOTAL PROPOSED PRICE|Total OTF Project Funds/i): number {
  for (const n of (doc.nodes ?? []) as CanvasNode[]) {
    const c = n.content as TableContent | null;
    if (!c || !Array.isArray(c.rows)) continue;
    for (const row of c.rows as TableCell[][]) {
      const first = String((row[0] as TableCell)?.text ?? '');
      if (label.test(first)) { const v = (row[1] as TableCell); const num = typeof v?.value === 'number' ? v.value : parseFloat(String(v?.text ?? '').replace(/[$,\s]/g, '')); if (Number.isFinite(num)) return num; }
    }
  }
  return NaN;
}

async function main() {
  const exportIdx = process.argv.indexOf('--export');
  const outDir = exportIdx >= 0 ? (process.argv[exportIdx + 1] || join(HERE, 'dist')) : null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  console.log('COMPUTED COST VOLUMES (buildCostVolume) vs template (buildFilledCost) vs computeBudget');
  let ok = true;
  for (const spec of COST_SPECS) {
    const inputs = specInputs(spec);
    const eng = computeBudget(inputs.labor, inputs.rates, { odcs: inputs.odcs, subs: inputs.subs, periods: inputs.periods });
    const computedDoc = buildComputedCost(spec);
    const computed = computedTotal(computedDoc);
    const template = costPrice(buildFilledCost(spec), spec.periods.length);
    const match = Math.abs(computed - eng.grand.totalPrice) < 0.02 && Math.abs(computed - template) < 0.02;
    ok &&= match;
    console.log(`  ${spec.tag.padEnd(13)} computed=$${Math.round(computed).toLocaleString().padStart(11)}  template=$${Math.round(template).toLocaleString().padStart(11)}  engine=$${Math.round(eng.grand.totalPrice).toLocaleString().padStart(11)}  ${match ? '✓' : '✗ MISMATCH'}`);
    if (outDir) writeFileSync(join(outDir, `NILOC-${spec.tag}-computed.xlsx`), await exportToXlsx(computedDoc, { company_name: 'NILOC Technologies' }));
  }

  const tvsf = buildTvsfBudget();
  const tvsfTotal = computedTotal(tvsf.doc);
  const tvsfOk = Math.abs(tvsfTotal - tvsf.total) < 0.02 && tvsf.total <= tvsf.ceiling;
  ok &&= tvsfOk;
  console.log(`\nTVSF otf_state_budget: total=$${Math.round(tvsfTotal).toLocaleString()} (lines $${tvsf.total.toLocaleString()}) ≤ ceiling $${tvsf.ceiling.toLocaleString()} ${tvsfOk ? '✓' : '✗'}`);
  if (outDir) writeFileSync(join(outDir, `NILOC-TVSF-budget.xlsx`), await exportToXlsx(tvsf.doc, { company_name: 'NILOC Technologies' }));

  console.log(`\n${ok ? '✓ COMPUTED PATH MATCHES (in-system buildCostVolume)' : '✗ MISMATCH'}${outDir ? ` · exported → ${outDir}` : ''}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
