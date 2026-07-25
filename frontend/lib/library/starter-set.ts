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

// STARTER_SET grows with the proposal-vehicle set (P4.2).
export const STARTER_SET: StarterDef[] = [...GENERIC_STARTERS];
