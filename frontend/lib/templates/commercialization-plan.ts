/**
 * Commercialization Plan Template (standalone)
 *
 * A standalone commercialization plan aligned to SBIR/STTR commercialization
 * expectations (the "Commercialization Strategy" / Niche Assessment structure):
 *   market need & size → customer & value proposition → competition & IP →
 *   go-to-market & business model → milestones, funding & financials →
 *   team & advisors.
 *
 * Calibri 11pt on the letter_collateral preset (running company header,
 * page-numbered footer, figures enabled). Real, polished narrative with a hero
 * banner and a market-sizing figure, {merge_field} placeholders, and
 * clearly-marked [brackets] for the company's own market sizing, figures, and
 * named IP.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// Standalone commercialization plan: Calibri 11pt, running header + page-numbered footer, figures on.
const PRESET: CanvasRules = CANVAS_PRESETS.letter_collateral;

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

export const COMMERCIALIZATION_PLAN: CanvasDocument = {
  version: 1,
  document_id: 'template-commercialization-plan',
  canvas: PRESET,
  metadata: {
    title: 'Commercialization Plan',
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
    // ─── Title ──────────────────────────────────────────────────
    node('title', {
      type: 'heading',
      content: { level: 1, text: 'Commercialization Plan' },
      style: { alignment: 'center', size: 24, weight: 'bold', color: '#1f3a5f', space_before: 8 },
    }),
    node('subtitle', {
      type: 'text_block',
      content: { text: '{product_name}' },
      style: { alignment: 'center', size: 15, style: 'italic', color: '#555555' },
    }),
    node('company', {
      type: 'text_block',
      content: { text: '{company_name}   ·   {website}' },
      style: { alignment: 'center', size: 12, weight: 'bold' },
    }),
    node('title-rule', {
      type: 'divider',
      content: { thickness: 2, color: '#1f3a5f', line_style: 'solid' },
    }),

    // ─── Hero band (product / mission imagery) ──────────────────
    node('hero', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Hero image', width: 484, height: 128, caption: '' },
      style: { alignment: 'center', space_before: 6, space_after: 8 },
    }),

    // ─── 1. Market Need & Size ──────────────────────────────────
    node('s1-h', {
      type: 'heading',
      content: { level: 1, text: 'Market Need & Size', numbering: '1' },
    }),
    node('s1-p1', {
      type: 'text_block',
      content: { text: 'The opportunity for {product_name} is driven by a durable, growing need: [describe the core problem your customers face — e.g., agencies and enterprises must process rising volumes of sensitive data securely and at speed, yet existing tools cannot keep up]. {value_prop} Because this need spans both government and commercial buyers, the addressable market is broad and less dependent on any single funding channel.' },
    }),
    node('s1-p2', {
      type: 'text_block',
      content: { text: 'We size the opportunity with both a top-down and a bottom-up view:' },
    }),
    node('s1-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Segment', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Definition', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Estimated Size', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff', alignment: 'right' } },
        ],
        rows: [
          ['TAM — Total Addressable Market', '[All buyers who could use this category of solution]', '[$X.XB]'],
          ['SAM — Serviceable Available Market', '[The segments {company_name} can reach today]', '[$XXXM]'],
          ['SOM — Serviceable Obtainable Market', '[The share we can realistically win in 3–5 years]', '[$XXM]'],
        ],
        column_widths: [150, 200, 118],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),
    node('s1-p3', {
      type: 'text_block',
      content: { text: 'The market is expanding at an estimated [X]% CAGR, propelled by [drivers — e.g., mandated modernization, rising security requirements, and growing data volumes].' },
      style: { space_before: 6 },
    }),
    node('s1-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Figure 1', width: 340, height: 180, caption: 'Figure 1: [Market sizing — TAM / SAM / SOM, with CAGR]' },
      style: { alignment: 'center', space_before: 8, space_after: 8 },
    }),

    // ─── 2. Customer & Value Proposition ────────────────────────
    node('s2-h', {
      type: 'heading',
      content: { level: 1, text: 'Customer & Value Proposition', numbering: '2' },
    }),
    node('s2-p1', {
      type: 'text_block',
      content: { text: 'Our primary customers are [define — e.g., federal program offices and mission owners responsible for X], with secondary demand from [e.g., state and local agencies and adjacent regulated enterprises]. These customers buy when they need to [core job-to-be-done] and cannot get there with the tools they have.' },
    }),
    node('s2-p2', {
      type: 'text_block',
      content: { text: 'The value proposition is straightforward: {product_name} lets customers achieve [key outcome] faster, at lower cost, and with less risk than the alternatives. For a typical customer that means [e.g., 40% faster processing, $X in annual savings, and a measurable reduction in security findings] — a return that pays back the investment well within the first year.' },
    }),
    node('s2-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Primary: [federal mission owners and program offices]' },
          { text: 'Secondary: [state & local government]' },
          { text: 'Adjacent commercial: [regulated enterprises with similar security and compliance needs]' },
        ],
      },
    }),

    // ─── 3. Competition & IP Position ───────────────────────────
    node('s3-h', {
      type: 'heading',
      content: { level: 1, text: 'Competition & IP Position', numbering: '3' },
    }),
    node('s3-p1', {
      type: 'text_block',
      content: { text: 'The competitive landscape includes [incumbent vendors, in-house/custom builds, and the status-quo manual process]. Most alternatives were not designed for the government environment and force customers to choose between capability and compliance.' },
    }),
    node('s3-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Alternative', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Limitation', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: '{product_name} Advantage', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
        ],
        rows: [
          ['[Incumbent vendor]', '[Costly, hard to integrate]', '[Open, interoperable, lower TCO]'],
          ['[In-house build]', '[Slow to build, hard to sustain]', '[Fielded in weeks, fully supported]'],
          ['[Status quo / manual]', '[Error-prone, does not scale]', '[Automated, auditable, secure]'],
        ],
        column_widths: [130, 170, 168],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),
    node('s3-p2', {
      type: 'text_block',
      content: { text: 'Our defensibility rests on proprietary technology, trade secrets, and hard-won domain know-how, with [N] patent application(s) pending covering [core innovations]. On any SBIR/STTR-funded work we assert SBIR data rights per DFARS 252.227-7018, protecting government-funded IP during the protection period while preserving our ability to commercialize. Trademarks protect the {product_name} brand.' },
      style: { space_before: 6 },
    }),

    // ─── 4. Go-to-Market & Business Model ───────────────────────
    node('s4-h', {
      type: 'heading',
      content: { level: 1, text: 'Go-to-Market & Business Model', numbering: '4' },
    }),
    node('s4-p1', {
      type: 'text_block',
      content: { text: 'We reach customers through a blend of direct sales to mission owners, contract vehicles that streamline procurement, and channel partnerships with primes and systems integrators. Early SBIR/STTR awards and pilots create the reference deployments that anchor broader adoption — a deliberate land-and-expand motion.' },
    }),
    node('s4-p2', {
      type: 'text_block',
      content: { text: 'The business model is recurring — [annual subscription / SaaS licensing] — supplemented by [implementation and support services]. Recurring revenue improves predictability and lifetime value, while services accelerate adoption and deepen customer relationships.' },
    }),
    node('s4-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Direct sales to federal mission owners and program offices' },
          { text: 'Procurement through {set_asides} and established contract vehicles' },
          { text: 'Channel partnerships with primes and systems integrators' },
          { text: 'Land-and-expand from funded pilots to enterprise deployments' },
        ],
      },
    }),

    // ─── 5. Milestones, Funding & Financials ────────────────────
    node('s5-h', {
      type: 'heading',
      content: { level: 1, text: 'Milestones, Funding & Financials', numbering: '5' },
    }),
    node('s5-p1', {
      type: 'text_block',
      content: { text: 'The plan below outlines the milestones, funding sources, and financial trajectory required to bring {product_name} from its current stage to sustained commercial scale.' },
    }),
    node('s5-milestones', {
      type: 'table',
      content: {
        headers: [
          { text: 'Milestone', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Target', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Funding Source', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
        ],
        rows: [
          ['Prototype / feasibility', '[Phase I complete]', '[SBIR/STTR Phase I]'],
          ['Field-ready product', '[Phase II complete]', '[SBIR/STTR Phase II]'],
          ['First commercial revenue', '[Year 1]', '[Revenue + matching funds]'],
          ['Scale & profitability', '[Year 3–5]', '[Revenue / private capital]'],
        ],
        column_widths: [170, 150, 148],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),
    node('s5-p2', {
      type: 'text_block',
      content: { text: 'Projected revenue (illustrative — replace with your own model):' },
      style: { space_before: 6 },
    }),
    node('s5-financials', {
      type: 'table',
      content: {
        headers: [
          { text: 'Year', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Revenue', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff', alignment: 'right' } },
          { text: 'Customers', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff', alignment: 'right' } },
        ],
        rows: [
          ['Year 1', '[$XXXk]', '[N]'],
          ['Year 2', '[$X.XM]', '[N]'],
          ['Year 3', '[$XX.XM]', '[N]'],
          ['Year 5', '[$XXM]', '[N]'],
        ],
        column_widths: [120, 180, 168],
        border_style: 'single',
      },
    }),
    node('s5-p3', {
      type: 'text_block',
      content: { text: 'To execute this plan we are seeking [$X in non-dilutive awards and/or private investment] to fund [product completion, go-to-market, and initial scale]. This capital carries the company to [break-even / Series A / sustained profitability].' },
      style: { space_before: 6 },
    }),

    // ─── 6. Team & Advisors ─────────────────────────────────────
    node('s6-h', {
      type: 'heading',
      content: { level: 1, text: 'Team & Advisors', numbering: '6' },
    }),
    node('s6-p1', {
      type: 'text_block',
      content: { text: '{company_name} is led by a team that combines deep technical expertise with public-sector and commercialization experience. [Name the principals and their relevant track record — prior exits, domain leadership, and government delivery — and the percentage of effort each commits to this effort.]' },
    }),
    node('s6-p2', {
      type: 'text_block',
      content: { text: 'Our advisory network adds market access, agency relationships, and domain credibility, including [named advisors, mentors, and strategic partners]. Together, the team has the capability to execute both the technical roadmap and the path to market.' },
    }),
    node('s6-contact', {
      type: 'text_block',
      content: { text: '{company_name}   ·   {poc_name}, {poc_title}   ·   {contact_email}   ·   {website}' },
      style: { alignment: 'center', size: 12, weight: 'bold', color: '#1f3a5f', space_before: 12 },
    }),
  ],
};
