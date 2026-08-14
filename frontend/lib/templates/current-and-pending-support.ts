/**
 * Current & Pending (Other) Support Template — Common Form
 *
 * The SciENcv Common Form: one block per project (current OR pending, foreign &
 * domestic, funded & in-kind), plus In-Kind Contributions (report if est. value
 * ≥ $5,000 and it requires a time commitment). Person-months must reconcile with
 * the budget/effort and not exceed 12/yr across all support. The individual must
 * personally certify in SciENcv.
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

export const CURRENT_AND_PENDING_SUPPORT: CanvasDocument = {
  version: 1, document_id: 'template-current-and-pending-support', canvas: PRESET,
  metadata: { title: 'Current & Pending (Other) Support', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Current & Pending (Other) Support' }, style: { size: 16, weight: 'bold' } }),
    node('id', { type: 'text_block', content: { text: 'Name: {pi_name}   ·   ORCID iD: [id]   ·   Primary organization: {company_name}' }, style: { size: 11, space_after: 8 } }),

    node('h-proj', { type: 'heading', content: { level: 2, text: 'Projects / Proposals' }, style: { size: 12, weight: 'bold' } }),
    node('proj', { type: 'table', content: {
      headers: [
        { text: 'Title', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Status', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Source / Award #', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Period', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Total $', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Person-Mo', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['{project_title}', 'Pending', '{solicitation_number}', '[start–end]', '{proposed_cost}', '[#]'],
        ['[Other project]', 'Current', '[source · award #]', '[start–end]', '[$]', '[#]'],
      ],
      column_widths: [130, 65, 130, 90, 75, 60], border_style: 'single',
    }, style: { size: 9 } }),
    node('overlap', { type: 'text_block', content: { text: 'Overlap statement (per project, ≤1,500 chars): [State scientific, budgetary, and effort (person-month) overlap with the proposed project — or "No overlap."]' }, style: { size: 10, style: 'italic', space_before: 6 } }),

    node('h-kind', { type: 'heading', content: { level: 2, text: 'In-Kind Contributions (report if ≥ $5,000 with a time commitment)' }, style: { size: 12, weight: 'bold' } }),
    node('kind', { type: 'table', content: {
      headers: [
        { text: 'Description', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Source', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Status', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Est. Value', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Dates', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [['[Personnel / facilities / data provided in kind]', '[org]', '[current/pending]', '[$]', '[start–end]']],
      column_widths: [180, 90, 90, 75, 90], border_style: 'single',
    }, style: { size: 9 } }),
    node('cert', { type: 'text_block', content: { text: 'Certification: {pi_name} must personally certify this document in SciENcv (the only valid signature). Report all current + pending, foreign and domestic, funded and in-kind.' }, style: { size: 10, style: 'italic', space_before: 8 } }),
  ],
};
