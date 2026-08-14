/**
 * BAA White Paper Template — AFRL "BAA Guide for Industry" A–D format
 *
 * The pre-proposal / Step-1 white paper of a two-step Broad Agency Announcement.
 * Section A cover (compliance header, usually excluded from the count) + Section B
 * (Period of Performance & Task Objectives) + Section C (Technical Summary &
 * Deliverables) + Section D (Rough Order of Magnitude cost). 12-pt minimum; the
 * ROM cost table recurs in OTA pitches too.
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

export const BAA_WHITE_PAPER: CanvasDocument = {
  version: 1, document_id: 'template-baa-white-paper', canvas: PRESET,
  metadata: { title: 'BAA White Paper', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: '{project_title}' }, style: { alignment: 'center', size: 16, weight: 'bold' } }),
    node('subtitle', { type: 'text_block', content: { text: 'White Paper in response to {solicitation_number}' }, style: { alignment: 'center', size: 11, style: 'italic', space_after: 10 } }),

    node('hA', { type: 'heading', content: { level: 2, text: 'Section A — Cover / Administrative' }, style: { size: 12, weight: 'bold' } }),
    node('sA', { type: 'bulleted_list', content: { items: [
      { text: 'BAA / announcement number: {solicitation_number} · Program / topic: {topic_area}' },
      { text: 'Offeror: {company_name} — [business size / socioeconomic status: {set_asides}]' },
      { text: 'CAGE {cage_code} · UEI {uei}' },
      { text: 'Technical POC: {pi_name} · {pi_email} · {pi_phone}' },
      { text: 'Contracting/Admin POC: {poc_name}, {poc_title} · {contact_email} · {poc_phone}' },
    ] }, style: { size: 11 } }),

    node('hB', { type: 'heading', content: { level: 2, text: 'Section B — Period of Performance & Task Objectives' }, style: { size: 12, weight: 'bold' } }),
    node('sB', { type: 'text_block', content: { text: 'Period of performance: {pop_months} months. Objectives: [the specific technical objectives of the proposed task and what "success" means for each].' }, style: { size: 11 } }),
    node('sched', { type: 'table', content: {
      headers: [
        { text: 'Task / Milestone', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Start', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Finish', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Deliverable', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [['[Task 1]', 'Mo 1', '[Mo]', '[deliverable]'], ['[Task 2]', '[Mo]', 'Mo {pop_months}', '[deliverable]']],
      column_widths: [180, 70, 70, 160], border_style: 'single',
    }, style: { size: 10 } }),

    node('hC', { type: 'heading', content: { level: 2, text: 'Section C — Technical Summary & Deliverables' }, style: { size: 12, weight: 'bold' } }),
    node('sC', { type: 'text_block', content: { text: '[Nature and scope of the research + your technical approach/solution. {value_prop} What is innovative vs. the state of the art. List the deliverables.]' }, style: { size: 11 } }),

    node('hD', { type: 'heading', content: { level: 2, text: 'Section D — Cost of Task (ROM)' }, style: { size: 12, weight: 'bold' } }),
    node('rom', { type: 'table', content: {
      headers: [
        { text: 'Cost Element', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Task 1', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Task 2', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Total', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['Labor ($)', '[$]', '[$]', '[$]'],
        ['Materials / Equipment ($)', '[$]', '[$]', '[$]'],
        ['Travel + Other Direct ($)', '[$]', '[$]', '[$]'],
        ['Indirect / Overhead ($)', '[$]', '[$]', '[$]'],
        ['TOTAL ($)', '[$]', '[$]', '{proposed_cost}'],
      ],
      column_widths: [200, 90, 90, 100], border_style: 'single',
    }, style: { size: 10 } }),
  ],
};
