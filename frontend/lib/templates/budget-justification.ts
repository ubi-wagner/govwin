/**
 * Budget Justification Template — SF424 R&R (A–K) narrative
 *
 * One narrative that justifies every budget category for all periods, in the R&R
 * Budget Form's A–K order, with the personnel-effort and equipment tables. Key
 * compliance rules embedded: Equipment = >$5,000 & useful life >1yr; Fee (J) is
 * SBIR/STTR-only up to 7% of total costs; work-split rules must be evident in the
 * effort/subaward numbers.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real data.
 * Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = CANVAS_PRESETS.letter_standard;
function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer' };
}

export const BUDGET_JUSTIFICATION: CanvasDocument = {
  version: 1, document_id: 'template-budget-justification', canvas: PRESET,
  metadata: { title: 'Budget Justification', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Budget Justification' }, style: { size: 16, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{project_title} · {company_name} · Total requested: {proposed_cost} over {pop_months} months' }, style: { size: 10, style: 'italic', space_after: 8 } }),

    node('hA', { type: 'heading', content: { level: 2, text: 'A. Senior / Key Personnel' }, style: { size: 12, weight: 'bold' } }),
    node('effort', { type: 'table', content: {
      headers: [
        { text: 'Name / Role', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Base Salary', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Person-Mo', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Requested', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['{pi_name} — PI', '[$]', '[#]', '[$]'],
        ['[Name] — [role]', '[$]', '[#]', '[$]'],
      ],
      column_widths: [200, 110, 90, 100], border_style: 'single',
    }, style: { size: 10 } }),
    node('sA', { type: 'text_block', content: { text: '[Justify each person\'s role/contribution and effort.]' }, style: { size: 11 } }),

    node('hB', { type: 'heading', content: { level: 2, text: 'B. Other Personnel · Fringe Benefits' }, style: { size: 12, weight: 'bold' } }),
    node('sB', { type: 'text_block', content: { text: '[Other personnel by role (#persons, person-months). Fringe computed on salaries — state the rate and base.]' }, style: { size: 11 } }),

    node('hC', { type: 'heading', content: { level: 2, text: 'C. Equipment (>$5,000/unit, useful life >1yr)' }, style: { size: 12, weight: 'bold' } }),
    node('equip', { type: 'table', content: {
      headers: [
        { text: 'Item', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Unit Cost', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Qty', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Justification', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [['[Item]', '[$]', '[#]', '[why needed]']],
      column_widths: [140, 90, 60, 210], border_style: 'single',
    }, style: { size: 10 } }),

    node('hD', { type: 'heading', content: { level: 2, text: 'D. Travel (domestic & foreign, listed separately)' }, style: { size: 12, weight: 'bold' } }),
    node('sD', { type: 'text_block', content: { text: '[Purpose, #trips/#travelers, destinations, and any conference tie-in.]' }, style: { size: 11 } }),

    node('hF', { type: 'heading', content: { level: 2, text: 'F. Other Direct Costs' }, style: { size: 12, weight: 'bold' } }),
    node('sF', { type: 'bulleted_list', content: { items: [
      { text: 'Materials & Supplies — [itemize categories, especially >$1,000].' },
      { text: 'Consultant Services — [name, rate, #days].' },
      { text: 'Subawards / Consortium — {research_institution}: [total; separate subaward budget + its own justification].' },
    ] }, style: { size: 11 } }),

    node('hH', { type: 'heading', content: { level: 2, text: 'G–K. Totals, Indirect (F&A), Fee' }, style: { size: 12, weight: 'bold' } }),
    node('sH', { type: 'text_block', content: { text: 'G. Total Direct Costs: [$]. H. Indirect (F&A): [rate & base — SBIR/STTR default 40% if unnegotiated]. I. Total Direct + Indirect: [$]. J. Fee (SBIR/STTR only, up to 7% of total costs): [$]. K. Total Costs and Fee: {proposed_cost}. Work-split: [SBIR ≥2/3 (Phase I) / STTR ≥40% small business + ≥30% {research_institution}] is evident in the effort and subaward numbers above.' }, style: { size: 11 } }),
  ],
};
