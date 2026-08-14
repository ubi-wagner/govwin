/**
 * OTA Solution Brief Template — DIU CSO model (also NSTXL/SOSSEC shape)
 *
 * Phase 1 of a defense Other-Transaction Commercial Solutions Opening: a ≤5-page
 * (or ≤15-slide) brief. Title Page (excluded from the count; must name the Area of
 * Interest) + Executive Summary + Technology Concept (pilot/demo of existing vs.
 * develop/adapt) + Company Viability. The Pitch (ROM price + schedule + data
 * rights) and Full Proposal follow separately.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real data.
 * Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = { ...CANVAS_PRESETS.letter_standard, max_pages: 5 };
function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer' };
}

export const OTA_SOLUTION_BRIEF: CanvasDocument = {
  version: 1, document_id: 'template-ota-solution-brief', canvas: PRESET,
  metadata: { title: 'OTA Solution Brief', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: '{project_title}' }, style: { alignment: 'center', size: 16, weight: 'bold' } }),
    node('titlepage', { type: 'text_block', content: { text: '{company_name} · {company_city}, {company_state} · [date]\nPOC: {poc_name}, {poc_title} · {contact_email} · {poc_phone}\nArea of Interest: [name the exact AOI this brief answers]\nSolicitation: {solicitation_number}' }, style: { alignment: 'center', size: 11, space_after: 10 } }),

    node('h1', { type: 'heading', content: { level: 2, text: 'Executive Summary' }, style: { size: 12, weight: 'bold' } }),
    node('s1', { type: 'text_block', content: { text: '[One-paragraph summary of the technology and the operational value. {value_prop}]' }, style: { size: 11 } }),

    node('h2', { type: 'heading', content: { level: 2, text: 'Technology Concept' }, style: { size: 12, weight: 'bold' } }),
    node('s2', { type: 'bulleted_list', content: { items: [
      { text: 'Unique aspects vs. the AOI: [what makes this solution fit the need].' },
      { text: 'Maturity: [state whether this is a pilot/demo of EXISTING commercial technology, or DEVELOPMENT/ADAPTATION — if development, give the maturation path]. Current TRL [X].' },
      { text: 'Proprietary aspects / data rights: [identify IP and any restrictions on Government use].' },
    ] }, style: { size: 11 } }),

    node('h3', { type: 'heading', content: { level: 2, text: 'Company Viability' }, style: { size: 12, weight: 'bold' } }),
    node('s3', { type: 'text_block', content: { text: '{company_name} is [company overview]. Funding to date / top-line revenue: [state {raise_amount} raised, or revenue]. Commercialization / go-to-market: [how this scales beyond the prototype].' }, style: { size: 11 } }),

    node('h4', { type: 'heading', content: { level: 2, text: 'ROM Price & Schedule (Pitch stage)' }, style: { size: 12, weight: 'bold' } }),
    node('rom', { type: 'table', content: {
      headers: [
        { text: 'Milestone / Task', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Deliverable', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Payment', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Date', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [['[Prototype milestone 1]', '[deliverable]', '[$]', '[Mo]'], ['[Prototype milestone 2]', '[deliverable]', '[$]', 'Mo {pop_months}']],
      column_widths: [170, 150, 80, 70], border_style: 'single',
    }, style: { size: 10 } }),
    node('note', { type: 'text_block', content: { text: 'Cost-share: a 1/3 non-Federal cost share is required if no nontraditional defense contractor participates to a significant extent. Prototype PoP generally ≤24 months; unclassified. SAM registration + UEI {uei} required before award.' }, style: { size: 10, style: 'italic', space_before: 6 } }),
  ],
};
