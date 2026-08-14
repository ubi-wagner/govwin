/**
 * Biographical Sketch Template — Common Form (NIH & NSF) + NIH Supplement
 *
 * The SciENcv Common Form biosketch layout used by NIH (due dates on/after Jan 25,
 * 2026) and NSF: Identifying Info, Professional Preparation (table), Appointments &
 * Positions (table), Products (≤5 related + ≤5 other), plus the NIH Supplement
 * (Personal Statement ≤3,500 chars, Contributions to Science ≤2,000 chars each,
 * Honors ≤15). Character limits govern; SciENcv certification is the only valid
 * signature.
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

export const BIOGRAPHICAL_SKETCH: CanvasDocument = {
  version: 1, document_id: 'template-biographical-sketch', canvas: PRESET,
  metadata: { title: 'Biographical Sketch', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Biographical Sketch' }, style: { size: 16, weight: 'bold' } }),
    node('id', { type: 'text_block', content: { text: 'Name: {pi_name}   ·   ORCID / eRA Commons iD: [id]   ·   Organization: {company_name}, {company_city}, {company_state}' }, style: { size: 11, space_after: 8 } }),

    node('h1', { type: 'heading', content: { level: 2, text: 'Professional Preparation' }, style: { size: 12, weight: 'bold' } }),
    node('prep', { type: 'table', content: {
      headers: [
        { text: 'Organization', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Location', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Degree / Training', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Field', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Dates', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['[University]', '[City, ST]', '[Degree]', '[Field]', '[start–end]'],
        ['[University]', '[City, ST]', '[Degree]', '[Field]', '[start–end]'],
      ],
      column_widths: [150, 100, 110, 90, 90], border_style: 'single',
    }, style: { size: 10 } }),

    node('h2', { type: 'heading', content: { level: 2, text: 'Appointments & Positions' }, style: { size: 12, weight: 'bold' } }),
    node('appt', { type: 'table', content: {
      headers: [
        { text: 'Organization', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Location', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Title', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Dates', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['{company_name}', '{company_city}, {company_state}', '{poc_title}', '[start–present]'],
        ['[Prior org — include all appointments, domestic & foreign, prior 3 years]', '[City, ST]', '[Title]', '[start–end]'],
      ],
      column_widths: [180, 110, 120, 90], border_style: 'single',
    }, style: { size: 10 } }),

    node('h3', { type: 'heading', content: { level: 2, text: 'Products' }, style: { size: 12, weight: 'bold' } }),
    node('p-rel', { type: 'text_block', content: { text: 'Most closely related to the proposed project (≤5):' }, style: { size: 11, weight: 'bold' } }),
    node('p-rel-list', { type: 'numbered_list', content: { items: [{ text: '[Full citation — publication, patent, dataset, or software.]' }, { text: '[Full citation.]' }] }, style: { size: 10 } }),
    node('p-oth', { type: 'text_block', content: { text: 'Other significant products (≤5):' }, style: { size: 11, weight: 'bold' } }),
    node('p-oth-list', { type: 'numbered_list', content: { items: [{ text: '[Full citation.]' }, { text: '[Full citation.]' }] }, style: { size: 10 } }),

    node('h4', { type: 'heading', content: { level: 2, text: 'Personal Statement (NIH Supplement · ≤3,500 characters)' }, style: { size: 12, weight: 'bold' } }),
    node('ps', { type: 'text_block', content: { text: '[Why you are well-suited for your role on this project — expertise, {capability}, and relevant experience.]' }, style: { size: 11 } }),

    node('h5', { type: 'heading', content: { level: 2, text: 'Contributions to Science (≤2,000 characters each)' }, style: { size: 12, weight: 'bold' } }),
    node('cts', { type: 'numbered_list', content: { items: [{ text: '[Contribution: the problem, your role, the outcome, and its significance.]' }, { text: '[Contribution.]' }] }, style: { size: 11 } }),

    node('h6', { type: 'heading', content: { level: 2, text: 'Honors (≤15)' }, style: { size: 12, weight: 'bold' } }),
    node('honors', { type: 'text_block', content: { text: '[Award — year; Award — year.]' }, style: { size: 11 } }),
  ],
};
