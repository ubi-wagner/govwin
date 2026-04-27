/**
 * DoD SBIR Phase I — Technical Volume Template (15 pages)
 *
 * Structured per standard DoD BAA requirements. Times New Roman 10pt,
 * 1-inch margins, single-spaced. Header: topic number + company.
 * Footer: company + page N of M.
 *
 * Section structure matches the DSIP standard BAA evaluation criteria:
 *   1. Technical Merit — is the approach innovative and feasible?
 *   2. Qualifications — does the team have the right expertise?
 *   3. Commercialization — is there a viable market path?
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = CANVAS_PRESETS.letter_sbir_phase1;

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

export const DOD_SBIR_PHASE1_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-sbir-p1-technical',
  canvas: PRESET,
  metadata: {
    title: 'DoD SBIR Phase I — Technical Volume',
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
    // ─── Cover Page ─────────────────────────────────────────────
    node('cover-title', {
      type: 'heading', content: { level: 1, text: '{topic_number}: {topic_title}' },
      style: { alignment: 'center', space_before: 120 },
    }),
    node('cover-subtitle', {
      type: 'text_block', content: { text: 'SBIR Phase I Technical Volume' },
      style: { alignment: 'center', size: 14 },
    }),
    node('cover-company', {
      type: 'text_block', content: { text: '{company_name}' },
      style: { alignment: 'center', size: 14, weight: 'bold', space_before: 48 },
    }),
    node('cover-details', {
      type: 'table',
      content: {
        headers: [
          { text: 'Field', style: { bold: true, bg: '#f0f0f0' } },
          { text: 'Value', style: { bg: '#f0f0f0' } },
        ],
        rows: [
          ['Solicitation Number', '{solicitation_number}'],
          ['Topic Number', '{topic_number}'],
          ['Company', '{company_name}'],
          ['CAGE Code', '{cage_code}'],
          ['UEI', '{uei}'],
          ['Principal Investigator', '{pi_name}'],
          ['PI Phone', '{pi_phone}'],
          ['PI Email', '{pi_email}'],
          ['Period of Performance', '{pop_months} months'],
          ['Proposed Cost', '${proposed_cost}'],
          ['TABA Proposed', '{taba_proposed}'],
        ],
        column_widths: [200, 340],
        border_style: 'single',
      },
      style: { space_before: 24 },
    }),
    node('cover-break', { type: 'page_break', content: null }),

    // ─── Table of Contents ──────────────────────────────────────
    node('toc', { type: 'toc', content: { max_depth: 2 } }),
    node('toc-break', { type: 'page_break', content: null }),

    // ─── 1. Technical Approach (~8 pages) ───────────────────────
    node('s1-heading', {
      type: 'heading', content: { level: 1, text: '1. Technical Approach', numbering: '1' },
    }),

    node('s1-1-heading', {
      type: 'heading', content: { level: 2, text: '1.1 Problem Statement / Need', numbering: '1.1' },
    }),
    node('s1-1-text', {
      type: 'text_block',
      content: { text: '[Describe the military or defense problem this topic addresses. Reference the specific need from the topic description. Explain why current solutions are inadequate and the operational impact of not solving this problem. 1-2 paragraphs.]' },
    }),

    node('s1-2-heading', {
      type: 'heading', content: { level: 2, text: '1.2 Proposed Innovation', numbering: '1.2' },
    }),
    node('s1-2-text', {
      type: 'text_block',
      content: { text: '[Describe your proposed innovation and how it addresses the stated need. What is novel about your approach compared to the state of the art? What specific technical challenges will you overcome? Be specific about the innovation — reviewers score novelty heavily. 2-3 paragraphs.]' },
    }),

    node('s1-3-heading', {
      type: 'heading', content: { level: 2, text: '1.3 Technical Objectives', numbering: '1.3' },
    }),
    node('s1-3-text', {
      type: 'text_block',
      content: { text: '[List the specific, measurable technical objectives for this Phase I effort. Each objective should be testable and tied to a deliverable.]' },
    }),
    node('s1-3-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Objective 1: e.g., Demonstrate feasibility of {approach} by achieving {metric} ≥ {threshold}]' },
          { text: '[Objective 2: e.g., Develop and validate a prototype {component} that {capability}]' },
          { text: '[Objective 3: e.g., Characterize {parameter} across {conditions} to establish design space]' },
        ],
      },
    }),

    node('s1-4-heading', {
      type: 'heading', content: { level: 2, text: '1.4 Technical Approach & Methodology', numbering: '1.4' },
    }),
    node('s1-4-text', {
      type: 'text_block',
      content: { text: '[This is the core of the proposal. Describe your technical approach in detail: the methods, algorithms, processes, or experimental design you will use to achieve each objective. Include preliminary data or proof-of-concept results if available. Reference specific technical literature. Explain why this approach will work and what risks exist. 3-5 paragraphs with figures/tables as needed.]' },
    }),

    node('s1-5-heading', {
      type: 'heading', content: { level: 2, text: '1.5 Schedule & Milestones', numbering: '1.5' },
    }),
    node('s1-5-text', {
      type: 'text_block',
      content: { text: '[Provide a task-level schedule for the Phase I period of performance. Each task should map to an objective. Include go/no-go decision points.]' },
    }),
    node('s1-5-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Description', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Months', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Deliverable', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['Task 1', '[Design & preliminary analysis]', '1–3', '[Design document]'],
          ['Task 2', '[Prototype development]', '2–5', '[Prototype / test data]'],
          ['Task 3', '[Testing & validation]', '4–6', '[Test report]'],
          ['Task 4', '[Phase II planning & final report]', '5–6', '[Final report]'],
        ],
        column_widths: [60, 220, 60, 160],
        border_style: 'single',
      },
    }),

    node('s1-6-heading', {
      type: 'heading', content: { level: 2, text: '1.6 Risk Assessment', numbering: '1.6' },
    }),
    node('s1-6-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Risk', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Likelihood', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Impact', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Mitigation', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['[Technical risk 1]', 'Medium', 'High', '[Mitigation strategy]'],
          ['[Technical risk 2]', 'Low', 'Medium', '[Mitigation strategy]'],
          ['[Schedule risk 1]', 'Low', 'High', '[Mitigation strategy]'],
        ],
        column_widths: [140, 70, 70, 220],
        border_style: 'single',
      },
    }),

    node('s1-break', { type: 'page_break', content: null }),

    // ─── 2. Key Personnel (~2 pages) ────────────────────────────
    node('s2-heading', {
      type: 'heading', content: { level: 1, text: '2. Key Personnel & Qualifications', numbering: '2' },
    }),

    node('s2-1-heading', {
      type: 'heading', content: { level: 2, text: '2.1 Principal Investigator', numbering: '2.1' },
    }),
    node('s2-1-text', {
      type: 'text_block',
      content: { text: '[Name, title, highest degree. Brief bio highlighting relevant experience, publications, and prior SBIR/STTR awards. Describe specific role and time commitment (% effort) on this project. PI must be primarily employed by the small business concern at the time of award. 1-2 paragraphs.]' },
    }),

    node('s2-2-heading', {
      type: 'heading', content: { level: 2, text: '2.2 Key Team Members', numbering: '2.2' },
    }),
    node('s2-2-text', {
      type: 'text_block',
      content: { text: '[For each key team member: name, title, role, relevant expertise, and % effort. Include subcontractor/consultant personnel if applicable. Demonstrate that the team collectively has the skills to execute the proposed work.]' },
    }),

    node('s2-3-heading', {
      type: 'heading', content: { level: 2, text: '2.3 Company Qualifications', numbering: '2.3' },
    }),
    node('s2-3-text', {
      type: 'text_block',
      content: { text: '[Describe the company\'s relevant experience, capabilities, and past performance on similar technical challenges. Reference prior SBIR/STTR awards, contracts, or publications that demonstrate domain expertise.]' },
    }),

    // ─── 3. Facilities & Equipment (~0.5 pages) ─────────────────
    node('s3-heading', {
      type: 'heading', content: { level: 1, text: '3. Facilities & Equipment', numbering: '3' },
    }),
    node('s3-text', {
      type: 'text_block',
      content: { text: '[Describe the facilities and equipment available for this project. Include laboratory space, computing resources, test equipment, and any specialized hardware or software. Note whether facilities are owned, leased, or accessible through a partner/subcontractor. If government-furnished equipment is requested, specify what and why.]' },
    }),

    // ─── 4. Related Work (~0.5 pages) ───────────────────────────
    node('s4-heading', {
      type: 'heading', content: { level: 1, text: '4. Related Work & Prior Art', numbering: '4' },
    }),
    node('s4-text', {
      type: 'text_block',
      content: { text: '[Describe ongoing or recently completed work related to this proposal, including other SBIR/STTR awards, IR&D, and relevant contracts. Explain how this proposal extends or builds on prior work without duplicating funded efforts. Disclose any current or pending support for similar work from any source.]' },
    }),

    // ─── 5. Commercialization Strategy (~2 pages) ────────────────
    node('s5-heading', {
      type: 'heading', content: { level: 1, text: '5. Commercialization Strategy', numbering: '5' },
    }),

    node('s5-1-heading', {
      type: 'heading', content: { level: 2, text: '5.1 Market Opportunity', numbering: '5.1' },
    }),
    node('s5-1-text', {
      type: 'text_block',
      content: { text: '[Describe the total addressable market (TAM) for the proposed technology. Include both government (DoD/IC/civilian agencies) and commercial markets. Provide specific dollar estimates and growth projections with sources.]' },
    }),

    node('s5-2-heading', {
      type: 'heading', content: { level: 2, text: '5.2 Transition Plan', numbering: '5.2' },
    }),
    node('s5-2-text', {
      type: 'text_block',
      content: { text: '[How will this technology transition from Phase I feasibility to Phase II prototype to Phase III production/deployment? Identify specific DoD programs of record, prime contractors, or commercial customers who would adopt this technology. Include any Letters of Intent or existing relationships.]' },
    }),

    node('s5-3-heading', {
      type: 'heading', content: { level: 2, text: '5.3 Intellectual Property', numbering: '5.3' },
    }),
    node('s5-3-text', {
      type: 'text_block',
      content: { text: '[Describe your IP position: existing patents/applications, trade secrets, or proprietary processes. Note any IP that will be generated under this effort and your commercialization plan for it. SBIR data rights apply per DFARS 252.227-7018.]' },
    }),

    // ─── 6. TABA Plan (if applicable, ~1 page) ──────────────────
    node('s6-heading', {
      type: 'heading', content: { level: 1, text: '6. TABA Plan', numbering: '6' },
    }),
    node('s6-text', {
      type: 'text_block',
      content: { text: '[If requesting Technical and Business Assistance (TABA), describe the specific assistance needed, the provider, and how it supports the Phase I objectives and commercialization plan. TABA requests are typically $6,500 for Phase I. Delete this section if not requesting TABA.]' },
    }),
  ],
};
