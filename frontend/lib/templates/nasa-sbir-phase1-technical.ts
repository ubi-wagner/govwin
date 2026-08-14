/**
 * NASA SBIR/STTR Phase I — Technical Proposal Template (EHB, 10 parts)
 *
 * The standard NASA SBIR/STTR Phase I technical proposal (Electronic Handbook):
 * all 10 numbered parts must be present, in order, and titled. 15-page limit;
 * the Proposal Budget Form and the 1-page Briefing Chart are separate uploads.
 * Evaluated on: technical merit/feasibility · qualifications/facilities · work
 * plan · commercial potential · price reasonableness.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real data.
 * Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = { ...CANVAS_PRESETS.letter_standard, max_pages: 15 };
function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer' };
}
const part = (num: string, title: string) => node(`h${num}`, { type: 'heading', content: { level: 2, text: `Part ${num} — ${title}` }, style: { size: 12, weight: 'bold' } });

export const NASA_SBIR_PHASE1_TECHNICAL: CanvasDocument = {
  version: 1, document_id: 'template-nasa-sbir-phase1-technical', canvas: PRESET,
  metadata: { title: 'NASA SBIR/STTR Phase I — Technical', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: '{project_title}' }, style: { alignment: 'center', size: 16, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{company_name} · NASA SBIR/STTR Phase I · Subtopic {subtopic_number} · {solicitation_number} · PI {pi_name}' }, style: { alignment: 'center', size: 10, style: 'italic', space_after: 10 } }),

    part('1', 'Table of Contents'),
    node('p1', { type: 'text_block', content: { text: '[List Parts 1–10 with page numbers.]' }, style: { size: 11 } }),
    part('2', 'Identification and Significance of the Innovation'),
    node('p2', { type: 'text_block', content: { text: '[The innovation and why it matters to a NASA need — the problem, your solution, and its significance. {value_prop} (Suggested ~5 pages.)]' }, style: { size: 11 } }),
    part('3', 'Technical Objectives'),
    node('p3', { type: 'text_block', content: { text: '[The specific, measurable Phase I objectives — what feasibility you will establish. (Suggested ~1 page.)]' }, style: { size: 11 } }),
    part('4', 'Work Plan'),
    node('p4', { type: 'text_block', content: { text: '[Tasks, approach, and schedule to meet the objectives.]' }, style: { size: 11 } }),
    node('p4-table', { type: 'table', content: {
      headers: [
        { text: 'Task #', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Task / Objective', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Approach', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Schedule (mo)', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Deliverable', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['1', '[objective]', '[method]', '[1–2]', '[deliverable]'],
        ['2', '[objective]', '[method]', '[3–5]', '[deliverable]'],
        ['3', '[objective]', '[method]', `[6–{pop_months}]`, 'Final report'],
      ],
      column_widths: [50, 130, 130, 80, 100], border_style: 'single',
    }, style: { size: 10 } }),
    part('5', 'Related R/R&D'),
    node('p5', { type: 'text_block', content: { text: '[Related prior and ongoing research and how this effort differs/builds on it.]' }, style: { size: 11 } }),
    part('6', 'Key Personnel and Bibliography of Directly Related Work'),
    node('p6', { type: 'text_block', content: { text: '[PI {pi_name} and key personnel — roles, qualifications, and a bibliography of directly related work.]' }, style: { size: 11 } }),
    part('7', 'The Market Opportunity'),
    node('p7', { type: 'text_block', content: { text: '[Commercialization: {market_size}. The credible path to a NASA need AND other markets.]' }, style: { size: 11 } }),
    part('8', 'Facilities / Equipment'),
    node('p8', { type: 'text_block', content: { text: '[The facilities and equipment at {company_city}, {company_state} that support the work.]' }, style: { size: 11 } }),
    part('9', 'Subcontractors and Consultants'),
    node('p9', { type: 'text_block', content: { text: '[Subcontractors/consultants (≤30% to subs for SBIR) — {research_institution} if partnering.]' }, style: { size: 11 } }),
    part('10', 'Related, Essentially Equivalent, and Duplicate Proposals and Awards'),
    node('p10', { type: 'text_block', content: { text: '[Disclose any related/equivalent/duplicate proposals or awards — or state "None."]' }, style: { size: 11 } }),
  ],
};
