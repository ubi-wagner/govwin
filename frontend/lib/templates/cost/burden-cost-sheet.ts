/**
 * Parameterized burden-waterfall COST SHEET generator (formula spreadsheet templates).
 *
 * Produces a pristine, formula-driven cost workbook whose roll-ups mirror the portal
 * cost engine EXACTLY (lib/proposal/cost-model.ts `computeBudget`) — so a tenant fills
 * the template and transcribes 1:1 into the portal cost sheet, and the numbers agree:
 *
 *   Direct Labor  = Σ(rate × hours)            [Labor sheet]
 *   Fringe        = DL × fringe%               [base: DL]
 *   Overhead      = (DL + Fringe) × OH%        [base: DL + Fringe]
 *   + Other Direct Costs (materials/travel/equipment/other) + Subcontracts
 *   Subtotal      = DL + Fringe + OH + ODC + Subs      (G&A base INCLUDES subs)
 *   G&A           = Subtotal × G&A%
 *   Total Est.    = Subtotal + G&A
 *   Fee / Profit  = Total Est. × fee%
 *   TOTAL PRICE   = Total Est. + Fee
 *
 * FOUR sheets, all live Excel formulas (recalc as the tenant types):
 *   1. Rates   — the FOUR rate inputs (Fringe / Overhead / G&A / Fee) — the easy
 *                "insert your OH, G&A, and profit" knobs. B2..B5 = the rates.
 *   2. Labor   — the common program labor codes × per-period hours × unburdened rate.
 *   3. ODC     — Materials / Travel / Equipment / Other + Subcontracts, per period.
 *   4. Summary — the burden waterfall per Period of Performance + a Total column.
 *
 * Parameterized by `periods` (the PoP variant) + `program` (fee-cap / work-share notes).
 * PRISTINE: numeric inputs ship BLANK (no baked-in figures); {anchors} for names.
 */
import type { CanvasDocument, CanvasNode, CanvasRules, TableCell } from '@/lib/types/canvas-document';

/** Excel column letter for a 1-based index (1→A, 2→B, 27→AA). */
export function colLetter(n: number): string {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export interface CostPeriod { name: string; months: number }
export interface BurdenCostOpts {
  documentId: string;
  title: string;
  periods: CostPeriod[];
  /** 'sbir' | 'sttr' | 'grant' — drives the program-rule note + default fee posture. */
  program?: 'sbir' | 'sttr' | 'grant';
  /** Ceiling reminder text (e.g. "$314,363 Phase I ceiling"). */
  ceilingNote?: string;
}

const PRESET: CanvasRules = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 54, right: 54, bottom: 54, left: 54 },
  header: { template: 'Cost Volume — {topic_number}', height: 32, font: { family: 'Arial', size: 9 } },
  footer: { template: '{company_name} | PROPRIETARY — {n} / {N}', height: 32, font: { family: 'Arial', size: 9 } },
  font_default: { family: 'Arial', size: 10 }, line_spacing: 1.1, max_pages: null, max_slides: null,
};

const HDR: TableCell['style'] = { bold: true, bg: '#1F4E79', fg: '#ffffff', alignment: 'center' };
const CAT: TableCell['style'] = { bold: true, bg: '#e8e8e8' };
const CUR: TableCell['style'] = { alignment: 'right' };
const TOT: TableCell['style'] = { bold: true, bg: '#f0f0f0', alignment: 'right' };
const GRAND: TableCell['style'] = { bold: true, bg: '#1F4E79', fg: '#ffffff', alignment: 'right' };

const h = (text: string): TableCell => ({ text, style: HDR });
const cat = (text: string): TableCell => ({ text, style: CAT });
const numIn = (fmt = '#,##0'): TableCell => ({ text: '', cell_type: 'number', number_format: fmt, style: CUR });
const dollarIn = (): TableCell => ({ text: '', cell_type: 'number', number_format: '$#,##0', style: CUR });
const pctIn = (): TableCell => ({ text: '', cell_type: 'percent', number_format: '0.0%', style: CUR });
const f = (formula: string, style: TableCell['style'] = CUR, fmt = '$#,##0'): TableCell => ({ text: '', formula, number_format: fmt, cell_type: 'formula', style });

function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: false };
}

// The common program labor codes that map to the portal cost sheet's labor categories.
const LABOR_CODES: Array<{ name: string; category: string }> = [
  { name: '{pi_name}', category: 'Principal Investigator' },
  { name: '[Name]', category: 'Co-Investigator / Senior Scientist' },
  { name: '[Name]', category: 'Senior Engineer' },
  { name: '[Name]', category: 'Research Engineer' },
  { name: '[Name]', category: 'Software Engineer' },
  { name: '[Name]', category: 'Design / Mechanical Engineer' },
  { name: '[Name]', category: 'Technician' },
  { name: '[Name]', category: 'Project Manager' },
  { name: '[Name]', category: 'Business / Administrative' },
];

const ODC_ROWS = ['Materials & Supplies', 'Travel', 'Equipment (>$5,000/unit)', 'Other Direct Costs', 'Subcontracts / Consultants'];

export function buildBurdenCostSheet(opts: BurdenCostOpts): CanvasDocument {
  const P = opts.periods.length;
  const program = opts.program ?? 'sbir';
  const periodCol = (p: number) => colLetter(2 + p);          // Summary/ODC: B, C, ...
  const totalCol = colLetter(2 + P);                          // Summary/ODC total column
  const nLabor = LABOR_CODES.length;
  const laborFirst = 2, laborLast = 1 + nLabor;               // Labor data rows 2..(1+n)
  // Labor columns: A Name, B Category, C Rate, then per period [Hrs, DL$]; then TotHrs, TotDL.
  const laborHrsCol = (p: number) => colLetter(4 + 2 * p);    // D, F, H, ...
  const laborDlCol = (p: number) => colLetter(5 + 2 * p);     // E, G, I, ...
  const laborTotHrsCol = colLetter(4 + 2 * P);
  const laborTotDlCol = colLetter(5 + 2 * P);

  const nodes: CanvasNode[] = [];

  // ── Sheet 1: Rates ──────────────────────────────────────────────
  nodes.push(node('rates-h', { type: 'heading', content: { level: 1, text: 'Indirect Rate Schedule' } }));
  nodes.push(node('rates-note', { type: 'text_block', content: { text: 'Enter your company\'s indirect rates. These flow into the Summary automatically. Use DCAA-audited rates if available, else provisional rates (note the basis). Fee/profit is typically ≤ 7% for SBIR/STTR.' }, style: { size: 9, style: 'italic' } }));
  nodes.push(node('rates-t', { type: 'table', content: {
    sheet_name: 'Rates', is_spreadsheet: true,
    headers: [h('Rate Category'), h('Rate (%)'), h('Base'), h('Notes')],
    rows: [
      [cat('Fringe Benefits'), pctIn(), { text: 'Direct Labor $' }, { text: 'Health, FICA, PTO, 401k, workers comp' }],
      [cat('Overhead (OH)'), pctIn(), { text: 'Direct Labor + Fringe' }, { text: 'Facilities, IT, admin support, insurance' }],
      [cat('General & Administrative (G&A)'), pctIn(), { text: 'Total Costs before G&A' }, { text: 'Exec mgmt, accounting, legal, BD' }],
      [cat('Fee / Profit'), pctIn(), { text: 'Total Est. Cost' }, { text: `Reasonable profit (FAR 15.404); ≤ 7% typical for ${program.toUpperCase()}` }],
    ],
    column_widths: [190, 80, 150, 200], border_style: 'single',
  } }));
  nodes.push(node('rates-brk', { type: 'page_break', content: null }));

  // ── Sheet 2: Labor ──────────────────────────────────────────────
  nodes.push(node('labor-h', { type: 'heading', content: { level: 1, text: 'Direct Labor Detail' } }));
  const laborHeaders: TableCell[] = [h('Name'), h('Labor Category'), h('Rate ($/hr)')];
  for (let p = 0; p < P; p++) { laborHeaders.push(h(`${opts.periods[p].name} Hrs`)); laborHeaders.push(h(`${opts.periods[p].name} DL$`)); }
  laborHeaders.push(h('Total Hrs')); laborHeaders.push(h('Total DL$'));
  const laborRows: TableCell[][] = LABOR_CODES.map((lc, i) => {
    const r = laborFirst + i;
    const row: TableCell[] = [{ text: lc.name }, { text: lc.category }, numIn('$#,##0')];
    for (let p = 0; p < P; p++) { row.push(numIn()); row.push(f(`=C${r}*${laborHrsCol(p)}${r}`)); }
    const hrsRefs = Array.from({ length: P }, (_, p) => `${laborHrsCol(p)}${r}`).join('+');
    const dlRefs = Array.from({ length: P }, (_, p) => `${laborDlCol(p)}${r}`).join('+');
    row.push(f(`=${hrsRefs}`, CUR, '#,##0')); row.push(f(`=${dlRefs}`));
    return row;
  });
  // TOTAL row
  const totRow: TableCell[] = [cat('TOTAL'), { text: '' }, { text: '' }];
  for (let p = 0; p < P; p++) {
    totRow.push(f(`=SUM(${laborHrsCol(p)}${laborFirst}:${laborHrsCol(p)}${laborLast})`, TOT, '#,##0'));
    totRow.push(f(`=SUM(${laborDlCol(p)}${laborFirst}:${laborDlCol(p)}${laborLast})`, TOT));
  }
  totRow.push(f(`=SUM(${laborTotHrsCol}${laborFirst}:${laborTotHrsCol}${laborLast})`, TOT, '#,##0'));
  totRow.push(f(`=SUM(${laborTotDlCol}${laborFirst}:${laborTotDlCol}${laborLast})`, TOT));
  laborRows.push(totRow);
  nodes.push(node('labor-t', { type: 'table', content: {
    sheet_name: 'Labor', is_spreadsheet: true, headers: laborHeaders, rows: laborRows,
    column_widths: [110, 150, 70, ...Array.from({ length: P * 2 }, () => 60), 60, 70], border_style: 'single',
  } }));
  nodes.push(node('labor-note', { type: 'text_block', content: { text: `Enter hours per period against each labor code; DL$ = rate × hours computes automatically. PI commitment ≥ 50% of hours (SBIR PI-as-primary-researcher rule).` }, style: { size: 9, style: 'italic' } }));
  nodes.push(node('labor-brk', { type: 'page_break', content: null }));

  // ── Sheet 3: ODC ────────────────────────────────────────────────
  nodes.push(node('odc-h', { type: 'heading', content: { level: 1, text: 'Other Direct Costs & Subcontracts' } }));
  const odcHeaders: TableCell[] = [h('Category')];
  for (let p = 0; p < P; p++) odcHeaders.push(h(`${opts.periods[p].name} $`));
  odcHeaders.push(h('Total $'));
  const odcRows: TableCell[][] = ODC_ROWS.map((label, i) => {
    const r = 2 + i;
    const row: TableCell[] = [cat(label)];
    for (let p = 0; p < P; p++) row.push(dollarIn());
    const refs = Array.from({ length: P }, (_, p) => `${periodCol(p)}${r}`).join('+');
    row.push(f(`=${refs}`, TOT));
    return row;
  });
  nodes.push(node('odc-t', { type: 'table', content: {
    sheet_name: 'ODC', is_spreadsheet: true, headers: odcHeaders, rows: odcRows,
    column_widths: [200, ...Array.from({ length: P }, () => 80), 80], border_style: 'single',
  } }));
  nodes.push(node('odc-note', { type: 'text_block', content: { text: 'Equipment = >$5,000/unit with useful life >1 yr (else it is Supplies). Subcontracts/consultants are a pass-through (no fringe/OH), but ARE in the G&A base. Itemize in the budget justification.' }, style: { size: 9, style: 'italic' } }));
  nodes.push(node('odc-brk', { type: 'page_break', content: null }));

  // ── Sheet 4: Summary (the burden waterfall) ─────────────────────
  nodes.push(node('sum-h', { type: 'heading', content: { level: 1, text: 'Cost Summary — Burden Waterfall' } }));
  const sumHeaders: TableCell[] = [h('Cost Element')];
  for (let p = 0; p < P; p++) sumHeaders.push(h(`${opts.periods[p].name} (${opts.periods[p].months} mo)`));
  if (P > 1) sumHeaders.push(h('Total'));

  // Summary rows (row index in the sheet, header = row 1):
  const R_DL = 2, R_FR = 3, R_OH = 4, R_MAT = 5, R_TRV = 6, R_EQP = 7, R_OTH = 8, R_SUB = 9, R_SUBT = 10, R_GNA = 11, R_EST = 12, R_FEE = 13, R_PRICE = 14;
  const perPeriod = (build: (p: number) => string, style: TableCell['style'] = CUR): TableCell[] => {
    const cells: TableCell[] = [];
    for (let p = 0; p < P; p++) cells.push(f(build(p), style));
    if (P > 1) { const rowNum = 0; void rowNum; } // total appended by caller
    return cells;
  };
  const withTotal = (rowNum: number, cells: TableCell[], style: TableCell['style'] = CUR): TableCell[] => {
    if (P > 1) cells.push(f(`=SUM(${periodCol(0)}${rowNum}:${periodCol(P - 1)}${rowNum})`, style));
    return cells;
  };
  const sumRows: TableCell[][] = [];
  // A. Direct Labor  ← Labor per-period DL column sum
  sumRows.push([cat('A. Direct Labor'), ...withTotal(R_DL, perPeriod((p) => `=SUM(Labor!${laborDlCol(p)}${laborFirst}:${laborDlCol(p)}${laborLast})`))]);
  // B. Fringe = DL × Rates!B2
  sumRows.push([cat('B. Fringe Benefits'), ...withTotal(R_FR, perPeriod((p) => `=${periodCol(p)}${R_DL}*Rates!$B$2`))]);
  // C. Overhead = (DL + Fringe) × Rates!B3
  sumRows.push([cat('C. Overhead'), ...withTotal(R_OH, perPeriod((p) => `=(${periodCol(p)}${R_DL}+${periodCol(p)}${R_FR})*Rates!$B$3`))]);
  // D–G Other Direct Costs ← ODC sheet rows 2..5
  sumRows.push([cat('D. Materials & Supplies'), ...withTotal(R_MAT, perPeriod((p) => `=ODC!${periodCol(p)}2`))]);
  sumRows.push([cat('E. Travel'), ...withTotal(R_TRV, perPeriod((p) => `=ODC!${periodCol(p)}3`))]);
  sumRows.push([cat('F. Equipment'), ...withTotal(R_EQP, perPeriod((p) => `=ODC!${periodCol(p)}4`))]);
  sumRows.push([cat('G. Other Direct Costs'), ...withTotal(R_OTH, perPeriod((p) => `=ODC!${periodCol(p)}5`))]);
  // Subcontracts ← ODC row 6
  sumRows.push([cat('Subcontracts / Consultants'), ...withTotal(R_SUB, perPeriod((p) => `=ODC!${periodCol(p)}6`))]);
  // Subtotal before G&A = SUM(DL..Subs)
  sumRows.push([cat('Subtotal before G&A'), ...withTotal(R_SUBT, perPeriod((p) => `=SUM(${periodCol(p)}${R_DL}:${periodCol(p)}${R_SUB})`), TOT)]);
  // H. G&A = Subtotal × Rates!B4
  sumRows.push([cat('H. G&A'), ...withTotal(R_GNA, perPeriod((p) => `=${periodCol(p)}${R_SUBT}*Rates!$B$4`))]);
  // Total Est Cost = Subtotal + G&A
  sumRows.push([cat('Total Estimated Cost'), ...withTotal(R_EST, perPeriod((p) => `=${periodCol(p)}${R_SUBT}+${periodCol(p)}${R_GNA}`), TOT)]);
  // I. Fee = Est × Rates!B5
  sumRows.push([cat('I. Fee / Profit'), ...withTotal(R_FEE, perPeriod((p) => `=${periodCol(p)}${R_EST}*Rates!$B$5`))]);
  // TOTAL PROPOSED PRICE = Est + Fee (whole row styled GRAND)
  const priceCells = withTotal(R_PRICE, perPeriod((p) => `=${periodCol(p)}${R_EST}+${periodCol(p)}${R_FEE}`, GRAND), GRAND);
  sumRows.push([{ text: 'TOTAL PROPOSED PRICE', style: GRAND }, ...priceCells]);

  nodes.push(node('sum-t', { type: 'table', content: {
    sheet_name: 'Summary', is_spreadsheet: true, headers: sumHeaders, rows: sumRows,
    column_widths: [200, ...Array.from({ length: P + (P > 1 ? 1 : 0) }, () => 90)], border_style: 'single',
  } }));
  const priceCell = P > 1 ? `${totalCol}${R_PRICE}` : `${periodCol(0)}${R_PRICE}`;
  nodes.push(node('sum-note', { type: 'text_block', content: { text: `Roll-up mirrors the portal cost sheet exactly (Direct Labor → Fringe → Overhead → ODC/Subcontracts → G&A → Fee → Price). ${opts.ceilingNote ? `Ceiling: ${opts.ceilingNote}. ` : ''}Total proposed price is cell Summary!${priceCell}.` }, style: { size: 9, style: 'italic' } }));

  return {
    version: 1, document_id: opts.documentId, canvas: PRESET,
    metadata: { title: opts.title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
    nodes,
  };
}
