/**
 * Quad Chart Template (1 page, DoD/SBIR)
 *
 * The one-page four-quadrant snapshot DoD/SBIR programs ask for — a header ID band,
 * a 2×2 grid of the canonical transition quadrants, and a distribution-statement
 * footer line. Quadrant LABELS vary by component (NASA/DHS/Navy/AF impose their own),
 * so they stay editable; the transition convention below is the dominant default:
 *   TL Operational Need / Concept · TR Technical Approach / Innovation ·
 *   BL Deliverables / Milestones / Schedule · BR Payoff / Transition / Cost / Team.
 *
 * PRISTINE — {merge_field} anchors + [bracketed prompts]; no real data. Capped to
 * one page (letter). Structure per docs/TEMPLATE_BRIDGE_DESIGN.md research.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = { ...CANVAS_PRESETS.letter_standard, max_pages: 1 };

function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return {
    id, type: n.type ?? 'text_block', content: n.content ?? null, style: n.style ?? {},
    provenance: { source: 'template' }, history: [], library_eligible: n.type !== 'page_break' && n.type !== 'spacer',
  };
}

export const QUAD_CHART: CanvasDocument = {
  version: 1,
  document_id: 'template-quad-chart',
  canvas: PRESET,
  metadata: {
    title: 'Quad Chart', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
    created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system',
    version_number: 1, status: 'empty',
  },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: '{project_title}' }, style: { alignment: 'center', size: 16, weight: 'bold' } }),
    node('idband', {
      type: 'text_block',
      content: { text: '{company_name} · {company_city}, {company_state}  |  Topic {topic_number} · {solicitation_number}  |  PI {pi_name} · {pi_email} · {pi_phone}' },
      style: { alignment: 'center', size: 9, space_after: 6 },
    }),
    node('quad', {
      type: 'table',
      content: {
        headers: [
          { text: 'Operational Need / Concept', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Technical Approach / Innovation', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        ],
        rows: [
          [
            '[The warfighter/operational problem you solve.] Concept graphic: [drop in a labeled concept image or product photo].',
            '[What the technology is.] Innovation/differentiator: [what only you do]. Key objectives: [1–3 Phase I objectives]. Current maturity: TRL [X].',
          ],
          [
            'Deliverables & Milestones\n[Milestone 1 — target date]; [Milestone 2 — target]; [Milestone 3 — target]. TRL progression [X→Y]. Deliverables: [prototype, report, data].',
            'Payoff / Transition / Cost / Team\nPayoff: [warfighter value]. Transition: [target program/customer]. Cost: {proposed_cost} over {pop_months} months. Team: {company_name} + [partners].',
          ],
        ],
        column_widths: [246, 246],
        border_style: 'single',
      },
      style: { size: 10 },
    }),
    node('distro', {
      type: 'text_block',
      content: { text: 'DISTRIBUTION STATEMENT A. Approved for public release; distribution unlimited. [Replace with the exact statement your solicitation requires.]' },
      style: { alignment: 'center', size: 8, style: 'italic', space_before: 8 },
    }),
  ],
};
