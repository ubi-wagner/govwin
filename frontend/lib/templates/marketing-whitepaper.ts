/**
 * Thought-Leadership White Paper Template (~6–8 pages)
 *
 * A long-form, credibility-building white paper for government audiences:
 *   executive summary → the problem & why it matters → our approach &
 *   technology → results & evidence → implications for leaders → about us.
 *
 * Calibri 11pt on the letter_collateral preset (running company header,
 * page-numbered footer, figures enabled). Includes a cover with hero art, a
 * table of contents, two in-body figure placeholders, and real,
 * publication-ready prose with {merge_field} placeholders (and clearly-marked
 * spots for the company's own figures/citations).
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// Thought-leadership white paper: Calibri 11pt, running header + page-numbered footer, figures on.
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

export const MARKETING_WHITEPAPER: CanvasDocument = {
  version: 1,
  document_id: 'template-marketing-whitepaper',
  canvas: PRESET,
  metadata: {
    title: 'Thought-Leadership White Paper',
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
    // ─── Cover ──────────────────────────────────────────────────
    node('cover-eyebrow', {
      type: 'text_block',
      content: { text: 'WHITE PAPER' },
      style: { alignment: 'center', size: 12, weight: 'bold', color: '#1f3a5f', space_before: 96 },
    }),
    node('cover-title', {
      type: 'heading',
      content: { level: 1, text: 'Closing the Capability Gap: How Modern Technology Is Reshaping Government Mission Delivery' },
      style: { alignment: 'center', size: 22, weight: 'bold', color: '#1f3a5f', space_before: 12 },
    }),
    node('cover-subtitle', {
      type: 'text_block',
      content: { text: 'A perspective from {company_name} on modernizing the mission — securely, affordably, and at speed.' },
      style: { alignment: 'center', size: 14, style: 'italic', color: '#555555', space_before: 12 },
    }),
    node('cover-byline', {
      type: 'text_block',
      content: { text: '{company_name}   ·   {website}' },
      style: { alignment: 'center', size: 12, weight: 'bold', space_before: 40 },
    }),
    node('cover-hero', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Hero image', width: 484, height: 210, caption: '' },
      style: { alignment: 'center', space_before: 28 },
    }),
    node('cover-break', { type: 'page_break', content: null }),

    // ─── Table of Contents ──────────────────────────────────────
    node('toc', { type: 'toc', content: { max_depth: 2 } }),
    node('toc-break', { type: 'page_break', content: null }),

    // ─── 1. Executive Summary ───────────────────────────────────
    node('s1-h', {
      type: 'heading',
      content: { level: 1, text: '1. Executive Summary', numbering: '1' },
    }),
    node('s1-p1', {
      type: 'text_block',
      content: { text: 'Government organizations face a widening gap between rising mission demand and the capabilities available to meet it. Budgets are constrained, threats and citizen expectations evolve faster than procurement cycles, and the public increasingly expects the same speed and reliability from government that they get from the private sector. Closing this gap is no longer a matter of incremental upgrades — it requires a deliberate strategy for adopting modern technology within the constraints that make government unique.' },
    }),
    node('s1-p2', {
      type: 'text_block',
      content: { text: 'This paper examines the forces driving that gap, the real cost of maintaining the status quo, and a practical framework leaders can use to modernize with confidence. It draws on {company_name}\'s experience delivering {product_name} to public-sector customers, and it offers concrete steps decision-makers can take today. {value_prop}' },
    }),

    // ─── 2. The Problem — and Why It Matters ────────────────────
    node('s2-h', {
      type: 'heading',
      content: { level: 1, text: '2. The Problem — and Why It Matters', numbering: '2' },
    }),
    node('s2-p1', {
      type: 'text_block',
      content: { text: 'For decades, government has run on systems that were state-of-the-art when they were built and have quietly become liabilities since. Aging platforms are expensive to maintain, difficult to secure, and nearly impossible to integrate with the modern tools agencies now depend on. Every year that maintenance consumes a larger share of the budget, less is left to invest in the mission itself.' },
    }),
    node('s2-p2', {
      type: 'text_block',
      content: { text: 'The consequences are not abstract. When systems cannot share data, analysts spend hours reconciling spreadsheets instead of making decisions. When security is bolted on after the fact, agencies carry risk they cannot fully see. And when it takes years to field a new capability, the mission is served by yesterday\'s technology against today\'s problems.' },
    }),
    node('s2-p3', {
      type: 'text_block',
      content: { text: 'Four forces are widening the gap:' },
    }),
    node('s2-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Legacy debt — maintaining brittle, end-of-life systems crowds out investment in new capability.' },
          { text: 'Data fragmentation — critical information is trapped in silos that cannot talk to one another.' },
          { text: 'Escalating threats — adversaries innovate faster than traditional acquisition can respond.' },
          { text: 'Talent and capacity — skilled teams are stretched thin across competing priorities.' },
        ],
      },
    }),

    // ─── 3. Our Approach & Technology ───────────────────────────
    node('s3-h', {
      type: 'heading',
      content: { level: 1, text: '3. Our Approach & Technology', numbering: '3' },
    }),
    node('s3-p1', {
      type: 'text_block',
      content: { text: 'Modernization does not have to mean a risky, multi-year rip-and-replace. {company_name} takes a different path: deliver value in small, verifiable increments, integrate with what already works, and earn trust at every step. {product_name} is built on that principle.' },
    }),
    node('s3-p2', {
      type: 'text_block',
      content: { text: 'Our approach rests on three commitments. First, security and compliance are designed in from the start, not added at the end — so systems are auditable and ready for authorization. Second, everything is built to interoperate, using open standards and well-documented interfaces so agencies are never locked in. Third, we optimize for time-to-value, fielding working capability in weeks so stakeholders see progress and the program builds momentum.' },
    }),
    node('s3-principles', {
      type: 'table',
      content: {
        headers: [
          { text: 'Principle', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'What It Means', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Why It Matters', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
        ],
        rows: [
          ['Secure by design', 'Compliance and auditability built into the architecture', 'Faster ATO, lower risk'],
          ['Open & interoperable', 'Standards-based interfaces, no vendor lock-in', 'Data flows where the mission needs it'],
          ['Incremental delivery', 'Working capability shipped in weeks, not years', 'Momentum, transparency, de-risked spend'],
        ],
        column_widths: [130, 200, 138],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),
    node('s3-p3', {
      type: 'text_block',
      content: { text: 'The result is technology that fits the government environment rather than fighting it — capability that operators actually adopt, that security teams can defend, and that leaders can stand behind.' },
      style: { space_before: 6 },
    }),
    node('s3-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Figure 1', width: 380, height: 200, caption: 'Figure 1: [Reference architecture — how the solution fits the mission environment]' },
      style: { alignment: 'center', space_before: 8, space_after: 8 },
    }),

    // ─── 4. Results & Evidence ──────────────────────────────────
    node('s4-h', {
      type: 'heading',
      content: { level: 1, text: '4. Results & Evidence', numbering: '4' },
    }),
    node('s4-p1', {
      type: 'text_block',
      content: { text: 'A modern approach is only as good as the outcomes it produces. Across our engagements, the pattern is consistent: faster delivery, lower cost of ownership, and measurable mission impact. The table below contrasts the traditional path with what customers experience using {product_name}.' },
    }),
    node('s4-results', {
      type: 'table',
      content: {
        headers: [
          { text: 'Outcome', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Traditional Approach', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'With {product_name}', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
        ],
        rows: [
          ['Time to field new capability', '[12–24 months]', '[Weeks]'],
          ['Cost of ownership', '[Rising maintenance burden]', '[Reduced by ~[X]%]'],
          ['Path to authorization', '[Uncertain, late-stage]', '[Designed-in, predictable]'],
        ],
        column_widths: [160, 154, 154],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),
    node('s4-p2', {
      type: 'text_block',
      content: { text: 'These are representative results; outcomes depend on scope and starting point. What does not change is the underlying discipline — measure, integrate, and deliver in increments — which is what makes the gains durable rather than one-time. [Replace the figures above with your own program metrics and add a short customer proof point or quotation to strengthen this section.]' },
      style: { space_before: 6 },
    }),
    node('s4-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Figure 2', width: 380, height: 200, caption: 'Figure 2: [Results — outcome metrics, traditional approach vs. with {product_name}]' },
      style: { alignment: 'center', space_before: 8, space_after: 8 },
    }),

    // ─── 5. Implications for Leaders ────────────────────────────
    node('s5-h', {
      type: 'heading',
      content: { level: 1, text: '5. Implications for Leaders', numbering: '5' },
    }),
    node('s5-p1', {
      type: 'text_block',
      content: { text: 'For agency leaders, the message is both urgent and hopeful. The cost of standing still compounds — in dollars, in risk, and in mission effectiveness — but the path forward is well understood and achievable within existing constraints. The organizations that pull ahead will be the ones that treat modernization as a continuous discipline rather than a one-time project.' },
    }),
    node('s5-p2', {
      type: 'text_block',
      content: { text: 'That shift is as much cultural as technical. It rewards leaders who fund outcomes over outputs, who insist on interoperability, and who create room for small, fast wins that build organizational confidence. A practical first move is to pick one high-friction workflow and prove the model on it.' },
    }),
    node('s5-list', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Identify one high-friction, high-value workflow to modernize first.' },
          { text: 'Insist on designed-in security and open interfaces from day one.' },
          { text: 'Set milestone-based expectations that deliver working capability in weeks.' },
          { text: 'Measure outcomes, then reinvest the savings in the next increment.' },
        ],
      },
    }),

    // ─── 6. About the Company ───────────────────────────────────
    node('s6-h', {
      type: 'heading',
      content: { level: 1, text: '6. About {company_name}', numbering: '6' },
    }),
    node('s6-p1', {
      type: 'text_block',
      content: { text: '{company_name} helps government organizations modernize mission-critical operations with technology built for the public sector. {value_prop} Through {product_name}, we deliver secure, interoperable capability that agencies can field quickly and defend with confidence.' },
    }),
    node('s6-contact', {
      type: 'text_block',
      content: { text: 'To learn more or discuss your mission, contact us at {contact_email} or visit {website}.' },
      style: { weight: 'bold', color: '#1f3a5f', space_before: 6 },
    }),
  ],
};
