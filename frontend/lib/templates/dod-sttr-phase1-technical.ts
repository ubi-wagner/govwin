/**
 * DoW STTR Phase I — Technical Volume Template (15 pages)
 *
 * Structured per standard Department of War (DoW/DoD) STTR BAA requirements.
 * Times New Roman 10pt, 1-inch margins, single-spaced. Header: topic number +
 * company. Footer: company + page N of M.
 *
 * STTR differs from SBIR in three defining ways, all reflected below:
 *   - The effort is performed JOINTLY by a small business concern (SBC) and a
 *     single partnering research institution (RI — university, FFRDC, or
 *     qualified nonprofit research institution).
 *   - A statutory work split: the SBC performs ≥ 40% and the RI ≥ 30% of the
 *     total effort (SBA STTR Policy Directive).
 *   - The Principal Investigator may be primarily employed by EITHER the SBC or
 *     the RI (in SBIR the PI must be primarily employed by the SBC).
 *
 * Section structure matches the DSIP standard BAA evaluation criteria plus the
 * STTR-specific partnership/work-allocation/IP requirements:
 *   1. Technical Approach — is the approach innovative and feasible?
 *   2. Research Institution Partnership & Work Allocation — the STTR core
 *   3. Key Personnel — does the joint team have the right expertise?
 *   5. Commercialization — is there a viable market path?
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

export const DOD_STTR_PHASE1_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-sttr-p1-technical',
  canvas: PRESET,
  metadata: {
    title: 'DoW STTR Phase I — Technical Volume',
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
      style: { alignment: 'center', space_before: 24, space_after: 18 },
    }),
    node('cover-title', {
      type: 'heading', content: { level: 1, text: '{topic_number}: {topic_title}' },
      style: { alignment: 'center', space_before: 24 },
    }),
    node('cover-subtitle', {
      type: 'text_block', content: { text: 'STTR Phase I Technical Volume' },
      style: { alignment: 'center', size: 14 },
    }),
    node('cover-company', {
      type: 'text_block', content: { text: '{company_name}' },
      style: { alignment: 'center', size: 14, weight: 'bold', space_before: 48 },
    }),
    node('cover-partner', {
      type: 'text_block', content: { text: 'in partnership with {research_institution}' },
      style: { alignment: 'center', size: 12, style: 'italic' },
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
          ['Small Business Concern', '{company_name}'],
          ['CAGE Code', '{cage_code}'],
          ['UEI', '{uei}'],
          ['Research Institution', '{research_institution}'],
          ['RI Research Lead', '{ri_pi_name}'],
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

    // ─── 1. Technical Approach (~6 pages) ───────────────────────
    node('s1-heading', {
      type: 'heading', content: { level: 1, text: '1. Technical Approach', numbering: '1' },
    }),

    node('s1-1-heading', {
      type: 'heading', content: { level: 2, text: '1.1 Problem Statement / Need', numbering: '1.1' },
    }),
    node('s1-1-text', {
      type: 'text_block',
      content: { text: 'Topic {topic_number}, "{topic_title}," identifies a critical Department of War capability gap: [state the operational problem in one or two sentences, drawn directly from the topic description]. Today, [describe how the warfighter or program currently addresses this need and why existing solutions fall short — cost, performance, size/weight/power, schedule, or supply-chain risk]. Left unsolved, [describe the operational impact: mission risk, cost growth, or a capability advantage ceded to the adversary]. {company_name}, in partnership with {research_institution}, proposes a jointly executed research effort to close this gap. [1–2 paragraphs.]' },
    }),

    node('s1-2-heading', {
      type: 'heading', content: { level: 2, text: '1.2 Proposed Innovation', numbering: '1.2' },
    }),
    node('s1-2-text', {
      type: 'text_block',
      content: { text: '{company_name} proposes [name the innovation in a single crisp sentence]. The core innovation is [what is genuinely new versus the state of the art — a method, material, algorithm, architecture, or process]. Where current approaches [limitation], our approach [advantage], enabling [quantified benefit]. This concept builds on foundational research at {research_institution} in [research area], transitioning that fundamental science toward a fieldable Department of War capability — the central intent of the STTR program. [2–3 paragraphs. Reviewers score novelty and technical merit heavily; be specific and defensible.]' },
    }),

    node('figure-1', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Solution concept and proposed innovation diagram', width: 400, height: 250, caption: 'Figure 1: [Solution concept / proposed innovation]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s1-3-heading', {
      type: 'heading', content: { level: 2, text: '1.3 Technical Objectives', numbering: '1.3' },
    }),
    node('s1-3-text', {
      type: 'text_block',
      content: { text: 'The Phase I effort will establish the scientific and technical feasibility of the proposed approach through the following specific, measurable objectives. Each objective is testable, maps to a Phase I deliverable, and aligns with the work allocated between {company_name} and {research_institution} in Section 2.' },
    }),
    node('s1-3-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Objective 1 — Establish feasibility of [approach] by demonstrating [metric] ≥ [threshold] under [representative conditions].' },
          { text: 'Objective 2 — Develop and validate a proof-of-concept [model/component] that [capability], led by {research_institution}.' },
          { text: 'Objective 3 — Characterize [key parameter] across [operational envelope] to define the Phase II design space and de-risk transition.' },
        ],
      },
    }),

    node('s1-4-heading', {
      type: 'heading', content: { level: 2, text: '1.4 Technical Approach & Methodology', numbering: '1.4' },
    }),
    node('s1-4-text', {
      type: 'text_block',
      content: { text: '[This is the core of the proposal and the most heavily weighted section. Describe the joint technical approach in detail: the methods, models, algorithms, experiments, and analyses {company_name} and {research_institution} will use to achieve each objective. Identify which tasks are performed by the small business concern and which by the research institution, consistent with the work allocation in Section 2. Present preliminary or prior data, cite the relevant technical literature, and explain why the approach will work and what the principal technical risks are. 3–5 paragraphs with figures and tables as needed.]' },
    }),

    node('figure-2', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Joint technical approach and system architecture', width: 400, height: 250, caption: 'Figure 2: [Joint technical approach / system architecture]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s1-5-heading', {
      type: 'heading', content: { level: 2, text: '1.5 Schedule & Milestones', numbering: '1.5' },
    }),
    node('s1-5-text', {
      type: 'text_block',
      content: { text: '[Provide a task-level schedule for the Phase I period of performance. Each task maps to an objective and identifies the lead performer (SBC or RI). Include go/no-go decision points and the hand-offs between {research_institution} and {company_name}.]' },
    }),
    node('s1-5-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Description', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Lead', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Months', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Deliverable', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['Task 1', '[Requirements & joint research plan]', 'SBC', '1–2', '[Research plan]'],
          ['Task 2', '[Fundamental research & modeling]', 'RI', '1–5', '[Models / data]'],
          ['Task 3', '[Proof-of-concept build & integration]', 'SBC', '3–7', '[Prototype]'],
          ['Task 4', '[Test, validation & feasibility analysis]', 'SBC + RI', '5–8', '[Test report]'],
          ['Task 5', '[Phase II planning & final report]', 'SBC', '7–9', '[Final report]'],
        ],
        column_widths: [55, 185, 70, 55, 135],
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
          ['[SBC/RI coordination risk]', 'Low', 'Medium', '[Integrated schedule, defined hand-offs, shared data repository]'],
        ],
        column_widths: [140, 70, 70, 220],
        border_style: 'single',
      },
    }),

    node('s1-break', { type: 'page_break', content: null }),

    // ─── 2. Research Institution Partnership & Work Allocation (~2.5 pages) ─
    node('s2-heading', {
      type: 'heading', content: { level: 1, text: '2. Research Institution Partnership & Work Allocation', numbering: '2' },
    }),

    node('s2-1-heading', {
      type: 'heading', content: { level: 2, text: '2.1 Research Institution & Rationale', numbering: '2.1' },
    }),
    node('s2-1-text', {
      type: 'text_block',
      content: { text: '{company_name} has partnered with {research_institution} to execute this STTR effort. [Identify the research institution — a U.S. college or university, federally funded R&D center (FFRDC), or qualified nonprofit research institution — and the specific laboratory, center, or department contributing.] {research_institution} brings [the fundamental research capability, unique facilities, instruments, or expertise the small business cannot supply internally], which is essential to [objective]. This partnership transitions cutting-edge fundamental research into a Department of War-relevant prototype — the defining purpose of the STTR program. [1–2 paragraphs.]' },
    }),

    node('s2-2-heading', {
      type: 'heading', content: { level: 2, text: '2.2 Work Allocation (SBC ≥ 40% / RI ≥ 30%)', numbering: '2.2' },
    }),
    node('s2-2-text', {
      type: 'text_block',
      content: { text: 'Under the STTR program and the SBA STTR Policy Directive, the cooperative research and development must be performed jointly by the small business concern (SBC) and a single partnering research institution (RI). {company_name} will perform not less than 40% of the work and {research_institution} not less than 30%, each measured as a percentage of total effort (direct plus indirect cost). The remaining effort — not to exceed 30% — is allocated as shown below. The allocation is enforced in the Cost Volume and holds across any amendment.' },
    }),
    node('s2-2-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Performer', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Role', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Share of Work', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Basis', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['{company_name} (SBC — Prime)', '[Systems integration, prototyping, test, program management]', '≥ 40%', '[Direct + indirect labor + ODC]'],
          ['{research_institution} (RI)', '[Fundamental research, modeling, characterization]', '≥ 30%', '[Direct + indirect labor + ODC]'],
          ['[Consultants / subcontractors]', '[Specialized analysis or components, if any]', '≤ 30%', '[As applicable]'],
          ['Total', '—', '100%', '—'],
        ],
        column_widths: [150, 190, 80, 120],
        border_style: 'single',
      },
    }),

    node('s2-3-heading', {
      type: 'heading', content: { level: 2, text: '2.3 Collaboration & Management Approach', numbering: '2.3' },
    }),
    node('s2-3-text', {
      type: 'text_block',
      content: { text: '[Describe how the joint effort is managed across the two organizations: the integrated master schedule, communication cadence, data-sharing mechanism, and how the Principal Investigator, {pi_name}, coordinates the SBC and RI teams. Identify the single PI responsible for overall technical direction and the RI research lead, and describe how deliverables from {research_institution} feed the SBC integration and test tasks.]' },
    }),

    node('figure-3', {
      type: 'image',
      content: { storage_key: '', alt_text: 'SBC and RI collaboration and data flow diagram', width: 400, height: 240, caption: 'Figure 3: [SBC/RI collaboration & data flow]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s2-4-heading', {
      type: 'heading', content: { level: 2, text: '2.4 Intellectual Property Allocation Agreement', numbering: '2.4' },
    }),
    node('s2-4-text', {
      type: 'text_block',
      content: { text: 'As required by the STTR Policy Directive, {company_name} and {research_institution} have entered into (or will execute prior to award) a written agreement allocating intellectual property rights and the rights to carry out follow-on research, development, and commercialization. [Summarize the allocation: the background IP each party brings and retains, ownership and licensing of IP developed under the project, and the small business\'s rights to commercialize in Phase III.] SBIR/STTR data rights in technical data and computer software generated under this effort are asserted under DFARS 252.227-7018; the Government receives SBIR/STTR data rights for the protection period, after which Government Purpose Rights apply.' },
    }),

    // ─── 3. Key Personnel (~2 pages) ────────────────────────────
    node('s3-heading', {
      type: 'heading', content: { level: 1, text: '3. Key Personnel & Qualifications', numbering: '3' },
    }),

    node('s3-1-heading', {
      type: 'heading', content: { level: 2, text: '3.1 Principal Investigator', numbering: '3.1' },
    }),
    node('s3-1-text', {
      type: 'text_block',
      content: { text: '{pi_name} will serve as Principal Investigator with overall responsibility for technical direction and Government reporting. [Name, title, highest degree, and a brief bio highlighting relevant experience, key publications, and prior SBIR/STTR awards.] Unlike the SBIR program, the STTR program permits the Principal Investigator to be primarily employed by either the small business concern or the research institution; {pi_name} is primarily employed by [the SBC or the RI] and commits [X]% level of effort to this project. [1–2 paragraphs.]' },
    }),

    node('s3-2-heading', {
      type: 'heading', content: { level: 2, text: '3.2 Research Institution Lead & Key Team Members', numbering: '3.2' },
    }),
    node('s3-2-text', {
      type: 'text_block',
      content: { text: '{research_institution} designates [name, title, degree] as its research lead. [For each key team member across both organizations, provide name, title, role, relevant expertise, and % effort — including subcontractor or consultant personnel. Demonstrate that the combined SBC + RI team holds every skill the statement of work requires and that responsibilities align with the work allocation in Section 2.2.]' },
    }),

    node('s3-3-heading', {
      type: 'heading', content: { level: 2, text: '3.3 Organizational Qualifications', numbering: '3.3' },
    }),
    node('s3-3-text', {
      type: 'text_block',
      content: { text: '[Describe {company_name}\'s relevant experience, capabilities, and past performance on similar technical challenges, and {research_institution}\'s standing in the relevant research field. Reference prior SBIR/STTR awards, contracts, publications, or transitions that demonstrate the joint team can execute and commercialize.]' },
    }),

    // ─── 4. Facilities & Equipment (~0.5 pages) ─────────────────
    node('s4-heading', {
      type: 'heading', content: { level: 1, text: '4. Facilities & Equipment', numbering: '4' },
    }),
    node('s4-text', {
      type: 'text_block',
      content: { text: '[Describe the facilities and equipment available at both {company_name} and {research_institution}: laboratory and test space, computing resources, specialized instruments, and prototyping hardware. Clarify which resources reside at the SBC versus the RI and how access is arranged under the cooperative agreement. Note whether facilities are owned, leased, or shared. If Government-furnished equipment or information is requested, specify what and why.]' },
    }),

    // ─── 5. Related Work (~0.5 pages) ───────────────────────────
    node('s5-heading', {
      type: 'heading', content: { level: 1, text: '5. Related Work & Prior Art', numbering: '5' },
    }),
    node('s5-text', {
      type: 'text_block',
      content: { text: '[Describe ongoing or recently completed work related to this proposal at both organizations, including other SBIR/STTR awards, IR&D, and sponsored research. Explain how this effort extends rather than duplicates funded work, and disclose any current or pending support for similar work from any source — for both {company_name} and {research_institution}.]' },
    }),

    // ─── 6. Commercialization Strategy (~2 pages) ────────────────
    node('s6-heading', {
      type: 'heading', content: { level: 1, text: '6. Commercialization Strategy', numbering: '6' },
    }),

    node('s6-1-heading', {
      type: 'heading', content: { level: 2, text: '6.1 Market Opportunity', numbering: '6.1' },
    }),
    node('s6-1-text', {
      type: 'text_block',
      content: { text: '[Describe the total addressable market (TAM) for the proposed technology, spanning Department of War and other Government customers (programs of record, other Services, the IC, and civilian agencies) and adjacent commercial markets. Provide specific dollar estimates and growth projections with sources.]' },
    }),

    node('s6-2-heading', {
      type: 'heading', content: { level: 2, text: '6.2 Transition Plan', numbering: '6.2' },
    }),
    node('s6-2-text', {
      type: 'text_block',
      content: { text: '[Explain the path from Phase I feasibility to a Phase II prototype to Phase III production or fielding. Identify specific Department of War programs of record, prime contractors, or commercial customers who would adopt the technology, and describe the continuing role of {research_institution} in development. Include any Letters of Intent, memoranda of understanding, or existing relationships.]' },
    }),

    node('figure-4', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase I to Phase III transition timeline', width: 400, height: 240, caption: 'Figure 4: [Phase I to II to III transition timeline]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s6-3-heading', {
      type: 'heading', content: { level: 2, text: '6.3 Intellectual Property', numbering: '6.3' },
    }),
    node('s6-3-text', {
      type: 'text_block',
      content: { text: '[Describe the combined IP position of {company_name} and {research_institution}: existing patents and applications, trade secrets, and proprietary methods, plus IP anticipated under this effort and the commercialization plan for it — consistent with the allocation agreement in Section 2.4. SBIR/STTR data rights apply per DFARS 252.227-7018.]' },
    }),

    // ─── 7. TABA Plan (if applicable, ~1 page) ──────────────────
    node('s7-heading', {
      type: 'heading', content: { level: 1, text: '7. TABA Plan', numbering: '7' },
    }),
    node('s7-text', {
      type: 'text_block',
      content: { text: '[If requesting Technical and Business Assistance (TABA), describe the specific assistance needed, the provider, and how it advances the Phase I objectives and commercialization plan. TABA is funded outside the SBC/RI work-split calculation and is typically ~$6,500 for Phase I. Delete this section if not requesting TABA.]' },
    }),
  ],
};
