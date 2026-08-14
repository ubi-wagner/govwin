/**
 * NIH Research Strategy Template — PHS 398 Research Plan (SBIR/STTR)
 *
 * Specific Aims (1 page, system-enforced) + Research Strategy with the three
 * literal headers in order — (a) Significance, (b) Innovation, (c) Approach —
 * organized around the aims, with Rigor & Reproducibility and Phase I go/no-go
 * criteria embedded in Approach. Research Strategy default 6 pages (many NOFOs
 * extend to 12 — take the number from the NOFO).
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

export const NIH_RESEARCH_STRATEGY: CanvasDocument = {
  version: 1, document_id: 'template-nih-research-strategy', canvas: PRESET,
  metadata: { title: 'NIH Research Strategy', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-01-01T00:00:00Z', last_modified_at: '2026-01-01T00:00:00Z', last_modified_by: 'system', version_number: 1, status: 'empty' },
  nodes: [
    node('title', { type: 'heading', content: { level: 1, text: 'Specific Aims' }, style: { size: 16, weight: 'bold' } }),
    node('aims-intro', { type: 'text_block', content: { text: '[Open with the problem/gap and your long-term goal. State the central hypothesis and the overall objective of THIS application. One innovation/payoff sentence: what this changes.]' }, style: { size: 11 } }),
    node('aim1', { type: 'text_block', content: { text: 'Aim 1. [Objective] — [brief approach] — [measurable outcome / milestone].' }, style: { size: 11, weight: 'bold' } }),
    node('aim2', { type: 'text_block', content: { text: 'Aim 2. [Objective] — [brief approach] — [measurable outcome / milestone].' }, style: { size: 11, weight: 'bold' } }),
    node('aim3', { type: 'text_block', content: { text: 'Aim 3. [Objective] — [brief approach] — [measurable outcome / milestone].' }, style: { size: 11, weight: 'bold' } }),
    node('aims-out', { type: 'text_block', content: { text: '[Expected outcomes and the impact on the field, health, or commercial practice.]' }, style: { size: 11 } }),
    node('brk', { type: 'page_break', content: null }),

    node('rs-title', { type: 'heading', content: { level: 1, text: 'Research Strategy' }, style: { size: 16, weight: 'bold' } }),
    node('ha', { type: 'heading', content: { level: 2, text: '(a) Significance' }, style: { size: 12, weight: 'bold' } }),
    node('sa', { type: 'text_block', content: { text: '[Importance of the problem; the strength/rigor of the prior research this builds on; how the project improves scientific knowledge, capability, health, or commercial practice. {value_prop}]' }, style: { size: 11 } }),
    node('hb', { type: 'heading', content: { level: 2, text: '(b) Innovation' }, style: { size: 12, weight: 'bold' } }),
    node('sb', { type: 'text_block', content: { text: '[How the project shifts current paradigms — novel concepts, methods, instrumentation, or product/market advantage. For SBIR: both technical AND commercial innovation.]' }, style: { size: 11 } }),
    node('hc', { type: 'heading', content: { level: 2, text: '(c) Approach' }, style: { size: 12, weight: 'bold' } }),
    node('sc-intro', { type: 'text_block', content: { text: 'Organized around the Specific Aims. For each aim: rationale, design/methods, expected outcomes, potential pitfalls & alternatives, and benchmarks/milestones.' }, style: { size: 11 } }),
    node('sc-aim1', { type: 'text_block', content: { text: 'Approach — Aim 1: [rationale · methods · expected outcomes · pitfalls & alternatives · Phase I go/no-go criteria].' }, style: { size: 11 } }),
    node('sc-aim2', { type: 'text_block', content: { text: 'Approach — Aim 2: [rationale · methods · expected outcomes · pitfalls & alternatives · milestones].' }, style: { size: 11 } }),
    node('sc-aim3', { type: 'text_block', content: { text: 'Approach — Aim 3: [rationale · methods · expected outcomes · pitfalls & alternatives · milestones].' }, style: { size: 11 } }),
    node('rr', { type: 'text_block', content: { text: 'Rigor & Reproducibility: [unbiased design, randomization/blinding, sample size/power, controls] and authentication of key biological/chemical resources.' }, style: { size: 11, style: 'italic' } }),
    node('timeline', { type: 'text_block', content: { text: 'Timeline: [Phase I effort over {pop_months} months, with the go/no-go decision point.]' }, style: { size: 11 } }),
  ],
};
