/**
 * DoD CSO Phase I — Pitch Briefing Template (10 slides)
 *
 * Structured per standard AFWERX/CSO pitch deck requirements.
 * Arial 18pt, 16:9 widescreen. Each slide is a page_break-delimited
 * section with a heading and structured content.
 *
 * CSO briefings are scored on innovation, feasibility, team,
 * commercialization potential, and schedule risk.
 */

import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';

const PRESET: CanvasRules = {
  format: 'slide_16_9',
  width: 960, height: 540,
  margins: { top: 40, right: 40, bottom: 40, left: 40 },
  header: null,
  footer: null,
  font_default: { family: 'Arial', size: 18 },
  line_spacing: 1.2,
  max_pages: null,
  max_slides: 10,
};

function node(id: string, n: Partial<CanvasNode>): CanvasNode {
  return {
    id,
    type: n.type ?? 'text_block',
    content: n.content ?? null,
    style: n.style ?? {},
    provenance: { source: 'template' },
    history: [],
    library_eligible: n.type !== 'page_break' && n.type !== 'spacer',
  };
}

export const DOD_CSO_PHASE1_BRIEFING: CanvasDocument = {
  version: 1,
  document_id: 'template-dod-cso-p1-briefing',
  canvas: PRESET,
  metadata: {
    title: 'DoD CSO Phase I — Pitch Briefing',
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
    // ─── Slide 1: Title ─────────────────────────────────────────
    node('s1-title', {
      type: 'heading',
      content: { level: 1, text: '{topic_title}' },
      style: { alignment: 'center', space_before: 80, size: 28, weight: 'bold' },
    }),
    node('s1-subtitle', {
      type: 'text_block',
      content: { text: 'CSO Phase I Proposal — {topic_number}' },
      style: { alignment: 'center', size: 20 },
    }),
    node('s1-company', {
      type: 'text_block',
      content: { text: '{company_name}' },
      style: { alignment: 'center', size: 22, weight: 'bold', space_before: 40 },
    }),
    node('s1-details', {
      type: 'text_block',
      content: { text: 'PI: {pi_name} | {pi_email}\n{company_city}, {company_state}' },
      style: { alignment: 'center', size: 14, space_before: 16 },
    }),
    node('s1-break', { type: 'page_break', content: null }),

    // ─── Slide 2: Problem / Need ────────────────────────────────
    node('s2-title', {
      type: 'heading',
      content: { level: 1, text: 'Problem / Need Statement' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s2-problem', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[What is the specific DoD/warfighter problem?]' },
          { text: '[Why do current solutions fall short?]' },
          { text: '[What is the operational impact of this gap?]' },
          { text: '[What is the market size / scope of this need?]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s2-note', {
      type: 'text_block',
      content: { text: 'Tip: Lead with the warfighter need, not your technology. Reviewers want to see you understand the problem before the solution.' },
      style: { size: 12, style: 'italic', color: '#888888', space_before: 24 },
    }),
    node('s2-break', { type: 'page_break', content: null }),

    // ─── Slide 3: Proposed Innovation ───────────────────────────
    node('s3-title', {
      type: 'heading',
      content: { level: 1, text: 'Proposed Solution / Innovation' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s3-innovation', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[One sentence: what is your innovation?]' },
          { text: '[How is it different from the state of the art?]' },
          { text: '[What makes it technically novel — not just incremental?]' },
          { text: '[Any preliminary data or proof points?]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s3-note', {
      type: 'text_block',
      content: { text: 'Include a diagram or figure if possible — visual impact scores well in briefings.' },
      style: { size: 12, style: 'italic', color: '#888888', space_before: 24 },
    }),
    node('s3-break', { type: 'page_break', content: null }),

    // ─── Slide 4: Technical Approach ────────────────────────────
    node('s4-title', {
      type: 'heading',
      content: { level: 1, text: 'Technical Approach' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s4-approach', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Key technical methodology / algorithm / process]' },
          { text: '[Architecture or system design overview]' },
          { text: '[Critical technical challenges and how you\'ll address them]' },
          { text: '[TRL start → TRL end for Phase I]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s4-break', { type: 'page_break', content: null }),

    // ─── Slide 5: Team ──────────────────────────────────────────
    node('s5-title', {
      type: 'heading',
      content: { level: 1, text: 'Team Qualifications' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s5-team', {
      type: 'table',
      content: {
        headers: [
          { text: 'Name', style: { bold: true, bg: '#2c3e7a', alignment: 'left' } },
          { text: 'Role', style: { bold: true, bg: '#2c3e7a', alignment: 'left' } },
          { text: 'Key Qualifications', style: { bold: true, bg: '#2c3e7a', alignment: 'left' } },
          { text: '% Effort', style: { bold: true, bg: '#2c3e7a', alignment: 'center' } },
        ],
        rows: [
          ['{pi_name}', 'PI / Tech Lead', '[PhD in X, N years experience, M prior SBIRs]', '50%'],
          ['[Name]', '[Role]', '[Key qualification]', '[%]'],
          ['[Name]', '[Role]', '[Key qualification]', '[%]'],
        ],
        column_widths: [150, 120, 350, 70],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s5-company', {
      type: 'text_block',
      content: { text: '[Company: Founded YYYY, N employees, headquartered in CITY. Relevant capabilities: ...  Prior SBIR/STTR awards: N awards totaling $X.XM from agencies including ...]' },
      style: { size: 14, space_before: 16 },
    }),
    node('s5-break', { type: 'page_break', content: null }),

    // ─── Slide 6: Phase I Objectives ────────────────────────────
    node('s6-title', {
      type: 'heading',
      content: { level: 1, text: 'Phase I Objectives & Milestones' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s6-objectives', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[Objective 1: Demonstrate feasibility of ...]' },
          { text: '[Objective 2: Develop prototype ...]' },
          { text: '[Objective 3: Validate performance against ...]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s6-schedule', {
      type: 'table',
      content: {
        headers: [
          { text: 'Month', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Task', style: { bold: true, bg: '#e8e8e8' } },
          { text: 'Deliverable / Go/No-Go', style: { bold: true, bg: '#e8e8e8' } },
        ],
        rows: [
          ['1-2', '[Design & analysis]', '[Design review]'],
          ['2-4', '[Prototype development]', '[Working prototype]'],
          ['4-6', '[Testing & validation]', '[Test report + final report]'],
        ],
        column_widths: [80, 300, 300],
        border_style: 'single',
      },
      style: { size: 13 },
    }),
    node('s6-break', { type: 'page_break', content: null }),

    // ─── Slide 7: Phase II Vision ───────────────────────────────
    node('s7-title', {
      type: 'heading',
      content: { level: 1, text: 'Phase II Vision' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s7-vision', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Phase II objective: Build and demonstrate a fieldable prototype]' },
          { text: '[Key Phase II milestones and expected TRL progression]' },
          { text: '[Integration pathway — which DoD system/platform will this plug into?]' },
          { text: '[Estimated Phase II cost and duration]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s7-break', { type: 'page_break', content: null }),

    // ─── Slide 8: Commercialization ─────────────────────────────
    node('s8-title', {
      type: 'heading',
      content: { level: 1, text: 'Commercialization Strategy' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s8-market', {
      type: 'bulleted_list',
      content: {
        items: [
          { text: '[Government market: Which programs of record? Which primes?]' },
          { text: '[Commercial market: Adjacent applications? TAM estimate?]' },
          { text: '[IP strategy: Patents, trade secrets, data rights]' },
          { text: '[Revenue model: License, SaaS, hardware sales, service contract?]' },
          { text: '[Customer traction: LOIs, MOUs, pilot programs, conversations?]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s8-break', { type: 'page_break', content: null }),

    // ─── Slide 9: Budget ────────────────────────────────────────
    node('s9-title', {
      type: 'heading',
      content: { level: 1, text: 'Budget Overview' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s9-budget', {
      type: 'table',
      content: {
        headers: [
          { text: 'Category', style: { bold: true, bg: '#2c3e7a' } },
          { text: 'Amount', style: { bold: true, bg: '#2c3e7a', alignment: 'right' } },
          { text: '% of Total', style: { bold: true, bg: '#2c3e7a', alignment: 'right' } },
        ],
        rows: [
          ['Direct Labor', '[$XX,XXX]', '[XX%]'],
          ['Materials & Supplies', '[$X,XXX]', '[X%]'],
          ['Travel', '[$X,XXX]', '[X%]'],
          ['Subcontracts / Consultants', '[$XX,XXX]', '[XX%]'],
          ['Other Direct Costs', '[$X,XXX]', '[X%]'],
          ['Indirect Costs', '[$XX,XXX]', '[XX%]'],
          [{ text: 'Total Proposed Cost', style: { bold: true } }, { text: '[$XXX,XXX]', style: { bold: true, alignment: 'right' } }, { text: '100%', style: { bold: true, alignment: 'right' } }],
        ],
        column_widths: [300, 180, 100],
        border_style: 'single',
      },
      style: { size: 14 },
    }),
    node('s9-pop', {
      type: 'text_block',
      content: { text: 'Period of Performance: {pop_months} months | TABA: {taba_proposed}' },
      style: { size: 14, space_before: 16 },
    }),
    node('s9-break', { type: 'page_break', content: null }),

    // ─── Slide 10: Summary / Questions ──────────────────────────
    node('s10-title', {
      type: 'heading',
      content: { level: 1, text: 'Summary' },
      style: { size: 24, weight: 'bold' },
    }),
    node('s10-summary', {
      type: 'numbered_list',
      content: {
        items: [
          { text: '[The problem: One-sentence statement of the DoD need]' },
          { text: '[Our innovation: One-sentence description of what\'s novel]' },
          { text: '[Phase I: What we\'ll prove in 6 months]' },
          { text: '[The team: Why we\'re the right company to do this]' },
          { text: '[The path: How this becomes a real capability]' },
        ],
      },
      style: { size: 16 },
    }),
    node('s10-contact', {
      type: 'text_block',
      content: { text: '{company_name}\n{pi_name} — {pi_email}\n{company_website}' },
      style: { alignment: 'center', size: 16, weight: 'bold', space_before: 40 },
    }),
  ],
};
