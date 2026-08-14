/**
 * Data Management & Sharing Plan (DMSP) Template — NSF PAPPG 24-1 style (2 pages)
 *
 * The five required PAPPG elements as literal headers, plus a Roles anchor. The
 * 2025 PAPPG 24-1 supplement mandate — share all data supporting NSF-funded
 * publications at time of publication — is called out; any exception must be
 * justified here.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real data. Capped to
 * two pages (letter). Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = { ...CANVAS_PRESETS.letter_standard, max_pages: 2 };
function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return { id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {}, provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer' };
}

export const DATA_MANAGEMENT_PLAN: CanvasDocument = {
  version: 1, document_id: 'template-data-management-plan', canvas: PRESET,
  metadata: { title: 'Data Management & Sharing Plan', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Data Management & Sharing Plan' }, style: { size: 16, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{project_title} · {company_name} · {solicitation_number}' }, style: { size: 10, style: 'italic', space_after: 8 } }),

    node('h1', { type: 'heading', content: { level: 2, text: '1. Data Types & Products' }, style: { size: 12, weight: 'bold' } }),
    node('s1', { type: 'text_block', content: { text: '[Types of data, samples, physical collections, software, curriculum materials, and other products this project will produce — e.g., {capability} test data, models, and code.]' }, style: { size: 11 } }),

    node('h2', { type: 'heading', content: { level: 2, text: '2. Standards & Formats' }, style: { size: 12, weight: 'bold' } }),
    node('s2', { type: 'text_block', content: { text: '[Standards for data and metadata format/content. Document any gaps where standards are absent or inadequate, and how you will remedy them.]' }, style: { size: 11 } }),

    node('h3', { type: 'heading', content: { level: 2, text: '3. Access & Sharing Policies' }, style: { size: 12, weight: 'bold' } }),
    node('s3', { type: 'text_block', content: { text: '[Policies for access and sharing, including protection of privacy, confidentiality, security, intellectual property, and other rights. NSF PAPPG 24-1: all data supporting NSF-funded publications must be shared at the time of publication — justify any exception here.]' }, style: { size: 11 } }),

    node('h4', { type: 'heading', content: { level: 2, text: '4. Re-use, Redistribution & Derivatives' }, style: { size: 12, weight: 'bold' } }),
    node('s4', { type: 'text_block', content: { text: '[Policies and provisions for re-use, redistribution, and the production of derivatives — including any licenses.]' }, style: { size: 11 } }),

    node('h5', { type: 'heading', content: { level: 2, text: '5. Archiving & Preservation' }, style: { size: 12, weight: 'bold' } }),
    node('s5', { type: 'text_block', content: { text: '[Plans for archiving data, samples, and products and preserving access to them: the repository, the retention period, and how long-term access is maintained.]' }, style: { size: 11 } }),

    node('h6', { type: 'heading', content: { level: 2, text: '6. Roles & Responsibilities' }, style: { size: 12, weight: 'bold' } }),
    node('s6', { type: 'text_block', content: { text: '[Who manages the data: {pi_name} and the team members responsible for collection, curation, and sharing.]' }, style: { size: 11 } }),
  ],
};
