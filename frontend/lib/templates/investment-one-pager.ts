/**
 * Investor One-Pager Template (1 page)
 *
 * A single-page, prose-and-table investor summary — the artifact a founder
 * hands to an investor before the full deck. It compresses the whole story
 * onto one letter page: who the company is, the problem, the solution, the
 * market (TAM/SAM/SOM), traction, business model, team, and the ask.
 *
 * Calibri 10.5pt on the letter_onepager preset (contact footer, hard 1-page
 * cap, figures enabled), designed to FILL a single page — hero banner + tight,
 * evenly-weighted sections. {merge_field} placeholders interpolate at
 * provisioning; [bracketed prompts] mark the specifics the founder fills in.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// One-page investor summary: Calibri 10.5pt, page-anchored contact footer, hard 1-page cap, figures on.
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_onepager,
  max_pages: 1,
};

function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return {
    id,
    type: n.type ?? 'text_block',
    content: n.content ?? null,
    style: n.style ?? {},
    provenance: { source: 'template' },
    history: [],
    library_eligible: n.type !== 'page_break' && n.type !== 'toc',
  };
}

export const INVESTMENT_ONE_PAGER: CanvasDocument = {
  version: 1,
  document_id: 'template-investment-one-pager',
  canvas: PRESET,
  metadata: {
    title: 'Investor One-Pager',
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
    // ─── Identity Block ─────────────────────────────────────────
    node('hdr-company', {
      type: 'heading', content: { level: 1, text: '{company_name}' },
      style: { alignment: 'center', space_after: 2 },
    }),
    node('hdr-tagline', {
      type: 'text_block', content: { text: '{tagline}' },
      style: { alignment: 'center', size: 13, style: 'italic', space_after: 8 },
    }),

    // ─── Hero band (company / product imagery) ──────────────────
    node('hero', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Hero image', width: 504, height: 104, caption: '' },
      style: { alignment: 'center', space_after: 8 },
    }),

    // ─── Problem ────────────────────────────────────────────────
    node('problem-h', {
      type: 'heading', content: { level: 2, text: 'The Problem' },
    }),
    node('problem-t', {
      type: 'text_block',
      content: { text: 'Every day, [target customers] lose time and money to [the core problem {company_name} solves]. Today\'s tools are manual, fragmented, and costly — and the gap widens as [the key market trend] accelerates.' },
    }),

    // ─── Solution ───────────────────────────────────────────────
    node('solution-h', {
      type: 'heading', content: { level: 2, text: 'Our Solution' },
    }),
    node('solution-t', {
      type: 'text_block',
      content: { text: '{company_name} is {tagline}. [One line on what the product does and the outcome it delivers], so customers get [the key benefit] without [the old tradeoff].' },
    }),

    // ─── Market ─────────────────────────────────────────────────
    node('market-h', {
      type: 'heading', content: { level: 2, text: 'Market Opportunity' },
    }),
    node('market-t', {
      type: 'text_block',
      content: { text: 'We compete in a {market_size} market growing at [X]% per year, driven by [the demand driver].' },
    }),
    node('market-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Segment', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Definition', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Size', style: { bold: true, bg: '#e8e8e8', alignment: 'right' } },
        ],
        rows: [
          ['TAM', 'Total addressable market', { text: '{market_size}', style: { alignment: 'right' } }],
          ['SAM', 'Serviceable market we can reach today', { text: '[$ SAM]', style: { alignment: 'right' } }],
          ['SOM', 'Obtainable within three years', { text: '[$ SOM]', style: { alignment: 'right' } }],
        ],
        column_widths: [70, 260, 138],
        border_style: 'single',
      },
      style: { size: 11, space_before: 4 },
    }),

    // ─── Traction ───────────────────────────────────────────────
    node('traction-h', {
      type: 'heading', content: { level: 2, text: 'Traction' },
    }),
    node('traction-l', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[$X ARR], growing [Y]% month over month.' },
          { text: '[N customers], including [notable logos].' },
          { text: '[Key milestone: product live, [M] letters of intent signed, [partnership] launched].' },
        ],
      },
    }),

    // ─── Business Model ─────────────────────────────────────────
    node('model-h', {
      type: 'heading', content: { level: 2, text: 'Business Model' },
    }),
    node('model-t', {
      type: 'text_block',
      content: { text: 'Recurring [subscription / usage] pricing, [M]% gross margin, [self-serve / sales-led] land-and-expand.' },
    }),

    // ─── Team ───────────────────────────────────────────────────
    node('team-h', {
      type: 'heading', content: { level: 2, text: 'Team' },
    }),
    node('team-t', {
      type: 'text_block',
      content: { text: 'CEO [Founder] — [prior domain]. CTO [Cofounder] — [background]. Advisors from [notable orgs].' },
    }),

    // ─── The Ask ────────────────────────────────────────────────
    node('ask-h', {
      type: 'heading', content: { level: 2, text: 'The Ask' },
    }),
    node('ask-t', {
      type: 'text_block',
      content: { text: '{company_name} is raising {raise_amount} to {use_of_funds}. This funds [N] months of runway to reach [the milestone that de-risks the next round].' },
    }),
    // Contact intentionally lives in the page-anchored footer (letter_onepager:
    // "{company_name} · {contact_email} · {website}") — no duplicate in-body line.
  ],
};
