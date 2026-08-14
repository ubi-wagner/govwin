/**
 * Facilities, Equipment & Other Resources Template — NSF style
 *
 * Narrative (no page limit), three standard headings: Facilities, Equipment, Other
 * Resources. CRITICAL compliance rule: NSF forbids any quantifiable financial /
 * dollar information here — describe adequacy, not cost.
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

export const FACILITIES_EQUIPMENT: CanvasDocument = {
  version: 1, document_id: 'template-facilities-equipment', canvas: PRESET,
  metadata: { title: 'Facilities, Equipment & Other Resources', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Facilities, Equipment & Other Resources' }, style: { size: 16, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{company_name} · {project_title}  —  Narrative only; do not include dollar amounts.' }, style: { size: 10, style: 'italic', space_after: 8 } }),

    node('h1', { type: 'heading', content: { level: 2, text: 'Facilities' }, style: { size: 12, weight: 'bold' } }),
    node('s1', { type: 'text_block', content: { text: '[Laboratory, clinical, computer, and office facilities available for the project — for each: location, square footage, and the physical features relevant to this work. Add field/performance sites under "Other."] {company_name} operates from {company_city}, {company_state}.' }, style: { size: 11 } }),

    node('h2', { type: 'heading', content: { level: 2, text: 'Equipment' }, style: { size: 12, weight: 'bold' } }),
    node('s2', { type: 'text_block', content: { text: '[The major/important equipment available for the project and how each supports the proposed tasks — e.g., {capability} equipment, instruments, and prototyping hardware.]' }, style: { size: 11 } }),

    node('h3', { type: 'heading', content: { level: 2, text: 'Other Resources' }, style: { size: 12, weight: 'bold' } }),
    node('s3', { type: 'text_block', content: { text: '[Support services (machine/electronics shop, computing, administrative), unfunded collaborators and senior personnel not in the budget, and contributions of collaborators/subrecipients. Reference {research_institution} if partnering.]' }, style: { size: 11 } }),
  ],
};
