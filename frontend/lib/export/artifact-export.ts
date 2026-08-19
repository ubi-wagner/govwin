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
import type { CanvasDocument, CanvasNode, CanvasRules, CanvasSection } from '@/lib/types/canvas-document';
import { CANVAS_PRESETS, coalesceGroups, sectionsToNodes } from '@/lib/types/canvas-document';
import { finishVolumeCanvas, type VolumeFacts } from '@/lib/proposal/volume-finish';
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

/** A default canvas by artifact type when a section carries none. */
function fallbackCanvas(artifactType: string | null | undefined): CanvasRules {
  if (artifactType === 'cost') return CANVAS_PRESETS.spreadsheet;
  return CANVAS_PRESETS.letter_sbir_phase1;
}

/** Split a node run on `page_break` into chunks (each chunk = one slide / one page-broken block). */
function splitOnPageBreak(nodes: CanvasNode[]): CanvasNode[][] {
  const chunks: CanvasNode[][] = [];
  let cur: CanvasNode[] = [];
  for (const n of nodes) {
    if (n.type === 'page_break') { if (cur.length) chunks.push(cur); cur = []; }
    else cur.push(n);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Flatten one mold's stored content (v1 nodes or a v2 section blob) to nodes. */
type ParsedMold = { canvas?: CanvasRules; nodes?: unknown; sections?: unknown };
function moldNodes(content: string | null): { nodes: CanvasNode[]; canvas: CanvasRules | null } {
  let parsed: ParsedMold | null = null;
  try {
    parsed = content ? (JSON.parse(content) as ParsedMold) : null;
  } catch {
    parsed = null;
  }
  const nodes: CanvasNode[] = Array.isArray(parsed?.sections) && parsed.sections.length
    ? sectionsToNodes(parsed.sections as CanvasSection[])
    : Array.isArray(parsed?.nodes) ? (parsed.nodes as CanvasNode[]) : [];
  return { nodes, canvas: parsed?.canvas ?? null };
}

/**
 * Assemble an artifact's ordered molds into ONE v2 CanvasDocument that FLOWS:
 * each mold becomes a `flow` CanvasSection (figures/tables kept together), with
 * NO forced page breaks between molds — content runs continuously and the page
 * count emerges (the fix for bottom-of-page gaps between sections). The first
 * mold's canvas rules win; malformed/empty mold content is skipped, not fatal.
 */
export function assembleArtifactCanvas(
  sections: Array<{ title: string | null; content: string | null; pageAllocation?: number | null; characterAllocation?: number | null }>,
  artifactType: string | null | undefined,
  title: string,
  /**
   * Pass the volume's own facts to FINISH the assembled document — cover band, figures derived from
   * its own content, running header/footer, figure numbering (`lib/proposal/volume-finish.ts`).
   *
   * Opt-in rather than automatic because assembly has two kinds of caller. Delivery paths (export,
   * package, the on-screen document view) want the finished volume; extraction paths
   * (`templates/extract`, past-proposal reuse) want the sections back exactly as the author wrote
   * them — harvesting a generated cover band into a reusable template would put one tenant's
   * identity into another's starting point.
   */
  finish?: VolumeFacts,
): CanvasDocument {
  const outSections: CanvasSection[] = [];
  let canvas: CanvasRules | null = null;
  for (const s of sections) {
    const { nodes, canvas: secCanvas } = moldNodes(s.content);
    if (nodes.length === 0) continue;
    if (!canvas && secCanvas) canvas = secCanvas;
    // A single mold may itself contain page_breaks — a whole slide deck stored as
    // one section, or a document with a deliberate break. Split on them so each
    // becomes its own section (⇒ its own slide for pptx; a break_before page for
    // documents). Molds still FLOW into each other (no break between molds).
    splitOnPageBreak(nodes).forEach((chunk, ci) => {
      const groups = coalesceGroups(chunk);
      if (groups.length === 0) return;
      outSections.push({
        id: crypto.randomUUID(),
        ...(ci === 0 && s.title ? { title: s.title } : {}),
        // The item's own page cap (proposal_sections.page_allocation) rides the FIRST chunk as
        // layout.page_budget so the floor's section_over_budget check is live at export — without
        // it a 1-page cover sheet could eat 8 pages of a 15-page volume unflagged.
        layout: {
          mode: 'flow',
          ...(ci > 0 ? { break_before: true } : {}),
          ...(ci === 0 && s.pageAllocation != null && s.pageAllocation > 0 ? { page_budget: s.pageAllocation } : {}),
          // Same for the item's CHARACTER cap (proposal_sections.character_allocation), which is
          // how the agency measures a cover-sheet abstract or project summary. Rides the first
          // chunk so section_over_characters fires at the export gate.
          ...(ci === 0 && s.characterAllocation != null && s.characterAllocation > 0 ? { character_budget: s.characterAllocation } : {}),
        },
        groups,
      });
    });
  }
  const doc: CanvasDocument = {
    version: 2,
    document_id: crypto.randomUUID(),
    canvas: canvas ?? fallbackCanvas(artifactType),
    nodes: [],
    sections: outSections,
    metadata: {
      title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted',
    },
  };
  return finish
    ? finishVolumeCanvas(doc, { ...finish, artifactType: artifactType ?? 'narrative', volumeName: finish.volumeName ?? title })
    : doc;
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
