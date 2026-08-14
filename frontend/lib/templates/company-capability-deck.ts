/**
 * Company Capability Deck Template (8 slides)
 *
 * The classic government-contractor CAPABILITY BRIEFING — the company overview a
 * small business brings to a teaming meeting, an industry day, or a program
 * office. One slide per beat: Title → Who We Are → Core Capabilities → Past
 * Performance → Certifications & Contract Vehicles → Differentiators → Key
 * Personnel → Contact.
 *
 * Arial on the `slide_deck` preset (subtle footer, images enabled). Each slide is
 * a page_break-delimited section with a heading and a structured cluster; the
 * title and capabilities slides carry a sized `image` placeholder (empty
 * storage_key). {merge_field} placeholders interpolate at provisioning;
 * [bracketed prompts] mark the specifics. PRISTINE — no real company data,
 * including the CAGE/UEI/SAM identifiers, which stay as anchors until filled.
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

export const COMPANY_CAPABILITY_DECK: CanvasDocument = {
  version: 1,
  document_id: 'template-company-capability-deck',
  canvas: PRESET,
  metadata: {
    title: 'Company Capability Deck',
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
      style: { alignment: 'center', space_before: 64, size: 30, weight: 'bold' },
    }),
    node('s1-sub', {
      type: 'text_block',
      content: { text: 'Capability Overview' },
      style: { alignment: 'center', size: 20, style: 'italic' },
    }),
    node('s1-image', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Company logo', width: 520, height: 180, caption: '[Company logo or a signature capability image]' },
      style: { alignment: 'center', space_before: 20 },
    }),
    node('s1-info', {
      type: 'text_block',
      content: { text: '{tagline} · {website}' },
      style: { alignment: 'center', size: 14, space_before: 16 },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── Slide 2: Who We Are ────────────────────────────────────
    node('s2-title', { type: 'heading', content: { level: 1, text: 'Who We Are' }, style: { size: 24, weight: 'bold' } }),
    node('s2-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '{company_name} is a [what you are — e.g., veteran-owned small business] delivering [your core offering] to [your customers].' },
          { text: 'Founded [year] · headquartered in [city, state] · [team size] staff.' },
          { text: 'Mission: [your one-line mission].' },
          { text: 'Core markets: [the agencies, programs, or sectors you serve].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s2-break', { type: 'page_break', content: null }),

    // ─── Slide 3: Core Capabilities ─────────────────────────────
    node('s3-title', { type: 'heading', content: { level: 1, text: 'Core Capabilities' }, style: { size: 24, weight: 'bold' } }),
    node('s3-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Capability 1] — [what you do and the outcome you deliver].' },
          { text: '[Capability 2] — [what you do and the outcome you deliver].' },
          { text: '[Capability 3] — [what you do and the outcome you deliver].' },
          { text: 'Primary NAICS: [code(s)] · [supporting codes].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s3-image', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Capabilities graphic', width: 720, height: 240, caption: '[Capabilities graphic or an icon row of your service areas]' },
      style: { alignment: 'center', space_before: 16 },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── Slide 4: Past Performance ──────────────────────────────
    node('s4-title', { type: 'heading', content: { level: 1, text: 'Past Performance' }, style: { size: 24, weight: 'bold' } }),
    node('s4-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Customer', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Scope', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Outcome', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        ],
        rows: [
          ['[Agency / prime]', '[what you delivered]', '[quantified result or period of performance]'],
          ['[Agency / prime]', '[what you delivered]', '[quantified result or period of performance]'],
          ['[Agency / prime]', '[what you delivered]', '[quantified result or period of performance]'],
        ],
        column_widths: [260, 340, 300],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s4-break', { type: 'page_break', content: null }),

    // ─── Slide 5: Certifications & Contract Vehicles ────────────
    node('s5-title', { type: 'heading', content: { level: 1, text: 'Certifications & Contract Vehicles' }, style: { size: 24, weight: 'bold' } }),
    node('s5-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Identifiers', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Set-Aside Status', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
          { text: 'Vehicles', style: { bold: true, bg: '#1f2937', fg: '#ffffff' } },
        ],
        rows: [
          ['CAGE {cage_code}', '[SDVOSB / WOSB / 8(a) / HUBZone / none]', '[GSA MAS / SEWP / CIO-SP / none]'],
          ['UEI {uei}', '[small-business size standard]', '[BOAs / IDIQs you hold or can access]'],
        ],
        column_widths: [280, 300, 320],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s5-note', {
      type: 'text_block',
      content: { text: 'Registered and active in SAM.gov. [Add clearances or facility certifications if applicable.]' },
      style: { size: 14, style: 'italic', space_before: 16 },
    }),
    node('s5-break', { type: 'page_break', content: null }),

    // ─── Slide 6: Differentiators ───────────────────────────────
    node('s6-title', { type: 'heading', content: { level: 1, text: 'Why {company_name}' }, style: { size: 24, weight: 'bold' } }),
    node('s6-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Proven: [track record — years, contracts, outcomes].' },
          { text: 'Specialized: [the niche depth that sets you apart].' },
          { text: 'Low-risk: [past performance, references, or certifications that de-risk award].' },
          { text: 'Ready to team: [how you complement a prime or lead a small effort].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s6-break', { type: 'page_break', content: null }),

    // ─── Slide 7: Key Personnel ─────────────────────────────────
    node('s7-title', { type: 'heading', content: { level: 1, text: 'Key Personnel' }, style: { size: 24, weight: 'bold' } }),
    node('s7-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Name], [title] — [the credential and the relevant experience].' },
          { text: '[Name], [title] — [domain depth and clearance if relevant].' },
          { text: '[Name], [title] — [delivery or technical leadership].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s7-break', { type: 'page_break', content: null }),

    // ─── Slide 8: Contact ───────────────────────────────────────
    node('s8-title', { type: 'heading', content: { level: 1, text: "Let's Work Together" }, style: { size: 24, weight: 'bold' } }),
    node('s8-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Point of contact: [name, title].' },
          { text: 'Capabilities statement and references available on request.' },
          { text: 'Open to [teaming, subcontracting, or prime opportunities].' },
        ],
      },
      style: { size: 16 },
    }),
    node('s8-contact', {
      type: 'text_block',
      content: { text: '{company_name}\n{contact_email}\n{website}' },
      style: { alignment: 'center', size: 18, weight: 'bold', space_before: 36 },
    }),
  ],
};
