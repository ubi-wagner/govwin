/**
 * DOE SBIR Phase I — Technical Narrative Template (20 pages)
 *
 * Structured per the DOE Office of Science SBIR/STTR Phase I Funding Opportunity
 * Announcement. The Technical Narrative (a.k.a. Project Narrative / Volume) is
 * capped at 20 pages. Times New Roman 12pt, 1-inch margins (DOE requires body
 * text no smaller than 11pt). DOE SBIR is a GRANT, awarded against a specific
 * Topic and Subtopic drawn from a sponsoring DOE program office, and is scored
 * heavily on the SIGNIFICANCE of the work to the DOE mission.
 *
 * Required section order follows the FOA's Technical Narrative outline:
 *   1. Significance and Background of the Problem or Opportunity
 *   2. Phase I Technical Objectives
 *   3. Phase I Work Plan (tasks, deliverables, milestones)
 *   4. Performance Schedule
 *   5. Related Research or R&D
 *   6. Principal Investigator and Key Personnel Qualifications
 *   7. Facilities and Equipment
 *   8. Commercialization and Impact
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// DOE prose narrative: 12pt Times New Roman, 1-inch margins, 20-page cap.
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_standard,
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

export const DOE_SBIR_PHASE1_TECHNICAL: CanvasDocument = {
  version: 1,
  document_id: 'template-doe-sbir-p1-technical',
  canvas: PRESET,
  metadata: {
    title: 'DOE SBIR Phase I — Technical Narrative',
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
    node('cover-title', {
      type: 'heading', content: { level: 1, text: '{topic_number}: {topic_title}' },
      style: { alignment: 'center', space_before: 120 },
    }),
    node('cover-subtitle', {
      type: 'text_block', content: { text: 'DOE SBIR Phase I — Technical Narrative' },
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
          ['FOA Number', '{solicitation_number}'],
          ['Sponsoring Program Office', '{doe_program_office}'],
          ['Topic Number', '{topic_number}'],
          ['Subtopic Number', '{subtopic_number}'],
          ['Company', '{company_name}'],
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
      content: { text: 'DOE SBIR is a mission grant. Reviewers weigh the strength of the scientific/technical approach, the qualifications of the team, and — distinctively for DOE — the SIGNIFICANCE of the work to the sponsoring program office\'s mission and to the responsive Subtopic. Tie the narrative to the exact Subtopic language and the specific DOE need it serves.' },
      style: { size: 10, style: 'italic', space_before: 12 },
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
      content: { text: '[Open by naming the exact Subtopic {subtopic_number} and the specific need it calls out, then define the problem or opportunity your project addresses. Explain why it matters to the DOE mission — energy, science, environmental, or national-security impact — and quantify the significance (energy saved, cost reduced, capability enabled, emissions avoided). DOE weights significance heavily, so make the mission relevance unmistakable and tie every claim back to the Subtopic language. 2–3 paragraphs.]' },
    }),
    node('s1-2-heading', {
      type: 'heading', content: { level: 2, text: '1.2 Background and State of the Art', numbering: '1.2' },
    }),
    node('s1-2-text', {
      type: 'text_block',
      content: { text: '[Summarize the current state of the art and why existing approaches are inadequate for the DOE need. Cite the key technical literature, competing technologies, and any relevant DOE program or national-lab work. Establish the technical gap your innovation closes, and distinguish clearly between what is already known and the unknowns this project will resolve. 2–3 paragraphs.]' },
    }),
    node('s1-3-heading', {
      type: 'heading', content: { level: 2, text: '1.3 The Proposed Innovation', numbering: '1.3' },
    }),
    node('s1-3-text', {
      type: 'text_block',
      content: { text: '{company_name} proposes [the innovation in one or two sentences]. [Describe what is novel about the approach, the scientific or engineering principle it rests on, and why it can meet the DOE need where incumbents cannot. State the central feasibility question Phase I will answer. 1–2 paragraphs.]' },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── 2. Phase I Technical Objectives (~2 pages) ─────────────
    node('s2-heading', {
      type: 'heading', content: { level: 1, text: '2. Phase I Technical Objectives', numbering: '2' },
    }),
    node('s2-text', {
      type: 'text_block',
      content: { text: '[State the specific, measurable objectives that establish technical feasibility in Phase I. Each objective should be testable, tied to a quantitative threshold, and aimed at retiring a major technical risk rather than building a finished product. Phase I proves the concept; Phase II builds it.]' },
    }),
    node('s2-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Objective 1: Demonstrate {approach} achieves {key metric} ≥ {threshold} under {representative DOE-relevant conditions}.]' },
          { text: '[Objective 2: Fabricate and characterize {component/material} to validate {performance parameter} against {benchmark}.]' },
          { text: '[Objective 3: Model and bound {critical parameter} across {operating range} to establish the Phase II scale-up path.]' },
        ],
      },
    }),

    // ─── 3. Phase I Work Plan (~5 pages) ────────────────────────
    node('s3-heading', {
      type: 'heading', content: { level: 1, text: '3. Phase I Work Plan', numbering: '3' },
    }),
    node('s3-intro', {
      type: 'text_block',
      content: { text: '[This is the core of the narrative. Present the detailed technical work as a set of numbered tasks that, together, meet the Phase I objectives. For each task describe the methodology, experimental or computational approach, expected results, the responsible personnel, and the deliverable it produces. Justify design choices, reference preliminary data where available, and make go/no-go decision points explicit. 4–6 paragraphs plus the task list below.]' },
    }),
    node('s3-tasks', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Task 1 — [Design & modeling]: [methodology and expected result]. Deliverable: [design document / model]. Personnel: [PI/role].' },
          { text: 'Task 2 — [Fabrication / implementation]: [methodology and expected result]. Deliverable: [prototype / dataset]. Personnel: [role].' },
          { text: 'Task 3 — [Experimental validation]: [test plan against thresholds]. Deliverable: [test report]. Go/No-Go decision point.' },
          { text: 'Task 4 — [Analysis, reporting & Phase II planning]: [scope]. Deliverable: [final report + Phase II work plan].' },
        ],
      },
    }),
    node('s3-deliverables-heading', {
      type: 'heading', content: { level: 2, text: '3.1 Deliverables', numbering: '3.1' },
    }),
    node('s3-deliverables-text', {
      type: 'text_block',
      content: { text: '[List the tangible Phase I deliverables — reports, prototypes, datasets, models, or samples — and map each to the task that produces it. Include the required DOE Phase I final technical report.]' },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── 4. Performance Schedule (~1 page) ──────────────────────
    node('s4-heading', {
      type: 'heading', content: { level: 1, text: '4. Performance Schedule', numbering: '4' },
    }),
    node('s4-text', {
      type: 'text_block',
      content: { text: '[Provide a task-level schedule for the Phase I period of performance, showing task durations, milestones, deliverables, and go/no-go decision points against the project timeline.]' },
    }),
    node('s4-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Description', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Months', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Milestone / Deliverable', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['Task 1', '[Design & modeling]', '1–2', '[Design document]'],
          ['Task 2', '[Fabrication / implementation]', '2–5', '[Prototype / dataset]'],
          ['Task 3', '[Experimental validation]', '4–7', '[Test report — Go/No-Go]'],
          ['Task 4', '[Analysis, reporting & Phase II plan]', '7–{pop_months}', '[Final technical report]'],
        ],
        column_widths: [55, 205, 60, 160],
        border_style: 'single',
      },
    }),

    // ─── 5. Related Research or R&D (~1 page) ───────────────────
    node('s5-heading', {
      type: 'heading', content: { level: 1, text: '5. Related Research or R&D', numbering: '5' },
    }),
    node('s5-text', {
      type: 'text_block',
      content: { text: '[Describe research and development related to this proposal — your own prior/ongoing work, relevant DOE-funded or national-laboratory efforts, and pertinent work elsewhere in the field. Explain how the proposed effort builds on this base without duplicating it. Disclose any current or pending federal support for related work, and confirm this project is not duplicative of a prior or concurrent award. 1–2 paragraphs.]' },
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
      content: { text: '{pi_name}, [title], will serve as Principal Investigator at [{effort}% effort]. [Summarize the relevant degree, technical experience, publications/patents, and prior SBIR/STTR or DOE awards. For a DOE SBIR, the PI must have their primary employment with the small business at the time of award and throughout the project. 1–2 paragraphs.]' },
    }),
    node('s6-2-heading', {
      type: 'heading', content: { level: 2, text: '6.2 Key Personnel, Consultants, and Subcontractors', numbering: '6.2' },
    }),
    node('s6-2-text', {
      type: 'text_block',
      content: { text: '[For each key team member, consultant, and subcontractor: name, role, relevant expertise, and share of the work. Show the team collectively covers the science and engineering the work plan demands. For an SBIR, the small business must perform at least two-thirds (~67%) of the Phase I work; identify any subcontractors and confirm the work split stays within that limit.]' },
    }),

    // ─── 7. Facilities and Equipment (~1 page) ──────────────────
    node('s7-heading', {
      type: 'heading', content: { level: 1, text: '7. Facilities and Equipment', numbering: '7' },
    }),
    node('s7-text', {
      type: 'text_block',
      content: { text: '[Describe the facilities, laboratory space, computing resources, and specialized equipment available for the project — owned, leased, or accessed through a subcontractor or a DOE user facility. Confirm you have or can obtain everything the work plan requires. If you plan to use a DOE national-laboratory user facility, describe the arrangement and any executed agreement.]' },
    }),

    // ─── 8. Commercialization and Impact (~2 pages) ─────────────
    node('s8-heading', {
      type: 'heading', content: { level: 1, text: '8. Commercialization and Impact', numbering: '8' },
    }),
    node('s8-1-heading', {
      type: 'heading', content: { level: 2, text: '8.1 Market Opportunity and Customers', numbering: '8.1' },
    }),
    node('s8-1-text', {
      type: 'text_block',
      content: { text: '[Describe the commercial opportunity if Phase I and II succeed: the target market and its size (with sources), the specific customers, and the value proposition. Identify both the commercial market and any DOE/federal adoption path. 1–2 paragraphs.]' },
    }),
    node('s8-2-heading', {
      type: 'heading', content: { level: 2, text: '8.2 Path to Market and Economic/Energy Impact', numbering: '8.2' },
    }),
    node('s8-2-text', {
      type: 'text_block',
      content: { text: '[Lay out the path from Phase I feasibility to Phase II prototype to Phase III commercialization, including the partners, follow-on funding, and IP strategy that carry it there. Quantify the ultimate DOE-mission impact — energy savings, emissions avoided, cost reductions, or new capability — that success would deliver. This ties the commercial return back to the significance argued in Section 1.]' },
    }),
  ],
};
