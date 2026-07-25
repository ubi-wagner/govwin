/**
 * The dogfooded STARTER SET (docs/LIBRARY_VAULTS_BUILD_PLAN.md P4) — the generic +
 * proposal-vehicle foundation artifacts we author once and seed into the house
 * library under `system_starter`, so every tenant can copy-on-use them and the
 * agents have a reference scaffold to match uploads against.
 *
 * Each StarterDef is pure data: a taxonomy (kind × form × context [× vehicle]) plus
 * a build() that returns a CanvasDocument. The section titles ARE the reusable
 * scaffold — decomposeAndIngest turns them into section grains (bodies are
 * placeholder guidance, marked non-eligible, so a template is pure structure).
 */
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode, type CanvasSection } from '@/lib/types/canvas-document';
import { sectionsToCanvasDoc, tableToCanvasSheet, type ArtifactForm, type Section } from '@/lib/library/artifact-canvas';

export interface StarterDef {
  slug: string;
  title: string;
  form: ArtifactForm;
  kind: 'template' | 'document';
  context: string;
  vehicle?: string;               // DoD/DoW vehicle slug (proposal starters)
  build: () => CanvasDocument;
}

const scaffoldNode = (type: CanvasNode['type'], content: unknown): CanvasNode => ({
  id: crypto.randomUUID(), type, content: content as CanvasNode['content'],
  style: {} as CanvasNode['style'], provenance: { source: 'template' }, history: [], library_eligible: false,
});

/** A deck (ppt) foundation — one section per slide (heading + optional bullets). */
export function deckToCanvasDoc(title: string, slides: Array<{ title: string; bullets?: string[] }>): CanvasDocument {
  const sections: CanvasSection[] = slides.map((s, i) => {
    const nodes: CanvasNode[] = [scaffoldNode('heading', { level: i === 0 ? 1 : 2, text: s.title })];
    if (s.bullets?.length) nodes.push(scaffoldNode('bulleted_list', { items: s.bullets.map((t) => ({ text: t })) }));
    return { id: crypto.randomUUID(), title: s.title, layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes }] };
  });
  return {
    version: 2, document_id: crypto.randomUUID(), canvas: CANVAS_PRESETS.slide_cso, nodes: [], sections,
    metadata: { title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
  } as CanvasDocument;
}

/** doc scaffold from titled sections (placeholder bodies guide the author). */
const doc = (title: string, sections: Section[]): CanvasDocument => sectionsToCanvasDoc(title, sections);
/** a cost sheet with a header row + a few placeholder line rows. */
const sheet = (title: string, headers: string[], rows: string[][]): CanvasDocument => tableToCanvasSheet(title, headers, rows, title.slice(0, 28));

// ── GENERIC starters (P4.1) — reusable business artifacts, context=general/marketing ──

export const GENERIC_STARTERS: StarterDef[] = [
  {
    slug: 'capability-statement', title: 'Capability Statement', form: 'doc', kind: 'template', context: 'capability',
    build: () => doc('Capability Statement', [
      { title: 'Company Overview', body: 'One paragraph: who you are, your mission, and the value you deliver to the government customer.' },
      { title: 'Core Competencies', body: 'Bulleted list of your differentiating technical + domain capabilities, mapped to NAICS/PSC where relevant.' },
      { title: 'Differentiators', body: 'Why you, specifically — IP, clearances, certifications, unique facilities, prior outcomes.' },
      { title: 'Past Performance', body: 'Three relevant contracts: customer, scope, value, period, and the measurable result.' },
      { title: 'Company Data', body: 'UEI/CAGE, NAICS/PSC codes, socioeconomic status, contract vehicles, DUNS.' },
      { title: 'Contact', body: 'POC name, title, email, phone, and address.' },
    ]),
  },
  {
    slug: 'one-pager', title: 'One-Pager', form: 'doc', kind: 'template', context: 'marketing',
    build: () => doc('One-Pager', [
      { title: 'Problem', body: 'The mission gap or pain, stated in the customer’s language.' },
      { title: 'Solution', body: 'Your approach in 2–3 sentences + the key innovation.' },
      { title: 'Proof', body: 'Traction, TRL, pilots, or prior results that de-risk the claim.' },
      { title: 'Team', body: 'The people and why they’re credible for this work.' },
      { title: 'Ask', body: 'What you want next: a meeting, a pilot, an award, a teaming call.' },
    ]),
  },
  {
    slug: 'memo', title: 'Memo', form: 'doc', kind: 'template', context: 'general',
    build: () => doc('Memo', [
      { title: 'Header', body: 'TO: / FROM: / DATE: / RE:' },
      { title: 'Summary', body: 'The bottom line up front (BLUF) — the decision or recommendation in one or two sentences.' },
      { title: 'Background', body: 'The context and facts the reader needs.' },
      { title: 'Discussion', body: 'The analysis, options, and trade-offs.' },
      { title: 'Recommendation', body: 'The specific action requested and the next step.' },
    ]),
  },
  {
    slug: 'pitch-deck', title: 'Pitch Deck', form: 'ppt', kind: 'template', context: 'marketing',
    build: () => deckToCanvasDoc('Pitch Deck', [
      { title: 'Company — One-line Pitch', bullets: ['What you do, for whom, and the outcome.'] },
      { title: 'Problem', bullets: ['The mission gap', 'Why it matters now', 'Cost of inaction'] },
      { title: 'Solution', bullets: ['Your approach', 'The key innovation', 'Why it works'] },
      { title: 'Market', bullets: ['Customer + program', 'TAM / SAM / SOM', 'Transition path'] },
      { title: 'Product / Technology', bullets: ['TRL', 'Architecture', 'Demonstrated capability'] },
      { title: 'Traction', bullets: ['Pilots / awards', 'Metrics', 'Customer validation'] },
      { title: 'Team', bullets: ['Key personnel', 'Advisors', 'Relevant credentials'] },
      { title: 'The Ask', bullets: ['What you want', 'Use of funds / next milestone'] },
    ]),
  },
  {
    slug: 'budget-workbook', title: 'Budget Workbook', form: 'sheet', kind: 'template', context: 'commercialization',
    build: () => sheet('Budget Workbook', ['Category', 'Base', 'Option', 'Total'], [
      ['Direct Labor', '', '', ''],
      ['Fringe', '', '', ''],
      ['Materials', '', '', ''],
      ['Travel', '', '', ''],
      ['Subcontracts / Consultants', '', '', ''],
      ['Indirect (Overhead + G&A)', '', '', ''],
      ['Fee', '', '', ''],
      ['Total', '', '', ''],
    ]),
  },
];

// ── PROPOSAL vehicle set (P4.2) — DoD/DoW: DoW CSO · SBIR I/II · STTR I/II · DP2 ──
// Each vehicle = a Technical-Volume doc + a Cost-Volume sheet; a shared
// commercialization deck is reused across them. TVs carry a `vehicle` tag.

const S = (title: string, body: string): Section => ({ title, body });

const SBIR_P1_TV: Section[] = [
  S('Identification & Significance of the Problem', 'The mission gap / opportunity and why it matters to the customer. Quantify the impact.'),
  S('Phase I Technical Objectives', 'The specific, measurable objectives that establish feasibility in Phase I.'),
  S('Phase I Work Plan', 'Tasks, methods, milestones, and schedule to meet the objectives.'),
  S('Related Work', 'Your prior/ongoing work and the state of the art that grounds the approach.'),
  S('Relationship with Future R&D', 'How Phase I sets up Phase II — the anticipated Phase II vision and end state.'),
  S('Commercialization Strategy', 'Target customers, transition path, and the dual-use / commercial potential.'),
  S('Key Personnel', 'PI and key staff, roles, level of effort, and relevant qualifications.'),
  S('Facilities & Equipment', 'The facilities, equipment, and resources available to perform the work.'),
  S('Subcontractors & Consultants', 'Any subs/consultants, their roles, and allocation of effort.'),
  S('Prior, Current, or Pending Support', 'Related funding to avoid duplication and show non-overlap.'),
];

const SBIR_P2_TV: Section[] = [
  S('Identification & Significance of the Problem', 'The mission gap / opportunity, refined with Phase I insight.'),
  S('Phase I Results & Feasibility', 'What Phase I proved — the data and results that establish feasibility.'),
  S('Phase II Technical Objectives', 'The full-scale R&D objectives that build on Phase I.'),
  S('Phase II Work Plan / Statement of Work', 'Detailed tasks, methods, milestones, deliverables, and schedule.'),
  S('Commercialization Plan', 'Expanded market analysis, transition/customer commitments, and the business model.'),
  S('Key Personnel', 'PI and key staff, roles, level of effort, and qualifications.'),
  S('Facilities & Equipment', 'Facilities, equipment, and resources for the full effort.'),
  S('Related Work', 'Prior/ongoing work and the state of the art.'),
  S('Subcontractors & Consultants', 'Subs/consultants, roles, and allocation of effort.'),
];

const STTR_RI: Section[] = [
  S('Research Institution & Partnership', 'The partnering research institution, its role, and the collaboration structure.'),
  S('Allocation of Work', 'Work split meeting STTR minimums (≥40% small business, ≥30% research institution).'),
  S('Intellectual Property & Data Rights', 'IP ownership + data-rights allocation between the small business and the RI.'),
];

const DP2_TV: Section[] = [
  S('Phase I Feasibility Documentation', 'Evidence you have ALREADY achieved Phase I-equivalent feasibility (the DP2 gate) — prior data/results.'),
  S('Phase II Technical Objectives', 'The full-scale R&D objectives.'),
  S('Phase II Work Plan / Statement of Work', 'Detailed tasks, methods, milestones, deliverables, and schedule.'),
  S('Commercialization Plan', 'Market analysis, transition/customer commitments, and business model.'),
  S('Key Personnel', 'PI and key staff, roles, level of effort, and qualifications.'),
  S('Facilities & Equipment', 'Facilities, equipment, and resources for the effort.'),
];

const CSO_BRIEF: Section[] = [
  S('Problem / Mission Need', 'The government problem or need, in the customer’s language.'),
  S('Solution & Innovation', 'Your commercial solution and what makes it innovative.'),
  S('Technical Approach', 'How the solution works and how you would deliver / demonstrate it.'),
  S('Company & Team', 'Who you are, relevant experience, and why you can execute.'),
  S('Rough Order of Magnitude Pricing', 'Indicative pricing / cost basis for the effort.'),
  S('Commercialization & Transition', 'Dual-use potential and the path to fielding / transition.'),
];

const COST_ELEMENTS = ['Direct Labor', 'Fringe Benefits', 'Materials & Supplies', 'Travel', 'Equipment', 'Subcontracts', 'Consultants', 'Other Direct Costs', 'Indirect (Overhead)', 'Indirect (G&A)', 'Fee / Profit', 'Total'];
const costSheet = (title: string, withOption: boolean): CanvasDocument => {
  const headers = withOption ? ['Cost Element', 'Base Period', 'Option Period', 'Total'] : ['Cost Element', 'Base Period', 'Total'];
  const rows = COST_ELEMENTS.map((c) => (withOption ? [c, '', '', ''] : [c, '', '']));
  return sheet(title, headers, rows);
};

const tvDoc = (title: string, sections: Section[]) => () => doc(title, sections);

export const PROPOSAL_STARTERS: StarterDef[] = [
  // DoW CSO — Commercial Solutions Opening (solution brief → full proposal + pricing)
  { slug: 'dow-cso-solution-brief', title: 'DoW CSO — Solution Brief', form: 'doc', kind: 'template', context: 'proposal', vehicle: 'dow-cso', build: tvDoc('DoW CSO — Solution Brief', CSO_BRIEF) },
  { slug: 'dow-cso-pricing', title: 'DoW CSO — Pricing', form: 'sheet', kind: 'template', context: 'proposal', vehicle: 'dow-cso', build: () => costSheet('DoW CSO — Pricing', false) },
  // SBIR Phase I / II
  { slug: 'sbir-p1-technical-volume', title: 'SBIR Phase I — Technical Volume', form: 'doc', kind: 'template', context: 'proposal', vehicle: 'sbir-phase-1', build: tvDoc('SBIR Phase I — Technical Volume', SBIR_P1_TV) },
  { slug: 'sbir-p1-cost-volume', title: 'SBIR Phase I — Cost Volume', form: 'sheet', kind: 'template', context: 'proposal', vehicle: 'sbir-phase-1', build: () => costSheet('SBIR Phase I — Cost Volume', false) },
  { slug: 'sbir-p2-technical-volume', title: 'SBIR Phase II — Technical Volume', form: 'doc', kind: 'template', context: 'proposal', vehicle: 'sbir-phase-2', build: tvDoc('SBIR Phase II — Technical Volume', SBIR_P2_TV) },
  { slug: 'sbir-p2-cost-volume', title: 'SBIR Phase II — Cost Volume', form: 'sheet', kind: 'template', context: 'proposal', vehicle: 'sbir-phase-2', build: () => costSheet('SBIR Phase II — Cost Volume', true) },
  // STTR Phase I / II (SBIR scaffold + research-institution partnership)
  { slug: 'sttr-p1-technical-volume', title: 'STTR Phase I — Technical Volume', form: 'doc', kind: 'template', context: 'proposal', vehicle: 'sttr-phase-1', build: tvDoc('STTR Phase I — Technical Volume', [...SBIR_P1_TV, ...STTR_RI]) },
  { slug: 'sttr-p1-cost-volume', title: 'STTR Phase I — Cost Volume', form: 'sheet', kind: 'template', context: 'proposal', vehicle: 'sttr-phase-1', build: () => costSheet('STTR Phase I — Cost Volume', false) },
  { slug: 'sttr-p2-technical-volume', title: 'STTR Phase II — Technical Volume', form: 'doc', kind: 'template', context: 'proposal', vehicle: 'sttr-phase-2', build: tvDoc('STTR Phase II — Technical Volume', [...SBIR_P2_TV, ...STTR_RI]) },
  { slug: 'sttr-p2-cost-volume', title: 'STTR Phase II — Cost Volume', form: 'sheet', kind: 'template', context: 'proposal', vehicle: 'sttr-phase-2', build: () => costSheet('STTR Phase II — Cost Volume', true) },
  // Direct to Phase II
  { slug: 'dp2-technical-volume', title: 'Direct-to-Phase-II — Technical Volume', form: 'doc', kind: 'template', context: 'proposal', vehicle: 'direct-to-phase-2', build: tvDoc('Direct-to-Phase-II — Technical Volume', DP2_TV) },
  { slug: 'dp2-cost-volume', title: 'Direct-to-Phase-II — Cost Volume', form: 'sheet', kind: 'template', context: 'proposal', vehicle: 'direct-to-phase-2', build: () => costSheet('Direct-to-Phase-II — Cost Volume', true) },
  // Shared commercialization deck (reused across vehicles)
  {
    slug: 'commercialization-deck', title: 'Commercialization Deck', form: 'ppt', kind: 'template', context: 'commercialization',
    build: () => deckToCanvasDoc('Commercialization Deck', [
      { title: 'Commercialization Strategy', bullets: ['The transition thesis in one line'] },
      { title: 'Market Opportunity', bullets: ['TAM / SAM / SOM', 'Defense + commercial demand'] },
      { title: 'Customer & Transition Path', bullets: ['Program of record', 'Transition partners', 'Acquisition pathway'] },
      { title: 'Business Model', bullets: ['How you make money', 'Pricing', 'Scaling'] },
      { title: 'Competitive Landscape', bullets: ['Alternatives', 'Your moat'] },
      { title: 'IP & Data Rights', bullets: ['Owned IP', 'Government data rights posture'] },
      { title: 'Funding & Milestones', bullets: ['Non-dilutive + dilutive', 'Key milestones'] },
      { title: 'Team & Partners', bullets: ['Key personnel', 'Research + industry partners'] },
    ]),
  },
];

/** The full dogfooded starter set: generics + the DoD/DoW proposal-vehicle set. */
export const STARTER_SET: StarterDef[] = [...GENERIC_STARTERS, ...PROPOSAL_STARTERS];
