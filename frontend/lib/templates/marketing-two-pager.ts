/**
 * Government Capability Statement Template (2 pages)
 *
 * The standard federal capability-statement layout used as leave-behind
 * collateral and to satisfy market-research / sources-sought requests:
 *   Page 1 — company overview · core competencies · differentiators
 *   Page 2 — past performance · company data (CAGE/UEI/NAICS/set-asides/POC)
 *
 * Calibri 11pt on the letter_collateral preset (running company header,
 * page-numbered footer, figures enabled), balanced across two pages — a
 * letterhead banner up top and a past-performance figure on page 2. The
 * company-data block is a two-column table per convention, with {merge_field}
 * placeholders.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// Two-page capability statement: Calibri 11pt, running header + page-numbered footer, figures on, 2-page cap.
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_collateral,
  max_pages: 2,
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

export const MARKETING_TWO_PAGER: CanvasDocument = {
  version: 1,
  document_id: 'template-marketing-two-pager',
  canvas: PRESET,
  metadata: {
    title: 'Government Capability Statement',
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
    // ─── Letterhead banner (logo / brand imagery) ──────────────
    node('banner', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Hero image', width: 484, height: 90, caption: '' },
      style: { alignment: 'center', space_after: 6 },
    }),

    // ─── Masthead ───────────────────────────────────────────────
    node('masthead-name', {
      type: 'heading',
      content: { level: 1, text: '{company_name}' },
      style: { alignment: 'center', size: 24, weight: 'bold', color: '#1f3a5f', space_before: 8 },
    }),
    node('masthead-tagline', {
      type: 'text_block',
      content: { text: '{tagline}' },
      style: { alignment: 'center', size: 13, style: 'italic', color: '#555555' },
    }),
    node('masthead-kicker', {
      type: 'text_block',
      content: { text: 'CAPABILITY STATEMENT' },
      style: { alignment: 'center', size: 12, weight: 'bold', color: '#555555', space_after: 2 },
    }),
    node('masthead-rule', {
      type: 'divider',
      content: { thickness: 2, color: '#1f3a5f', line_style: 'solid' },
    }),

    // ─── Company Overview ───────────────────────────────────────
    node('overview-h', {
      type: 'heading',
      content: { level: 2, text: 'Company Overview' },
    }),
    node('overview-t', {
      type: 'text_block',
      content: { text: '{company_name} is a {set_asides} technology company delivering {product_name} to federal, defense, and civilian agencies. {value_prop} Since {founded_year}, our team has helped government customers modernize mission-critical operations while meeting the highest standards for security, compliance, and accountability. We pair deep domain expertise with a delivery model built for the pace and rigor of the public sector — so agencies get capability they can field, not just a proof of concept.' },
    }),

    // ─── Core Competencies ──────────────────────────────────────
    node('comp-h', {
      type: 'heading',
      content: { level: 2, text: 'Core Competencies' },
    }),
    node('comp-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Systems modernization & legacy migration' },
          { text: 'Data engineering, analytics & decision support' },
          { text: 'Secure cloud architecture & DevSecOps' },
          { text: 'AI/ML integration & intelligent automation' },
          { text: 'Cybersecurity, compliance & ATO support' },
          { text: 'Agile program management & delivery' },
        ],
      },
    }),

    // ─── Differentiators ────────────────────────────────────────
    node('diff-h', {
      type: 'heading',
      content: { level: 2, text: 'Differentiators' },
    }),
    node('diff-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Purpose-built for government — every solution meets federal security, privacy, and interoperability requirements from the outset.' },
          { text: 'Outcome-driven delivery — modular, milestone-based execution that fields working capability quickly and de-risks the program.' },
          { text: 'Experienced team — public-sector practitioners who understand agency mission, governance, and the acquisition lifecycle.' },
        ],
      },
    }),

    node('page-break-1', { type: 'page_break', content: null }),

    // ─── Past Performance ───────────────────────────────────────
    node('pp-h', {
      type: 'heading',
      content: { level: 2, text: 'Past Performance' },
    }),
    node('pp-t', {
      type: 'text_block',
      content: { text: 'Representative engagements demonstrating {company_name}\'s ability to deliver on mission, on schedule, and on budget:' },
    }),
    node('pp-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Customer / Agency', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Scope of Work', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Outcome & Impact', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
        ],
        rows: [
          ['[Agency or prime contractor]', '[Scope — e.g., modernized case-management platform]', '[Result — e.g., 35% faster processing]'],
          ['[Agency or prime contractor]', '[Scope — e.g., secure data lake & analytics]', '[Result — e.g., $4M cost avoidance]'],
          ['[Agency or prime contractor]', '[Scope — e.g., DevSecOps pipeline & ATO support]', '[Result — e.g., ATO achieved in 90 days]'],
        ],
        column_widths: [140, 190, 138],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),
    // ─── Past-performance figure ───────────────────────────────
    node('pp-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Figure 1', width: 300, height: 150, caption: 'Figure 1: [Past-performance results graphic — e.g., outcomes bar chart]' },
      style: { alignment: 'center', space_before: 6, space_after: 6 },
    }),

    // ─── Company Data ───────────────────────────────────────────
    node('data-h', {
      type: 'heading',
      content: { level: 2, text: 'Company Data' },
    }),
    node('data-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Field', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
          { text: 'Value', style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } },
        ],
        rows: [
          ['Legal Business Name', '{company_name}'],
          ['CAGE Code', '{cage_code}'],
          ['UEI', '{uei}'],
          ['NAICS Codes', '{naics_codes}'],
          ['Socioeconomic Status / Set-Asides', '{set_asides}'],
          ['Primary Point of Contact', '{poc_name}, {poc_title}'],
          ['Email', '{contact_email}'],
          ['Phone', '{poc_phone}'],
          ['Website', '{website}'],
        ],
        column_widths: [190, 278],
        border_style: 'single',
      },
      style: { space_before: 6 },
    }),

    // ─── Closing contact band ───────────────────────────────────
    node('closing-rule', {
      type: 'divider',
      content: { thickness: 1, color: '#1f3a5f', line_style: 'solid' },
    }),
    node('closing', {
      type: 'text_block',
      content: { text: '{company_name}   ·   {website}   ·   {contact_email}' },
      style: { alignment: 'center', size: 12, weight: 'bold', color: '#1f3a5f', space_before: 8 },
    }),
  ],
};
