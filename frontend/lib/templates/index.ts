/**
 * Canvas document templates — structured starter content for common proposal
 * and collateral types across DoD/DoW, NSF, and DOE, plus marketing,
 * commercialization, and investment formats (one/two-pager, whitepaper, deck).
 * Used when provisioning a proposal workspace or starting a standalone document
 * to pre-populate sections with the right headings, tables, and placeholder text.
 *
 * Templates use {merge_field} placeholders interpolated with real values when a
 * proposal/document is created (company name, topic number, PI info, etc.).
 */

// ── DoD/DoW — SBIR (existing) ──
export { DOD_SBIR_PHASE1_TECHNICAL } from './dod-sbir-phase1-technical';
export { DOD_SBIR_PHASE2_TECHNICAL } from './dod-sbir-phase2-technical';
export { DOD_CSO_PHASE1_BRIEFING } from './dod-cso-phase1-briefing';
export { DOD_SBIR_PHASE1_COST } from './dod-sbir-phase1-cost';
// ── DoD/DoW — STTR + Direct-to-Phase-II ──
export { DOD_STTR_PHASE1_TECHNICAL } from './dod-sttr-phase1-technical';
export { DOD_STTR_PHASE2_TECHNICAL } from './dod-sttr-phase2-technical';
export { DOD_D2P2_TECHNICAL } from './dod-d2p2-technical';
// ── NSF ──
export { NSF_PROJECT_PITCH } from './nsf-project-pitch';
export { NSF_SBIR_PHASE1_PROJECT_DESCRIPTION } from './nsf-sbir-phase1-project-description';
// ── DOE ──
export { DOE_SBIR_PHASE1_TECHNICAL } from './doe-sbir-phase1-technical';
export { DOE_STTR_PHASE1_TECHNICAL } from './doe-sttr-phase1-technical';
// ── Collateral — marketing / commercialization / investment ──
export { MARKETING_ONE_PAGER } from './marketing-one-pager';
export { MARKETING_TWO_PAGER } from './marketing-two-pager';
export { MARKETING_WHITEPAPER } from './marketing-whitepaper';
export { MARKETING_SLIDE_DECK } from './marketing-slide-deck';
export { COMMERCIALIZATION_PLAN } from './commercialization-plan';
export { INVESTMENT_ONE_PAGER } from './investment-one-pager';
export { INVESTMENT_PITCH_DECK } from './investment-pitch-deck';
// ── Overview decks — technology + company capability ──
export { TECH_OVERVIEW_DECK } from './tech-overview-deck';
export { COMPANY_CAPABILITY_DECK } from './company-capability-deck';

import type { CanvasDocument } from '@/lib/types/canvas-document';
import { DOD_SBIR_PHASE1_TECHNICAL } from './dod-sbir-phase1-technical';
import { DOD_SBIR_PHASE2_TECHNICAL } from './dod-sbir-phase2-technical';
import { DOD_CSO_PHASE1_BRIEFING } from './dod-cso-phase1-briefing';
import { DOD_SBIR_PHASE1_COST } from './dod-sbir-phase1-cost';
import { DOD_STTR_PHASE1_TECHNICAL } from './dod-sttr-phase1-technical';
import { DOD_STTR_PHASE2_TECHNICAL } from './dod-sttr-phase2-technical';
import { DOD_D2P2_TECHNICAL } from './dod-d2p2-technical';
import { NSF_PROJECT_PITCH } from './nsf-project-pitch';
import { NSF_SBIR_PHASE1_PROJECT_DESCRIPTION } from './nsf-sbir-phase1-project-description';
import { DOE_SBIR_PHASE1_TECHNICAL } from './doe-sbir-phase1-technical';
import { DOE_STTR_PHASE1_TECHNICAL } from './doe-sttr-phase1-technical';
import { MARKETING_ONE_PAGER } from './marketing-one-pager';
import { MARKETING_TWO_PAGER } from './marketing-two-pager';
import { MARKETING_WHITEPAPER } from './marketing-whitepaper';
import { MARKETING_SLIDE_DECK } from './marketing-slide-deck';
import { COMMERCIALIZATION_PLAN } from './commercialization-plan';
import { INVESTMENT_ONE_PAGER } from './investment-one-pager';
import { INVESTMENT_PITCH_DECK } from './investment-pitch-deck';
import { TECH_OVERVIEW_DECK } from './tech-overview-deck';
import { COMPANY_CAPABILITY_DECK } from './company-capability-deck';

export type TemplateCategory = 'dod_dow' | 'nsf' | 'doe' | 'marketing' | 'commercialization' | 'investment' | 'tech' | 'company';

export type TemplateKey =
  | 'dod-sbir-phase1-technical'
  | 'dod-sbir-phase1-cost'
  | 'dod-sbir-phase2-technical'
  | 'dod-cso-phase1-briefing'
  | 'dod-sttr-phase1-technical'
  | 'dod-sttr-phase2-technical'
  | 'dod-d2p2-technical'
  | 'nsf-project-pitch'
  | 'nsf-sbir-phase1-project-description'
  | 'doe-sbir-phase1-technical'
  | 'doe-sttr-phase1-technical'
  | 'marketing-one-pager'
  | 'marketing-two-pager'
  | 'marketing-whitepaper'
  | 'marketing-slide-deck'
  | 'commercialization-plan'
  | 'investment-one-pager'
  | 'investment-pitch-deck'
  | 'tech-overview-deck'
  | 'company-capability-deck'
  | 'key-personnel-bio'
  | 'past-performance-narrative';

const TEMPLATE_MAP: Record<string, CanvasDocument> = {
  'dod-sbir-phase1-technical': DOD_SBIR_PHASE1_TECHNICAL,
  'dod-sbir-phase2-technical': DOD_SBIR_PHASE2_TECHNICAL,
  'dod-cso-phase1-briefing': DOD_CSO_PHASE1_BRIEFING,
  'dod-sbir-phase1-cost': DOD_SBIR_PHASE1_COST,
  'dod-sttr-phase1-technical': DOD_STTR_PHASE1_TECHNICAL,
  'dod-sttr-phase2-technical': DOD_STTR_PHASE2_TECHNICAL,
  'dod-d2p2-technical': DOD_D2P2_TECHNICAL,
  'nsf-project-pitch': NSF_PROJECT_PITCH,
  'nsf-sbir-phase1-project-description': NSF_SBIR_PHASE1_PROJECT_DESCRIPTION,
  'doe-sbir-phase1-technical': DOE_SBIR_PHASE1_TECHNICAL,
  'doe-sttr-phase1-technical': DOE_STTR_PHASE1_TECHNICAL,
  'marketing-one-pager': MARKETING_ONE_PAGER,
  'marketing-two-pager': MARKETING_TWO_PAGER,
  'marketing-whitepaper': MARKETING_WHITEPAPER,
  'marketing-slide-deck': MARKETING_SLIDE_DECK,
  'commercialization-plan': COMMERCIALIZATION_PLAN,
  'investment-one-pager': INVESTMENT_ONE_PAGER,
  'investment-pitch-deck': INVESTMENT_PITCH_DECK,
  'tech-overview-deck': TECH_OVERVIEW_DECK,
  'company-capability-deck': COMPANY_CAPABILITY_DECK,
};

/** Picker metadata — grouped, launch-facing catalog of the starter templates. */
export const TEMPLATE_CATALOG: { key: TemplateKey; title: string; category: TemplateCategory; format: 'document' | 'deck' | 'spreadsheet' }[] = [
  { key: 'dod-sbir-phase1-technical', title: 'DoD SBIR Phase I — Technical', category: 'dod_dow', format: 'document' },
  { key: 'dod-sbir-phase1-cost', title: 'DoD SBIR Phase I — Cost', category: 'dod_dow', format: 'spreadsheet' },
  { key: 'dod-sbir-phase2-technical', title: 'DoD SBIR Phase II — Technical', category: 'dod_dow', format: 'document' },
  { key: 'dod-sttr-phase1-technical', title: 'DoD/DoW STTR Phase I — Technical', category: 'dod_dow', format: 'document' },
  { key: 'dod-sttr-phase2-technical', title: 'DoD/DoW STTR Phase II — Technical', category: 'dod_dow', format: 'document' },
  { key: 'dod-d2p2-technical', title: 'DoD/DoW Direct-to-Phase-II — Technical', category: 'dod_dow', format: 'document' },
  { key: 'dod-cso-phase1-briefing', title: 'DoD CSO Phase I — Briefing', category: 'dod_dow', format: 'deck' },
  { key: 'nsf-project-pitch', title: 'NSF — Project Pitch', category: 'nsf', format: 'document' },
  { key: 'nsf-sbir-phase1-project-description', title: 'NSF SBIR/STTR Phase I — Project Description', category: 'nsf', format: 'document' },
  { key: 'doe-sbir-phase1-technical', title: 'DOE SBIR Phase I — Technical', category: 'doe', format: 'document' },
  { key: 'doe-sttr-phase1-technical', title: 'DOE STTR Phase I — Technical', category: 'doe', format: 'document' },
  { key: 'marketing-one-pager', title: 'Marketing — One-Pager', category: 'marketing', format: 'document' },
  { key: 'marketing-two-pager', title: 'Capability Statement — Two-Pager', category: 'marketing', format: 'document' },
  { key: 'marketing-whitepaper', title: 'Marketing — Whitepaper', category: 'marketing', format: 'document' },
  { key: 'marketing-slide-deck', title: 'Marketing — Sales Deck', category: 'marketing', format: 'deck' },
  { key: 'commercialization-plan', title: 'Commercialization Plan', category: 'commercialization', format: 'document' },
  { key: 'investment-one-pager', title: 'Investment — One-Pager', category: 'investment', format: 'document' },
  { key: 'investment-pitch-deck', title: 'Investment — Pitch Deck', category: 'investment', format: 'deck' },
  { key: 'tech-overview-deck', title: 'Technology Overview — Deck', category: 'tech', format: 'deck' },
  { key: 'company-capability-deck', title: 'Company Capability — Deck', category: 'company', format: 'deck' },
];

/**
 * Look up a template by its key. Returns a deep clone so callers
 * can safely mutate (interpolate merge fields, assign IDs, etc.).
 */
export function getTemplate(key: string): CanvasDocument | null {
  const t = TEMPLATE_MAP[key];
  if (!t) return null;
  return JSON.parse(JSON.stringify(t));
}

/**
 * Resolve a template key from program_type + item_type.
 * Used during proposal provisioning to auto-select the right template.
 */
export function resolveTemplateKey(
  programType: string,
  itemType: string,
  itemName?: string,
): string | null {
  // Cover sheets, certifications, commercialization reports and cost sheets are auto/form volumes —
  // they must NEVER inherit a narrative content template. (Seeding the 15-page Technical template into
  // a 1-page Cover Sheet is what produced the "15/1p" over-limit.) Guard by name first.
  const name = (itemName ?? '').toLowerCase();
  if (/cover\s*sheet|cover\s*page|\bcertif|commercial(iz|is)ation report|\bccr\b|cost\s*sheet|sf-?424|funding agreement/.test(name)) {
    return null;
  }
  let key: string | null = null;
  if (programType === 'sbir_phase_1' && (itemType === 'cost' || itemType === 'cost_volume' || itemType === 'spreadsheet')) {
    key = 'dod-sbir-phase1-cost';
  } else if (itemType === 'slide_deck') {
    if (programType === 'cso') key = 'dod-cso-phase1-briefing';
  } else if (itemType === 'word_doc') {
    // Only the word_doc narrative gets a technical template — NOT pdf/form/text items.
    if (programType === 'sbir_phase_1') key = 'dod-sbir-phase1-technical';
    else if (programType === 'sbir_phase_2') key = 'dod-sbir-phase2-technical';
    else if (programType === 'sttr_phase_1') key = 'dod-sttr-phase1-technical';
    else if (programType === 'sttr_phase_2') key = 'dod-sttr-phase2-technical';
    else if (programType === 'direct_to_phase_2' || programType === 'd2p2') key = 'dod-d2p2-technical';
    else if (programType === 'nsf_sbir_phase_1' || programType === 'nsf_sbir' || programType === 'nsf_sttr') key = 'nsf-sbir-phase1-project-description';
    else if (programType === 'doe_sbir_phase_1' || programType === 'doe_sbir') key = 'doe-sbir-phase1-technical';
    else if (programType === 'doe_sttr_phase_1' || programType === 'doe_sttr') key = 'doe-sttr-phase1-technical';
  }
  if (key && !TEMPLATE_MAP[key]) return null;
  return key;
}

/**
 * Interpolate {merge_field} placeholders in all text nodes.
 * Values come from tenant profile + opportunity + compliance data.
 */
export function interpolateTemplate(
  doc: CanvasDocument,
  variables: Record<string, string>,
): CanvasDocument {
  const json = JSON.stringify(doc);
  const interpolated = json.replace(
    /\{([a-z_]+)\}/g,
    (match, key: string) => variables[key] ?? match,
  );
  return JSON.parse(interpolated);
}
