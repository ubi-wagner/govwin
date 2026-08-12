/**
 * Marketing One-Pager Template (single page)
 *
 * A tight, sales-ready product/capability one-pager for government buyers:
 * headline value proposition → the problem → our solution → three key
 * differentiators → proof points & traction → call-to-action + contact.
 *
 * Letter, Times New Roman 12pt, 1-inch margins (letter_standard). Designed
 * to render on ONE page. Real, polished starter copy with {merge_field}
 * placeholders that get interpolated at proposal/collateral creation.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = CANVAS_PRESETS.letter_standard;

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

export const MARKETING_ONE_PAGER: CanvasDocument = {
  version: 1,
  document_id: 'template-marketing-one-pager',
  canvas: PRESET,
  metadata: {
    title: 'Marketing One-Pager',
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
    // ─── Masthead ───────────────────────────────────────────────
    node('masthead-name', {
      type: 'heading',
      content: { level: 1, text: '{company_name}' },
      style: { alignment: 'center', size: 26, weight: 'bold', color: '#1f3a5f', space_before: 8 },
    }),
    node('masthead-tagline', {
      type: 'text_block',
      content: { text: '{tagline}' },
      style: { alignment: 'center', size: 13, style: 'italic', color: '#555555', space_after: 4 },
    }),
    node('masthead-rule', {
      type: 'divider',
      content: { thickness: 2, color: '#1f3a5f', line_style: 'solid' },
    }),

    // ─── Headline value proposition ─────────────────────────────
    node('headline', {
      type: 'heading',
      content: { level: 2, text: '{value_prop}' },
      style: { alignment: 'center', size: 16, weight: 'bold', color: '#1f3a5f', space_before: 10, space_after: 8 },
    }),

    // ─── The Problem ────────────────────────────────────────────
    node('problem-h', {
      type: 'heading',
      content: { level: 3, text: 'The Problem' },
    }),
    node('problem-t', {
      type: 'text_block',
      content: { text: 'Government teams are asked to do more every year with tighter budgets, shorter timelines, and zero tolerance for risk. Legacy systems, siloed data, and manual workflows slow the mission and drive up cost — and most commercial tools were never built for the security, compliance, and interoperability the federal environment demands.' },
    }),

    // ─── Our Solution ───────────────────────────────────────────
    node('solution-h', {
      type: 'heading',
      content: { level: 3, text: 'Our Solution' },
    }),
    node('solution-t', {
      type: 'text_block',
      content: { text: '{product_name} closes that gap. Purpose-built for the realities of public-sector work, {company_name} deploys inside your existing authority-to-operate boundary, connects to the systems you already run, and puts measurable results in front of your team in weeks — not years.' },
    }),

    // ─── Key Differentiators ────────────────────────────────────
    node('diff-h', {
      type: 'heading',
      content: { level: 3, text: 'Why {company_name}' },
    }),
    node('diff-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Mission-built, not retrofitted — engineered from day one for federal security, privacy, and compliance, so there are no surprises at ATO.' },
          { text: 'Fast time-to-value — modular deployment and pre-built integrations deliver working capability in weeks and de-risk every milestone.' },
          { text: 'A partner, not just a vendor — a U.S.-based team with deep public-sector experience stands behind every deployment.' },
        ],
      },
    }),

    // ─── Proof Points & Traction ────────────────────────────────
    node('proof-h', {
      type: 'heading',
      content: { level: 3, text: 'Proof Points & Traction' },
    }),
    node('proof-list', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: 'Deployed across multiple federal programs with documented, measurable mission impact.' },
          { text: 'Delivers real outcomes for customers — [add your headline metric, e.g., 40% faster processing or $2M in cost avoidance].' },
          { text: 'Credentials that de-risk award: {set_asides} · CAGE {cage_code} · UEI {uei}.' },
        ],
      },
    }),

    // ─── Call to Action + Contact ───────────────────────────────
    node('cta-rule', {
      type: 'divider',
      content: { thickness: 1, color: '#1f3a5f', line_style: 'solid' },
    }),
    node('cta', {
      type: 'text_block',
      content: { text: 'Ready to see {product_name} in action? Let\'s start the conversation.' },
      style: { alignment: 'center', size: 13, weight: 'bold', color: '#1f3a5f', space_before: 10 },
    }),
    node('contact', {
      type: 'text_block',
      content: { text: '{contact_email}   ·   {website}' },
      style: { alignment: 'center', size: 12, space_before: 4 },
    }),
  ],
};
