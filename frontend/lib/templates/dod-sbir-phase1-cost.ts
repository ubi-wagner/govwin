/**
 * DoD SBIR Phase I — Cost Volume Template
 *
 * This is a SPREADSHEET model, not a Word document. The final deliverable
 * may be exported as PDF/Word, but the working artifact is an Excel workbook
 * with formulas for overhead, G&A, fringe, fee, and roll-up totals.
 *
 * Structure: 4 sheets
 *   1. Summary — roll-up of all categories with formulas
 *   2. Labor — rates × hours with fringe calculation
 *   3. ODC — materials, travel, subs, equipment, other
 *   4. Rates — indirect rate assumptions (fringe, OH, G&A, fee)
 *
 * All currency cells use formula references so changing a rate or
 * hours value cascades through the entire budget automatically.
 */

import type { CanvasDocument, CanvasNode, CanvasRules, TableCell } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = {
  format: 'letter',
  width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: 'Cost Proposal — {topic_number}', height: 36, font: { family: 'Arial', size: 10 } },
  footer: { template: '{company_name} | PROPRIETARY', height: 36, font: { family: 'Arial', size: 10 } },
  font_default: { family: 'Arial', size: 10 },
  line_spacing: 1.15,
  max_pages: null,
  max_slides: null,
};

const HDR: TableCell['style'] = { bold: true, bg: '#2c3e7a', alignment: 'center' };
const CAT: TableCell['style'] = { bold: true, bg: '#e8e8e8' };
const CUR: TableCell['style'] = { alignment: 'right' };
const TOTAL: TableCell['style'] = { bold: true, bg: '#f0f0f0', alignment: 'right' };
const TOTAL_L: TableCell['style'] = { bold: true, bg: '#f0f0f0' };
const GRAND: TableCell['style'] = { bold: true, bg: '#2c3e7a', alignment: 'right' };
const GRAND_L: TableCell['style'] = { bold: true, bg: '#2c3e7a' };

function h(text: string): TableCell { return { text, style: HDR }; }
function cur(formula: string, text?: string): TableCell {
  return { text: text ?? '', formula, number_format: '$#,##0', cell_type: 'formula', style: CUR };
}
function pct(formula: string, text?: string): TableCell {
  return { text: text ?? '', formula, number_format: '0.0%', cell_type: 'formula', style: CUR };
}
function num(value: number, fmt?: string): TableCell {
  return { text: String(value), value, number_format: fmt ?? '#,##0', cell_type: 'number', style: CUR };
}

function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return {
    id,
    type: n.type ?? 'text_block',
    content: n.content ?? null,
    style: n.style ?? {},
    provenance: { source: 'template' },
    history: [],
    library_eligible: false,
  };
}

export const DOD_SBIR_PHASE1_COST: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-sbir-p1-cost',
  canvas: PRESET,
  metadata: {
    title: 'DoD SBIR Phase I — Cost Volume',
    volume_id: '',
    required_item_id: '',
    proposal_id: '',
    solicitation_id: '',
    created_at: '2026-01-01T00:00:00Z',
    last_modified_at: '2026-01-01T00:00:00Z',
    last_modified_by: 'system',
    version_number: 1,
    status: 'empty',
  },
  nodes: [
    // ═══════════════════════════════════════════════════════════════
    // Sheet 1: RATES — Indirect rate assumptions
    // ═══════════════════════════════════════════════════════════════
    node('rates-heading', {
      type: 'heading', content: { level: 1, text: 'Indirect Rate Schedule' },
    }),
    node('rates-note', {
      type: 'text_block',
      content: { text: 'Enter your company\'s indirect rates below. These flow into the Labor and Summary sheets automatically. Use DCAA-audited rates if available; otherwise use provisional rates and note the basis.' },
      style: { size: 9, style: 'italic' },
    }),
    node('rates-table', {
      type: 'table',
      content: {
        sheet_name: 'Rates',
        is_spreadsheet: true,
        headers: [
          h('Rate Category'),
          h('Rate (%)'),
          h('Base'),
          h('Status'),
          h('Notes'),
        ],
        rows: [
          [
            { text: 'Fringe Benefits', style: CAT },
            { text: '35.0%', value: 0.35, cell_type: 'percent', number_format: '0.0%', style: CUR },
            { text: 'Direct Labor $', style: CUR },
            { text: 'Provisional' },
            { text: 'Health, FICA, PTO, 401k, workers comp' },
          ],
          [
            { text: 'Overhead (OH)', style: CAT },
            { text: '45.0%', value: 0.45, cell_type: 'percent', number_format: '0.0%', style: CUR },
            { text: 'Direct Labor + Fringe', style: CUR },
            { text: 'Provisional' },
            { text: 'Facilities, IT, admin support, insurance' },
          ],
          [
            { text: 'General & Administrative (G&A)', style: CAT },
            { text: '15.0%', value: 0.15, cell_type: 'percent', number_format: '0.0%', style: CUR },
            { text: 'Total Costs before G&A', style: CUR },
            { text: 'Provisional' },
            { text: 'Exec mgmt, accounting, legal, BD' },
          ],
          [
            { text: 'Fee / Profit', style: CAT },
            { text: '7.0%', value: 0.07, cell_type: 'percent', number_format: '0.0%', style: CUR },
            { text: 'Total Est. Cost', style: CUR },
            { text: '' },
            { text: 'Reasonable profit per FAR 15.404' },
          ],
        ],
        column_widths: [160, 80, 140, 90, 200],
        border_style: 'single',
      },
    }),

    node('rates-break', { type: 'page_break', content: null }),

    // ═══════════════════════════════════════════════════════════════
    // Sheet 2: LABOR — Hours × rates with fringe roll-up
    // ═══════════════════════════════════════════════════════════════
    node('labor-heading', {
      type: 'heading', content: { level: 1, text: 'Direct Labor Detail' },
    }),
    node('labor-table', {
      type: 'table',
      content: {
        sheet_name: 'Labor',
        is_spreadsheet: true,
        headers: [
          h('Name'),
          h('Labor Category'),
          h('Hourly Rate'),
          h('Hours'),
          h('Direct Labor $'),
          h('Fringe (%)'),
          h('Fringe $'),
          h('Total Loaded'),
        ],
        rows: [
          // Row references: C=rate, D=hours, E=C*D, F=fringe%, G=E*F, H=E+G
          [
            { text: '{pi_name}' },
            { text: 'Principal Investigator' },
            num(85, '$#,##0'),
            num(500),
            cur('=C2*D2', '$42,500'),
            pct('=Rates!B2', '35.0%'),
            cur('=E2*F2', '$14,875'),
            cur('=E2+G2', '$57,375'),
          ],
          [
            { text: '[Engineer Name]' },
            { text: 'Senior Engineer' },
            num(75, '$#,##0'),
            num(400),
            cur('=C3*D3', '$30,000'),
            pct('=Rates!B2', '35.0%'),
            cur('=E3*F3', '$10,500'),
            cur('=E3+G3', '$40,500'),
          ],
          [
            { text: '[Scientist Name]' },
            { text: 'Research Scientist' },
            num(70, '$#,##0'),
            num(300),
            cur('=C4*D4', '$21,000'),
            pct('=Rates!B2', '35.0%'),
            cur('=E4*F4', '$7,350'),
            cur('=E4+G4', '$28,350'),
          ],
          [
            { text: '[Tech Name]' },
            { text: 'Technician' },
            num(45, '$#,##0'),
            num(200),
            cur('=C5*D5', '$9,000'),
            pct('=Rates!B2', '35.0%'),
            cur('=E5*F5', '$3,150'),
            cur('=E5+G5', '$12,150'),
          ],
          // Totals row
          [
            { text: 'TOTAL LABOR', style: TOTAL_L },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL, formula: '=SUM(D2:D5)', number_format: '#,##0', cell_type: 'formula' },
            { text: '$102,500', style: TOTAL, formula: '=SUM(E2:E5)', number_format: '$#,##0', cell_type: 'formula' },
            { text: '', style: TOTAL },
            { text: '$35,875', style: TOTAL, formula: '=SUM(G2:G5)', number_format: '$#,##0', cell_type: 'formula' },
            { text: '$138,375', style: TOTAL, formula: '=SUM(H2:H5)', number_format: '$#,##0', cell_type: 'formula' },
          ],
        ],
        column_widths: [120, 120, 75, 55, 85, 65, 75, 85],
        border_style: 'single',
      },
    }),
    node('labor-note', {
      type: 'text_block',
      content: { text: 'Rates are actual hourly rates consistent with company accounting practices. Fringe rate pulled from Rates sheet. PI commitment: 50%+ of total hours (SBIR requirement for PI as primary researcher).' },
      style: { size: 9, style: 'italic' },
    }),

    node('labor-break', { type: 'page_break', content: null }),

    // ═══════════════════════════════════════════════════════════════
    // Sheet 3: ODC — Materials, travel, subs, equipment, other
    // ═══════════════════════════════════════════════════════════════
    node('odc-heading', {
      type: 'heading', content: { level: 1, text: 'Other Direct Costs' },
    }),

    // Materials
    node('mat-subhead', {
      type: 'heading', content: { level: 2, text: 'Materials & Supplies' },
    }),
    node('mat-table', {
      type: 'table',
      content: {
        sheet_name: 'ODC',
        is_spreadsheet: true,
        headers: [ h('Item'), h('Qty'), h('Unit Cost'), h('Total') ],
        rows: [
          ['[Prototype components]', num(1), num(2500, '$#,##0'), cur('=B2*C2', '$2,500')],
          ['[Test fixtures / consumables]', num(1), num(1500, '$#,##0'), cur('=B3*C3', '$1,500')],
          ['[Software license (annual)]', num(1), num(2000, '$#,##0'), cur('=B4*C4', '$2,000')],
          [
            { text: 'Total Materials', style: TOTAL_L },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '$6,000', style: TOTAL, formula: '=SUM(D2:D4)', number_format: '$#,##0', cell_type: 'formula' },
          ],
        ],
        column_widths: [250, 60, 90, 100],
        border_style: 'single',
      },
    }),

    // Travel
    node('travel-subhead', {
      type: 'heading', content: { level: 2, text: 'Travel' },
    }),
    node('travel-table', {
      type: 'table',
      content: {
        is_spreadsheet: true,
        headers: [ h('Trip Purpose'), h('Destination'), h('Travelers'), h('Days'), h('Per Diem'), h('Airfare'), h('Total') ],
        rows: [
          [
            'Kickoff / IPR',
            '[Sponsor location]',
            num(1),
            num(2),
            num(200, '$#,##0'),
            num(600, '$#,##0'),
            cur('=C2*D2*E2+F2', '$1,000'),
          ],
          [
            'Final review',
            '[Sponsor location]',
            num(1),
            num(2),
            num(200, '$#,##0'),
            num(600, '$#,##0'),
            cur('=C3*D3*E3+F3', '$1,000'),
          ],
          [
            { text: 'Total Travel', style: TOTAL_L },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '$2,000', style: TOTAL, formula: '=SUM(G2:G3)', number_format: '$#,##0', cell_type: 'formula' },
          ],
        ],
        column_widths: [120, 120, 55, 45, 65, 65, 80],
        border_style: 'single',
      },
    }),
    node('travel-note', {
      type: 'text_block',
      content: { text: 'Per diem and lodging per GSA rates for destination city. Airfare at coach/economy rate.' },
      style: { size: 9, style: 'italic' },
    }),

    // Subcontracts
    node('sub-subhead', {
      type: 'heading', content: { level: 2, text: 'Subcontracts / Consultants' },
    }),
    node('sub-table', {
      type: 'table',
      content: {
        is_spreadsheet: true,
        headers: [ h('Organization'), h('Role / SOW'), h('Hours'), h('Rate'), h('Total') ],
        rows: [
          [
            '[University / Lab]',
            '[Specific research task]',
            num(100),
            num(150, '$#,##0'),
            cur('=C2*D2', '$15,000'),
          ],
          [
            '[Consultant name]',
            '[Subject matter advisory]',
            num(40),
            num(200, '$#,##0'),
            cur('=C3*D3', '$8,000'),
          ],
          [
            { text: 'Total Subcontracts', style: TOTAL_L },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '', style: TOTAL },
            { text: '$23,000', style: TOTAL, formula: '=SUM(E2:E3)', number_format: '$#,##0', cell_type: 'formula' },
          ],
        ],
        column_widths: [140, 170, 60, 70, 90],
        border_style: 'single',
      },
    }),
    node('sub-note', {
      type: 'text_block',
      content: { text: 'SBIR: small business must perform ≥67% of work. STTR: SBC ≥40%, research institution ≥30%. Subcontract work share reflected in Summary sheet.' },
      style: { size: 9, style: 'italic' },
    }),

    node('odc-break', { type: 'page_break', content: null }),

    // ═══════════════════════════════════════════════════════════════
    // Sheet 4: SUMMARY — Full roll-up with indirect formulas
    // ═══════════════════════════════════════════════════════════════
    node('summary-heading', {
      type: 'heading', content: { level: 1, text: 'Cost Summary' },
    }),
    node('summary-meta', {
      type: 'table',
      content: {
        is_spreadsheet: false,
        headers: [
          { text: '', style: { bg: '#f0f0f0' } },
          { text: '', style: { bg: '#f0f0f0' } },
        ],
        rows: [
          ['Solicitation', '{solicitation_number}'],
          ['Topic', '{topic_number}'],
          ['Company', '{company_name}'],
          ['PoP', '{pop_months} months'],
        ],
        column_widths: [150, 350],
        border_style: 'single',
      },
    }),

    node('summary-table', {
      type: 'table',
      content: {
        sheet_name: 'Summary',
        is_spreadsheet: true,
        headers: [
          h('Cost Element'),
          h('Amount'),
          h('Notes'),
        ],
        rows: [
          // Direct costs
          [
            { text: 'A. Direct Labor', style: CAT },
            cur('=Labor!E6', '$102,500'),
            { text: '=SUM of labor rates × hours' },
          ],
          [
            { text: 'B. Fringe Benefits', style: CAT },
            cur('=Labor!G6', '$35,875'),
            { text: '=Direct Labor × Fringe Rate (Rates!B2)' },
          ],
          [
            { text: 'C. Overhead', style: CAT },
            cur('=(Summary!B2+Summary!B3)*Rates!B3', '$62,269'),
            { text: '=(A+B) × OH Rate (Rates!B3)' },
          ],
          [
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
          ],
          [
            { text: 'D. Materials & Supplies', style: CAT },
            cur('=ODC!D5', '$6,000'),
            { text: '=Materials subtotal' },
          ],
          [
            { text: 'E. Travel', style: CAT },
            cur('=ODC!G4_travel', '$2,000'),
            { text: '=Travel subtotal' },
          ],
          [
            { text: 'F. Subcontracts / Consultants', style: CAT },
            cur('=ODC!E4_sub', '$23,000'),
            { text: '=Subcontracts subtotal' },
          ],
          [
            { text: 'G. Other Direct Costs', style: CAT },
            num(0, '$#,##0'),
            { text: '[Equipment, testing services, etc.]' },
          ],
          [
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
          ],
          // Subtotals
          [
            { text: 'Total Direct Costs (A+B+D+E+F+G)', style: TOTAL_L },
            { text: '$169,375', style: TOTAL, formula: '=B2+B3+B6+B7+B8+B9', number_format: '$#,##0', cell_type: 'formula' },
            { text: '', style: TOTAL },
          ],
          [
            { text: 'Total Direct + Overhead (A+B+C+D+E+F+G)', style: TOTAL_L },
            { text: '$231,644', style: TOTAL, formula: '=B11+B4', number_format: '$#,##0', cell_type: 'formula' },
            { text: '', style: TOTAL },
          ],
          [
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
          ],
          // G&A and fee
          [
            { text: 'H. G&A', style: CAT },
            cur('=Summary!B12*Rates!B4', '$34,747'),
            { text: '=Total (A-G+C) × G&A Rate (Rates!B4)' },
          ],
          [
            { text: 'TOTAL ESTIMATED COST', style: GRAND_L },
            { text: '$266,391', style: GRAND, formula: '=B12+B14', number_format: '$#,##0', cell_type: 'formula' },
            { text: '', style: GRAND },
          ],
          [
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
            { text: '', style: { bg: '#f0f0f0' } },
          ],
          [
            { text: 'I. Fee / Profit', style: CAT },
            cur('=Summary!B15*Rates!B5', '$18,647'),
            { text: '=Total Est. Cost × Fee Rate (Rates!B5)' },
          ],
          [
            { text: 'TOTAL PROPOSED PRICE', style: GRAND_L },
            { text: '$285,038', style: GRAND, formula: '=B15+B17', number_format: '$#,##0', cell_type: 'formula' },
            { text: '', style: GRAND },
          ],
        ],
        column_widths: [240, 110, 200],
        border_style: 'single',
      },
    }),

    // Work share compliance check
    node('workshare-heading', {
      type: 'heading', content: { level: 2, text: 'Work Share Compliance' },
    }),
    node('workshare-table', {
      type: 'table',
      content: {
        is_spreadsheet: true,
        headers: [ h('Metric'), h('Value'), h('Requirement'), h('Status') ],
        rows: [
          [
            'SBC Work %',
            pct('=(Summary!B2+Summary!B3)/(Summary!B2+Summary!B3+Summary!B8)', '85%'),
            { text: '≥ 67% (SBIR) / ≥ 40% (STTR)' },
            { text: 'PASS', style: { bold: true } },
          ],
          [
            'PI Hours as % of Total',
            pct('=Labor!D2/Labor!D6', '36%'),
            { text: 'PI should be primary researcher' },
            { text: 'CHECK' },
          ],
          [
            'Sub % of Total Cost',
            pct('=Summary!B8/Summary!B15', '9%'),
            { text: '< 33% (SBIR) / flexible (STTR)' },
            { text: 'PASS', style: { bold: true } },
          ],
        ],
        column_widths: [160, 80, 200, 70],
        border_style: 'single',
      },
    }),
    node('workshare-note', {
      type: 'text_block',
      content: { text: 'Work share percentages are auto-calculated from the labor and subcontract sheets. SBIR Phase I requires the SBC to perform at least 2/3 of the research effort. Adjust sub hours if work share drops below threshold.' },
      style: { size: 9, style: 'italic' },
    }),
  ],
};
