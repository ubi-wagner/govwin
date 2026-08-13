/**
 * Investor Pitch Deck Template (11 slides)
 *
 * The classic seed/Series-A investor deck, one slide per story beat:
 * Title → Problem → Solution → Product → Market → Business Model →
 * Traction → Competition → Team → Financials → The Ask.
 *
 * Arial 18pt, 16:9 widescreen on the `slide_deck` preset (subtle footer
 * '{company_name} · {n} / {N}', images enabled). Each slide is a page_break-
 * delimited section with a heading, a structured cluster, and — on the title
 * and three content slides — a sized `image` placeholder (empty storage_key)
 * where a visual belongs: hero banner, solution overview, product screenshot,
 * and the up-and-to-the-right traction chart. {merge_field} placeholders
 * interpolate at provisioning; [bracketed prompts] mark the specifics
 * (including each figure's caption) — and the italic tip lines are coaching
 * notes the founder deletes before sending.
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

export const INVESTMENT_PITCH_DECK: CanvasDocument = {
  version: 1,
  document_id: 'template-investment-pitch-deck',
  canvas: PRESET,
  metadata: {
    title: 'Investor Pitch Deck',
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
      content: { level: 1, text: '{company_name}' },
      style: { alignment: 'center', space_before: 72, size: 28, weight: 'bold' },
    }),
    node('s1-tagline', {
      type: 'text_block',
      content: { text: '{tagline}' },
      style: { alignment: 'center', size: 20, style: 'italic' },
    }),
    node('s1-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'Company logo or hero product image',
        width: 760,
        height: 200,
        caption: '[Company logo or hero product image — drop in your brand banner]',
      },
      style: { alignment: 'center', space_before: 20 },
    }),
    node('s1-info', {
      type: 'text_block',
      content: { text: 'Investor Presentation · Seed / Series [X] · {contact_email} · [City, State] · [Month YYYY]' },
      style: { alignment: 'center', size: 14, space_before: 16 },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── Slide 2: Problem ───────────────────────────────────────
    node('s2-title', {
      type: 'heading',
      content: { level: 1, text: 'The Problem' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s2-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Target customers] lose [time / money / opportunity] to [the core problem] every [day / week].' },
          { text: 'Today\'s options are manual, fragmented, and costly — none solve [the key job].' },
          { text: 'The pain is accelerating: [market trend, regulation, or cost driver].' },
          { text: 'Bottom line: [the quantified cost of the status quo] is wasted every year.' },
        ],
      },
      style: { size: 16 },
    }),
    node('s2-note', {
      type: 'text_block',
      content: { text: 'Lead with the customer\'s pain, not your product — make the audience feel the cost of the status quo.' },
      style: { size: 12, style: 'italic', color: '#888888', space_before: 24 },
    }),
    node('s2-break', { type: 'page_break', content: null }),

    // ─── Slide 3: Solution ──────────────────────────────────────
    node('s3-title', {
      type: 'heading',
      content: { level: 1, text: 'Our Solution' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s3-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '{company_name} is {tagline}.' },
          { text: '[One sentence: what the product does and the outcome].' },
          { text: 'Customers get [benefit 1], [benefit 2], [benefit 3] — one platform.' },
          { text: 'Unlike the alternatives, we [your core differentiator].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s3-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'Solution overview',
        width: 640,
        height: 280,
        caption: '[Solution overview graphic — the "before → after" your product creates]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── Slide 4: Product ───────────────────────────────────────
    node('s4-title', {
      type: 'heading',
      content: { level: 1, text: 'Product' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s4-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Capability 1 — what the user does and gets].' },
          { text: '[Capability 2 — the second core workflow].' },
          { text: '[Capability 3 — what makes it sticky].' },
          { text: 'Built on [key technology / proprietary data / IP] — our defensible edge.' },
        ],
      },
      style: { size: 16 },
    }),
    node('s4-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'Product screenshot',
        width: 600,
        height: 300,
        caption: '[Product screenshot, demo frame, or architecture diagram — show it in action]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s4-break', { type: 'page_break', content: null }),

    // ─── Slide 5: Market (TAM / SAM / SOM) ──────────────────────
    node('s5-title', {
      type: 'heading',
      content: { level: 1, text: 'Market Opportunity' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s5-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Segment', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Definition', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Size', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'right' } },
        ],
        rows: [
          ['TAM', 'Total addressable market', { text: '{market_size}', style: { alignment: 'right' } }],
          ['SAM', 'Serviceable available market', { text: '[$ SAM]', style: { alignment: 'right' } }],
          ['SOM', 'Serviceable obtainable market (3 yr)', { text: '[$ SOM]', style: { alignment: 'right' } }],
        ],
        column_widths: [150, 470, 200],
        border_style: 'single',
      },
      style: { size: 15 },
    }),
    node('s5-note', {
      type: 'text_block',
      content: { text: 'Growing [X]% CAGR, driven by [the market trend]. Sources: [analyst report / primary research].' },
      style: { size: 14, space_before: 16 },
    }),
    node('s5-break', { type: 'page_break', content: null }),

    // ─── Slide 6: Business Model ────────────────────────────────
    node('s6-title', {
      type: 'heading',
      content: { level: 1, text: 'Business Model' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s6-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Revenue: [subscription / usage / transaction] at [$X per seat / unit / month].' },
          { text: 'Unit economics: CAC [$X], LTV [$Y], LTV:CAC [N:1], gross margin [M]%.' },
          { text: 'Motion: [self-serve / sales-led / channel], with a [length] sales cycle.' },
          { text: 'Expansion: [land-and-expand / seats / new modules] drives [Z]% net revenue retention.' },
        ],
      },
      style: { size: 16 },
    }),
    node('s6-break', { type: 'page_break', content: null }),

    // ─── Slide 7: Traction ──────────────────────────────────────
    node('s7-title', {
      type: 'heading',
      content: { level: 1, text: 'Traction' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s7-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[$X ARR], growing [Y]% month over month.' },
          { text: '[N customers], including [notable logos].' },
          { text: '[Z]% net revenue retention; [payback period] payback.' },
          { text: 'Milestones: [launched product], [signed partnerships], [awards / press].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s7-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'Traction growth chart',
        width: 620,
        height: 300,
        caption: '[Revenue / usage growth chart — the up-and-to-the-right curve that beats adjectives]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s7-break', { type: 'page_break', content: null }),

    // ─── Slide 8: Competition ───────────────────────────────────
    node('s8-title', {
      type: 'heading',
      content: { level: 1, text: 'Competitive Landscape' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s8-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Capability', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: '{company_name}', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'center' } },
          { text: '[Competitor A]', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'center' } },
          { text: '[Competitor B]', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'center' } },
        ],
        rows: [
          ['[Real-time X]', { text: 'Yes', style: { alignment: 'center' } }, { text: 'No', style: { alignment: 'center' } }, { text: 'Partial', style: { alignment: 'center' } }],
          ['[Native Y integration]', { text: 'Yes', style: { alignment: 'center' } }, { text: 'Partial', style: { alignment: 'center' } }, { text: 'No', style: { alignment: 'center' } }],
          ['[Z automation]', { text: 'Yes', style: { alignment: 'center' } }, { text: 'No', style: { alignment: 'center' } }, { text: 'No', style: { alignment: 'center' } }],
          ['Relative cost / TCO', { text: '[$]', style: { alignment: 'center' } }, { text: '[$$]', style: { alignment: 'center' } }, { text: '[$$$]', style: { alignment: 'center' } }],
        ],
        column_widths: [280, 200, 200, 200],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s8-note', {
      type: 'text_block',
      content: { text: 'Our moat: [network effects / proprietary data / switching costs / regulatory advantage].' },
      style: { size: 14, space_before: 16 },
    }),
    node('s8-break', { type: 'page_break', content: null }),

    // ─── Slide 9: Team ──────────────────────────────────────────
    node('s9-title', {
      type: 'heading',
      content: { level: 1, text: 'Team' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s9-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Name', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'left' } },
          { text: 'Role', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'left' } },
          { text: 'Background', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'left' } },
        ],
        rows: [
          ['[Founder Name]', 'CEO', '[Prior company, domain expertise, N years]'],
          ['[Cofounder Name]', 'CTO', '[Technical background, prior builds]'],
          ['[Key Hire]', '[Role]', '[Relevant experience]'],
        ],
        column_widths: [180, 160, 500],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s9-note', {
      type: 'text_block',
      content: { text: 'Advisors & backers: [notable names, firms, angels who de-risk the bet].' },
      style: { size: 14, space_before: 16 },
    }),
    node('s9-break', { type: 'page_break', content: null }),

    // ─── Slide 10: Financials & Projections ─────────────────────
    node('s10-title', {
      type: 'heading',
      content: { level: 1, text: 'Financials & Projections' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s10-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Metric', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Year 1', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'right' } },
          { text: 'Year 2', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'right' } },
          { text: 'Year 3', style: { bold: true, bg: '#1f2937', fg: '#ffffff', alignment: 'right' } },
        ],
        rows: [
          ['Revenue', { text: '[$]', style: { alignment: 'right' } }, { text: '[$]', style: { alignment: 'right' } }, { text: '[$]', style: { alignment: 'right' } }],
          ['Customers', { text: '[#]', style: { alignment: 'right' } }, { text: '[#]', style: { alignment: 'right' } }, { text: '[#]', style: { alignment: 'right' } }],
          ['Gross Margin', { text: '[%]', style: { alignment: 'right' } }, { text: '[%]', style: { alignment: 'right' } }, { text: '[%]', style: { alignment: 'right' } }],
          [
            { text: 'EBITDA / (Burn)', style: { bold: true } },
            { text: '[$]', style: { bold: true, alignment: 'right' } },
            { text: '[$]', style: { bold: true, alignment: 'right' } },
            { text: '[$]', style: { bold: true, alignment: 'right' } },
          ],
        ],
        column_widths: [280, 200, 200, 200],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s10-note', {
      type: 'text_block',
      content: { text: 'Path to [profitability / Series X] by [date]. Key drivers: [the 2-3 assumptions that matter most].' },
      style: { size: 14, space_before: 16 },
    }),
    node('s10-break', { type: 'page_break', content: null }),

    // ─── Slide 11: The Ask ──────────────────────────────────────
    node('s11-title', {
      type: 'heading',
      content: { level: 1, text: 'The Ask' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s11-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'We are raising {raise_amount}.' },
          { text: 'Use of funds: {use_of_funds}.' },
          { text: 'This delivers [N] months of runway to reach [the milestones that de-risk the next round].' },
        ],
      },
      style: { size: 18 },
    }),
    node('s11-contact', {
      type: 'text_block',
      content: { text: '{company_name}\n{contact_email}\n{website}' },
      style: { alignment: 'center', size: 18, weight: 'bold', space_before: 40 },
    }),
  ],
};
