/**
 * NSF Project Pitch Template (3 pages)
 *
 * The Project Pitch is the required first step for NSF SBIR/STTR. It is a short
 * pre-proposal (3-page cap) submitted through the NSF portal; NSF responds within
 * ~3 weeks with an invitation to submit a full proposal, or a decline. Its whole
 * job is to let a program director judge, quickly, whether the work is (a) a
 * genuine technological innovation, (b) high technical risk, and (c) a real
 * commercial opportunity — the deep-tech screen.
 *
 * The pitch answers four prompts, in order:
 *   1. Technology Innovation
 *   2. Technical Objectives and Challenges
 *   3. Market Opportunity
 *   4. Company and Team
 *
 * Times New Roman 11pt, 1-inch margins with a running header + page-numbered
 * footer (letter_agency), 3-page limit. Because it is short and prose-only, there
 * is no cover page or table of contents — a masthead banner and a compact identity
 * block lead straight into the four prompts.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// Short prose pre-proposal: 11pt Times New Roman, 1-inch margins, running header +
// page-numbered footer (letter_agency), 3-page cap.
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_agency,
  max_pages: 3,
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

export const NSF_PROJECT_PITCH: CanvasDocument = {
  version: 1,
  document_id: 'template-nsf-project-pitch',
  canvas: PRESET,
  metadata: {
    title: 'NSF Project Pitch',
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
    // ─── Masthead banner ────────────────────────────────────────
    node('banner', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Company banner', width: 936, height: 90, caption: '' },
      style: { alignment: 'center', space_after: 10 },
    }),

    // ─── Identity Block ─────────────────────────────────────────
    node('hdr-title', {
      type: 'heading', content: { level: 1, text: '{project_title}' },
      style: { alignment: 'center', space_before: 6 },
    }),
    node('hdr-subtitle', {
      type: 'text_block', content: { text: 'NSF Project Pitch — {company_name}' },
      style: { alignment: 'center', size: 12, weight: 'bold', space_after: 6 },
    }),
    node('hdr-meta', {
      type: 'text_block',
      content: { text: 'Topic Area: {topic_area}    |    PI: {pi_name} ({pi_email})    |    Solicitation: {solicitation_number}' },
      style: { alignment: 'center', size: 11, style: 'italic', space_after: 12 },
    }),
    node('hdr-note', {
      type: 'text_block',
      content: { text: 'The Project Pitch is a deep-tech screen. In three pages, convince a program director that this is a real technological innovation, that Phase I carries genuine technical risk (not routine engineering), and that success unlocks a large commercial market. Keep each answer tight and specific.' },
      style: { size: 11, style: 'italic', space_after: 12 },
    }),

    // ─── 1. Technology Innovation ───────────────────────────────
    node('p1-heading', {
      type: 'heading', content: { level: 2, text: '1. Technology Innovation' },
    }),
    node('p1-text', {
      type: 'text_block',
      content: { text: 'Describe the technical innovation that would be the focus of a Phase I project, including a summary of the current state of the art and its limitations. {company_name} is developing [the innovation in one sentence] to [the outcome it enables]. [Explain what is scientifically or technically new, why existing approaches cannot get there, and what specific advance makes yours possible. Emphasize the leap over the state of the art — NSF funds transformative, not incremental, technology. ~1/2 page.]' },
    }),
    node('p1-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Innovation concept and system diagram', width: 900, height: 500, caption: 'Figure 1: [System architecture / innovation concept diagram — how the pieces fit and where the advance sits]' },
      style: { space_before: 6, space_after: 6 },
    }),

    // ─── 2. Technical Objectives and Challenges ─────────────────
    node('p2-heading', {
      type: 'heading', content: { level: 2, text: '2. Technical Objectives and Challenges' },
    }),
    node('p2-text', {
      type: 'text_block',
      content: { text: 'Describe the R&D or technical work that will help you determine the technical feasibility of the innovation, including the key technical objectives and the risks that make it uncertain. [State 2–3 measurable Phase I objectives, each with a quantitative success threshold, and name the single hardest technical hurdle each one retires. Make the technical risk explicit — a reviewer should see that the outcome is genuinely unknown and that Phase I is designed to resolve it. ~1/2 page.]' },
    }),
    node('p2-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Objective 1: demonstrate {approach} reaches {metric} ≥ {threshold} — retires {key risk}.]' },
          { text: '[Objective 2: validate {component/model} against {benchmark} — retires {key risk}.]' },
          { text: '[Objective 3 (optional): characterize {parameter} to prove the scale-up path.]' },
        ],
      },
    }),

    // ─── 3. Market Opportunity ──────────────────────────────────
    node('p3-heading', {
      type: 'heading', content: { level: 2, text: '3. Market Opportunity' },
    }),
    node('p3-text', {
      type: 'text_block',
      content: { text: 'Describe the customer profile and pain point that motivate this innovation, and the size of the market opportunity. [Name the specific first customer and the concrete problem they will pay to solve, quantify the total addressable market with a cited source, and state the value proposition in dollars saved or revenue enabled. Cite any customer discovery — interviews, letters of interest, or pilots — that shows real pull. ~1/2 page.]' },
    }),
    node('p3-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Market opportunity sizing', width: 900, height: 500, caption: 'Figure 2: [Market opportunity — TAM / SAM / SOM with a cited source, or the value-proposition comparison]' },
      style: { space_before: 6, space_after: 6 },
    }),

    // ─── 4. Company and Team ────────────────────────────────────
    node('p4-heading', {
      type: 'heading', content: { level: 2, text: '4. Company and Team' },
    }),
    node('p4-text', {
      type: 'text_block',
      content: { text: 'Describe the company and the team that will carry out the proposed work, and why they are positioned to succeed. {company_name} is [one line on the company, stage, and prior traction or funding]. The Principal Investigator, {pi_name}, brings [the directly relevant expertise]. [Round out the key team members, advisors, or research partners, and note any prior technical results or awards that de-risk execution. For an NSF SBIR the PI must be primarily employed by the company; for an STTR the PI may sit at the company or the partnering research institution. ~1/2 page.]' },
    }),
  ],
};
