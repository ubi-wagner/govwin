/**
 * Statement of Work (SOW) Template — MIL-HDBK-245D structure
 *
 * The contract performance document (not a page-limited submission): the canonical
 * three numbered sections — 1. Scope, 2. Applicable Documents, 3. Requirements
 * (tasks/subtasks) — plus the standard government tasking elements (deliverables
 * table linked to CDRLs, period/place of performance, GFP/GFE/GFI, milestones).
 * A task states WHAT, not HOW; every deliverable traces to a numbered task.
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

export const STATEMENT_OF_WORK: CanvasDocument = {
  version: 1, document_id: 'template-statement-of-work', canvas: PRESET,
  metadata: { title: 'Statement of Work', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Statement of Work — {project_title}' }, style: { size: 16, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{company_name} · {solicitation_number} · Prepared for [contracting agency]' }, style: { size: 10, style: 'italic', space_after: 8 } }),

    node('h1', { type: 'heading', content: { level: 2, text: '1. Scope' }, style: { size: 13, weight: 'bold' } }),
    node('s1', { type: 'text_block', content: { text: 'This Statement of Work defines the effort {company_name} will perform under {solicitation_number}. [State the breadth and limitations of the work in one or two sentences.]' }, style: { size: 11 } }),
    node('h11', { type: 'heading', content: { level: 3, text: '1.1 Background' }, style: { size: 11, weight: 'bold' } }),
    node('s11', { type: 'text_block', content: { text: '[The operational/technical background and the need this effort addresses.]' }, style: { size: 11 } }),

    node('h2', { type: 'heading', content: { level: 2, text: '2. Applicable Documents' }, style: { size: 13, weight: 'bold' } }),
    node('s2', { type: 'bulleted_list', content: { items: [
      { text: '[Government documents: specifications, standards, and handbooks actually invoked in Section 3.]' },
      { text: '[Other/non-Government documents invoked in Section 3.]' },
    ] }, style: { size: 11 } }),

    node('h3', { type: 'heading', content: { level: 2, text: '3. Requirements' }, style: { size: 13, weight: 'bold' } }),
    node('s31', { type: 'heading', content: { level: 3, text: '3.1 Task 1 — [Task name]' }, style: { size: 11, weight: 'bold' } }),
    node('s31b', { type: 'text_block', content: { text: 'The contractor shall [what to do — the outcome, not the method]. Subtasks: 3.1.1 [subtask]; 3.1.2 [subtask].' }, style: { size: 11 } }),
    node('s32', { type: 'heading', content: { level: 3, text: '3.2 Task 2 — [Task name]' }, style: { size: 11, weight: 'bold' } }),
    node('s32b', { type: 'text_block', content: { text: 'The contractor shall [what to do]. Subtasks: 3.2.1 [subtask]; 3.2.2 [subtask].' }, style: { size: 11 } }),
    node('s33', { type: 'heading', content: { level: 3, text: '3.3 Task 3 — [Task name]' }, style: { size: 11, weight: 'bold' } }),
    node('s33b', { type: 'text_block', content: { text: 'The contractor shall [what to do]. Subtasks: 3.3.1 [subtask]; 3.3.2 [subtask].' }, style: { size: 11 } }),

    node('h-del', { type: 'heading', content: { level: 2, text: '4. Deliverables' }, style: { size: 13, weight: 'bold' } }),
    node('del', { type: 'table', content: {
      headers: [
        { text: 'Deliverable / CDRL', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'SOW Task', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Format / DID', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Due', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [
        ['[Deliverable 1]', '3.1', '[format / DID]', '[month]'],
        ['[Deliverable 2]', '3.2', '[format / DID]', '[month]'],
        ['Final report', '3.3', '[format / DID]', 'Month {pop_months}'],
      ],
      column_widths: [180, 90, 140, 90], border_style: 'single',
    }, style: { size: 10 } }),

    node('h-pop', { type: 'heading', content: { level: 2, text: '5. Period & Place of Performance' }, style: { size: 13, weight: 'bold' } }),
    node('pop', { type: 'text_block', content: { text: 'Period of performance: {pop_months} months from award. Place of performance: {company_address}, {company_city}, {company_state} [and any Government or field sites].' }, style: { size: 11 } }),

    node('h-gfp', { type: 'heading', content: { level: 2, text: '6. Government-Furnished Property / Information' }, style: { size: 13, weight: 'bold' } }),
    node('gfp', { type: 'text_block', content: { text: '[List any GFP/GFE/GFI the Government provides, with delivery dates — or state "None required."]' }, style: { size: 11 } }),

    node('h-mile', { type: 'heading', content: { level: 2, text: '7. Milestones' }, style: { size: 13, weight: 'bold' } }),
    node('mile', { type: 'table', content: {
      headers: [
        { text: 'Milestone', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Task Ref', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        { text: 'Planned Date', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
      ],
      rows: [['[Kickoff]', '3.1', 'Month 1'], ['[Mid-point review]', '3.2', '[month]'], ['[Final delivery]', '3.3', 'Month {pop_months}']],
      column_widths: [260, 120, 120], border_style: 'single',
    }, style: { size: 10 } }),
  ],
};
