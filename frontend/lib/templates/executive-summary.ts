/**
 * Executive Summary / Cover Letter Template (1 page)
 *
 * The one-page summary a reviewer can read alone and still answer: who is this
 * org, what's the problem, what's the solution, what does it cost, what changes.
 * Five beats: Problem → Solution → Why Us → The Ask → Impact.
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

export const EXECUTIVE_SUMMARY: CanvasDocument = {
  version: 1, document_id: 'template-executive-summary', canvas: PRESET,
  metadata: { title: 'Executive Summary', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Executive Summary — {project_title}' }, style: { size: 16, weight: 'bold' } }),
    node('meta', { type: 'text_block', content: { text: '{company_name} · {topic_number} · {solicitation_number}' }, style: { size: 10, style: 'italic', space_after: 8 } }),

    node('h-problem', { type: 'heading', content: { level: 2, text: 'The Problem' }, style: { size: 12, weight: 'bold' } }),
    node('problem', { type: 'text_block', content: { text: '[Open with the hook, not boilerplate: the specific problem and one sharp data point — e.g., {market_size}.] [Why it matters now, and to whom.]' }, style: { size: 11 } }),

    node('h-solution', { type: 'heading', content: { level: 2, text: 'Our Solution' }, style: { size: 12, weight: 'bold' } }),
    node('solution', { type: 'text_block', content: { text: '{company_name} will [what you will do, in plain language]. {value_prop} [What makes the approach work.]' }, style: { size: 11 } }),

    node('h-why', { type: 'heading', content: { level: 2, text: 'Why {company_name}' }, style: { size: 12, weight: 'bold' } }),
    node('why', { type: 'text_block', content: { text: '[The unique capability, IP, or track record that makes you the right team: {capability}. Named leads: {pi_name} and the core team.]' }, style: { size: 11 } }),

    node('h-ask', { type: 'heading', content: { level: 2, text: 'The Ask' }, style: { size: 12, weight: 'bold' } }),
    node('ask', { type: 'text_block', content: { text: 'We request {proposed_cost} over {pop_months} months to [what the money buys — the concrete Phase I / project deliverables].' }, style: { size: 11 } }),

    node('h-impact', { type: 'heading', content: { level: 2, text: 'Impact' }, style: { size: 12, weight: 'bold' } }),
    node('impact', { type: 'text_block', content: { text: '[The measurable change the funder gets: {target} vs. a {threshold} threshold on {metric}.] [Transition/commercial payoff.]' }, style: { size: 11 } }),

    node('contact', { type: 'text_block', content: { text: 'Contact: {poc_name}, {poc_title} · {contact_email} · {poc_phone} · {website}' }, style: { size: 10, space_before: 10 } }),
  ],
};
