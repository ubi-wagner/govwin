/**
 * Canvas document templates — structured starter content for common
 * DoD proposal types. Used when provisioning a new proposal workspace
 * to pre-populate sections with the right headings, tables, and
 * placeholder text for each format.
 *
 * Templates use {merge_field} placeholders that get interpolated
 * with actual values when a proposal is created (company name,
 * topic number, PI info, etc.).
 */

export { DOD_SBIR_PHASE1_TECHNICAL } from './dod-sbir-phase1-technical';
export { DOD_CSO_PHASE1_BRIEFING } from './dod-cso-phase1-briefing';
export { DOD_SBIR_PHASE1_COST } from './dod-sbir-phase1-cost';

import type { CanvasDocument } from '@/lib/types/canvas-document';
import { DOD_SBIR_PHASE1_TECHNICAL } from './dod-sbir-phase1-technical';
import { DOD_CSO_PHASE1_BRIEFING } from './dod-cso-phase1-briefing';
import { DOD_SBIR_PHASE1_COST } from './dod-sbir-phase1-cost';

export type TemplateKey =
  | 'dod-sbir-phase1-technical'
  | 'dod-sbir-phase1-cost'
  | 'dod-sbir-phase2-technical'
  | 'dod-cso-phase1-briefing'
  | 'key-personnel-bio'
  | 'past-performance-narrative';

const TEMPLATE_MAP: Record<string, CanvasDocument> = {
  'dod-sbir-phase1-technical': DOD_SBIR_PHASE1_TECHNICAL,
  'dod-cso-phase1-briefing': DOD_CSO_PHASE1_BRIEFING,
  'dod-sbir-phase1-cost': DOD_SBIR_PHASE1_COST,
};

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
): string | null {
  let key: string | null = null;
  if (itemType === 'slide_deck') {
    if (programType === 'cso') key = 'dod-cso-phase1-briefing';
  } else if (itemType === 'word_doc' || itemType === 'pdf' || itemType === 'text') {
    if (programType === 'sbir_phase_1') key = 'dod-sbir-phase1-technical';
    if (programType === 'sbir_phase_2') key = 'dod-sbir-phase2-technical';
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
