/** IMMO-E — cost volume authored by the deterministic burden engine (buildCostVolume) with the
 *  GHOST DSIP labor categories, Atossa Alavi as PI, the real firm rates (fringe 35 · OH 60 · G&A 40
 *  value-added base · fee 5), and Base/Option costed separately. Reproduces the winning DSIP
 *  numbers to the cent (Base $199,998.85 ≤ $200K · Option $114,989.28 ≤ $115K · Total $314,988.14),
 *  landed on the ONE canvas via the section save route. §14 carries the full computed workbook
 *  (readiness rolls it up); §15 carries the Option-focused summary.
 *
 *  cd frontend && node --import tsx scripts/immo-cost.mts */
import { chromium } from 'playwright';
import { buildCostVolume } from '@/lib/proposal/cost-forms';
import { computeBudget } from '@/lib/proposal/cost-model';
import type { LaborLine, OtherDirectCost, IndirectRates } from '@/lib/proposal/cost-model';

const BASE = 'http://localhost:3000';
const SLUG = 'immobileyes';
const PROPOSAL = 'd4b6de67-eb3a-482b-84eb-4b0457687f19';

let failures = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failures++; };

// GHOST DSIP burden structure — value-added G&A base (DSIP "Apply G&A to Overhead? NO").
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
const meta = {
  title: 'Phase I Cost Volume — Base & Option', agency: 'Navy', program: 'sbir',
  companyName: 'Immobileyes, Inc.', solicitationNumber: 'DON26BX03-NP002', topicNumber: 'DON26BX03-NP002',
  ceiling: 200000, proposalId: PROPOSAL,
};

// subs: [] is explicit — the GHOST proposal has NO subcontractors (Firm POW 100%). Even though
// buildCostVolume now defaults omitted collections to empty, spell it out so the intent is on the page.
const workbook = buildCostVolume('burden_waterfall', meta, { labor, rates, odcs, subs: [], periods });
const budget = computeBudget(labor, rates, { odcs, subs: [], periods, ceiling: 200000, program: 'sbir' });
const [base, opt] = budget.periods;
console.log(`Base price $${base.totalPrice.toFixed(2)} (≤ $200,000) · Option $${opt.totalPrice.toFixed(2)} (≤ $115,000) · Total $${budget.grand.totalPrice.toFixed(2)} · SBC work ${(budget.workshare.sbcWorkPct * 100).toFixed(0)}%`);
ok('Base ≤ $200,000 cap', base.totalPrice <= 200000, `$${base.totalPrice.toFixed(2)}`);
ok('Option ≤ $115,000 cap', opt.totalPrice <= 115000, `$${opt.totalPrice.toFixed(2)}`);

// Option-focused summary for §15 (presentation only — NO structured sheet_name, so the readiness
// parser reads §14's complete workbook and is not shadowed by a half-set of sheets here).
const money = (x: number) => ({ text: `$${Math.round(x).toLocaleString('en-US')}`, value: x, cell_type: 'currency', number_format: '$#,##0', style: { alignment: 'right' } });
const optionDoc = {
  version: 1,
  canvas: (workbook as { canvas: unknown }).canvas,
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
      ],
      border_style: 'single', header_style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' },
    }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
  ],
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', 'admin@immobileyes.test');
await page.fill('input[type="password"]', 'DemoPass123!');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 }), page.click('button[type="submit"]')]);
console.log('✓ logged in as admin@immobileyes.test');
const api = page.request;

const docRes = await api.get(`${BASE}/api/portal/${SLUG}/proposals/${PROPOSAL}/document`);
const doc = await docRes.json();
const secs: Array<{ id: string; title: string; version?: number }> = doc.data.sections;
const s14 = secs.find((s) => /Base Cost Proposal/i.test(s.title));
const s15 = secs.find((s) => /Option Cost Proposal/i.test(s.title));
ok('found §14 Base + §15 Option', !!s14 && !!s15);

async function put(sec: { id: string; version?: number } | undefined, content: unknown, label: string) {
  if (!sec) return;
  const r = await api.put(`${BASE}/api/portal/${SLUG}/proposals/${PROPOSAL}/sections/${sec.id}/save`, {
    data: { content, source: 'human_edit', status: 'complete', baseVersion: sec.version, editSummary: label }, timeout: 60_000,
  });
  const body = await r.json().catch(() => ({}));
  ok(label, r.status() === 200, `HTTP ${r.status()} ${JSON.stringify(body).slice(0, 150)}`);
}

// §14 gets the full computed workbook (Base + Option columns) — the readiness rollup source.
await put(s14, { version: 1, canvas: (workbook as { canvas: unknown }).canvas, metadata: { ...(workbook as { metadata?: object }).metadata, status: 'complete' }, nodes: (workbook as { nodes: unknown[] }).nodes }, 'Cost Volume workbook (Base + Option) via burden engine');
await put(s15, optionDoc, 'Option cost summary');

await b.close();
console.log(failures === 0 ? '\nIMMO-COST: ALL GREEN' : `\nIMMO-COST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
