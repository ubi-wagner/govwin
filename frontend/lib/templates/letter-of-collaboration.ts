/**
 * Letter of Collaboration / Support Template (1 page)
 *
 * Defaults to the NSF **Letter of Collaboration** convention — the strictest and
 * safest (a departure from the single-sentence format can get a proposal returned
 * without review). The verbatim NSF sentence is included; a support-letter variant
 * just loosens the body. A standard business-letter shell (letterhead, date,
 * addressee, salutation, body, signature) wraps it.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real data. Capped to
 * one page (letter). Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = { ...CANVAS_PRESETS.letter_standard, max_pages: 1 };
function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer' };
}

export const LETTER_OF_COLLABORATION: CanvasDocument = {
  version: 1, document_id: 'template-letter-of-collaboration', canvas: PRESET,
  metadata: { title: 'Letter of Collaboration', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('letterhead', { type: 'text_block', content: { text: '[COLLABORATOR ORGANIZATION LETTERHEAD]\n[Address · phone · website]' }, style: { alignment: 'center', size: 11, weight: 'bold', space_after: 10 } }),
    node('date', { type: 'text_block', content: { text: '[Month Day, Year]' }, style: { size: 11, space_after: 8 } }),
    node('addressee', { type: 'text_block', content: { text: '{pi_name}\nPrincipal Investigator, {company_name}\n{company_address}, {company_city}, {company_state}' }, style: { size: 11, space_after: 8 } }),
    node('salutation', { type: 'text_block', content: { text: 'Dear {pi_name}:' }, style: { size: 11, space_after: 8 } }),

    node('body-nsf', { type: 'text_block', content: { text: 'If the proposal submitted by {pi_name} entitled "{project_title}" is selected for funding, it is my intent to collaborate and/or commit resources as detailed in the Project Description or the Facilities, Equipment or Other Resources section of the proposal.' }, style: { size: 11, style: 'italic', space_after: 8 } }),
    node('body-detail', { type: 'text_block', content: { text: '[If a Letter of SUPPORT is permitted (not NSF): add the relationship — who you are and your connection to the project — and the specific commitment: personnel, access, data, facilities, or in-kind resources you will provide. Do NOT add evaluative or endorsing language for an NSF Letter of Collaboration.]' }, style: { size: 11, space_after: 12 } }),

    node('closing', { type: 'text_block', content: { text: 'Sincerely,' }, style: { size: 11, space_after: 24 } }),
    node('sig', { type: 'text_block', content: { text: '[Signature]\n[Name]\n[Title]\n[Organization]' }, style: { size: 11 } }),
  ],
};
