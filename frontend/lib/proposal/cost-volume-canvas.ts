/**
 * Universal cost-volume canvas generator.
 *
 * Emits a complete cost-volume CanvasDocument whose numbers are COMPUTED by the
 * deterministic engine (lib/proposal/cost-model.ts), not hand-maintained placeholder
 * strings. Agency-neutral: the burden waterfall (Direct Labor → Fringe → Overhead →
 * ODC/Subs → G&A → Fee → Price) is identical for DoW, NSF, and DOE, so ONE generator
 * serves every agency — only the header text and which compliance floors are shown differ.
 *
 * This supersedes the static `templates/dod-sbir-phase1-cost.ts` (whose totals were
 * hardcoded display strings + Excel formulas that only resolved at xlsx-export time and
 * could silently drift from the summary). Here every table cell carries both a display
 * `text` and a numeric `value`, so the canvas, the readiness roll-up, and every export
 * (docx/pdf/xlsx) read the same computed dollars.
 */

import type { CanvasDocument, CanvasNode, CanvasRules, TableCell, TableCellStyle, TableContent } from '@/lib/types/canvas-document';
import { docNodes } from '@/lib/types/canvas-document';
import { coerceJsonb } from '@/lib/jsonb';
import { parseNumericText } from '@/lib/numeric-cell';
import {
  computeBudget, odcTotal, roundCents,
  type LaborLine, type IndirectRates, type OtherDirectCost, type Subcontract, type Period,
  type BudgetResult, type PeriodBreakdown,
} from '@/lib/proposal/cost-model';

export interface CostVolumeMeta {
  title?: string;
  agency?: string | null;
  /** 'sbir' | 'sttr' | null — drives which work-share floor is shown. */
  program?: string | null;
  companyName?: string | null;
  solicitationNumber?: string | null;
  topicNumber?: string | null;
  /** Solicitation funding ceiling (for the realism check + summary annotation). */
  ceiling?: number | null;
  proposalId?: string;
  solicitationId?: string;
  actorId?: string;
}

export interface CostVolumeInputs {
  labor: LaborLine[];
  rates: IndirectRates;
  odcs?: OtherDirectCost[];
  subs?: Subcontract[];
  periods?: Period[];
  meta?: CostVolumeMeta;
}

// ─── Cell styling (mirrors the retired DoD template's look) ─────────────────────
const HDR: TableCellStyle = { bold: true, bg: '#1F4E79', fg: '#FFFFFF', alignment: 'center' };
const CAT: TableCellStyle = { bold: true, bg: '#e8e8e8' };
const CUR: TableCellStyle = { alignment: 'right' };
const TOTAL: TableCellStyle = { bold: true, bg: '#f0f0f0', alignment: 'right' };
const TOTAL_L: TableCellStyle = { bold: true, bg: '#f0f0f0' };
const GRAND: TableCellStyle = { bold: true, bg: '#1F4E79', fg: '#FFFFFF', alignment: 'right' };
const GRAND_L: TableCellStyle = { bold: true, bg: '#1F4E79', fg: '#FFFFFF' };

function h(text: string): TableCell { return { text, style: HDR }; }
/** Money cell — whole-dollar DISPLAY (gov cost volumes show whole dollars); `value` carries FULL
 * precision so the readiness parse + exports never lose cents on a fractional input. */
function money(x: number, style: TableCellStyle = CUR): TableCell {
  return { text: `$${Math.round(x).toLocaleString('en-US')}`, value: x, number_format: '$#,##0', cell_type: 'currency', style };
}
function pctCell(frac: number, style: TableCellStyle = CUR): TableCell {
  return { text: `${(frac * 100).toFixed(1)}%`, value: frac, number_format: '0.0%', cell_type: 'percent', style };
}
function numCell(v: number, style: TableCellStyle = CUR): TableCell {
  return { text: v.toLocaleString('en-US'), value: v, number_format: '#,##0', cell_type: 'number', style };
}
function txt(text: string, style?: TableCellStyle): TableCell { return style ? { text, style } : { text }; }

let _seq = 0;
function node(type: CanvasNode['type'], content: unknown, style: CanvasNode['style'] = {}): CanvasNode {
  _seq += 1;
  return {
    id: `cost-${_seq}-${type}`,
    type,
    content: content as CanvasNode['content'],
    style,
    provenance: { source: 'template' },
    history: [],
    library_eligible: false,
  };
}

function rules(meta: CostVolumeMeta): CanvasRules {
  const header = meta.topicNumber || meta.solicitationNumber
    ? `Cost Proposal — ${meta.topicNumber || meta.solicitationNumber}`
    : 'Cost Proposal';
  return {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: { template: header, height: 36, font: { family: 'Arial', size: 10 } },
    footer: { template: `${meta.companyName || '{company_name}'} | PROPRIETARY`, height: 36, font: { family: 'Arial', size: 10 } },
    font_default: { family: 'Arial', size: 10 },
    line_spacing: 1.15,
    max_pages: null, max_slides: null,
  };
}

// ─── The generator ──────────────────────────────────────────────────────────────

/**
 * Build a computed cost-volume canvas from typed inputs. Deterministic + pure — safe to
 * run at provision time (server) or on demand. The returned doc's `metadata.status` is
 * `'ai_drafted'` (it is generated content the tenant reviews + edits), not `'empty'`.
 */
export function buildCostVolumeCanvas(input: CostVolumeInputs): CanvasDocument {
  _seq = 0;
  const meta = input.meta ?? {};
  const budget: BudgetResult = computeBudget(input.labor, input.rates, {
    odcs: input.odcs, subs: input.subs, periods: input.periods,
    ceiling: meta.ceiling ?? null, program: meta.program ?? null,
  });
  const g = budget.grand;
  const nodes: CanvasNode[] = [];
  const now = new Date().toISOString();

  // Intro
  const agencyLabel = meta.agency ? ` — ${meta.agency}` : '';
  nodes.push(node('heading', { level: 1, text: `Cost Volume${agencyLabel}` }));
  nodes.push(node('text_block', {
    text: 'This cost volume is computed from the direct-labor, indirect-rate, other-direct-cost, and '
      + 'subcontract inputs below. Every total flows from the standard federal burden waterfall '
      + '(Direct Labor → Fringe → Overhead → Other Direct Costs / Subcontracts → G&A → Fee). '
      + 'Replace the example rows with your actual personnel, hours, rates, and costs — the summary '
      + 'recomputes from what you enter.',
  }, { size: 10, style: 'italic' }));

  // 1. Rate schedule
  nodes.push(node('heading', { level: 2, text: 'Indirect Rate Schedule' }));
  nodes.push(node('table', {
    sheet_name: 'Rates', is_spreadsheet: true,
    headers: [h('Rate Category'), h('Rate'), h('Base'), h('Notes')],
    rows: [
      [txt('Fringe Benefits', CAT), pctCell(input.rates.fringePct), txt('Direct Labor'), txt('Health, FICA, PTO, 401k, workers comp')],
      [txt('Overhead (OH)', CAT), pctCell(input.rates.overheadPct), txt('Direct Labor + Fringe'), txt('Facilities, IT, admin support, insurance')],
      [txt('General & Administrative (G&A)', CAT), pctCell(input.rates.gnaPct),
        txt(input.rates.gnaAppliesToOverhead === false ? 'Total before G&A, excluding overhead' : 'Total costs before G&A'),
        txt('Exec mgmt, accounting, legal, BD')],
      // Machine-readable G&A-base toggle (parseStructuredCostInputs reads "G&A on Overhead"); 1=include
      // overhead in the G&A base (default), 0=value-added base (DSIP "Apply G&A to Overhead? NO").
      [txt('G&A on Overhead', CAT), numCell(input.rates.gnaAppliesToOverhead === false ? 0 : 1),
        txt(input.rates.gnaAppliesToOverhead === false ? 'No — value-added base' : 'Yes — total cost input'),
        txt('Whether overhead is inside the G&A base')],
      [txt('Fee / Profit', CAT), pctCell(input.rates.feePct), txt('Total estimated cost'), txt('Reasonable profit (FAR 15.404)')],
    ],
    column_widths: [180, 70, 160, 200], border_style: 'single',
  }));

  // 2. Direct labor detail
  nodes.push(node('heading', { level: 2, text: 'Direct Labor Detail' }));
  const laborRows: (string | TableCell)[][] = input.labor.map((ln) => {
    const dl = ln.hours * ln.unburdenedRate;
    const fringe = dl * input.rates.fringePct;
    return [
      txt(ln.name), txt(ln.category), money(ln.unburdenedRate), numCell(ln.hours),
      money(dl), pctCell(input.rates.fringePct), money(fringe), money(dl + fringe),
    ];
  });
  const totHours = input.labor.reduce((a, ln) => a + ln.hours, 0);
  laborRows.push([
    txt('TOTAL LABOR', TOTAL_L), txt('', TOTAL), txt('', TOTAL), numCell(totHours, TOTAL),
    money(g.directLabor, TOTAL), txt('', TOTAL), money(g.fringe, TOTAL), money(g.directLabor + g.fringe, TOTAL),
  ]);
  nodes.push(node('table', {
    sheet_name: 'Labor', is_spreadsheet: true,
    headers: [h('Name'), h('Labor Category'), h('Hourly Rate'), h('Hours'), h('Direct Labor $'), h('Fringe %'), h('Fringe $'), h('Total Loaded')],
    rows: laborRows,
    column_widths: [110, 115, 70, 50, 80, 55, 70, 80], border_style: 'single',
  }));

  // 3. Other direct costs
  const odcs = input.odcs ?? [];
  if (odcs.length) {
    nodes.push(node('heading', { level: 2, text: 'Other Direct Costs' }));
    const KIND_LABEL: Record<string, string> = { materials: 'Materials & Supplies', travel: 'Travel', equipment: 'Equipment', odc_other: 'Other Direct Costs' };
    const odcRows: (string | TableCell)[][] = odcs.map((o) => [txt(KIND_LABEL[o.kind] ?? o.kind), txt(o.label), money(o.amount)]);
    odcRows.push([txt('Total Other Direct Costs', TOTAL_L), txt('', TOTAL), money(odcTotal(g), TOTAL)]);
    nodes.push(node('table', {
      sheet_name: 'ODC', is_spreadsheet: true,
      headers: [h('Category'), h('Description'), h('Amount')],
      rows: odcRows, column_widths: [180, 240, 100], border_style: 'single',
    }));
  }

  // 4. Subcontracts / consultants
  const subs = input.subs ?? [];
  if (subs.length) {
    nodes.push(node('heading', { level: 2, text: 'Subcontracts / Consultants' }));
    const subRows: (string | TableCell)[][] = subs.map((s) => [
      txt(s.org), txt(s.role), txt(s.isResearchInstitution ? 'Research Institution' : 'Subcontractor'), money(s.amount),
    ]);
    subRows.push([txt('Total Subcontracts', TOTAL_L), txt('', TOTAL), txt('', TOTAL), money(g.subcontracts, TOTAL)]);
    nodes.push(node('table', {
      sheet_name: 'Subs', is_spreadsheet: true,
      headers: [h('Organization'), h('Role / SOW'), h('Type'), h('Amount')],
      rows: subRows, column_widths: [160, 200, 130, 100], border_style: 'single',
    }));
  }

  // 5. Cost summary — the burden waterfall roll-up (computed)
  nodes.push(node('heading', { level: 2, text: 'Cost Summary' }));
  nodes.push(node('table', {
    sheet_name: 'Summary', is_spreadsheet: true,
    headers: [h('Cost Element'), h('Amount'), h('Basis')],
    rows: summaryRows(g),
    column_widths: [260, 120, 200], border_style: 'single',
  }));
  if (meta.ceiling != null) {
    const over = g.totalPrice - meta.ceiling;
    nodes.push(node('text_block', {
      text: over > 0
        ? `⚠ Total proposed price exceeds the solicitation ceiling of $${Math.round(meta.ceiling).toLocaleString('en-US')} by $${Math.round(over).toLocaleString('en-US')}.`
        : `Total proposed price is within the solicitation ceiling of $${Math.round(meta.ceiling).toLocaleString('en-US')} (headroom $${Math.round(-over).toLocaleString('en-US')}).`,
    }, { size: 10, style: 'italic' }));
  }

  // 6. Work-share compliance (only when the program has a work-share floor)
  const prog = (meta.program ?? '').toLowerCase();
  if (prog === 'sbir' || prog === 'sttr') {
    nodes.push(node('heading', { level: 2, text: 'Work-Share Compliance' }));
    nodes.push(node('table', {
      is_spreadsheet: true,
      headers: [h('Metric'), h('Value'), h('Requirement'), h('Status')],
      rows: worksharRows(budget, prog),
      column_widths: [200, 90, 210, 70], border_style: 'single',
    }));
  }

  const doc: CanvasDocument = {
    version: 1,
    document_id: meta.proposalId ? `cost-${meta.proposalId}` : 'cost-volume',
    canvas: rules(meta),
    metadata: {
      title: meta.title || 'Cost Volume',
      volume_id: '',
      required_item_id: '',
      proposal_id: meta.proposalId ?? '',
      solicitation_id: meta.solicitationId ?? '',
      created_at: now,
      last_modified_at: now,
      last_modified_by: meta.actorId ?? 'system',
      version_number: 1,
      status: 'ai_drafted',
    },
    nodes,
  };
  return doc;
}

function summaryRows(g: PeriodBreakdown): (string | TableCell)[][] {
  return [
    [txt('A. Direct Labor', CAT), money(g.directLabor), txt('Σ hours × unburdened rate')],
    [txt('B. Fringe Benefits', CAT), money(g.fringe), txt('A × fringe rate')],
    [txt('C. Overhead', CAT), money(g.overhead), txt('(A + B) × overhead rate')],
    [txt('D. Other Direct Costs', CAT), money(odcTotal(g)), txt('Materials + travel + equipment + other')],
    [txt('E. Subcontracts / Consultants', CAT), money(g.subcontracts), txt('Pass-through')],
    [txt('Total before G&A (A–E)', TOTAL_L), money(g.totalBeforeGna, TOTAL), txt('', TOTAL)],
    [txt('F. G&A', CAT), money(g.gna), txt('(Total before G&A) × G&A rate')],
    [txt('TOTAL ESTIMATED COST', GRAND_L), money(g.totalEstCost, GRAND), txt('', GRAND)],
    [txt('G. Fee / Profit', CAT), money(g.fee), txt('(Total est. cost) × fee rate')],
    [txt('TOTAL PROPOSED PRICE', GRAND_L), money(g.totalPrice, GRAND), txt('', GRAND)],
  ];
}

function worksharRows(budget: BudgetResult, prog: string): (string | TableCell)[][] {
  const ws = budget.workshare;
  const sbcFloor = prog === 'sttr' ? 0.4 : 0.67;
  const sbcOk = ws.sbcWorkPct >= sbcFloor - 1e-9;
  const rows: (string | TableCell)[][] = [
    [
      txt('SBC Work Share'),
      pctCell(ws.sbcWorkPct),
      txt(prog === 'sttr' ? '≥ 40% (STTR)' : '≥ 67% (SBIR)'),
      txt(sbcOk ? 'PASS' : 'CHECK', { bold: true }),
    ],
  ];
  if (prog === 'sttr') {
    const riOk = ws.researchInstitutionShareOfPrice >= 0.3 - 1e-9;
    rows.push([
      txt('Research Institution Share'),
      pctCell(ws.researchInstitutionShareOfPrice),
      txt('≥ 30% of price (STTR)'),
      txt(riOk ? 'PASS' : 'CHECK', { bold: true }),
    ]);
  }
  rows.push([
    txt('Subcontract Share of Price'),
    pctCell(ws.subcontractShareOfPrice),
    txt('Informational'),
    txt('—'),
  ]);
  return rows;
}

// ─── Provisional starter inputs (agency-neutral) ────────────────────────────────

/**
 * Sensible example inputs for a freshly-provisioned cost volume, so the artifact opens
 * as a worked example the tenant edits (not a blank page). Numbers are illustrative
 * placeholders; the intro note and example labels make that explicit. Program-agnostic —
 * the same starter works for DoW, NSF, or DOE (the caller passes program/agency via meta).
 */
export function provisionalCostInputs(): Pick<CostVolumeInputs, 'labor' | 'rates' | 'odcs' | 'subs'> {
  return {
    labor: [
      { name: '{pi_name}', category: 'Principal Investigator', hours: 500, unburdenedRate: 85 },
      { name: '[Senior Engineer]', category: 'Senior Engineer', hours: 400, unburdenedRate: 75 },
      { name: '[Research Scientist]', category: 'Research Scientist', hours: 300, unburdenedRate: 70 },
    ],
    rates: { fringePct: 0.35, overheadPct: 0.45, gnaPct: 0.15, feePct: 0.07 },
    odcs: [
      { kind: 'materials', label: '[Prototype components / consumables]', amount: 6000 },
      { kind: 'travel', label: '[Kickoff + final review travel]', amount: 2000 },
    ],
    subs: [
      { org: '[University / Lab]', role: '[Specific research task]', amount: 15000, isResearchInstitution: true },
    ],
  };
}

/** Convenience: build a starter cost volume for a proposal in one call. */
export function buildStarterCostVolume(meta: CostVolumeMeta): CanvasDocument {
  return buildCostVolumeCanvas({ ...provisionalCostInputs(), meta });
}

// ─── Structured parse (canvas → typed inputs), for the readiness roll-up ─────────

function loose(s: string): number {
  const v = parseNumericText(s); // shared parser: $, commas, %, K/M/B suffixes, accounting negatives
  return v == null ? NaN : v;
}
function cellNum(cell: string | TableCell | undefined): number {
  if (cell == null) return NaN;
  if (typeof cell === 'string') return loose(cell);
  // Object cells carry a machine `value` (kept in sync with the edited text by the canvas editors);
  // prefer it, falling back to parsing the visible text for string/edited cells.
  if (typeof cell.value === 'number') return cell.value;
  return loose(cell.text ?? '');
}
function cellStr(cell: string | TableCell | undefined): string {
  if (cell == null) return '';
  return typeof cell === 'string' ? cell : cell.text ?? '';
}

/**
 * Recover typed cost inputs from a structured cost-volume canvas (the workbook this module
 * generates). Reads the INPUT sheets (Rates / Labor / ODC / Subs) by their `sheet_name`, so a
 * tenant's edits to hours, rates, or subcontracts drive the recomputed roll-up. Returns null
 * when the canvas is not the structured workbook (no 'Labor' sheet) — the caller then falls
 * back to the free-form reader. Column positions match `buildCostVolumeCanvas` exactly.
 */
export function parseStructuredCostInputs(
  sections: Array<{ content: string | null }>,
): Pick<CostVolumeInputs, 'labor' | 'rates' | 'odcs' | 'subs'> | null {
  const bySheet = new Map<string, TableContent>();
  for (const sec of sections) {
    const doc = coerceJsonb<CanvasDocument | null>(sec.content, null);
    if (!doc) continue;
    for (const n of docNodes(doc)) {
      if (n.type !== 'table') continue;
      const t = n.content as unknown as TableContent;
      if (t?.sheet_name && !bySheet.has(t.sheet_name)) bySheet.set(t.sheet_name, t);
    }
  }
  const laborSheet = bySheet.get('Labor');
  if (!laborSheet) return null; // not the structured workbook

  const rates: IndirectRates = { fringePct: 0, overheadPct: 0, gnaPct: 0, feePct: 0 };
  const ratesSheet = bySheet.get('Rates');
  for (const row of ratesSheet?.rows ?? []) {
    const label = cellStr(row[0]).toLowerCase();
    const v = cellNum(row[1]);
    if (!Number.isFinite(v)) continue;
    if (/g&a on overhead|g&a base/.test(label)) rates.gnaAppliesToOverhead = v !== 0;
    else if (/fringe/.test(label)) rates.fringePct = v;
    else if (/overhead|\boh\b/.test(label)) rates.overheadPct = v;
    else if (/g&a|general/.test(label)) rates.gnaPct = v;
    else if (/fee|profit/.test(label)) rates.feePct = v;
  }

  const labor: LaborLine[] = [];
  for (const row of laborSheet.rows) {
    if (/^total/i.test(cellStr(row[0]).trim())) continue;
    const rate = cellNum(row[2]);
    const hours = cellNum(row[3]);
    if (!Number.isFinite(rate) || !Number.isFinite(hours)) continue;
    labor.push({ name: cellStr(row[0]), category: cellStr(row[1]), hours, unburdenedRate: rate });
  }

  const odcs: OtherDirectCost[] = [];
  for (const row of bySheet.get('ODC')?.rows ?? []) {
    const label = cellStr(row[0]).toLowerCase();
    if (/^total/.test(label.trim())) continue;
    const amount = cellNum(row[2]);
    if (!Number.isFinite(amount)) continue;
    const kind = /material/.test(label) ? 'materials'
      : /travel/.test(label) ? 'travel'
      : /equipment/.test(label) ? 'equipment' : 'odc_other';
    odcs.push({ kind, label: cellStr(row[1]), amount });
  }

  const subs: Subcontract[] = [];
  for (const row of bySheet.get('Subs')?.rows ?? []) {
    if (/^total/i.test(cellStr(row[0]).trim())) continue;
    const amount = cellNum(row[3]);
    if (!Number.isFinite(amount)) continue;
    subs.push({
      org: cellStr(row[0]), role: cellStr(row[1]),
      amount, isResearchInstitution: /research institution/i.test(cellStr(row[2])),
    });
  }

  return { labor, rates, odcs, subs };
}

export { roundCents };
