/**
 * DoD SBIR Phase II — Technical Volume Template (50 pages)
 *
 * Phase II proposals are substantially longer and more detailed than Phase I.
 * They require Phase I results, expanded technical approach, detailed
 * commercialization plan, and comprehensive management/cost sections.
 *
 * Section structure per standard DoD BAA Phase II evaluation criteria:
 *   1. Phase I Results — demonstrated feasibility
 *   2. Technical Approach — detailed R&D plan for Phase II
 *   3. Key Personnel — expanded team with Phase II additions
 *   4. Commercialization Plan — market analysis, customer pipeline
 *   5. Management Plan — schedule, milestones, risk mitigation
 *   6. Facilities & Equipment — labs, tools, partnerships
 *
 * Template provides bracketed instruction placeholders for each section.
 * Users fill in their content guided by the instructions in each placeholder.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// Phase II uses the same formatting rules as Phase I (Times New Roman, 1-inch margins)
// but with a 50-page limit instead of 15.
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_sbir_phase1,
  max_pages: 50,
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

export const DOD_SBIR_PHASE2_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-sbir-p2-technical',
  canvas: PRESET,
  metadata: {
    title: 'DoD SBIR Phase II — Technical Volume',
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
      type: 'heading',
      content: { level: 1, text: '{topic_number}: {topic_title}' },
      style: { alignment: 'center', size: 16 },
    }),
    node('cover-subtitle', {
      type: 'heading',
      content: { level: 2, text: 'SBIR Phase II Technical Volume' },
      style: { alignment: 'center', size: 14 },
    }),
    node('cover-company', {
      type: 'text_block',
      content: { text: '{company_name}\n{company_address}\nDUNS: {duns_number}\nCAGE: {cage_code}' },
      style: { alignment: 'center' },
    }),
    node('cover-pi', {
      type: 'text_block',
      content: { text: 'Principal Investigator: {pi_name}\nEmail: {pi_email}\nPhone: {pi_phone}' },
      style: { alignment: 'center' },
    }),
    node('cover-break', { type: 'page_break', content: null }),

    // ─── Table of Contents ──────────────────────────────────────
    node('toc', {
      type: 'toc',
      content: { text: 'Table of Contents' },
    }),
    node('toc-break', { type: 'page_break', content: null }),

    // ─── Section 1: Phase I Results ─────────────────────────────
    node('s1-heading', {
      type: 'heading',
      content: { level: 1, text: '1. Phase I Results and Feasibility' },
    }),
    node('s1-intro', {
      type: 'text_block',
      content: {
        text: '[Phase I Summary — Describe your Phase I objectives, approach, and key results. Demonstrate that the Phase I effort successfully established feasibility of the proposed approach. Include specific quantitative results, metrics, and deliverables achieved.]',
      },
    }),
    node('s1-objectives', {
      type: 'heading',
      content: { level: 2, text: '1.1 Phase I Objectives and Results' },
    }),
    node('s1-objectives-text', {
      type: 'text_block',
      content: { text: '[For each Phase I objective, describe the approach taken and the results achieved. Include data, test outcomes, and any deviations from the original plan. Reference figures and tables as appropriate.]' },
    }),
    node('s1-feasibility', {
      type: 'heading',
      content: { level: 2, text: '1.2 Feasibility Demonstration' },
    }),
    node('s1-feasibility-text', {
      type: 'text_block',
      content: { text: '[Provide evidence of technical feasibility established during Phase I. Include experimental data, prototype performance, simulation results, or other quantitative evidence that validates the proposed approach for Phase II.]' },
    }),

    // ─── Section 2: Technical Approach ──────────────────────────
    node('s2-heading', {
      type: 'heading',
      content: { level: 1, text: '2. Technical Approach' },
    }),
    node('s2-intro', {
      type: 'text_block',
      content: {
        text: '[Describe the detailed technical approach for Phase II R&D. Explain how this builds on Phase I results and addresses each technical objective with specific methods, tools, and expected outcomes. This section should be the most substantive part of the proposal. 3-5 paragraphs minimum.]',
      },
    }),
    node('s2-innovation', {
      type: 'heading',
      content: { level: 2, text: '2.1 Innovation and Technical Merit' },
    }),
    node('s2-innovation-text', {
      type: 'text_block',
      content: { text: '[Describe what is novel about your approach compared to the state of the art. Explain the specific technical challenges you will overcome and why your solution represents a significant advancement. Reference relevant literature and competing approaches.]' },
    }),
    node('s2-methodology', {
      type: 'heading',
      content: { level: 2, text: '2.2 Research Methodology' },
    }),
    node('s2-methodology-text', {
      type: 'text_block',
      content: { text: '[Detail the research methodology, experimental design, and analytical approaches. Include specific protocols, test conditions, sample sizes, and statistical methods. Explain how each experiment maps to a technical objective.]' },
    }),
    node('s2-milestones', {
      type: 'heading',
      content: { level: 2, text: '2.3 Technical Milestones and Deliverables' },
    }),
    node('s2-milestones-text', {
      type: 'text_block',
      content: { text: '[List Phase II technical milestones with specific go/no-go decision criteria, quantitative success metrics, and deliverables for each milestone. Include a milestone table or Gantt chart reference.]' },
    }),

    // ─── Section 3: Key Personnel ───────────────────────────────
    node('s3-heading', {
      type: 'heading',
      content: { level: 1, text: '3. Key Personnel and Qualifications' },
    }),
    node('s3-intro', {
      type: 'text_block',
      content: {
        text: '[Describe the qualifications of all key personnel. Include relevant experience, publications, and prior SBIR/STTR work. Identify any new team members added for Phase II and explain why their expertise is needed for the expanded scope.]',
      },
    }),
    node('s3-pi', {
      type: 'heading',
      content: { level: 2, text: '3.1 Principal Investigator' },
    }),
    node('s3-pi-text', {
      type: 'text_block',
      content: { text: '[Name, title, highest degree. Describe the PI\'s relevant experience, publications, and prior SBIR/STTR awards. Specify their role and time commitment (% effort) for Phase II. PI must be primarily employed by the small business concern. 1-2 paragraphs.]' },
    }),

    // ─── Section 4: Commercialization Plan ──────────────────────
    node('s4-heading', {
      type: 'heading',
      content: { level: 1, text: '4. Commercialization Plan' },
    }),
    node('s4-intro', {
      type: 'text_block',
      content: {
        text: '[Present a comprehensive commercialization strategy. Address total addressable market size, target customers (DoD and commercial), competitive landscape, IP strategy, and revenue projections. This section is heavily weighted in Phase II evaluation. 2-3 paragraphs.]',
      },
    }),
    node('s4-market', {
      type: 'heading',
      content: { level: 2, text: '4.1 Market Analysis' },
    }),
    node('s4-market-text', {
      type: 'text_block',
      content: { text: '[Describe the total addressable market (TAM) for the proposed technology. Break down by customer segments (DoD programs of record, other federal agencies, commercial). Provide specific dollar estimates and growth projections with sources.]' },
    }),
    node('s4-customers', {
      type: 'heading',
      content: { level: 2, text: '4.2 Customer Pipeline' },
    }),
    node('s4-customers-text', {
      type: 'text_block',
      content: { text: '[List potential customers and partners with evidence of interest: Letters of Intent, MOUs, teaming agreements, or documented conversations. Include specific DoD program offices, prime contractors, or commercial customers in your pipeline.]' },
    }),
    node('s4-ip', {
      type: 'heading',
      content: { level: 2, text: '4.3 Intellectual Property Strategy' },
    }),
    node('s4-ip-text', {
      type: 'text_block',
      content: { text: '[Describe your IP position: existing patents or applications, trade secrets, and proprietary processes. Detail your licensing strategy and plans for IP generated under this effort. SBIR data rights apply per DFARS 252.227-7018.]' },
    }),

    // ─── Section 5: Management Plan ─────────────────────────────
    node('s5-heading', {
      type: 'heading',
      content: { level: 1, text: '5. Management Plan' },
    }),
    node('s5-schedule', {
      type: 'heading',
      content: { level: 2, text: '5.1 Schedule and Milestones' },
    }),
    node('s5-schedule-text', {
      type: 'text_block',
      content: { text: '[Provide a detailed project schedule for the Phase II period of performance. Include milestones, deliverables, decision points, and task dependencies. Consider including a Gantt chart or milestone table.]' },
    }),
    node('s5-risk', {
      type: 'heading',
      content: { level: 2, text: '5.2 Risk Assessment and Mitigation' },
    }),
    node('s5-risk-text', {
      type: 'text_block',
      content: { text: '[Identify technical and programmatic risks with likelihood and impact assessments. Provide specific mitigation strategies for each risk. Consider using a risk matrix table.]' },
    }),

    // ─── Section 6: Facilities & Equipment ──────────────────────
    node('s6-heading', {
      type: 'heading',
      content: { level: 1, text: '6. Facilities and Equipment' },
    }),
    node('s6-text', {
      type: 'text_block',
      content: {
        text: '[Describe facilities, equipment, and subcontractor resources available for Phase II work. Include laboratory space, computing resources, test equipment, and specialized hardware or software. Note whether resources are owned, leased, or accessible through partners.]',
      },
    }),
  ],
};
