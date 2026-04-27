/**
 * DoD SBIR Phase I — Cost Volume Template
 *
 * Standard cost proposal format accepted by most DoD agencies.
 * Covers labor, materials, travel, subcontracts, ODCs, indirects, and fee.
 * Budget typically $50K-$275K for 6-12 month PoP.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';

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
    node('cost-title', {
      type: 'heading',
      content: { level: 1, text: 'Cost Proposal — {topic_number}' },
    }),
    node('cost-meta', {
      type: 'table',
      content: {
        headers: [
          { text: 'Field', style: { bold: true, bg: '#f0f0f0' } },
          { text: 'Value', style: { bg: '#f0f0f0' } },
        ],
        rows: [
          ['Company', '{company_name}'],
          ['Topic Number', '{topic_number}'],
          ['Period of Performance', '{pop_months} months'],
          ['Total Proposed Cost', '${proposed_cost}'],
          ['Fee / Profit', '[X%]'],
        ],
        column_widths: [200, 340],
        border_style: 'single',
      },
    }),

    // ─── Labor ──────────────────────────────────────────────────
    node('labor-heading', {
      type: 'heading', content: { level: 1, text: '1. Direct Labor', numbering: '1' },
    }),
    node('labor-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Name / Position', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Labor Category', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Hours', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Rate ($/hr)', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Total', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
        ],
        rows: [
          ['{pi_name}', 'Principal Investigator', '[hrs]', '[$XXX]', '[$XX,XXX]'],
          ['[Name]', 'Senior Engineer', '[hrs]', '[$XXX]', '[$XX,XXX]'],
          ['[Name]', 'Research Scientist', '[hrs]', '[$XXX]', '[$XX,XXX]'],
          ['[Name]', 'Technician', '[hrs]', '[$XX]', '[$X,XXX]'],
          [{ text: 'Total Direct Labor', style: { bold: true } }, '', '', '', { text: '[$XX,XXX]', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [130, 120, 60, 80, 80],
        border_style: 'single',
      },
    }),
    node('labor-note', {
      type: 'text_block',
      content: { text: '[Provide basis for labor rates. If using actual rates, state so. If using composite rates, explain the methodology. Rates should be consistent with company\'s established accounting practices.]' },
      style: { size: 9, style: 'italic' },
    }),

    // ─── Materials ──────────────────────────────────────────────
    node('materials-heading', {
      type: 'heading', content: { level: 1, text: '2. Materials & Supplies', numbering: '2' },
    }),
    node('materials-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Item', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Quantity', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Unit Cost', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Total', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
        ],
        rows: [
          ['[Material/supply item]', '[qty]', '[$XXX]', '[$X,XXX]'],
          ['[Software license]', '[1]', '[$X,XXX]', '[$X,XXX]'],
          [{ text: 'Total Materials', style: { bold: true } }, '', '', { text: '[$X,XXX]', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [250, 70, 80, 80],
        border_style: 'single',
      },
    }),

    // ─── Travel ─────────────────────────────────────────────────
    node('travel-heading', {
      type: 'heading', content: { level: 1, text: '3. Travel', numbering: '3' },
    }),
    node('travel-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Trip Purpose', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Destination', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Travelers', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Days', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Total', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
        ],
        rows: [
          ['[Kickoff / IPR meeting]', '[Location]', '[1]', '[2]', '[$X,XXX]'],
          ['[Final review]', '[Location]', '[1]', '[2]', '[$X,XXX]'],
          [{ text: 'Total Travel', style: { bold: true } }, '', '', '', { text: '[$X,XXX]', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [160, 110, 60, 50, 80],
        border_style: 'single',
      },
    }),
    node('travel-note', {
      type: 'text_block',
      content: { text: '[Airfare, per diem, and lodging based on GSA/JTR rates for the destination city. Ground transportation estimated at $XX/day.]' },
      style: { size: 9, style: 'italic' },
    }),

    // ─── Subcontracts ───────────────────────────────────────────
    node('sub-heading', {
      type: 'heading', content: { level: 1, text: '4. Subcontracts / Consultants', numbering: '4' },
    }),
    node('sub-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Organization / Consultant', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Role', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Basis', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Total', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
        ],
        rows: [
          ['[University / lab name]', '[Specific task]', '[XX hrs @ $XXX/hr]', '[$XX,XXX]'],
          ['[Consultant name]', '[Advisory role]', '[XX hrs @ $XXX/hr]', '[$X,XXX]'],
          [{ text: 'Total Subcontracts', style: { bold: true } }, '', '', { text: '[$XX,XXX]', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [160, 140, 120, 80],
        border_style: 'single',
      },
    }),
    node('sub-note', {
      type: 'text_block',
      content: { text: '[Note: For SBIR, the small business must perform a minimum of 2/3 (67%) of the research. For STTR, the small business must perform at least 40% and the research institution at least 30%.]' },
      style: { size: 9, style: 'italic' },
    }),

    // ─── ODC ────────────────────────────────────────────────────
    node('odc-heading', {
      type: 'heading', content: { level: 1, text: '5. Other Direct Costs', numbering: '5' },
    }),
    node('odc-text', {
      type: 'text_block',
      content: { text: '[List any other direct costs not covered above: equipment rental, testing services, publication costs, etc. Provide basis for each cost estimate.]' },
    }),

    // ─── Indirects ──────────────────────────────────────────────
    node('indirect-heading', {
      type: 'heading', content: { level: 1, text: '6. Indirect Costs', numbering: '6' },
    }),
    node('indirect-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Rate Type', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Rate', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Base', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
          { text: 'Total', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
        ],
        rows: [
          ['Fringe Benefits', '[XX%]', '[$XX,XXX]', '[$XX,XXX]'],
          ['Overhead / G&A', '[XX%]', '[$XX,XXX]', '[$XX,XXX]'],
          [{ text: 'Total Indirect', style: { bold: true } }, '', '', { text: '[$XX,XXX]', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [160, 80, 120, 120],
        border_style: 'single',
      },
    }),
    node('indirect-note', {
      type: 'text_block',
      content: { text: '[State whether rates are audited/approved by DCAA, provisional, or company-established. If no DCAA audit, provide basis for rates.]' },
      style: { size: 9, style: 'italic' },
    }),

    // ─── Fee ────────────────────────────────────────────────────
    node('fee-heading', {
      type: 'heading', content: { level: 1, text: '7. Fee / Profit', numbering: '7' },
    }),
    node('fee-text', {
      type: 'text_block',
      content: { text: '[Fee is calculated at X% on total estimated cost (excluding fee). SBIR contracts typically allow reasonable profit/fee. State the fee percentage and total.]' },
    }),

    // ─── Summary ────────────────────────────────────────────────
    node('summary-heading', {
      type: 'heading', content: { level: 1, text: '8. Cost Summary', numbering: '8' },
    }),
    node('summary-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Category', style: { bold: true, bg: '#2c3e7a' } },
          { text: 'Amount', style: { bold: true, bg: '#2c3e7a', alignment: 'right' } },
        ],
        rows: [
          ['1. Direct Labor', '[$XX,XXX]'],
          ['2. Materials & Supplies', '[$X,XXX]'],
          ['3. Travel', '[$X,XXX]'],
          ['4. Subcontracts / Consultants', '[$XX,XXX]'],
          ['5. Other Direct Costs', '[$X,XXX]'],
          [{ text: 'Total Direct Costs', style: { bold: true } }, { text: '[$XXX,XXX]', style: { bold: true, alignment: 'right' } }],
          ['6. Indirect Costs (Fringe + OH/G&A)', '[$XX,XXX]'],
          [{ text: 'Total Estimated Cost', style: { bold: true } }, { text: '[$XXX,XXX]', style: { bold: true, alignment: 'right' } }],
          ['7. Fee / Profit (X%)', '[$X,XXX]'],
          [{ text: 'TOTAL PROPOSED PRICE', style: { bold: true } }, { text: '[$XXX,XXX]', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [340, 140],
        border_style: 'single',
      },
    }),
  ],
};
