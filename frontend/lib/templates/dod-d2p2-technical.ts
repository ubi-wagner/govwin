/**
 * DoW Direct to Phase II (D2P2) — Technical Volume Template
 *
 * A Direct to Phase II proposal is submitted WITHOUT a preceding Phase I award.
 * Under the Department of War's (DoW/DoD) Direct to Phase II authority, an
 * offeror may compete for a Phase II award only if it can document that the
 * scientific and technical merit and feasibility normally established in a
 * Phase I have ALREADY been demonstrated through prior work (internal R&D,
 * private investment, or other Government funding) independent of any Phase I
 * award under the topic.
 *
 * Because of this, the volume MUST OPEN with an evidence section proving that
 * Phase I-equivalent feasibility is already in hand — this is the single most
 * heavily scrutinized part of a D2P2 evaluation. The remainder mirrors a
 * standard Phase II Technical Volume.
 *
 * Section structure per the DoW D2P2 BAA evaluation criteria:
 *   1. Phase I Feasibility Already Demonstrated — the D2P2 gate (evidence)
 *   2. Phase II Technical Approach — detailed R&D plan
 *   3. Tasks, Milestones, and Schedule
 *   4. Team and Key Personnel
 *   5. Transition and Commercialization (Phase III)
 *   6. Facilities and Equipment
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

export const DOD_D2P2_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-d2p2-technical',
  canvas: PRESET,
  metadata: {
    title: 'DoW Direct to Phase II — Technical Volume',
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
      content: { level: 2, text: 'Direct to Phase II (D2P2) Technical Volume' },
      style: { alignment: 'center', size: 14 },
    }),
    node('cover-company', {
      type: 'text_block',
      content: { text: '{company_name}\n{company_address}\nCAGE: {cage_code}   UEI: {uei}' },
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

    // ─── Section 1: Phase I Feasibility Already Demonstrated ─────
    // The D2P2 gate — must lead the volume. Evaluators decide here whether
    // Phase I-equivalent feasibility has genuinely been established.
    node('s1-heading', {
      type: 'heading',
      content: { level: 1, text: '1. Phase I Feasibility Already Demonstrated' },
    }),
    node('s1-intro', {
      type: 'text_block',
      content: {
        text: 'This proposal is submitted under the Department of War\'s Direct to Phase II (D2P2) authority, which permits a Phase II award without a preceding Phase I award when the offeror documents that the scientific and technical merit and feasibility ordinarily established in a Phase I have already been demonstrated. {company_name} did not receive — and does not require — a Phase I award under Topic {topic_number}; instead, this section presents the prior results that independently establish Phase I-equivalent feasibility for "{topic_title}." [Summarize, in one paragraph, the prior effort and the specific feasibility it demonstrated.]',
      },
    }),
    node('s1-basis', {
      type: 'heading',
      content: { level: 2, text: '1.1 Basis of Feasibility' },
    }),
    node('s1-basis-text', {
      type: 'text_block',
      content: { text: '[State the Phase I-equivalent feasibility question the topic requires an offeror to have answered, then describe the prior work {company_name} performed that answers it. Identify the technology, the maturity reached (e.g., Technology Readiness Level), and the conditions under which it was demonstrated. Be explicit that the work is directly relevant to Topic {topic_number} — evaluators reject D2P2 proposals whose evidence is adjacent but not on-point.]' },
    }),
    node('s1-evidence', {
      type: 'heading',
      content: { level: 2, text: '1.2 Evidence of Feasibility' },
    }),
    node('s1-evidence-text', {
      type: 'text_block',
      content: { text: '[Present concrete, quantitative evidence: test data, prototype performance, modeling and simulation results, peer-reviewed publications, or third-party validation. Reference each figure and table. The evaluation of a D2P2 proposal turns on whether this evidence convincingly establishes feasibility equivalent to a completed Phase I.]' },
    }),
    node('s1-evidence-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Feasibility Objective', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Evidence & Result Achieved', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Maturity (TRL)', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Source of Work', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['[Feasibility claim 1]', '[Quantitative result vs. threshold]', '[TRL x]', '[IR&D / prior contract # / publication]'],
          ['[Feasibility claim 2]', '[Quantitative result vs. threshold]', '[TRL x]', '[IR&D / prior contract # / publication]'],
          ['[Feasibility claim 3]', '[Quantitative result vs. threshold]', '[TRL x]', '[IR&D / prior contract # / publication]'],
        ],
        column_widths: [150, 180, 70, 100],
        border_style: 'single',
      },
    }),
    node('figure-1', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase I-equivalent feasibility evidence', width: 420, height: 260, caption: 'Figure 1: [Phase I-equivalent feasibility evidence]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s1-source', {
      type: 'heading',
      content: { level: 2, text: '1.3 Source of Prior Work and Funding' },
    }),
    node('s1-source-text', {
      type: 'text_block',
      content: { text: '[Identify the funding source(s) for the prior work — internal research and development (IR&D), private investment, or prior Government contracts (with numbers) — and confirm that the feasibility was established independent of any Phase I award under this topic. Disclose current and pending support for related work. This establishes both eligibility for D2P2 and the absence of duplicative funding.]' },
    }),

    // ─── Section 2: Phase II Technical Approach ─────────────────
    node('s2-heading', {
      type: 'heading',
      content: { level: 1, text: '2. Phase II Technical Approach' },
    }),
    node('s2-intro', {
      type: 'text_block',
      content: {
        text: '[Describe the detailed technical approach for the Phase II R&D effort. Explain how it builds directly on the feasibility established in Section 1 and how each technical objective will be met with specific methods, tools, and expected outcomes. This is the most substantive part of the proposal. 3–5 paragraphs minimum.]',
      },
    }),
    node('s2-innovation', {
      type: 'heading',
      content: { level: 2, text: '2.1 Innovation and Technical Merit' },
    }),
    node('s2-innovation-text', {
      type: 'text_block',
      content: { text: '[Describe what is novel about {company_name}\'s approach compared to the state of the art. Explain the specific technical challenges to be overcome and why the solution is a significant advancement. Reference relevant literature and competing approaches.]' },
    }),
    node('s2-methodology', {
      type: 'heading',
      content: { level: 2, text: '2.2 Research Methodology and Objectives' },
    }),
    node('s2-methodology-text', {
      type: 'text_block',
      content: { text: '[List the specific, measurable Phase II technical objectives, then detail the research methodology, experimental design, and analytical approaches used to achieve each: protocols, test conditions, sample sizes, and statistical methods. Explain how each experiment maps to an objective and to a deliverable.]' },
    }),

    // ─── Section 3: Tasks, Milestones, and Schedule ─────────────
    node('figure-2', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase II system architecture diagram', width: 420, height: 260, caption: 'Figure 2: [Phase II system architecture]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s3-heading', {
      type: 'heading',
      content: { level: 1, text: '3. Tasks, Milestones, and Schedule' },
    }),
    node('s3-tasks-text', {
      type: 'text_block',
      content: { text: '[Provide a task-level plan for the Phase II period of performance (typically ~24 months). Each task maps to an objective and a deliverable. Include a Gantt chart or milestone table.]' },
    }),
    node('s3-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Description', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Months', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Deliverable', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['Task 1', '[Detailed design & Phase II planning]', '1–4', '[System design review]'],
          ['Task 2', '[Prototype development]', '3–14', '[Engineering prototype]'],
          ['Task 3', '[Integration & bench test]', '10–18', '[Test readiness review]'],
          ['Task 4', '[Demonstration in a relevant environment]', '16–22', '[Demonstration report]'],
          ['Task 5', '[Transition package & final report]', '20–24', '[Final report / transition plan]'],
        ],
        column_widths: [60, 220, 60, 160],
        border_style: 'single',
      },
    }),
    node('figure-3', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase II schedule and milestone Gantt chart', width: 420, height: 240, caption: 'Figure 3: [Phase II schedule / milestone Gantt]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s3-gonogo', {
      type: 'heading',
      content: { level: 2, text: '3.1 Milestones and Go/No-Go Criteria' },
    }),
    node('s3-gonogo-text', {
      type: 'text_block',
      content: { text: '[Define the Phase II milestones with quantitative go/no-go decision criteria and the success metric for each. Tie each milestone to a deliverable and a decision the Government program office can act on.]' },
    }),
    node('s3-risk', {
      type: 'heading',
      content: { level: 2, text: '3.2 Risk Assessment and Mitigation' },
    }),
    node('s3-risk-table', {
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
          ['[Integration/scale-up risk]', 'Medium', 'Medium', '[Mitigation strategy]'],
          ['[Transition/schedule risk]', 'Low', 'High', '[Mitigation strategy]'],
        ],
        column_widths: [140, 70, 70, 220],
        border_style: 'single',
      },
    }),

    // ─── Section 4: Team and Key Personnel ──────────────────────
    node('s4-heading', {
      type: 'heading',
      content: { level: 1, text: '4. Team and Key Personnel' },
    }),
    node('s4-pi', {
      type: 'heading',
      content: { level: 2, text: '4.1 Principal Investigator' },
    }),
    node('s4-pi-text', {
      type: 'text_block',
      content: { text: '{pi_name} will serve as Principal Investigator with overall responsibility for technical direction and Government reporting. [Name, title, highest degree; relevant experience, publications, and prior SBIR/STTR or R&D awards, especially the work that established the feasibility in Section 1.] The PI must be primarily employed by {company_name} at the time of award and commits [X]% level of effort. 1–2 paragraphs.' },
    }),
    node('s4-team', {
      type: 'heading',
      content: { level: 2, text: '4.2 Key Team Members and Company Qualifications' },
    }),
    node('s4-team-text', {
      type: 'text_block',
      content: { text: '[For each key team member: name, title, role, expertise, and % effort, including subcontractors or consultants. Then describe {company_name}\'s relevant experience, capabilities, and past performance — particularly the prior effort that produced the feasibility evidence — demonstrating the team can execute Phase II and transition the technology.]' },
    }),

    // ─── Section 5: Transition and Commercialization (Phase III) ─
    node('s5-heading', {
      type: 'heading',
      content: { level: 1, text: '5. Transition and Commercialization (Phase III)' },
    }),
    node('s5-intro', {
      type: 'text_block',
      content: {
        text: '[Present the commercialization and transition strategy. Because a D2P2 effort already has demonstrated maturity, evaluators expect a credible, near-term transition path. Address the market, target customers, and the Phase III funding that will carry the technology beyond SBIR/STTR. 2–3 paragraphs.]',
      },
    }),
    node('s5-market', {
      type: 'heading',
      content: { level: 2, text: '5.1 Market Opportunity' },
    }),
    node('s5-market-text', {
      type: 'text_block',
      content: { text: '[Describe the total addressable market (TAM) across Department of War and other Government customers (programs of record, other Services, the IC, civilian agencies) and adjacent commercial markets. Provide specific dollar estimates and growth projections with sources.]' },
    }),
    node('s5-transition', {
      type: 'heading',
      content: { level: 2, text: '5.2 Transition Targets and Customer Pipeline' },
    }),
    node('s5-transition-text', {
      type: 'text_block',
      content: { text: '[Identify the specific Department of War programs of record, prime contractors, or acquisition pathways that will adopt the technology, with evidence of interest: Letters of Intent, MOUs, teaming agreements, matching funds, or program-office engagement. Evaluators weight demonstrated transition commitment heavily for D2P2.]' },
    }),
    node('figure-4', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Transition pathway and customer pipeline', width: 420, height: 240, caption: 'Figure 4: [Transition pathway / customer pipeline]' },
      style: { alignment: 'center', space_before: 12, space_after: 12 },
    }),
    node('s5-phase3', {
      type: 'heading',
      content: { level: 2, text: '5.3 Phase III Path and Intellectual Property' },
    }),
    node('s5-phase3-text', {
      type: 'text_block',
      content: { text: 'Phase III is work that derives from, extends, or completes this effort and is funded by non-SBIR/STTR sources; the Government may award Phase III work (including on a sole-source basis) to {company_name} as the concern that developed the technology, per the SBIR/STTR Policy Directive. [Describe the production/deployment path and the IP position — existing patents and applications, trade secrets, and IP anticipated under this effort. SBIR/STTR data rights apply per DFARS 252.227-7018.]' },
    }),

    // ─── Section 6: Facilities & Equipment ──────────────────────
    node('s6-heading', {
      type: 'heading',
      content: { level: 1, text: '6. Facilities and Equipment' },
    }),
    node('s6-text', {
      type: 'text_block',
      content: {
        text: '[Describe the facilities and equipment available for Phase II: laboratory and test space, computing resources, test equipment, and specialized hardware or software — including any assets used to produce the Section 1 feasibility evidence. Note whether resources are owned, leased, or accessible through partners or subcontractors. If Government-furnished equipment or information is requested, specify what and why.]',
      },
    }),
  ],
};
