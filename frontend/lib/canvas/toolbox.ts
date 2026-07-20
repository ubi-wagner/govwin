/**
 * resolveCanvasToolbox — the canvas sidebar as a PRIORITIZED CARD LIST
 * (docs/CANVAS_GEOMETRY_REDESIGN.md §8b).
 *
 * The sidebar is one component-card list. Which cards show, and their ORDER
 * (most-likely-for-this-context first), is resolved from `(role × stage ×
 * artifactType × permission)` on top of `resolveCanvasCapabilities`. Sometimes
 * the list is essentially one card — a collaborator's *Review · Modify · Lock*;
 * sometimes many — an RFP admin ingesting an RFP (annotate, template, sections,
 * floorplan, …). Every actor's journey (collaborator upload/collaborate → RFP
 * admin ingest/template → tenant admin build/review/AI → lock/complete-ToDo)
 * reads from this one resolver, so the whole product's tool surface is defined
 * in exactly one place.
 */
import { resolveCanvasCapabilities, type CanvasCapabilities, type CapabilityInput } from '@/lib/canvas/capabilities';

export interface ToolCard {
  id: string;
  title: string;
  hint: string;
  /** the capability flag that must be true to show this card; 'always' = ambient. */
  requires: keyof CanvasCapabilities | 'always';
  /** ambient cards (status/export) render compact, not as a primary tool. */
  ambient?: boolean;
}

/** The full toolbox — every card the canvas can surface, in any context. */
export const TOOL_CARDS: ToolCard[] = [
  { id: 'review',     title: 'Review · Modify · Lock', hint: 'comment, revise, and complete (lock) this section', requires: 'canComment' },
  { id: 'annotate',   title: 'Annotate & Atomize',      hint: 'box-and-tag content into library atoms / groups / sections', requires: 'canAnnotate' },
  { id: 'template',   title: 'Template',                hint: 'save this skeleton as a reusable template', requires: 'canManageStructure' },
  { id: 'sections',   title: 'Sections & Budget',       hint: 'section list, page-fill gauge, keep-together, drag-resize', requires: 'canManageStructure' },
  { id: 'floorplan',  title: 'Floorplan',               hint: 'margins, header / footer, font floor, page cap', requires: 'canManageFloorplan' },
  { id: 'library',    title: 'Insert from Library',     hint: 'drop atoms / groups into the active section', requires: 'canInsertLibrary' },
  { id: 'ai',         title: 'AI Assist',               hint: 'draft / revise / fit-to-budget', requires: 'canDraftAI' },
  { id: 'insert',     title: 'Insert',                  hint: 'add a heading, text, list, table, image…', requires: 'canEditContent' },
  { id: 'format',     title: 'Format',                  hint: 'style the selected block', requires: 'canFormat' },
  { id: 'atomize',    title: 'Harvest to Library',      hint: 'return locked content to the library', requires: 'canAtomize' },
  { id: 'compliance', title: 'Compliance & Status',     hint: 'page budget, sources, matrix status', requires: 'always', ambient: true },
  { id: 'export',     title: 'Export',                  hint: 'download docx / pptx / xlsx / pdf', requires: 'canExport', ambient: true },
];

/**
 * Priority by STAGE — the order the cards appear ("most likely first") for each
 * context. A card not listed for a stage sorts after the listed ones (still
 * shown if its capability passes), so cards[0] is the PRIMARY tool for the
 * role×context and the tail is ambient/secondary.
 */
const STAGE_ORDER: Record<string, string[]> = {
  ingest:   ['annotate', 'template', 'sections', 'floorplan', 'insert', 'format', 'library', 'ai', 'compliance', 'export'],
  template: ['template', 'sections', 'floorplan', 'insert', 'format', 'annotate', 'library', 'compliance', 'export'],
  draft:    ['insert', 'format', 'library', 'ai', 'sections', 'annotate', 'floorplan', 'template', 'compliance', 'export'],
  review:   ['review', 'ai', 'format', 'compliance', 'export'],
  locked:   ['review', 'atomize', 'compliance', 'export'],
};

export interface ResolvedToolbox {
  cards: ToolCard[];
  /** the top non-ambient card — the primary tool for this role×context. */
  primary: ToolCard | null;
  capabilities: CanvasCapabilities;
}

/** Order + gate the cards from an ALREADY-resolved capability set (client-side,
 *  where the page has resolved capabilities but not the raw role). */
export function toolboxFromCapabilities(capabilities: CanvasCapabilities, stage: string = 'draft'): ResolvedToolbox {
  const order = STAGE_ORDER[stage] ?? STAGE_ORDER.draft;
  const rank = (id: string) => { const i = order.indexOf(id); return i === -1 ? 999 : i; };
  const cards = TOOL_CARDS
    .filter((c) => c.requires === 'always' || capabilities[c.requires])
    .sort((a, b) => rank(a.id) - rank(b.id));
  const primary = cards.find((c) => !c.ambient) ?? null;
  return { cards, primary, capabilities };
}

/** Resolve the ordered, capability-gated card list for a role×context. */
export function resolveCanvasToolbox(input: CapabilityInput): ResolvedToolbox {
  return toolboxFromCapabilities(resolveCanvasCapabilities(input), input.stage ?? 'draft');
}
