/**
 * Technology Overview Deck Template (9 slides)
 *
 * A technical capability briefing for an engineering/evaluator audience (program
 * managers, technical reviewers, teaming partners) — the story of the TECHNOLOGY,
 * not the sale. One slide per beat: Title → The Challenge → Our Technology → How
 * It Works → What Makes It Different → Validation & Maturity → Applications →
 * Roadmap → Team & Contact.
 *
 * Arial on the `slide_deck` preset (subtle footer, images enabled). Each slide is
 * a page_break-delimited section with a heading and a structured cluster; the
 * title and the technology/architecture/validation slides carry a sized `image`
 * placeholder (empty storage_key) where a concept, architecture, or results
 * figure belongs. {merge_field} placeholders interpolate at provisioning;
 * [bracketed prompts] mark the specifics to fill in. PRISTINE — no real data.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = CANVAS_PRESETS.slide_deck;

function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return {
    id,
    type: n.type ?? 'text_block',
    content: n.content ?? null,
    style: n.style ?? {},
    provenance: { source: 'template' },
    history: [],
    library_eligible: n.type !== 'page_break' && n.type !== 'spacer',
  };
}

export const TECH_OVERVIEW_DECK: CanvasDocument = {
  version: 1,
  document_id: 'template-tech-overview-deck',
  canvas: PRESET,
  metadata: {
    title: 'Technology Overview Deck',
    volume_id: '',
    required_item_id: '',
    proposal_id: '',
    solicitation_id: '',
    created_at: '2026-01-01T00:00:00Z',
    last_modified_at: '2026-01-01T00:00:00Z',
    last_modified_by: 'system',
    version_number: 1,
    status: 'empty',
  },
  nodes: [
    // ─── Slide 1: Title ─────────────────────────────────────────
    node('s1-title', {
      type: 'heading',
      content: { level: 1, text: '{product_name}' },
      style: { alignment: 'center', space_before: 64, size: 30, weight: 'bold' },
    }),
    node('s1-sub', {
      type: 'text_block',
      content: { text: 'A Technology Overview from {company_name}' },
      style: { alignment: 'center', size: 18, style: 'italic' },
    }),
    node('s1-image', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Concept or hero technology image', width: 720, height: 220, caption: '[Concept render, hardware photo, or annotated hero shot of the technology]' },
      style: { alignment: 'center', space_before: 20 },
    }),
    node('s1-info', {
      type: 'text_block',
      content: { text: '{tagline} · {website}' },
      style: { alignment: 'center', size: 14, space_before: 16 },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── Slide 2: The Challenge ─────────────────────────────────
    node('s2-title', { type: 'heading', content: { level: 1, text: 'The Challenge' }, style: { size: 24, weight: 'bold' } }),
    node('s2-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[The technical problem]: [what breaks down today and why it matters — mission, cost, or risk].' },
          { text: 'Why it is hard: [the constraint that defeats conventional approaches].' },
          { text: 'Why now: [the enabling shift — data, compute, policy, or a new method].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s2-break', { type: 'page_break', content: null }),

    // ─── Slide 3: Our Technology ────────────────────────────────
    node('s3-title', { type: 'heading', content: { level: 1, text: 'Our Technology' }, style: { size: 24, weight: 'bold' } }),
    node('s3-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '{product_name} is [what it is — a system, method, material, or platform].' },
          { text: 'The core innovation: [the novel mechanism or approach at the heart of it].' },
          { text: 'What it enables: [the capability that was not possible before].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── Slide 4: How It Works ──────────────────────────────────
    node('s4-title', { type: 'heading', content: { level: 1, text: 'How It Works' }, style: { size: 24, weight: 'bold' } }),
    node('s4-steps', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Input / trigger] — [what goes in or sets it off].' },
          { text: '[Core process] — [the key transformation your technology performs].' },
          { text: '[Output / result] — [what the user or system gets].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s4-image', {
      type: 'image',
      content: { storage_key: '', alt_text: 'System architecture diagram', width: 800, height: 260, caption: '[System / architecture diagram — how the pieces fit and data flows]' },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s4-break', { type: 'page_break', content: null }),

    // ─── Slide 5: What Makes It Different ───────────────────────
    node('s5-title', { type: 'heading', content: { level: 1, text: 'What Makes It Different' }, style: { size: 24, weight: 'bold' } }),
    node('s5-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Dimension', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Conventional Approach', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: '{product_name}', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        ],
        rows: [
          ['[Performance]', '[what today does]', '[your advantage — quantified]'],
          ['[Cost / speed]', '[what today does]', '[your advantage — quantified]'],
          ['[Risk / other]', '[what today does]', '[your advantage — quantified]'],
        ],
        column_widths: [220, 320, 320],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s5-ip', {
      type: 'text_block',
      content: { text: 'Protected by [patents / trade secrets / know-how]; [what is defensible and why].' },
      style: { size: 14, style: 'italic', space_before: 16 },
    }),
    node('s5-break', { type: 'page_break', content: null }),

    // ─── Slide 6: Validation & Maturity ─────────────────────────
    node('s6-title', { type: 'heading', content: { level: 1, text: 'Validation & Maturity' }, style: { size: 24, weight: 'bold' } }),
    node('s6-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Maturity: [current TRL / MRL] — [what has been demonstrated, and where].' },
          { text: 'Evidence: [tests, pilots, or peer-reviewed results that back the claims].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s6-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Metric', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Target', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Demonstrated', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        ],
        rows: [
          ['[Key metric 1]', '[goal]', '[result to date]'],
          ['[Key metric 2]', '[goal]', '[result to date]'],
        ],
        column_widths: [300, 280, 280],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s6-break', { type: 'page_break', content: null }),

    // ─── Slide 7: Applications ──────────────────────────────────
    node('s7-title', { type: 'heading', content: { level: 1, text: 'Applications & Use Cases' }, style: { size: 24, weight: 'bold' } }),
    node('s7-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Defense / government: [the mission use case and the buyer].' },
          { text: 'Commercial: [the dual-use market and the customer].' },
          { text: 'Near-term beachhead: [where you win first and why].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s7-break', { type: 'page_break', content: null }),

    // ─── Slide 8: Roadmap ───────────────────────────────────────
    node('s8-title', { type: 'heading', content: { level: 1, text: 'Roadmap' }, style: { size: 24, weight: 'bold' } }),
    node('s8-steps', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Now — [current phase: what is built and proven].' },
          { text: 'Next — [the immediate milestone and what it unlocks].' },
          { text: 'Then — [scale / transition target and the customer at the end].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s8-break', { type: 'page_break', content: null }),

    // ─── Slide 9: Team & Contact ────────────────────────────────
    node('s9-title', { type: 'heading', content: { level: 1, text: 'Team & Contact' }, style: { size: 24, weight: 'bold' } }),
    node('s9-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Lead name], [role] — [the credential that makes them the right person for this].' },
          { text: '[Team member], [role] — [domain depth].' },
          { text: 'Advisors / partners: [names that add credibility].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s9-contact', {
      type: 'text_block',
      content: { text: '{company_name}\n{contact_email}\n{website}' },
      style: { alignment: 'center', size: 18, weight: 'bold', space_before: 36 },
    }),
  ],
};
