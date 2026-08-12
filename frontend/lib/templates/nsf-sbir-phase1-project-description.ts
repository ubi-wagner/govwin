/**
 * NSF SBIR/STTR Phase I — Project Description Template (15 pages)
 *
 * Structured per the NSF SBIR/STTR Phase I Program Solicitation. Times New
 * Roman 12pt, 1-inch margins (NSF PAPPG requires body font no smaller than
 * 11pt). The Project Description is capped at 15 pages including all figures,
 * tables, and references.
 *
 * NSF scores every proposal on its two statutory merit-review criteria:
 *   Intellectual Merit  — is the innovation sound, non-incremental, and does
 *                         the R&D advance knowledge? (The Innovation + R&D Plan)
 *   Broader Impacts     — societal benefit beyond the direct commercial return.
 *
 * Section order mirrors the solicitation's required Project Description outline:
 *   1. The Innovation
 *   2. The Technical Objectives and Challenges
 *   3. The R&D Plan
 *   4. The Team and Facilities
 *   5. The Commercial Opportunity
 *   6. Broader/Societal Impacts
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

// NSF prose narrative: 12pt Times New Roman, 1-inch margins, 15-page cap.
// (letter_standard, with the solicitation's 15-page Project Description limit.)
const PRESET: CanvasRules = {
  ...CANVAS_PRESETS.letter_standard,
  max_pages: 15,
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

export const NSF_SBIR_PHASE1_PROJECT_DESCRIPTION: CanvasDocument = {
  version: 1,
  document_id: 'template-nsf-sbir-p1-project-description',
  canvas: PRESET,
  metadata: {
    title: 'NSF SBIR/STTR Phase I — Project Description',
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
      type: 'heading', content: { level: 1, text: '{project_title}' },
      style: { alignment: 'center', space_before: 120 },
    }),
    node('cover-subtitle', {
      type: 'text_block', content: { text: 'NSF SBIR/STTR Phase I — Project Description' },
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
          ['NSF Topic Area', '{topic_area}'],
          ['Project Pitch ID', '{project_pitch_id}'],
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
      content: { text: 'NSF review is organized around two criteria — Intellectual Merit and Broader Impacts. Sections 1–3 carry the Intellectual Merit case (a non-incremental innovation on a sound technical foundation with a credible, high-risk R&D plan); Section 5 carries the commercial case; Section 6 addresses Broader Impacts. Address every criterion explicitly — reviewers score against them by name.' },
      style: { size: 10, style: 'italic', space_before: 12 },
    }),
    node('cover-break', { type: 'page_break', content: null }),

    // ─── Table of Contents ──────────────────────────────────────
    node('toc', { type: 'toc', content: { max_depth: 2 } }),
    node('toc-break', { type: 'page_break', content: null }),

    // ─── 1. The Innovation (~3 pages) ───────────────────────────
    node('s1-heading', {
      type: 'heading', content: { level: 1, text: '1. The Innovation', numbering: '1' },
    }),

    node('s1-1-heading', {
      type: 'heading', content: { level: 2, text: '1.1 The Opportunity', numbering: '1.1' },
    }),
    node('s1-1-text', {
      type: 'text_block',
      content: { text: '{company_name} is developing [one-sentence description of the product or platform] to solve [the specific, well-defined problem]. Today, [describe how the problem is handled by the state of the art and why that approach falls short — quantify the gap: cost, time, accuracy, energy, safety, or scale]. [Explain who feels this pain and why it matters now — a market shift, a regulatory driver, or a newly enabling technology. 1–2 paragraphs. Reviewers must finish this subsection understanding exactly what is broken and why it is worth NSF funding.]' },
    }),

    node('s1-2-heading', {
      type: 'heading', content: { level: 2, text: '1.2 The Proposed Innovation', numbering: '1.2' },
    }),
    node('s1-2-text', {
      type: 'text_block',
      content: { text: '[This subsection makes the Intellectual Merit case. Describe the core technical innovation — the specific scientific or engineering advance that makes your solution possible. Be concrete about the mechanism: what is novel, why it has not been done before, and what fundamental insight or new capability it rests on. NSF funds non-incremental, high-technical-risk innovation, so distinguish sharply between what is already known/de-risked and the genuine unknowns this project will resolve. State the central technical hypothesis you will test in Phase I. 2–3 paragraphs.]' },
    }),

    node('s1-3-heading', {
      type: 'heading', content: { level: 2, text: '1.3 Competitive Advantage and State of the Art', numbering: '1.3' },
    }),
    node('s1-3-text', {
      type: 'text_block',
      content: { text: '[Position the innovation against the current state of the art and the nearest competing approaches (academic, commercial, and incumbent workarounds). Explain what durable, defensible advantage the innovation creates — a performance step-change, a cost structure competitors cannot match, protectable IP, or data/network effects. Cite the key technical literature and name specific alternatives. Reviewers penalize innovations that are merely incremental improvements on existing products. 1–2 paragraphs.]' },
    }),

    node('s1-break', { type: 'page_break', content: null }),

    // ─── 2. Technical Objectives and Challenges (~2 pages) ──────
    node('s2-heading', {
      type: 'heading', content: { level: 1, text: '2. The Technical Objectives and Challenges', numbering: '2' },
    }),

    node('s2-1-heading', {
      type: 'heading', content: { level: 2, text: '2.1 Phase I Technical Objectives', numbering: '2.1' },
    }),
    node('s2-1-text', {
      type: 'text_block',
      content: { text: '[State the specific, measurable objectives that define success for this Phase I effort. Each objective should be a testable proof point tied to the central technical hypothesis, with a quantitative threshold that a reviewer could check. Phase I is about establishing technical feasibility — objectives should retire the biggest risks, not build a finished product.]' },
    }),
    node('s2-1-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Objective 1: Demonstrate that {approach} achieves {key metric} ≥ {threshold} under {representative conditions}.]' },
          { text: '[Objective 2: Validate {component/model} against {benchmark or ground truth}, achieving {error/accuracy target}.]' },
          { text: '[Objective 3: Characterize {critical parameter} across {operating range} to establish the feasible design space and scale-up path.]' },
        ],
      },
    }),

    node('s2-2-heading', {
      type: 'heading', content: { level: 2, text: '2.2 Key Technical Challenges and Risks', numbering: '2.2' },
    }),
    node('s2-2-text', {
      type: 'text_block',
      content: { text: '[Name the hardest technical challenges standing between the current state and the objectives — the reasons this is genuinely high-risk R&D and not routine development. For each, explain why it is difficult, what could go wrong, and how the Phase I plan directly attacks it. NSF rewards a clear-eyed account of risk far more than a claim that success is assured. 2–4 paragraphs, or a risk table if clearer.]' },
    }),
    node('s2-2-risk-table', {
      type: 'table',
      content: {
        headers: [
          { text: 'Technical Risk', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Why It Is Hard', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Phase I Mitigation', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['[Risk 1 — the central feasibility unknown]', '[What is unproven]', '[Task/experiment that retires it]'],
          ['[Risk 2 — a key performance target]', '[Physical or algorithmic limit]', '[Fallback approach if primary stalls]'],
          ['[Risk 3 — integration or scale]', '[Interaction/scale-up unknown]', '[Test that bounds the risk]'],
        ],
        column_widths: [180, 180, 180],
        border_style: 'single',
      },
    }),

    node('s2-break', { type: 'page_break', content: null }),

    // ─── 3. The R&D Plan (~4 pages) ─────────────────────────────
    node('s3-heading', {
      type: 'heading', content: { level: 1, text: '3. The R&D Plan', numbering: '3' },
    }),

    node('s3-1-heading', {
      type: 'heading', content: { level: 2, text: '3.1 Technical Approach', numbering: '3.1' },
    }),
    node('s3-1-text', {
      type: 'text_block',
      content: { text: '[This is the heart of the Intellectual Merit case and typically the longest subsection. Describe in detail the methods, models, experimental design, and analysis you will use to meet each objective. Ground the approach in the underlying science and justify design choices against alternatives you considered and rejected. Include any preliminary data or proof-of-concept results — they materially strengthen a Phase I proposal. Reference figures and prior literature. 3–5 paragraphs.]' },
    }),

    node('s3-2-heading', {
      type: 'heading', content: { level: 2, text: '3.2 Tasks and Methodology', numbering: '3.2' },
    }),
    node('s3-2-text', {
      type: 'text_block',
      content: { text: '[Break the work into a numbered task plan. Each task should map to one or more technical objectives, name the responsible personnel, and produce a concrete deliverable or decision. Make the go/no-go logic explicit so reviewers see how feasibility is proven step by step.]' },
    }),
    node('s3-2-tasks', {
      type: 'numbered_list',
      content: {
        items: [
          { text: 'Task 1 — [Modeling / design]: [scope]. Deliverable: [design spec, model, or analysis]. Retires Objective 1.' },
          { text: 'Task 2 — [Build / implement]: [scope]. Deliverable: [prototype, dataset, or software]. Retires Objective 2.' },
          { text: 'Task 3 — [Test / validate]: [scope]. Deliverable: [test report vs. thresholds]. Go/No-Go decision point.' },
          { text: 'Task 4 — [Analyze & plan Phase II]: [scope]. Deliverable: [feasibility summary + Phase II R&D plan].' },
        ],
      },
    }),

    node('s3-3-heading', {
      type: 'heading', content: { level: 2, text: '3.3 Milestones and Success Metrics', numbering: '3.3' },
    }),
    node('s3-3-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Milestone / Deliverable', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Quantitative Success Metric', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Months', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['Task 1', '[Design / model complete]', '[e.g., predicted {metric} ≥ {target}]', '1–2'],
          ['Task 2', '[Prototype / dataset built]', '[e.g., {component} operational]', '2–5'],
          ['Task 3', '[Validation report]', '[e.g., measured {metric} ≥ {threshold}]', '4–7'],
          ['Task 4', '[Feasibility summary + Phase II plan]', '[Go/No-Go criteria met]', '7–{pop_months}'],
        ],
        column_widths: [55, 175, 195, 55],
        border_style: 'single',
      },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── 4. The Team and Facilities (~2 pages) ──────────────────
    node('s4-heading', {
      type: 'heading', content: { level: 1, text: '4. The Team and Facilities', numbering: '4' },
    }),

    node('s4-1-heading', {
      type: 'heading', content: { level: 2, text: '4.1 Principal Investigator', numbering: '4.1' },
    }),
    node('s4-1-text', {
      type: 'text_block',
      content: { text: '{pi_name}, [title], will serve as Principal Investigator at [{effort}% effort]. [Summarize the degree, the directly relevant technical experience, key publications or patents, and any prior SBIR/STTR or federal R&D awards. For an NSF SBIR (not STTR), the PI must have their primary employment — more than one-half time — with the small business at the time of award and for the duration of the project. 1–2 paragraphs.]' },
    }),

    node('s4-2-heading', {
      type: 'heading', content: { level: 2, text: '4.2 Team, Advisors, and Consultants', numbering: '4.2' },
    }),
    node('s4-2-text', {
      type: 'text_block',
      content: { text: '[For each key team member, consultant, and technical/commercial advisor: name, role, and the specific expertise they bring to the objectives. Show that the team collectively covers the science, the engineering, and the path to market. Note any subawards or consultants and what portion of the work they perform. Demonstrate the team can actually execute this plan.]' },
    }),

    node('s4-3-heading', {
      type: 'heading', content: { level: 2, text: '4.3 Facilities and Equipment', numbering: '4.3' },
    }),
    node('s4-3-text', {
      type: 'text_block',
      content: { text: '[Describe the facilities, laboratory space, computing resources, and specialized equipment available for the project, whether owned, leased, or accessed through a subawardee or facility-use agreement. Confirm you have — or have a concrete plan to obtain — everything the R&D plan requires. Note any unique instrumentation that de-risks the work.]' },
    }),

    // ─── 5. The Commercial Opportunity (~2.5 pages) ─────────────
    node('s5-heading', {
      type: 'heading', content: { level: 1, text: '5. The Commercial Opportunity', numbering: '5' },
    }),

    node('s5-1-heading', {
      type: 'heading', content: { level: 2, text: '5.1 Market and Customer', numbering: '5.1' },
    }),
    node('s5-1-text', {
      type: 'text_block',
      content: { text: '[Define the customer and the market. Identify the specific first customer segment (not just an industry), the total addressable and serviceable markets with cited sources, and the concrete pain your customer will pay to remove. Summarize any customer discovery you have done — interviews, letters of support, pilots, or NSF I-Corps participation carry real weight here. Quantify the value proposition (dollars saved, revenue enabled, risk reduced). 2–3 paragraphs.]' },
    }),

    node('s5-2-heading', {
      type: 'heading', content: { level: 2, text: '5.2 Business Model and Competition', numbering: '5.2' },
    }),
    node('s5-2-text', {
      type: 'text_block',
      content: { text: '[Explain how the company makes money — pricing, sales motion, and unit economics — and why customers will switch to you. Map the competitive landscape (incumbents, startups, and the status quo) and state your durable advantage and IP strategy. Be candid about barriers to adoption (regulatory, procurement, switching costs) and how you will overcome them.]' },
    }),

    node('s5-3-heading', {
      type: 'heading', content: { level: 2, text: '5.3 Path to Commercialization', numbering: '5.3' },
    }),
    node('s5-3-text', {
      type: 'text_block',
      content: { text: '[Lay out the path from a successful Phase I feasibility result, through the Phase II R&D and prototype, to first revenue and scale. Identify the funding and partnerships (customers, strategics, follow-on capital) that carry the technology to market, and the key milestones along the way. NSF looks for a credible, specific commercialization trajectory — not a generic hockey-stick.]' },
    }),

    // ─── 6. Broader / Societal Impacts (~1 page) ────────────────
    node('s6-heading', {
      type: 'heading', content: { level: 1, text: '6. Broader/Societal Impacts', numbering: '6' },
    }),
    node('s6-text', {
      type: 'text_block',
      content: { text: '[Address NSF\'s Broader Impacts criterion directly: the societal benefits that would flow from success beyond the direct commercial return. Draw on the outcomes NSF values — strengthened U.S. economic competitiveness and manufacturing; a more capable and inclusive STEM workforce; broadened participation of underrepresented groups; improved public health, safety, or education; environmental sustainability; or enhanced national security. Be specific and credible about the mechanism and scale of the benefit, and tie it to this project rather than to the field in general. 1–2 paragraphs.]' },
    }),

    // ─── References ─────────────────────────────────────────────
    node('refs-heading', {
      type: 'heading', content: { level: 1, text: '7. References Cited', numbering: '7' },
    }),
    node('refs-text', {
      type: 'text_block',
      content: { text: '[List the technical references cited throughout the Project Description. NSF counts references toward the 15-page Project Description limit (unlike some agencies), so cite selectively and keep the list to the works that substantiate the innovation and approach.]' },
    }),
  ],
};
