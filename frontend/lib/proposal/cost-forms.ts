/**
 * Cost-volume FORM LAYER — render a computed cost/budget as one of the most common
 * government budget forms.
 *
 * The burden waterfall (lib/proposal/cost-model.ts) is the universal ARITHMETIC; the FORM
 * is the LAYOUT the agency requires. The same computed dollars present three ways:
 *
 *   • burden_waterfall — DoD / DoW SBIR·STTR + any burdened cost volume (the default;
 *                        rendered by cost-volume-canvas.ts).
 *   • sf424a           — SF-424A "Budget Information (Non-Construction)", Section B budget
 *                        categories a–k. The federal-grant standard (NSF, DOE, most
 *                        grants.gov). Grants pay no fee/profit, so the total is direct +
 *                        indirect only. Driven by the SAME engine inputs.
 *   • otf_state_budget — a state / EDA project budget: a spend-type table (Personnel /
 *                        Equipment / Supplies / Purchased Services / Other → project funds +
 *                        total) with a hard ask ceiling, a personnel-share cap, and a
 *                        cost-share rule. This is the Ohio TVSF Round-45 "Budget" volume.
 *
 * resolveCostForm() picks the form from the opportunity; buildCostVolume() dispatches. Pure
 * (no DB / no clock beyond an injected timestamp) and unit-tested.
 */

import type { CanvasDocument, CanvasNode, CanvasRules, TableCell, TableCellStyle } from '@/lib/types/canvas-document';
import { computeBudget, type LaborLine, type IndirectRates, type OtherDirectCost, type Subcontract } from '@/lib/proposal/cost-model';
import { buildCostVolumeCanvas, provisionalCostInputs, type CostVolumeInputs, type CostVolumeMeta } from '@/lib/proposal/cost-volume-canvas';

export type CostForm = 'burden_waterfall' | 'sf424a' | 'otf_state_budget';

export interface CostFormMeta extends CostVolumeMeta {
  /** Hard funding ceiling / ask cap (TVSF $200,000). */
  ceiling?: number | null;
  /** Max personnel share of the ask, as a fraction (TVSF 0.20). */
  personnelMaxPct?: number | null;
  /** Whether applicant cost-share is allowed (TVSF false). */
  costShareAllowed?: boolean;
  /** The solicitation's volume_format hint, if known. */
  volumeFormat?: string | null;
}

/**
 * Pick the cost form from the opportunity. Program/agency/volume-format signals — defaults to
 * the burden waterfall (the most general burdened form).
 */
export function resolveCostForm(o: { agency?: string | null; program?: string | null; volumeName?: string | null; volumeFormat?: string | null }): CostForm {
  const a = (o.agency ?? '').toLowerCase();
  const p = (o.program ?? '').toLowerCase();
  const vf = (o.volumeFormat ?? '').toLowerCase();
  if (vf.includes('tvsf') || vf.includes('otf') || /\btvsf\b|third frontier|\botf\b|econdev/.test(p) || /third frontier|dmvec/.test(a)) return 'otf_state_budget';
  // Grant agencies. NOTE: no bare `\benergy\b` (DOE is already caught by \bdoe\b / "department of energy";
  // \benergy\b would wrongly grab DoD "Directed Energy" / "High Energy Laser" program offices), and the
  // program grant token is word-bounded (\bgrant\b — not bare "grant", which matches "migrant").
  if (vf === 'sf424a' || vf.includes('424') || /\bnsf\b|national science|\bdoe\b|department of energy|grants?\.gov|\bnih\b|\busda\b|\bnasa\b/.test(a) || /\bnsf\b|\bdoe\b|\bgrant\b/.test(p)) return 'sf424a';
  return 'burden_waterfall';
}

// ─── shared cell/node helpers (self-contained to keep the waterfall module untouched) ───
const HDR: TableCellStyle = { bold: true, bg: '#2c3e7a', alignment: 'center' };
const CAT: TableCellStyle = { bold: true, bg: '#e8e8e8' };
const CUR: TableCellStyle = { alignment: 'right' };
const TOTAL: TableCellStyle = { bold: true, bg: '#f0f0f0', alignment: 'right' };
const TOTAL_L: TableCellStyle = { bold: true, bg: '#f0f0f0' };
const GRAND: TableCellStyle = { bold: true, bg: '#2c3e7a', alignment: 'right' };
const GRAND_L: TableCellStyle = { bold: true, bg: '#2c3e7a' };

function h(text: string): TableCell { return { text, style: HDR }; }
function money(x: number, style: TableCellStyle = CUR): TableCell {
  const v = Math.round(x);
  return { text: `$${v.toLocaleString('en-US')}`, value: v, number_format: '$#,##0', cell_type: 'currency', style };
}
function pctCell(frac: number, style: TableCellStyle = CUR): TableCell {
  return { text: `${(frac * 100).toFixed(1)}%`, value: frac, number_format: '0.0%', cell_type: 'percent', style };
}
function txt(text: string, style?: TableCellStyle): TableCell { return style ? { text, style } : { text }; }

let _seq = 0;
function node(type: CanvasNode['type'], content: unknown, style: CanvasNode['style'] = {}): CanvasNode {
  _seq += 1;
  return { id: `costform-${_seq}-${type}`, type, content: content as CanvasNode['content'], style, provenance: { source: 'template' }, history: [], library_eligible: false };
}
function rules(meta: CostFormMeta): CanvasRules {
  return {
    format: 'letter', width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: { template: meta.topicNumber || meta.solicitationNumber ? `Budget — ${meta.topicNumber || meta.solicitationNumber}` : 'Budget', height: 36, font: { family: 'Arial', size: 10 } },
    footer: { template: `${meta.companyName || '{company_name}'} | PROPRIETARY`, height: 36, font: { family: 'Arial', size: 10 } },
    font_default: { family: 'Arial', size: 10 }, line_spacing: 1.15, max_pages: null, max_slides: null,
  };
}
function shell(meta: CostFormMeta, nodes: CanvasNode[], now: string): CanvasDocument {
  return {
    version: 1, document_id: meta.proposalId ? `cost-${meta.proposalId}` : 'cost-form', canvas: rules(meta),
    metadata: {
      title: meta.title || 'Budget', volume_id: '', required_item_id: '', proposal_id: meta.proposalId ?? '',
      solicitation_id: meta.solicitationId ?? '', created_at: now, last_modified_at: now,
      last_modified_by: meta.actorId ?? 'system', version_number: 1, status: 'ai_drafted',
    },
    nodes,
  };
}

// ─── SF-424A — Budget Information (Non-Construction), Section B ──────────────────
// Maps the burden-engine inputs to the SF-424A object-class categories. Grants pay no
// fee/profit; the total is Total Direct (a–h) + Indirect (j). Overhead+G&A → Indirect.

export function buildSf424aCanvas(input: CostVolumeInputs & { meta?: CostFormMeta }, now = new Date().toISOString()): CanvasDocument {
  _seq = 0;
  const meta = (input.meta ?? {}) as CostFormMeta;
  const b = computeBudget(input.labor, input.rates, { odcs: input.odcs, subs: input.subs, ceiling: meta.ceiling ?? null });
  const g = b.grand;
  const personnel = g.directLabor;
  const fringe = g.fringe;
  const travel = g.travel;
  const equipment = g.equipment;
  const supplies = g.materials;
  const contractual = g.subcontracts;
  const other = g.odcOther;
  const totalDirect = personnel + fringe + travel + equipment + supplies + contractual + other; // a–h (g=Construction=0)
  const indirect = g.overhead + g.gna; // j
  const total = totalDirect + indirect; // k (no fee — grants)

  const nodes: CanvasNode[] = [];
  nodes.push(node('heading', { level: 1, text: `Budget — SF-424A (Non-Construction)${meta.agency ? ` — ${meta.agency}` : ''}` }));
  nodes.push(node('text_block', { text: 'Section B — Budget Categories. Federal grant budget; object-class categories per SF-424A. No fee/profit is charged on a grant — the total is direct charges plus indirect (F&A). Replace the example amounts with your actual budget.' }, { size: 9, style: 'italic' }));
  nodes.push(node('table', {
    sheet_name: 'SF424A', is_spreadsheet: true,
    headers: [h('6. Object Class Categories'), h('Amount')],
    rows: [
      [txt('a. Personnel', CAT), money(personnel)],
      [txt('b. Fringe Benefits', CAT), money(fringe)],
      [txt('c. Travel', CAT), money(travel)],
      [txt('d. Equipment', CAT), money(equipment)],
      [txt('e. Supplies', CAT), money(supplies)],
      [txt('f. Contractual', CAT), money(contractual)],
      [txt('g. Construction', CAT), money(0)],
      [txt('h. Other', CAT), money(other)],
      [txt('i. Total Direct Charges (a–h)', TOTAL_L), money(totalDirect, TOTAL)],
      [txt('j. Indirect Charges', CAT), money(indirect)],
      [txt('k. TOTALS (i + j)', GRAND_L), money(total, GRAND)],
    ],
    column_widths: [320, 140], border_style: 'single',
  }));
  if (meta.ceiling != null) {
    const over = total - meta.ceiling;
    nodes.push(node('text_block', { text: over > 0 ? `⚠ Total ($${Math.round(total).toLocaleString('en-US')}) exceeds the program ceiling of $${Math.round(meta.ceiling).toLocaleString('en-US')} by $${Math.round(over).toLocaleString('en-US')}.` : `Total is within the program ceiling of $${Math.round(meta.ceiling).toLocaleString('en-US')} (headroom $${Math.round(-over).toLocaleString('en-US')}).` }, { size: 9, style: 'italic' }));
  }
  nodes.push(node('heading', { level: 2, text: 'Budget Justification' }));
  nodes.push(node('text_block', { text: '[Narrate each object-class category: the basis for personnel effort and rates, the fringe rate, travel purpose, equipment >$5,000 itemized, supplies, the basis for each contractual/subaward, and the indirect (F&A) rate agreement.]' }));
  return shell(meta, nodes, now);
}

// ─── OTF / state project budget (Ohio TVSF Round-45 "Budget" volume) ─────────────
// A spend-type table with a hard ask ceiling, a personnel-share cap, and a no-cost-share rule.

export interface OtfSpendLine { type: string; amount: number; note?: string }

export function buildOtfStateBudgetCanvas(
  input: { lines: OtfSpendLine[]; meta?: CostFormMeta },
  now = new Date().toISOString(),
): CanvasDocument {
  _seq = 0;
  const meta = (input.meta ?? {}) as CostFormMeta;
  const lines = input.lines;
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const personnel = lines.filter((l) => /personnel|salar|wage|labor/i.test(l.type)).reduce((a, l) => a + l.amount, 0);
  const ceiling = meta.ceiling ?? null;
  const persMax = meta.personnelMaxPct ?? null;

  const nodes: CanvasNode[] = [];
  nodes.push(node('heading', { level: 1, text: `Budget${meta.agency ? ` — ${meta.agency}` : ''}` }));
  nodes.push(node('text_block', {
    text: `Project budget by spend type${ceiling != null ? `. OTF ask must not exceed $${Math.round(ceiling).toLocaleString('en-US')}` : ''}${persMax != null ? `; Personnel must not exceed ${(persMax * 100).toFixed(0)}% of the ask` : ''}${meta.costShareAllowed === false ? '; no applicant cost share is required or credited' : ''}. Narrate every line in §12. Replace the example amounts with your actual budget.`,
  }, { size: 9, style: 'italic' }));

  const rows: (string | TableCell)[][] = lines.map((l) => [txt(l.type, CAT), money(l.amount), txt(l.note ?? '')]);
  rows.push([txt('Total OTF Project Funds', GRAND_L), money(total, GRAND), txt('', GRAND)]);
  nodes.push(node('table', {
    sheet_name: 'Budget', is_spreadsheet: true,
    headers: [h('Spend Type'), h('OTF Project Funds'), h('Basis / Narrative')],
    rows, column_widths: [200, 130, 230], border_style: 'single',
  }));

  // Compliance mini-table (advisory) — ask ceiling, personnel cap, cost share.
  if (ceiling != null || persMax != null || meta.costShareAllowed === false) {
    const compRows: (string | TableCell)[][] = [];
    if (ceiling != null) compRows.push([txt('OTF Ask'), money(total), txt(`≤ $${Math.round(ceiling).toLocaleString('en-US')}`), txt(total <= ceiling ? 'PASS' : 'OVER', { bold: true })]);
    if (persMax != null) {
      const persPct = total > 0 ? personnel / total : 0;
      compRows.push([txt('Personnel Share'), pctCell(persPct), txt(`≤ ${(persMax * 100).toFixed(0)}%`), txt(persPct <= persMax + 1e-9 ? 'PASS' : 'OVER', { bold: true })]);
    }
    if (meta.costShareAllowed === false) compRows.push([txt('Applicant Cost Share'), money(0), txt('None required'), txt('PASS', { bold: true })]);
    nodes.push(node('heading', { level: 2, text: 'Budget Compliance' }));
    nodes.push(node('table', { is_spreadsheet: true, headers: [h('Metric'), h('Value'), h('Requirement'), h('Status')], rows: compRows, column_widths: [180, 100, 180, 70], border_style: 'single' }));
  }

  nodes.push(node('heading', { level: 2, text: 'Budget Narrative' }));
  nodes.push(node('text_block', { text: '[Narrate every budget line: what the Personnel funds pay for and the basis; equipment and its role; supplies; each purchased service / vendor; and how the total maps to the project milestones (§11). Fixed-price where possible.]' }));
  return shell(meta, nodes, now);
}

// ─── Provisional starter inputs per form ────────────────────────────────────────

/**
 * Starter spend-type lines that fill EXACTLY to the ask ceiling with Personnel at (but never over)
 * the share cap. Every non-Personnel line scales with the ceiling — no hardcoded floor — so a small
 * micro-grant ($25k) stays non-negative and compliant, not just the $200k case. Personnel is floored
 * so `personnel/ceiling ≤ personnelMaxPct` for any ceiling; Purchased Services absorbs the rounding
 * residual (~0.375·rest, always ≥ 0).
 */
export function provisionalOtfLines(ceiling = 200000, personnelMaxPct = 0.2): OtfSpendLine[] {
  const c = Math.max(0, Math.round(ceiling));
  const pct = Math.min(1, Math.max(0, personnelMaxPct));
  const personnel = Math.floor(c * pct);      // ≤ the personnel share cap (never rounds over)
  const rest = c - personnel;
  const equipment = Math.round(rest * 0.375);
  const supplies = Math.round(rest * 0.1875);
  const other = Math.round(rest * 0.0625);
  const purchased = rest - equipment - supplies - other; // residual (~0.375·rest ≥ 0); keeps the sum = ceiling
  return [
    { type: 'Personnel', amount: personnel, note: '[Roles, FTE %, and basis — capped at the personnel share limit]' },
    { type: 'Equipment', amount: equipment, note: '[Capital equipment itemized]' },
    { type: 'Supplies', amount: supplies, note: '[Materials & consumables]' },
    { type: 'Purchased Services', amount: purchased, note: '[Vendors / subcontracted services]' },
    { type: 'Other Direct Costs', amount: other, note: '[Other project costs]' },
  ];
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────────

/**
 * Build a cost/budget volume in the requested form. `inputs` are the burden-engine inputs
 * (used by burden_waterfall + sf424a); the OTF form derives its spend-type lines from the
 * caps in `meta` when none are supplied.
 */
export function buildCostVolume(
  form: CostForm,
  meta: CostFormMeta,
  inputs?: Partial<CostVolumeInputs>,
  otfLines?: OtfSpendLine[],
): CanvasDocument {
  const base = { ...provisionalCostInputs(), ...(inputs ?? {}) } as CostVolumeInputs;
  switch (form) {
    case 'sf424a':
      return buildSf424aCanvas({ ...base, meta });
    case 'otf_state_budget':
      return buildOtfStateBudgetCanvas({ lines: otfLines ?? provisionalOtfLines(meta.ceiling ?? 200000, meta.personnelMaxPct ?? 0.2), meta });
    case 'burden_waterfall':
    default:
      return buildCostVolumeCanvas({ ...base, meta });
  }
}
