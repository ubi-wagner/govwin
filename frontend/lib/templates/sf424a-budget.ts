/**
 * SF-424A — Budget Information (Non-Construction Programs) Template
 *
 * The OMB 4040-0006 grant budget form as a fillable workbook: Section A (Budget
 * Summary), Section B (the load-bearing object-class block a–k), Section D
 * (Forecasted Cash Needs), Section E (Future Funding), and Section F (Other).
 * Compliance cross-checks are noted: B.i = a+h, B.k = i+j; Section D line 13 must
 * reconcile to the Federal totals. Blank cells — the tenant enters the numbers.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real budget figures.
 * Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 54, right: 54, bottom: 54, left: 54 },
  header: { template: 'SF-424A — {project_title}', height: 30, font: { family: 'Arial', size: 9 } },
  footer: { template: '{company_name} · OMB 4040-0006', height: 30, font: { family: 'Arial', size: 9 } },
  font_default: { family: 'Arial', size: 10 }, line_spacing: 1.1, max_pages: null, max_slides: null,
};
function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer' };
}
const hc = (text: string) => ({ text, style: { bold: true, bg: '#2c3e7a', fg: '#ffffff' } });

export const SF424A_BUDGET: CanvasDocument = {
  version: 1, document_id: 'template-sf424a-budget', canvas: PRESET,
  metadata: { title: 'SF-424A Budget', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'SF-424A — Budget Information (Non-Construction)' }, style: { size: 15, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{project_title} · {company_name} · {solicitation_number}' }, style: { size: 10, style: 'italic', space_after: 6 } }),

    node('hA', { type: 'heading', content: { level: 2, text: 'Section A — Budget Summary' }, style: { size: 12, weight: 'bold' } }),
    node('secA', { type: 'table', content: {
      headers: [hc('Grant Program / Function'), hc('Assistance Listing #'), hc('Federal (e)'), hc('Non-Federal (f)'), hc('Total (g)')],
      rows: [
        ['{project_title}', '[##.###]', '[$]', '[$]', '[$]'],
        ['[Program 2]', '[##.###]', '[$]', '[$]', '[$]'],
        ['5. TOTALS', '', '[$]', '[$]', '{proposed_cost}'],
      ],
      column_widths: [160, 100, 80, 80, 84], border_style: 'single',
    }, style: { size: 9 } }),

    node('hB', { type: 'heading', content: { level: 2, text: 'Section B — Budget Categories (Object Classes)' }, style: { size: 12, weight: 'bold' } }),
    node('secB', { type: 'table', content: {
      headers: [hc('6. Object Class Category'), hc('(1)'), hc('(2)'), hc('(3)'), hc('(5) Total')],
      rows: [
        ['a. Personnel', '[$]', '[$]', '[$]', '[$]'],
        ['b. Fringe Benefits', '[$]', '[$]', '[$]', '[$]'],
        ['c. Travel', '[$]', '[$]', '[$]', '[$]'],
        ['d. Equipment', '[$]', '[$]', '[$]', '[$]'],
        ['e. Supplies', '[$]', '[$]', '[$]', '[$]'],
        ['f. Contractual', '[$]', '[$]', '[$]', '[$]'],
        ['g. Construction', '[$]', '[$]', '[$]', '[$]'],
        ['h. Other', '[$]', '[$]', '[$]', '[$]'],
        ['i. Total Direct (a–h)', '[$]', '[$]', '[$]', '[$]'],
        ['j. Indirect Charges', '[$]', '[$]', '[$]', '[$]'],
        ['k. TOTALS (i + j)', '[$]', '[$]', '[$]', '{proposed_cost}'],
        ['7. Program Income', '[$]', '[$]', '[$]', '[$]'],
      ],
      column_widths: [180, 78, 78, 78, 90], border_style: 'single',
    }, style: { size: 9 } }),
    node('checkB', { type: 'text_block', content: { text: 'Cross-checks: i = a+h; k = i+j; Section A col (g) = Federal + Non-Federal.' }, style: { size: 8, style: 'italic', space_before: 4 } }),

    node('hD', { type: 'heading', content: { level: 2, text: 'Section D — Forecasted Cash Needs' }, style: { size: 12, weight: 'bold' } }),
    node('secD', { type: 'table', content: {
      headers: [hc(''), hc('Total 1st Yr'), hc('1st Qtr'), hc('2nd Qtr'), hc('3rd Qtr'), hc('4th Qtr')],
      rows: [
        ['13. Federal', '[$]', '[$]', '[$]', '[$]', '[$]'],
        ['14. Non-Federal', '[$]', '[$]', '[$]', '[$]', '[$]'],
        ['15. TOTAL', '[$]', '[$]', '[$]', '[$]', '[$]'],
      ],
      column_widths: [110, 90, 62, 62, 62, 62], border_style: 'single',
    }, style: { size: 9 } }),

    node('hF', { type: 'heading', content: { level: 2, text: 'Section F — Other Budget Information' }, style: { size: 12, weight: 'bold' } }),
    node('secF', { type: 'text_block', content: { text: '21. Direct Charges: [basis]. 22. Indirect Charges: [negotiated rate & base — must tie to a rate agreement]. 23. Remarks: [any explanation].' }, style: { size: 10 } }),
  ],
};
