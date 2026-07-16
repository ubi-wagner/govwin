/**
 * Per-artifact / per-format export helpers.
 *
 * An artifact groups one or more section canvases into a deliverable. This
 * module resolves the artifact's NATIVE export format (narrative→docx,
 * slides→pptx, cost/spreadsheet→xlsx, or an explicit override incl. pdf),
 * assembles the artifact's ordered sections into a single CanvasDocument, and
 * renders it with the matching exporter. Used by the artifact-export route.
 *
 * docx/pptx/xlsx are pure Node. PDF uses Chromium (Playwright) via the
 * pdf-exporter's dynamic import — an infra dependency; callers should surface a
 * clear error when Chromium is unavailable.
 */
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';
import { exportToDocx } from './docx-exporter';

export type ExportFormat = 'docx' | 'pptx' | 'xlsx' | 'pdf';
export const EXPORT_FORMATS: ExportFormat[] = ['docx', 'pptx', 'xlsx', 'pdf'];

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Resolve the export format for an artifact. An explicit, valid `requested`
 * wins; otherwise the native format is derived from the canvas format first
 * (most specific) then the artifact_type.
 */
export function resolveArtifactFormat(
  artifactType: string | null | undefined,
  canvasFormat: string | null | undefined,
  requested?: string | null,
): ExportFormat {
  if (requested && (EXPORT_FORMATS as string[]).includes(requested)) return requested as ExportFormat;
  if (canvasFormat === 'slide_16_9' || canvasFormat === 'slide_4_3') return 'pptx';
  if (canvasFormat === 'spreadsheet' || artifactType === 'cost') return 'xlsx';
  return 'docx';
}

function pageBreak(): CanvasNode {
  return { id: crypto.randomUUID(), type: 'page_break', content: null, style: {}, provenance: { source: 'template' }, history: [], library_eligible: false };
}

/** A default canvas by artifact type when a section carries none. */
function fallbackCanvas(artifactType: string | null | undefined): CanvasRules {
  if (artifactType === 'cost') return CANVAS_PRESETS.spreadsheet;
  return CANVAS_PRESETS.letter_sbir_phase1;
}

/**
 * Assemble an artifact's ordered section canvases into one CanvasDocument:
 * the first section's canvas rules (or a type default) + every section's nodes,
 * separated by a page break. Malformed section content is skipped, not fatal.
 */
export function assembleArtifactCanvas(
  sections: Array<{ title: string | null; content: string | null }>,
  artifactType: string | null | undefined,
  title: string,
): CanvasDocument {
  const nodes: CanvasNode[] = [];
  let canvas: CanvasRules | null = null;
  let placed = 0;
  for (const s of sections) {
    let parsed: { canvas?: CanvasRules; nodes?: unknown } | null = null;
    try {
      parsed = s.content ? (JSON.parse(s.content) as { canvas?: CanvasRules; nodes?: unknown }) : null;
    } catch {
      parsed = null;
    }
    const secNodes: CanvasNode[] = Array.isArray(parsed?.nodes) ? (parsed!.nodes as CanvasNode[]) : [];
    if (secNodes.length === 0) continue;
    if (!canvas && parsed?.canvas) canvas = parsed.canvas;
    if (placed > 0) nodes.push(pageBreak());
    nodes.push(...secNodes);
    placed++;
  }
  return {
    version: 1,
    document_id: crypto.randomUUID(),
    canvas: canvas ?? fallbackCanvas(artifactType),
    nodes,
    metadata: {
      title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted',
    },
  };
}

/** Render a CanvasDocument to the given format. Throws on exporter failure. */
export async function renderCanvas(
  format: ExportFormat,
  doc: CanvasDocument,
  vars: Record<string, string>,
): Promise<Buffer> {
  if (format === 'pptx') { const { exportToPptx } = await import('./pptx-exporter'); return exportToPptx(doc, vars); }
  if (format === 'xlsx') { const { exportToXlsx } = await import('./xlsx-exporter'); return exportToXlsx(doc, vars); }
  if (format === 'pdf') { const { exportToPdf } = await import('./pdf-exporter'); return exportToPdf(doc, vars); }
  return exportToDocx(doc, vars);
}
