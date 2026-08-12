/**
 * DOE STTR Phase I — Technical Narrative Template (20 pages)
 *
 * The STTR variant of the DOE Phase I Technical Narrative. It shares the SBIR
 * spine (Significance → Objectives → Work Plan → Schedule → Related R&D →
 * Personnel → Facilities → Commercialization) but adds the two features that
 * define an STTR:
 *
 *   • A partnering nonprofit RESEARCH INSTITUTION (university or FFRDC) that
 *     performs a substantial share of the work under subaward (Section 7).
 *   • The STTR WORK SPLIT: the small business must perform ≥ 40% of the work
 *     and the single partnering research institution ≥ 30%; the remaining
 *     ≤ 30% may be done by either party or third parties. A negotiated
 *     Allocation of Rights (IP) agreement between the two is required at award.
 *
 * A further STTR distinction: the Principal Investigator may be primarily
 * employed by EITHER the small business OR the research institution — unlike
 * SBIR, where the PI must be primarily employed by the small business.
 *
 * Times New Roman 11pt, 1-inch margins with a running header + page-numbered
 * footer (letter_agency; DOE requires body text no smaller than 11pt); the
 * Technical Narrative is capped at 20 pages.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// DOE prose narrative: 11pt Times New Roman, 1-inch margins, running header +
// page-numbered footer (letter_agency), 20-page cap.
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_agency,
  max_pages: 20,
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

export const DOE_STTR_PHASE1_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-doe-sttr-p1-technical',
  canvas: PRESET,
  metadata: {
    title: 'DOE STTR Phase I — Technical Narrative',
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
    // ─── Cover / Identity Block ─────────────────────────────────
    node('cover-banner', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Company banner', width: 936, height: 90, caption: '' },
      style: { alignment: 'center', space_before: 24, space_after: 12 },
    }),
    node('cover-title', {
      type: 'heading', content: { level: 1, text: '{topic_number}: {topic_title}' },
      style: { alignment: 'center', space_before: 18 },
    }),
    node('cover-subtitle', {
      type: 'text_block', content: { text: 'DOE STTR Phase I — Technical Narrative' },
      style: { alignment: 'center', size: 14 },
    }),
    node('cover-company', {
      type: 'text_block', content: { text: '{company_name}  ×  {research_institution}' },
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
          ['Proposal Title', '{project_title}'],
          ['FOA Number', '{solicitation_number}'],
          ['Sponsoring Program Office', '{doe_program_office}'],
          ['Topic Number', '{topic_number}'],
          ['Subtopic Number', '{subtopic_number}'],
          ['Small Business Concern', '{company_name}'],
          ['Partnering Research Institution', '{research_institution}'],
          ['UEI', '{uei}'],
          ['Principal Investigator', '{pi_name}'],
          ['PI Email', '{pi_email}'],
          ['PI Phone', '{pi_phone}'],
          ['Period of Performance', '{pop_months} months'],
          ['Requested Amount', '${proposed_cost}'],
        ],
        column_widths: [200, 340],
        border_style: 'single',
      },
      style: { space_before: 24 },
    }),
    node('cover-note', {
      type: 'text_block',
      content: { text: 'DOE STTR is a mission grant executed as a formal small-business/research-institution collaboration. Reviewers weigh the scientific/technical approach, the team, and the SIGNIFICANCE of the work to the sponsoring program office — and, uniquely for STTR, the quality of the partnership and compliance with the ≥40% / ≥30% work split. Make the mission relevance and the collaboration both unmistakable.' },
      style: { size: 11, style: 'italic', space_before: 12 },
    }),
    node('cover-break', { type: 'page_break', content: null }),

    // ─── Table of Contents ──────────────────────────────────────
    node('toc', { type: 'toc', content: { max_depth: 2 } }),
    node('toc-break', { type: 'page_break', content: null }),

    // ─── 1. Significance and Background (~3 pages) ──────────────
    node('s1-heading', {
      type: 'heading', content: { level: 1, text: '1. Significance and Background of the Problem or Opportunity', numbering: '1' },
    }),
    node('s1-1-heading', {
      type: 'heading', content: { level: 2, text: '1.1 The Problem and Its Significance to DOE', numbering: '1.1' },
    }),
    node('s1-1-text', {
      type: 'text_block',
      content: { text: '[Open by naming the exact Subtopic {subtopic_number} and the need it calls out, then define the problem or opportunity your project addresses. Explain why it matters to the DOE mission — energy, science, environmental, or national-security impact — and quantify the significance (energy saved, cost reduced, capability enabled, emissions avoided). DOE weights significance heavily; tie every claim back to the Subtopic language. 2–3 paragraphs.]' },
    }),
    node('s1-2-heading', {
      type: 'heading', content: { level: 2, text: '1.2 Background and State of the Art', numbering: '1.2' },
    }),
    node('s1-2-text', {
      type: 'text_block',
      content: { text: '[Summarize the current state of the art and why existing approaches are inadequate for the DOE need. Cite the key technical literature, competing technologies, and any relevant DOE program or national-lab work — including the foundational research at {research_institution} that this collaboration builds upon. Establish the technical gap the innovation closes. 2–3 paragraphs.]' },
    }),
    node('s1-3-heading', {
      type: 'heading', content: { level: 2, text: '1.3 The Proposed Innovation', numbering: '1.3' },
    }),
    node('s1-3-text', {
      type: 'text_block',
      content: { text: '{company_name}, in partnership with {research_institution}, proposes [the innovation in one or two sentences]. [Describe what is novel, the scientific or engineering principle it rests on, and how the small-business/research-institution pairing is uniquely positioned to prove it. State the central feasibility question Phase I will answer. 1–2 paragraphs.]' },
    }),
    node('s1-3-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Proposed innovation and collaboration concept diagram', width: 900, height: 520, caption: 'Figure 1: [Proposed innovation / collaboration concept — the novel mechanism and how the small business and research institution jointly prove it]' },
      style: { space_before: 6, space_after: 6 },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── 2. Phase I Technical Objectives (~2 pages) ─────────────
    node('s2-heading', {
      type: 'heading', content: { level: 1, text: '2. Phase I Technical Objectives', numbering: '2' },
    }),
    node('s2-text', {
      type: 'text_block',
      content: { text: '[State the specific, measurable objectives that establish technical feasibility in Phase I. Each objective should be testable, tied to a quantitative threshold, and aimed at retiring a major technical risk. Note which partner leads each objective so the division of scientific labor is visible from the start.]' },
    }),
    node('s2-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Objective 1 (lead: {company_name}): Demonstrate {approach} achieves {key metric} ≥ {threshold} under {representative conditions}.]' },
          { text: '[Objective 2 (lead: {research_institution}): Characterize/validate {phenomenon or material} against {benchmark} to confirm the scientific basis.]' },
          { text: '[Objective 3 (joint): Integrate the results to model {critical parameter} and establish the Phase II scale-up path.]' },
        ],
      },
    }),

    // ─── 3. Phase I Work Plan (~5 pages) ────────────────────────
    node('s3-heading', {
      type: 'heading', content: { level: 1, text: '3. Phase I Work Plan', numbering: '3' },
    }),
    node('s3-intro', {
      type: 'text_block',
      content: { text: '[The core of the narrative. Present the technical work as numbered tasks that together meet the Phase I objectives. For each task describe the methodology, expected results, the responsible partner and personnel, and the deliverable. Make the collaboration operational — show exactly which tasks the small business performs and which the research institution performs, and how the two hand off. Make go/no-go points explicit. 4–6 paragraphs plus the task list below.]' },
    }),
    node('s3-tasks', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Task 1 — [Design & modeling] (performer: {company_name}): [methodology and expected result]. Deliverable: [design document / model].' },
          { text: 'Task 2 — [Core experiments] (performer: {research_institution}): [methodology and expected result]. Deliverable: [characterization data].' },
          { text: 'Task 3 — [Integration & validation] (joint): [test plan against thresholds]. Deliverable: [test report]. Go/No-Go decision point.' },
          { text: 'Task 4 — [Analysis, reporting & Phase II planning] (performer: {company_name}): [scope]. Deliverable: [final report + Phase II work plan].' },
        ],
      },
    }),
    node('s3-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Technical approach and partner task-flow diagram', width: 900, height: 520, caption: 'Figure 2: [Technical approach & partner task flow — which tasks the small business performs, which the research institution performs, and the hand-offs between them]' },
      style: { space_before: 6, space_after: 6 },
    }),
    node('s3-deliverables-heading', {
      type: 'heading', content: { level: 2, text: '3.1 Deliverables', numbering: '3.1' },
    }),
    node('s3-deliverables-text', {
      type: 'text_block',
      content: { text: '[List the tangible Phase I deliverables — reports, prototypes, datasets, models, or samples — and map each to the task and performing partner that produces it. Include the required DOE Phase I final technical report.]' },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── 4. Performance Schedule (~1 page) ──────────────────────
    node('s4-heading', {
      type: 'heading', content: { level: 1, text: '4. Performance Schedule', numbering: '4' },
    }),
    node('s4-text', {
      type: 'text_block',
      content: { text: '[Provide a task-level schedule for the Phase I period of performance, showing task durations, the responsible partner, milestones, deliverables, and go/no-go decision points.]' },
    }),
    node('s4-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Description', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Performer', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Months', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Milestone / Deliverable', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['Task 1', '[Design & modeling]', 'SBC', '1–2', '[Design document]'],
          ['Task 2', '[Core experiments]', 'RI', '2–5', '[Characterization data]'],
          ['Task 3', '[Integration & validation]', 'Joint', '4–7', '[Test report — Go/No-Go]'],
          ['Task 4', '[Analysis & Phase II plan]', 'SBC', '7–{pop_months}', '[Final technical report]'],
        ],
        column_widths: [50, 165, 65, 55, 145],
        border_style: 'single',
      },
    }),
    node('s4-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Phase I milestone schedule Gantt chart with performers', width: 900, height: 460, caption: 'Figure 3: [Phase I milestone schedule (Gantt) — task bars across the period of performance by performer (SBC / RI / joint), with the go/no-go decision point marked]' },
      style: { space_before: 6, space_after: 6 },
    }),

    // ─── 5. Related Research or R&D (~1 page) ───────────────────
    node('s5-heading', {
      type: 'heading', content: { level: 1, text: '5. Related Research or R&D', numbering: '5' },
    }),
    node('s5-text', {
      type: 'text_block',
      content: { text: '[Describe related R&D — the small business\'s prior/ongoing work, the foundational research at {research_institution} that anchors the partnership, relevant DOE-funded or national-laboratory efforts, and pertinent work elsewhere. Explain how the proposed effort builds on this base without duplicating it, and disclose any current or pending federal support for related work at either partner. 1–2 paragraphs.]' },
    }),

    // ─── 6. PI and Key Personnel Qualifications (~2 pages) ──────
    node('s6-heading', {
      type: 'heading', content: { level: 1, text: '6. Principal Investigator and Key Personnel Qualifications', numbering: '6' },
    }),
    node('s6-1-heading', {
      type: 'heading', content: { level: 2, text: '6.1 Principal Investigator', numbering: '6.1' },
    }),
    node('s6-1-text', {
      type: 'text_block',
      content: { text: '{pi_name}, [title], will serve as Principal Investigator at [{effort}% effort]. [Summarize the relevant degree, technical experience, publications/patents, and prior SBIR/STTR or DOE awards. Under STTR rules the PI may be primarily employed by EITHER {company_name} OR {research_institution} — state which, and confirm the required minimum time commitment. 1–2 paragraphs.]' },
    }),
    node('s6-2-heading', {
      type: 'heading', content: { level: 2, text: '6.2 Research Institution Co-Investigator and Key Personnel', numbering: '6.2' },
    }),
    node('s6-2-text', {
      type: 'text_block',
      content: { text: '{ri_pi_name}, [title] at {research_institution}, will lead the research-institution effort. [Summarize their expertise and the specific scientific capability they bring. Then list the remaining key personnel, consultants, and staff across both partners: name, role, relevant expertise, and share of the work. Show the combined team covers the full scientific and engineering scope of the work plan.]' },
    }),

    // ─── 7. Research Institution Partnership and Work Split ─────
    node('s7-heading', {
      type: 'heading', content: { level: 1, text: '7. Research Institution Partnership and Work Split', numbering: '7' },
    }),
    node('s7-1-heading', {
      type: 'heading', content: { level: 2, text: '7.1 The Partnering Research Institution', numbering: '7.1' },
    }),
    node('s7-1-text', {
      type: 'text_block',
      content: { text: '{research_institution} is the single partnering research institution for this STTR. [Confirm it is a U.S. nonprofit research institution eligible under the STTR program — a college or university, a nonprofit research organization, or a federally funded research and development center (FFRDC). Describe its directly relevant expertise, facilities, and the specific role {ri_pi_name} and the institution play. Explain why this partner, and not the small business alone, is essential to proving feasibility. 1–2 paragraphs.]' },
    }),
    node('s7-2-heading', {
      type: 'heading', content: { level: 2, text: '7.2 Collaboration Plan and Management', numbering: '7.2' },
    }),
    node('s7-2-text', {
      type: 'text_block',
      content: { text: '[Describe how the two organizations will work together: communication cadence, data and sample handoffs between tasks, decision authority, and how the PI coordinates across both sites. A clear, credible management plan for the collaboration is part of what DOE evaluates in an STTR. 1–2 paragraphs.]' },
    }),
    node('s7-3-heading', {
      type: 'heading', content: { level: 2, text: '7.3 STTR Work Split', numbering: '7.3' },
    }),
    node('s7-3-text', {
      type: 'text_block',
      content: { text: 'The proposed effort satisfies the STTR work-split requirement: the small business performs at least 40% of the work and the partnering research institution at least 30%, measured as a percentage of the total Phase I effort. The remaining share may be performed by either party or by third parties. [Fill the table with your actual percentages and confirm they meet the minimums.]' },
    }),
    node('s7-3-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Performing Entity', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Scope of Work', style: { bold: true, bg: '#e8e8e8' } },
          { text: '% of Total Effort', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'STTR Minimum', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['{company_name} (Small Business Concern)', '[Prime — Tasks 1, 3, 4]', '[≥40]%', '≥ 40%'],
          ['{research_institution} (Research Institution)', '[Subaward — Tasks 2, 3]', '[≥30]%', '≥ 30%'],
          ['Other (consultants / third parties)', '[if any]', '[≤30]%', '≤ 30%'],
          [{ text: 'Total', style: { bold: true } }, { text: '', style: { bold: true } }, { text: '100%', style: { bold: true } }, ''],
        ],
        column_widths: [190, 170, 90, 90],
        border_style: 'single',
      },
    }),
    node('s7-4-heading', {
      type: 'heading', content: { level: 2, text: '7.4 Subaward Structure and Allocation of Rights (IP)', numbering: '7.4' },
    }),
    node('s7-4-text', {
      type: 'text_block',
      content: { text: '[Describe the subaward from {company_name} (the prime) to {research_institution}, and summarize the negotiated Allocation of Rights / intellectual-property agreement between the two parties — how background IP is licensed, how project IP (subject inventions) is owned and licensed, and how commercialization rights flow to the small business. STTR requires the two parties to execute a written Allocation of Rights agreement; note its status and that it will be in place at award. Do not include the full agreement here. 1–2 paragraphs.]' },
    }),
    node('s7-break', { type: 'page_break', content: null }),

    // ─── 8. Facilities and Equipment (~1 page) ──────────────────
    node('s8-heading', {
      type: 'heading', content: { level: 1, text: '8. Facilities and Equipment', numbering: '8' },
    }),
    node('s8-text', {
      type: 'text_block',
      content: { text: '[Describe the facilities, laboratory space, computing resources, and specialized equipment at BOTH partners — the small business and {research_institution} — noting what is owned, leased, or accessed through the subaward or a DOE user facility. Confirm the combined resources cover everything the work plan requires. If a DOE national-laboratory user facility is involved, describe the arrangement and any executed agreement.]' },
    }),

    // ─── 9. Commercialization and Impact (~2 pages) ─────────────
    node('s9-heading', {
      type: 'heading', content: { level: 1, text: '9. Commercialization and Impact', numbering: '9' },
    }),
    node('s9-1-heading', {
      type: 'heading', content: { level: 2, text: '9.1 Market Opportunity and Customers', numbering: '9.1' },
    }),
    node('s9-1-text', {
      type: 'text_block',
      content: { text: '[Describe the commercial opportunity if Phase I and II succeed: the target market and its size (with sources), the specific customers, and the value proposition. Identify both the commercial market and any DOE/federal adoption path. The small business holds the lead commercialization role; make that explicit. 1–2 paragraphs.]' },
    }),
    node('s9-1-figure', {
      type: 'image',
      content: { storage_key: '', alt_text: 'Market opportunity and energy impact chart', width: 900, height: 500, caption: 'Figure 4: [Market opportunity & energy impact — TAM / SAM / SOM with sources, or the projected energy/cost impact at scale]' },
      style: { space_before: 6, space_after: 6 },
    }),
    node('s9-2-heading', {
      type: 'heading', content: { level: 2, text: '9.2 Path to Market and Economic/Energy Impact', numbering: '9.2' },
    }),
    node('s9-2-text', {
      type: 'text_block',
      content: { text: '[Lay out the path from Phase I feasibility to Phase II prototype to Phase III commercialization, including how project IP licensed from {research_institution} under the Allocation of Rights agreement is carried to market by {company_name}, the follow-on funding, and the commercialization partners. Quantify the ultimate DOE-mission impact — energy savings, emissions avoided, cost reductions, or new capability — that success would deliver, tying the return back to the significance argued in Section 1.]' },
    }),
  ],
};
