/**
 * Starter-canvas builder for standalone tenant documents (Tier 2, #3).
 *
 * Turns either a BLANK preset (flier / letter / deck / sheet) or a
 * `document_templates` row into a ready-to-edit CanvasDocument — the exact same
 * shape the proposal-section editor consumes, so the one canvas shell renders it
 * unchanged (docs/CANVAS_GEOMETRY_REDESIGN.md §8a).
 *
 * Template resolution (most→least specific):
 *   1. `canvas_document` carries real nodes/sections (a tenant-EXTRACTED
 *      skeleton) → flatten it to an editable doc (`toEditableFlat`).
 *   2. `metadata.sections` is a string[] of section names (a SEEDED system
 *      template predating canvas_document) → scaffold one heading per name so the
 *      author gets the outline to fill.
 *   3. Neither → an empty canvas carrying just the template's page rules.
 *
 * Pure + framework-free (no DB, no request) so it is unit-testable and shared.
 */
import {
  CANVAS_PRESETS,
  createEmptyCanvas,
  createNode,
  toEditableFlat,
  type CanvasDocument,
  type CanvasDocumentMetadata,
  type CanvasRules,
  type CanvasNode,
} from '@/lib/types/canvas-document';
import { coerceJsonb } from '@/lib/jsonb';

/** The blank quick-starts offered on the "New document" chooser. */
export type BlankPreset = 'flier' | 'letter' | 'deck' | 'sheet';

/** The 10 document types shared with `document_templates.template_type`. */
export const DOC_TYPES = [
  'technical_volume', 'cost_volume', 'slide_deck', 'past_performance',
  'key_personnel', 'commercialization', 'abstract', 'cover_sheet',
  'supporting_docs', 'custom',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v);
}

interface BlankSpec { rules: CanvasRules; docType: DocType; title: string }

/** Blank presets → (page rules, doc type, default title). */
const BLANKS: Record<BlankPreset, BlankSpec> = {
  // A one-pager: letter rules capped to a single page.
  flier:  { rules: { ...CANVAS_PRESETS.letter_standard, max_pages: 1 }, docType: 'custom', title: 'Untitled flier' },
  letter: { rules: CANVAS_PRESETS.letter_standard, docType: 'custom', title: 'Untitled document' },
  deck:   { rules: CANVAS_PRESETS.slide_cso, docType: 'slide_deck', title: 'Untitled deck' },
  sheet:  { rules: CANVAS_PRESETS.spreadsheet, docType: 'cost_volume', title: 'Untitled workbook' },
};

export function isBlankPreset(v: unknown): v is BlankPreset {
  return typeof v === 'string' && v in BLANKS;
}

export interface StarterResult { canvas: CanvasDocument; docType: DocType; title: string }

interface StarterOpts { documentId: string; actorId: string; title?: string }

function baseMetadata(title: string, documentId: string, actorId: string): CanvasDocumentMetadata {
  const now = new Date().toISOString();
  return {
    title,
    volume_id: '',
    required_item_id: '',
    proposal_id: '',
    solicitation_id: '',
    created_at: now,
    last_modified_at: now,
    last_modified_by: actorId,
    version_number: 1,
    status: 'empty',
  };
}

/** Build a starter canvas from a blank preset. */
export function starterFromPreset(preset: BlankPreset, opts: StarterOpts): StarterResult {
  const spec = BLANKS[preset];
  const title = opts.title?.trim() || spec.title;
  const canvas = createEmptyCanvas({
    documentId: opts.documentId,
    canvas: spec.rules,
    metadata: baseMetadata(title, opts.documentId, opts.actorId),
  });
  return { canvas, docType: spec.docType, title };
}

/**
 * The subset of a `document_templates` row the starter needs. Field names are
 * camelCase because `@/lib/db` applies a global snake_case→camelCase transform to
 * every result row (so `canvas_document` arrives as `canvasDocument`).
 */
export interface TemplateRow {
  id: string;
  name: string;
  templateType: string;
  canvasPreset: unknown;
  canvasDocument: unknown;
  metadata: unknown;
}

/** Does a canvas_document value carry real editable content? */
function hasBody(doc: CanvasDocument): boolean {
  return (Array.isArray(doc.nodes) && doc.nodes.length > 0)
    || (Array.isArray(doc.sections) && doc.sections.length > 0);
}

/** Build a starter canvas from a `document_templates` row. */
export function starterFromTemplate(tpl: TemplateRow, opts: StarterOpts): StarterResult {
  const docType: DocType = isDocType(tpl.templateType) ? tpl.templateType : 'custom';
  const title = opts.title?.trim() || tpl.name || 'Untitled document';

  // Page rules: the template's canvas_preset, else a sensible default per type.
  const preset = coerceJsonb<Partial<CanvasRules>>(tpl.canvasPreset, {});
  const rules: CanvasRules = preset && typeof preset.format === 'string'
    ? (preset as CanvasRules)
    : docType === 'slide_deck'
      ? CANVAS_PRESETS.slide_cso
      : docType === 'cost_volume'
        ? CANVAS_PRESETS.spreadsheet
        : CANVAS_PRESETS.letter_standard;

  const metadata = baseMetadata(title, opts.documentId, opts.actorId);

  // 1. A tenant-extracted skeleton with a real body → flatten to editable.
  const body = coerceJsonb<Partial<CanvasDocument>>(tpl.canvasDocument, {});
  if (body && (Array.isArray(body.nodes) || Array.isArray(body.sections))) {
    const full: CanvasDocument = {
      version: body.version === 2 ? 2 : 1,
      document_id: opts.documentId,
      canvas: body.canvas && typeof (body.canvas as CanvasRules).format === 'string' ? (body.canvas as CanvasRules) : rules,
      nodes: Array.isArray(body.nodes) ? (body.nodes as CanvasNode[]) : [],
      sections: Array.isArray(body.sections) ? body.sections : undefined,
      metadata,
    };
    if (hasBody(full)) {
      const flat = toEditableFlat(full);
      return { canvas: { ...flat, metadata }, docType, title };
    }
  }

  // 2. A seeded template with only a section-NAME list → scaffold heading nodes.
  const meta = coerceJsonb<{ sections?: unknown }>(tpl.metadata, {});
  const names = Array.isArray(meta.sections)
    ? meta.sections.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  if (names.length > 0) {
    const nodes: CanvasNode[] = names.map((name) =>
      createNode({ type: 'heading', content: { level: 2, text: name }, source: 'template', actorId: opts.actorId, actorName: 'Template' }),
    );
    return { canvas: { version: 1, document_id: opts.documentId, canvas: rules, nodes, metadata }, docType, title };
  }

  // 3. Nothing to seed → an empty canvas with just the page rules.
  const canvas = createEmptyCanvas({ documentId: opts.documentId, canvas: rules, metadata });
  return { canvas, docType, title };
}

/**
 * Count content nodes for the `node_count` column (flat or section layer).
 * Total-safe against a malformed section/group shape (client-supplied on save):
 * a missing `groups`/`nodes` array contributes 0 rather than throwing.
 */
export function countNodes(canvas: CanvasDocument): number {
  if (Array.isArray(canvas.nodes) && canvas.nodes.length) return canvas.nodes.length;
  if (Array.isArray(canvas.sections)) {
    return canvas.sections.reduce((sum, s) => sum
      + (Array.isArray(s?.groups) ? s.groups.reduce((g, grp) => g + (Array.isArray(grp?.nodes) ? grp.nodes.length : 0), 0) : 0), 0);
  }
  return 0;
}
