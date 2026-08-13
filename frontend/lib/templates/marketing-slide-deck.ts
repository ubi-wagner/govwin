/**
 * Marketing / Capability Deck Template (9 slides)
 *
 * A capability + sales deck for winning customers (not investors): the story a
 * company tells a prospect. One slide per beat: Title → Who We Are → The Problem
 * → Our Solution & Differentiators → How It Works → Proof & Case Studies →
 * Customers & Partners → Why Us → Next Steps.
 *
 * Arial 18pt, 16:9 widescreen on the `slide_deck` preset (subtle footer
 * '{company_name} · {n} / {N}', images enabled). Each slide is a page_break-
 * delimited section with a heading, a structured cluster, and — on the title and
 * four content slides — a sized `image` placeholder (empty storage_key) where a
 * visual belongs: hero banner, market chart, product shot, process diagram, and
 * a customer/partner logo wall. {merge_field} placeholders interpolate at
 * provisioning; [bracketed prompts] mark the specifics (including each figure's
 * caption); the italic tip lines are coaching notes to delete before sending.
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

export const MARKETING_SLIDE_DECK: CanvasDocument = {
  version: 1,
  document_id: 'template-marketing-slide-deck',
  canvas: PRESET,
  metadata: {
    title: 'Marketing / Capability Deck',
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
      content: { text: 'Capabilities Overview · {contact_email} · {website}' },
      style: { alignment: 'center', size: 14, space_before: 16 },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── Slide 2: Who We Are ────────────────────────────────────
    node('s2-title', {
      type: 'heading',
      content: { level: 1, text: 'Who We Are' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s2-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '{company_name} helps [target customers] [achieve the outcome you deliver].' },
          { text: 'Founded [year] in [HQ]; [team size] across [engineering, delivery, and support].' },
          { text: 'Mission: [your one-line mission].' },
          { text: '[Credentials: certifications, clearances, or small-business status].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s2-break', { type: 'page_break', content: null }),

    // ─── Slide 3: The Problem ───────────────────────────────────
    node('s3-title', {
      type: 'heading',
      content: { level: 1, text: 'The Problem' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s3-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Target customers] struggle with [the core challenge] that costs [time / money / risk].' },
          { text: 'Legacy approaches are slow, manual, and siloed.' },
          { text: 'A {market_size} market — large, growing, and underserved by [the gap].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s3-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'Market opportunity chart',
        width: 560,
        height: 300,
        caption: '[Market-size or cost-of-inaction chart — quantify the pain the way customers describe it]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── Slide 4: Our Solution & Differentiators ────────────────
    node('s4-title', {
      type: 'heading',
      content: { level: 1, text: 'Our Solution' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s4-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '{company_name} delivers {tagline} — [what the product or service is].' },
          { text: 'Differentiator 1: [what only you do].' },
          { text: 'Differentiator 2: [proprietary method or speed].' },
          { text: 'Differentiator 3: [service model or integration].' },
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
        caption: '[Product screenshot or annotated hero shot of the solution in action]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s4-break', { type: 'page_break', content: null }),

    // ─── Slide 5: How It Works ──────────────────────────────────
    node('s5-title', {
      type: 'heading',
      content: { level: 1, text: 'How It Works' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s5-list', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Discover — [assess needs and scope the fit].' },
          { text: 'Deploy — [integrate and configure to your environment].' },
          { text: 'Deliver — [measure outcomes and expand].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s5-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'How it works process diagram',
        width: 780,
        height: 240,
        caption: '[Three-step process diagram: Discover → Deploy → Deliver — makes the process tangible at a glance]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s5-break', { type: 'page_break', content: null }),

    // ─── Slide 6: Proof & Case Studies ──────────────────────────
    node('s6-title', {
      type: 'heading',
      content: { level: 1, text: 'Proof & Results' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s6-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Client', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Challenge', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Result', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        ],
        rows: [
          ['[Client A]', '[The problem they faced]', '[Quantified outcome — e.g., 40% faster]'],
          ['[Client B]', '[The problem they faced]', '[Quantified outcome — e.g., $2M saved]'],
        ],
        column_widths: [220, 340, 320],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s6-quote', {
      type: 'text_block',
      content: { text: '"[Customer quote about the impact you delivered]" — [Name, Title, Company]' },
      style: { size: 14, style: 'italic', space_before: 16 },
    }),
    node('s6-break', { type: 'page_break', content: null }),

    // ─── Slide 7: Customers & Partners ──────────────────────────
    node('s7-title', {
      type: 'heading',
      content: { level: 1, text: 'Customers & Partners' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s7-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Trusted by [customer logos or the sectors you serve].' },
          { text: 'Technology & channel partners: [partner names].' },
          { text: 'Available via [contract vehicles / marketplaces — GSA, AWS Marketplace, etc.].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s7-image', {
      type: 'image',
      content: {
        storage_key: '',
        alt_text: 'Customer and partner logo wall',
        width: 800,
        height: 170,
        caption: '[Customer & partner logo wall — the marks that build instant credibility]',
      },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s7-break', { type: 'page_break', content: null }),

    // ─── Slide 8: Why Us ────────────────────────────────────────
    node('s8-title', {
      type: 'heading',
      content: { level: 1, text: 'Why {company_name}' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s8-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Proven: [track record — years, number of clients, outcomes].' },
          { text: 'Fast: [speed / time-to-value].' },
          { text: 'Trusted: [security, compliance, references].' },
          { text: 'A partner, not a vendor: [long-term service and support model].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s8-break', { type: 'page_break', content: null }),

    // ─── Slide 9: Next Steps ────────────────────────────────────
    node('s9-title', {
      type: 'heading',
      content: { level: 1, text: 'Next Steps' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s9-list', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Book a discovery call or live demo].' },
          { text: '[Scope a pilot or proof of concept].' },
          { text: '[Plan the rollout and success metrics].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s9-contact', {
      type: 'text_block',
      content: { text: '{company_name}\n{contact_email}\n{website}' },
      style: { alignment: 'center', size: 18, weight: 'bold', space_before: 40 },
    }),
  ],
};
