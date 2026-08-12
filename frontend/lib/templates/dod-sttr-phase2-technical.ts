/**
 * DoW STTR Phase II — Technical Volume Template
 *
 * Phase II STTR proposals are substantially longer and more detailed than
 * Phase I. They require Phase I results, an expanded joint technical approach,
 * a continuation of the small-business/research-institution (SBC/RI)
 * partnership, a comprehensive commercialization plan, and — the Phase II
 * differentiator — a Phase III commercialization and transition plan.
 *
 * STTR-specific requirements carried through Phase II:
 *   - The cooperative effort remains a JOINT SBC + RI effort, and the statutory
 *     work split (SBC ≥ 40%, RI ≥ 30% of total effort) still applies.
 *   - The Principal Investigator may be primarily employed by either the SBC or
 *     the RI (SBA STTR Policy Directive).
 *   - IP rights and follow-on commercialization rights are governed by the
 *     written SBC/RI allocation agreement.
 *
 * Section structure per standard DoW STTR BAA Phase II evaluation criteria:
 *   1. Phase I Results — demonstrated feasibility
 *   2. Technical Approach — detailed R&D plan for Phase II
 *   3. Research Institution Partnership — continuing joint effort + work split
 *   4. Key Personnel — expanded joint team
 *   5. Commercialization Plan — market analysis, customer pipeline
 *   6. Phase III Commercialization & Transition Plan
 *   7. Management Plan — schedule, milestones, risk mitigation
 *   8. Facilities & Equipment — SBC + RI labs, tools, partnerships
 *
 * Template provides bracketed instruction placeholders for each section.
 * Users fill in their content guided by the instructions in each placeholder.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = CANVAS_PRESETS.letter_sbir_phase2;

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

export const DOD_STTR_PHASE2_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-sttr-p2-technical',
  canvas: PRESET,
  metadata: {
    title: 'DoW STTR Phase II — Technical Volume',
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
    node('cover-banner', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Company banner', width: 468, height: 96, caption: '' },
      style: { alignment: 'center', space_before: 24, space_after: 24 },
    }),
    node('cover-title', {
      type: 'heading',
      content: { level: 1, text: '{topic_number}: {topic_title}' },
      style: { alignment: 'center', size: 16, space_before: 48 },
    }),
    node('cover-subtitle', {
      type: 'heading',
      content: { level: 2, text: 'STTR Phase II Technical Volume' },
      style: { alignment: 'center', size: 14 },
    }),
    node('cover-company', {
      type: 'text_block',
      content: { text: '{company_name}\n{company_address}\nCAGE: {cage_code}   UEI: {uei}' },
      style: { alignment: 'center' },
    }),
    node('cover-ri', {
      type: 'text_block',
      content: { text: 'Research Institution: {research_institution}' },
      style: { alignment: 'center', style: 'italic' },
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
        text: '[Phase I Summary — Describe the Phase I objectives, joint SBC/RI approach, and key results for Topic {topic_number}. Demonstrate that the Phase I effort successfully established feasibility of the proposed approach. Include specific quantitative results, metrics, and deliverables achieved by {company_name} and {research_institution}.]',
      },
    }),
    node('s1-objectives', {
      type: 'heading',
      content: { level: 2, text: '1.1 Phase I Objectives and Results' },
    }),
    node('s1-objectives-text', {
      type: 'text_block',
      content: { text: '[For each Phase I objective, describe the approach taken and the results achieved, noting the contribution of the small business concern and the research institution. Include data, test outcomes, and any deviations from the original plan. Reference figures and tables as appropriate.]' },
    }),
    node('s1-feasibility', {
      type: 'heading',
      content: { level: 2, text: '1.2 Feasibility Demonstration' },
    }),
    node('s1-feasibility-text', {
      type: 'text_block',
      content: { text: '[Provide evidence of technical feasibility established during Phase I: experimental data, prototype performance, simulation results, or other quantitative evidence that validates the joint approach for Phase II. State the Technology Readiness Level (TRL) achieved and the target TRL at the end of Phase II.]' },
    }),

    // ─── Section 2: Technical Approach ──────────────────────────
    node('figure-1', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase I feasibility results', width: 420, height: 260, caption: 'Figure 1: [Phase I feasibility results]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s2-heading', {
      type: 'heading',
      content: { level: 1, text: '2. Technical Approach' },
    }),
    node('s2-intro', {
      type: 'text_block',
      content: {
        text: '[Describe the detailed technical approach for Phase II R&D. Explain how it builds on Phase I results and addresses each technical objective with specific methods, tools, and expected outcomes, and identify which tasks are led by {company_name} versus {research_institution}. This is the most substantive part of the proposal. 3–5 paragraphs minimum.]',
      },
    }),
    node('s2-innovation', {
      type: 'heading',
      content: { level: 2, text: '2.1 Innovation and Technical Merit' },
    }),
    node('s2-innovation-text', {
      type: 'text_block',
      content: { text: '[Describe what is novel about the approach compared to the state of the art. Explain the specific technical challenges to be overcome and why the solution is a significant advancement, transitioning fundamental research from {research_institution} toward a fieldable capability. Reference relevant literature and competing approaches.]' },
    }),
    node('s2-methodology', {
      type: 'heading',
      content: { level: 2, text: '2.2 Research Methodology' },
    }),
    node('s2-methodology-text', {
      type: 'text_block',
      content: { text: '[Detail the research methodology, experimental design, and analytical approaches. Include specific protocols, test conditions, sample sizes, and statistical methods. Explain how each experiment maps to a technical objective and to the SBC or RI performing it.]' },
    }),
    node('figure-2', {
      type: 'image',
      content: { storage_key: '', alt_text: 'System architecture and technical approach diagram', width: 420, height: 260, caption: 'Figure 2: [System architecture / technical approach]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s2-milestones', {
      type: 'heading',
      content: { level: 2, text: '2.3 Technical Milestones and Deliverables' },
    }),
    node('s2-milestones-text', {
      type: 'text_block',
      content: { text: '[List Phase II technical milestones with specific go/no-go decision criteria, quantitative success metrics, and deliverables for each milestone. Include a milestone table or Gantt chart reference, and show hand-offs between {company_name} and {research_institution}.]' },
    }),

    // ─── Section 3: Research Institution Partnership ────────────
    node('s3-heading', {
      type: 'heading',
      content: { level: 1, text: '3. Research Institution Partnership & Work Allocation' },
    }),
    node('s3-intro', {
      type: 'text_block',
      content: {
        text: 'This STTR Phase II effort continues the cooperative research and development between {company_name} (the small business concern, or SBC) and {research_institution} (the single partnering research institution, or RI). [Summarize how the partnership matured through Phase I and why {research_institution} remains essential to the expanded Phase II scope.]',
      },
    }),
    node('s3-role', {
      type: 'heading',
      content: { level: 2, text: '3.1 Continuing Role of the Research Institution' },
    }),
    node('s3-role-text', {
      type: 'text_block',
      content: { text: '[Describe the specific Phase II research that {research_institution} will perform — the fundamental science, modeling, characterization, or specialized testing the small business cannot supply internally — and how those results feed the SBC prototyping and integration tasks.]' },
    }),
    node('s3-split', {
      type: 'heading',
      content: { level: 2, text: '3.2 Phase II Work Allocation (SBC ≥ 40% / RI ≥ 30%)' },
    }),
    node('s3-split-text', {
      type: 'text_block',
      content: { text: 'As in Phase I, and per the SBA STTR Policy Directive, {company_name} will perform not less than 40% of the work and {research_institution} not less than 30%, each measured as a percentage of total effort (direct plus indirect cost). The remaining effort — not to exceed 30% — is allocated as shown below and is enforced in the Phase II Cost Volume across any amendment.' },
    }),
    node('s3-split-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Performer', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Phase II Role', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Share of Work', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Basis', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['{company_name} (SBC — Prime)', '[Engineering, integration, test, transition, program management]', '≥ 40%', '[Direct + indirect labor + ODC]'],
          ['{research_institution} (RI)', '[Advanced research, modeling, characterization]', '≥ 30%', '[Direct + indirect labor + ODC]'],
          ['[Consultants / subcontractors]', '[Specialized analysis or components, if any]', '≤ 30%', '[As applicable]'],
          ['Total', '—', '100%', '—'],
        ],
        column_widths: [150, 190, 80, 120],
        border_style: 'single',
      },
    }),
    node('figure-3', {
      type: 'image',
      content: { storage_key: '', alt_text: 'SBC and RI work allocation and collaboration diagram', width: 420, height: 240, caption: 'Figure 3: [SBC/RI work allocation & collaboration]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s3-ip', {
      type: 'heading',
      content: { level: 2, text: '3.3 Collaboration Management, IP & Data Rights' },
    }),
    node('s3-ip-text', {
      type: 'text_block',
      content: { text: '[Describe how the joint effort is managed across the two organizations (integrated schedule, cadence, data sharing) and confirm the written SBC/RI intellectual-property allocation agreement remains in force for Phase II. Summarize the allocation of background and project IP and the small business\'s Phase III commercialization rights. SBIR/STTR data rights are asserted under DFARS 252.227-7018.]' },
    }),

    // ─── Section 4: Key Personnel ───────────────────────────────
    node('s4-heading', {
      type: 'heading',
      content: { level: 1, text: '4. Key Personnel and Qualifications' },
    }),
    node('s4-intro', {
      type: 'text_block',
      content: {
        text: '[Describe the qualifications of all key personnel across {company_name} and {research_institution}. Include relevant experience, publications, and prior SBIR/STTR work. Identify any new team members added for Phase II and explain why their expertise is needed for the expanded scope.]',
      },
    }),
    node('s4-pi', {
      type: 'heading',
      content: { level: 2, text: '4.1 Principal Investigator' },
    }),
    node('s4-pi-text', {
      type: 'text_block',
      content: { text: '{pi_name} continues as Principal Investigator with overall responsibility for technical direction. [Name, title, highest degree; relevant experience, publications, and prior SBIR/STTR awards.] Under the STTR program the PI may be primarily employed by either the small business concern or the research institution; {pi_name} is primarily employed by [the SBC or the RI] and commits [X]% effort to Phase II. 1–2 paragraphs.' },
    }),
    node('s4-team', {
      type: 'heading',
      content: { level: 2, text: '4.2 Research Institution Lead and Additional Phase II Personnel' },
    }),
    node('s4-team-text', {
      type: 'text_block',
      content: { text: '[Identify the {research_institution} research lead and each additional key team member across both organizations — name, title, role, expertise, and % effort — and show that responsibilities align with the Phase II work allocation in Section 3.2.]' },
    }),

    // ─── Section 5: Commercialization Plan ──────────────────────
    node('s5-heading', {
      type: 'heading',
      content: { level: 1, text: '5. Commercialization Plan' },
    }),
    node('s5-intro', {
      type: 'text_block',
      content: {
        text: '[Present a comprehensive commercialization strategy. Address total addressable market size, target customers (Department of War and commercial), competitive landscape, IP strategy, and revenue projections. This section is heavily weighted in Phase II evaluation. 2–3 paragraphs.]',
      },
    }),
    node('s5-market', {
      type: 'heading',
      content: { level: 2, text: '5.1 Market Analysis' },
    }),
    node('s5-market-text', {
      type: 'text_block',
      content: { text: '[Describe the total addressable market (TAM) for the proposed technology, broken down by customer segment (Department of War programs of record, other federal agencies, commercial). Provide specific dollar estimates and growth projections with sources.]' },
    }),
    node('s5-customers', {
      type: 'heading',
      content: { level: 2, text: '5.2 Customer Pipeline' },
    }),
    node('s5-customers-text', {
      type: 'text_block',
      content: { text: '[List potential customers and partners with evidence of interest: Letters of Intent, MOUs, teaming agreements, or documented conversations. Include specific Department of War program offices, prime contractors, or commercial customers in the pipeline.]' },
    }),
    node('s5-ip', {
      type: 'heading',
      content: { level: 2, text: '5.3 Intellectual Property Strategy' },
    }),
    node('s5-ip-text', {
      type: 'text_block',
      content: { text: '[Describe the combined IP position of {company_name} and {research_institution}: existing patents or applications, trade secrets, and proprietary processes; the licensing strategy; and plans for IP generated under this effort, consistent with the SBC/RI allocation agreement. SBIR/STTR data rights apply per DFARS 252.227-7018.]' },
    }),

    // ─── Section 6: Phase III Commercialization & Transition ────
    node('s6-heading', {
      type: 'heading',
      content: { level: 1, text: '6. Phase III Commercialization and Transition Plan' },
    }),
    node('s6-intro', {
      type: 'text_block',
      content: {
        text: 'Phase III is work that derives from, extends, or completes this STTR effort and is funded by sources other than the SBIR/STTR program — follow-on Government production or services contracts, or private capital. [Summarize the intended Phase III outcome and who pays for it.] The Government may award Phase III work (including on a sole-source basis) to {company_name} as the concern that developed the technology, per the SBIR/STTR Policy Directive.',
      },
    }),
    node('s6-targets', {
      type: 'heading',
      content: { level: 2, text: '6.1 Transition Targets and Path' },
    }),
    node('s6-targets-text', {
      type: 'text_block',
      content: { text: '[Identify the specific Department of War programs of record, prime contractors, or acquisition pathways that will adopt the technology, and the technical and programmatic steps to move from a Phase II prototype to a fielded capability. Describe the continuing role, if any, of {research_institution}.]' },
    }),
    node('figure-4', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase III transition timeline', width: 420, height: 240, caption: 'Figure 4: [Phase III transition timeline]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s6-commitments', {
      type: 'heading',
      content: { level: 2, text: '6.2 Funding and Adoption Commitments' },
    }),
    node('s6-commitments-text', {
      type: 'text_block',
      content: { text: '[Document evidence of Phase III commitment: matching funds, transition agreements, prime-contractor teaming, Program Executive Office interest, or private investment. Include dollar figures and named sponsors where possible — evaluators weight demonstrated transition commitment heavily.]' },
    }),
    node('s6-production', {
      type: 'heading',
      content: { level: 2, text: '6.3 Production, Deployment, and Sustainment' },
    }),
    node('s6-production-text', {
      type: 'text_block',
      content: { text: '[Describe the manufacturing, deployment, and sustainment approach at production scale: supply chain, quality, cost targets, and how the SBC/RI IP allocation supports {company_name}\'s ability to deliver and sustain the capability.]' },
    }),

    // ─── Section 7: Management Plan ─────────────────────────────
    node('s7-heading', {
      type: 'heading',
      content: { level: 1, text: '7. Management Plan' },
    }),
    node('s7-schedule', {
      type: 'heading',
      content: { level: 2, text: '7.1 Schedule and Milestones' },
    }),
    node('s7-schedule-text', {
      type: 'text_block',
      content: { text: '[Provide a detailed project schedule for the Phase II period of performance. Include milestones, deliverables, decision points, and task dependencies across {company_name} and {research_institution}. Consider including a Gantt chart or milestone table.]' },
    }),
    node('s7-risk', {
      type: 'heading',
      content: { level: 2, text: '7.2 Risk Assessment and Mitigation' },
    }),
    node('s7-risk-text', {
      type: 'text_block',
      content: { text: '[Identify technical, programmatic, and SBC/RI-coordination risks with likelihood and impact assessments, and provide a specific mitigation strategy for each. Consider using a risk matrix table.]' },
    }),

    // ─── Section 8: Facilities & Equipment ──────────────────────
    node('s8-heading', {
      type: 'heading',
      content: { level: 1, text: '8. Facilities and Equipment' },
    }),
    node('s8-text', {
      type: 'text_block',
      content: {
        text: '[Describe facilities, equipment, and subcontractor resources available for Phase II at both {company_name} and {research_institution}: laboratory space, computing resources, test equipment, and specialized hardware or software. Clarify which resources reside at the SBC versus the RI and whether they are owned, leased, or shared under the cooperative agreement.]',
      },
    }),
  ],
};
