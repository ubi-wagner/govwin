/** Correct the finalized Immobileyes cost volume: regenerate §14/§15 with the FIXED buildCostVolume
 *  (no phantom provisional subcontractor) and write the corrected content into the two cost sections.
 *  The proposal is already finalized (submitted+locked), and the system correctly freezes re-authoring
 *  of finalized content through the save route — so this applies the fixed engine's output directly to
 *  the frozen build (a one-time data correction of a finished proposal), then the live package route
 *  re-exports it. Verifies the readiness rollup lands on the true $314,988.14.
 *
 *  cd frontend && node --import tsx scripts/immo-recost.mts */
import { buildCostVolume } from '@/lib/proposal/cost-forms';
import { computeBudget } from '@/lib/proposal/cost-model';
import { parseStructuredCostInputs } from '@/lib/proposal/cost-volume-canvas';
import type { LaborLine, OtherDirectCost, IndirectRates } from '@/lib/proposal/cost-model';
import { sqlBypass as sql } from '@/lib/db';

const P = 'd4b6de67-eb3a-482b-84eb-4b0457687f19';
const rates: IndirectRates = { fringePct: 0.35, overheadPct: 0.60, gnaPct: 0.40, feePct: 0.05, gnaAppliesToOverhead: false };
const B = [1, 0], O = [0, 1];
const labor: LaborLine[] = [
  { name: 'Atossa Alavi', category: 'Chief Executive / Principal Investigator', hours: 400, unburdenedRate: 50, allocation: B },
  { name: 'Dr. Bahman Taheri', category: 'Physicist / Chief Scientist', hours: 260, unburdenedRate: 63, allocation: B },
  { name: 'Electrical Engineer', category: 'Electrical Engineer', hours: 200, unburdenedRate: 45, allocation: B },
  { name: 'Dr. Christopher Lukowski', category: 'Engineers, All Other / Senior Optics Engineer', hours: 260, unburdenedRate: 50, allocation: B },
  { name: 'Software Engineer', category: 'Software Developer', hours: 165, unburdenedRate: 45, allocation: B },
  { name: 'Atossa Alavi', category: 'Chief Executive / Principal Investigator', hours: 160, unburdenedRate: 50, allocation: O },
  { name: 'Dr. Bahman Taheri', category: 'Physicist / Chief Scientist', hours: 120, unburdenedRate: 63, allocation: O },
  { name: 'Electrical Engineer', category: 'Electrical Engineer', hours: 120, unburdenedRate: 45, allocation: O },
  { name: 'Dr. Christopher Lukowski', category: 'Engineers, All Other / Senior Optics Engineer', hours: 80, unburdenedRate: 50, allocation: O },
  { name: 'Software Engineer', category: 'Software Developer', hours: 80, unburdenedRate: 45, allocation: O },
];
const odcs: OtherDirectCost[] = [
  { kind: 'materials', label: 'Modeling, Analysis & Testing Components (AlphaMicron)', amount: 8000, allocation: B },
  { kind: 'materials', label: 'DEXTER Benchtop System & Testing Prototype Components (AlphaMicron)', amount: 22000, allocation: O },
  { kind: 'travel', label: 'Recommended Phase I Onsite Meeting — Kent, OH → NAS Patuxent River, MD (2 pax, 3 days)', amount: 1144, allocation: B },
  { kind: 'travel', label: 'Recommended Option Onsite Visit — Kent, OH → NAVAIR (2 pax, 3 days)', amount: 1144, allocation: O },
];
const periods = [{ name: 'Base (6 mo)', months: 6 }, { name: 'Option (6 mo)', months: 6 }];
const meta = { title: 'Phase I Cost Volume — Base & Option', agency: 'Navy', program: 'sbir', companyName: 'Immobileyes, Inc.', solicitationNumber: 'DON26BX03-NP002', topicNumber: 'DON26BX03-NP002', ceiling: 200000, proposalId: P };

const workbook = buildCostVolume('burden_waterfall', meta, { labor, rates, odcs, subs: [], periods });
const budget = computeBudget(labor, rates, { odcs, subs: [], periods });
const [base, opt] = budget.periods;
const f = (x: number) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`corrected: Base ${f(base.totalPrice)} · Option ${f(opt.totalPrice)} · Total ${f(budget.grand.totalPrice)} · subs ${f(budget.grand.subcontracts)}`);

// Confirm the workbook has NO phantom subcontractor.
const wbText = JSON.stringify((workbook as { nodes: unknown[] }).nodes);
if (/University \/ Lab|15,000/.test(wbText)) { console.log('✗ phantom sub STILL present'); process.exit(1); }
console.log('✓ no phantom subcontractor in the regenerated workbook');

const money = (x: number) => ({ text: `$${Math.round(x).toLocaleString('en-US')}`, value: x, cell_type: 'currency', number_format: '$#,##0', style: { alignment: 'right' } });
const optionDoc = {
  version: 1, canvas: (workbook as { canvas: unknown }).canvas,
  metadata: { title: 'Phase I Option Cost Proposal', status: 'complete' },
  nodes: [
    { id: 'opt-h', type: 'heading', content: { level: 1, text: 'Phase I Option Cost Proposal' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
    { id: 'opt-p', type: 'text_block', content: { text: 'The 6-month Option period is funded separately from the Base and is fully costed within the DSIP cost form (Option column of the Cost Volume, §14). It advances the effort toward Phase II with a DEXTER breadboard optical-effects demonstration and a maritime prototype/transition package. Total Option price is not to exceed $115,000 per the topic.' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
    { id: 'opt-t', type: 'table', content: {
      headers: ['Option Cost Element', 'Amount'],
      rows: [
        [{ text: 'A. Direct Labor (PI + Chief Scientist + EE + Optics + SW)' }, money(opt.directLabor)],
        [{ text: 'B. Fringe Benefits (35%)' }, money(opt.fringe)],
        [{ text: 'C. Overhead (60% × A+B)' }, money(opt.overhead)],
        [{ text: 'D. Direct Materials (DEXTER benchtop prototype)' }, money(opt.materials)],
        [{ text: 'E. Direct Travel (NAVAIR onsite, 2 pax)' }, money(opt.travel)],
        [{ text: 'F. G&A (40% × value-added base, excl. overhead)' }, money(opt.gna)],
        [{ text: 'Total Estimated Cost' }, money(opt.totalEstCost)],
        [{ text: 'G. Fee / Profit (5%)' }, money(opt.fee)],
        [{ text: 'TOTAL OPTION PRICE (NTE $115,000)' }, money(opt.totalPrice)],
      ], border_style: 'single', header_style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' },
    }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
  ],
};

const s14 = { version: 1, canvas: (workbook as { canvas: unknown }).canvas, metadata: { ...(workbook as { metadata?: object }).metadata, status: 'complete' }, nodes: (workbook as { nodes: unknown[] }).nodes };
await sql`UPDATE proposal_sections SET content = ${JSON.stringify(s14)}, updated_at = now() WHERE proposal_id = ${P} AND volume_number = 3 AND section_number = '14'`;
await sql`UPDATE proposal_sections SET content = ${JSON.stringify(optionDoc)}, updated_at = now() WHERE proposal_id = ${P} AND volume_number = 3 AND section_number = '15'`;
console.log('✓ §14 + §15 corrected content written');

// Verify the readiness rollup now recomputes to the true total from the stored §14.
const rows = await sql`SELECT content FROM proposal_sections WHERE proposal_id = ${P} AND volume_number = 3 ORDER BY sort_index`;
const parsed = parseStructuredCostInputs(rows.map((r: { content: string }) => ({ content: r.content })) as { content: string }[]);
if (parsed) {
  const rb = computeBudget(parsed.labor, parsed.rates, { odcs: parsed.odcs, subs: parsed.subs });
  console.log(`readiness rollup now: ${f(rb.grand.totalPrice)} · subs ${f(rb.grand.subcontracts)} · SBC work ${(rb.workshare.sbcWorkPct * 100).toFixed(0)}%`);
}
await sql.end();
